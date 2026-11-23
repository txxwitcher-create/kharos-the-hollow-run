import { AudioSettings, LevelDef } from '../types/game';

export type FootstepSurface =
  | 'stone'
  | 'dirt'
  | 'wet_stone'
  | 'snow'
  | 'metal'
  | 'wood'
  | 'sand'
  | 'cave';

export type EffortKind =
  | 'light_breath'
  | 'breath'
  | 'jump'
  | 'double_jump'
  | 'land_soft'
  | 'land_hard'
  | 'slide'
  | 'near_miss'
  | 'stumble'
  | 'collision'
  | 'recovery_breath'
  | 'ability'
  | 'death';

/**
 * Procedural Web Audio API sound design & dynamic 20-biome soundtrack engine.
 * Zero external audio files — 100% real-time synthesized percussion, pads, motifs,
 * 8-surface terrain-matched footsteps, warm natural formant+aspiration human vocals,
 * gear foley, The Hollow roars/growls/stomps, and UI feedback.
 */
export class KharosAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private envGain: GainNode | null = null;
  private charGain: GainNode | null = null;
  private hollowGain: GainNode | null = null;
  private uiGain: GainNode | null = null;

  private settings: AudioSettings;
  private musicTimer: number | null = null;
  private ambientNode: AudioBufferSourceNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private currentLevel: LevelDef | null = null;
  private stepIdx = 0;
  private intensity = 0.25; // 0..1 driven by speed & Hollow proximity
  private coinChainCount = 0;
  private lastCoinTime = 0;
  private lastEffortAt: Partial<Record<EffortKind, number>> = {};
  private lastEffortVariant: Partial<Record<EffortKind, number>> = {};
  private lastFootstepVariant = -1;
  private lastRustleAt = 0;
  private lastGrowlAt = 0;
  private paused = false;

  constructor(settings: AudioSettings) {
    this.settings = { ...settings };
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.envGain = this.ctx.createGain();
      this.charGain = this.ctx.createGain();
      this.hollowGain = this.ctx.createGain();
      this.uiGain = this.ctx.createGain();

      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.envGain.connect(this.masterGain);
      this.charGain.connect(this.masterGain);
      this.hollowGain.connect(this.masterGain);
      this.uiGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.applySettings(this.settings);
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public applySettings(settings: AudioSettings): void {
    this.settings = { ...settings };
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const m = settings.muted ? 0 : settings.master;
    this.masterGain.gain.setTargetAtTime(m, now, 0.04);
    this.musicGain?.gain.setTargetAtTime(settings.music * 0.42, now, 0.05);
    this.sfxGain?.gain.setTargetAtTime(settings.sfx * 0.65, now, 0.04);
    this.envGain?.gain.setTargetAtTime(settings.environment * 0.22, now, 0.08);
    this.charGain?.gain.setTargetAtTime(settings.character * 0.58, now, 0.04);
    this.hollowGain?.gain.setTargetAtTime(settings.hollow * 0.8, now, 0.04);
    this.uiGain?.gain.setTargetAtTime(settings.ui * 0.55, now, 0.03);
  }

  public vibrate(pattern: number | number[], enabled: boolean): void {
    if (!enabled || this.settings.muted || this.settings.vibrationIntensity <= 0.02) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const scale = this.settings.vibrationIntensity;
      if (Array.isArray(pattern)) {
        navigator.vibrate(pattern.map((v) => Math.max(5, Math.round(v * scale))));
      } else {
        navigator.vibrate(Math.max(5, Math.round(pattern * scale)));
      }
    }
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx) return;
    if (paused) {
      this.musicGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.envGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    } else {
      this.applySettings(this.settings);
    }
  }

  public setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
    if (this.ambientFilter && this.ctx) {
      this.ambientFilter.frequency.setTargetAtTime(320 + this.intensity * 900, this.ctx.currentTime, 0.15);
    }
  }

  public startEnvironmentSoundtrack(level: LevelDef): void {
    this.currentLevel = level;
    this.stopMusic();
    this.unlock();
    if (!this.ctx) return;

    this.startAmbientBed(level);

    const stepMs = Math.max(150, Math.round(60000 / level.musicBpm / 2));
    this.stepIdx = 0;
    this.musicTimer = window.setInterval(() => {
      if (this.paused || !this.ctx || this.ctx.state !== 'running' || this.settings.muted) return;
      this.playMusicStep();
    }, stepMs);
  }

  private startAmbientBed(level: LevelDef): void {
    if (!this.ctx || !this.envGain) return;
    this.stopAmbientBed();

    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      data[i] = last * 2.4;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    const isWaterOrRain =
      level.weather === 'rain' || level.weather === 'bubbles' || level.weather === 'drizzle';
    filter.type = isWaterOrRain ? 'bandpass' : 'lowpass';
    filter.frequency.value = isWaterOrRain ? 950 : 440;
    filter.Q.value = isWaterOrRain ? 1.2 : 0.7;

    src.connect(filter);
    filter.connect(this.envGain);
    src.start();
    this.ambientNode = src;
    this.ambientFilter = filter;
  }

  private stopAmbientBed(): void {
    if (this.ambientNode) {
      try {
        this.ambientNode.stop();
        this.ambientNode.disconnect();
      } catch {
        // ignore already stopped
      }
      this.ambientNode = null;
    }
    this.ambientFilter = null;
  }

  public stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.stopAmbientBed();
  }

  private playMusicStep(): void {
    if (!this.ctx || !this.musicGain || !this.currentLevel) return;
    const now = this.ctx.currentTime;
    const lvl = this.currentLevel;
    const step = this.stepIdx++;
    const scale = lvl.musicScale;

    const kickPattern = step % 4 === 0 || (this.intensity > 0.55 && step % 8 === 6);
    if (kickPattern) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(115, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
      gain.gain.setValueAtTime(0.32 + this.intensity * 0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 0.2);
    }

    if (step % 2 === 1 && this.intensity > 0.2) {
      this.playNoiseBurst(
        0.04,
        2400 + (step % 4) * 350,
        0.08 + this.intensity * 0.06,
        this.musicGain,
      );
    }

    if (step % 2 === 0) {
      const degree = scale[(step / 2 + Math.floor(step / 8)) % scale.length];
      const octaveBoost = step % 16 >= 8 ? 2 : 1;
      const freq = lvl.musicRootHz * Math.pow(2, degree / 12) * octaveBoost;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      const crystalline =
        lvl.weather === 'snow' || lvl.weather === 'crystal_glint' || lvl.weather === 'aurora';
      osc.type = crystalline ? 'sine' : lvl.id >= 17 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(crystalline ? 2400 : 900 + this.intensity * 1200, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.11 + this.intensity * 0.06, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 0.36);
    }

    if (step % 8 === 0) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(lvl.musicRootHz * 0.5, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.14, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
      osc.connect(gain);
      gain.connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 1.35);
    }

    // Subtle organic environmental ambience pulses (distant birds, water shimmer, mountain wind, cave echo)
    if (step > 4 && step % 24 === 12) {
      this.playAmbientNaturePulse(lvl, step);
    }
  }

  private playAmbientNaturePulse(lvl: LevelDef, step: number): void {
    if (!this.ctx || !this.envGain || this.settings.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const arch = lvl.architecture;

    if (
      arch === 'jungle_temple' ||
      arch === 'whispering_woods' ||
      arch === 'giant_canopy' ||
      arch === 'colossus_sanctuary' ||
      arch === 'lost_ziggurat'
    ) {
      // Soft distant 2-note woodland / jungle songbird chirp (varied pitch, gentle volume)
      const baseHz = 1850 + ((step * 173) % 750);
      for (let i = 0; i < 2; i++) {
        const t0 = now + i * 0.14;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseHz * (i === 0 ? 1 : 1.18), t0);
        osc.frequency.exponentialRampToValueAtTime(baseHz * (i === 0 ? 1.24 : 0.92), t0 + 0.11);
        g.gain.setValueAtTime(0.001, t0);
        g.gain.linearRampToValueAtTime(0.11, t0 + 0.025);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        osc.connect(g);
        g.connect(this.envGain);
        osc.start(t0);
        osc.stop(t0 + 0.13);
      }
    } else if (arch === 'drowned_arches' || arch === 'storm_monoliths') {
      // Airy flowing water / surf shimmer swell
      this.playNoiseBurst(0.65, 1180 + (step % 3) * 180, 0.16, this.envGain, 1.8);
    } else if (
      arch === 'hollow_ribs' ||
      arch === 'crystal_caverns' ||
      arch === 'iron_mines' ||
      arch === 'shattered_realm'
    ) {
      // Resonant subterranean cave / crystal chime echo
      const hz = arch === 'crystal_caverns' ? 740 + (step % 4) * 110 : 195 + (step % 3) * 32;
      this.playTone(hz, hz * 0.94, 0.72, 'sine', 0.12, this.envGain);
    } else {
      // Gentle sweeping canyon / summit / desert wind gust
      this.playNoiseBurst(0.75, 520 + (step % 5) * 95, 0.14, this.envGain, 2.2);
    }
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    target: GainNode | null,
  ): void {
    if (!this.ctx || !target || this.settings.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    }
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(target);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private playNoiseBurst(
    duration: number,
    centerHz: number,
    volume: number,
    target: GainNode | null,
    q = 1.4,
  ): void {
    if (!this.ctx || !target || this.settings.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centerHz;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(target);
    src.start(now);
  }

  private pickAntiRepeatVariant(prev: number, count = 4): number {
    const idx = Math.floor(Math.random() * count);
    return idx === prev ? (idx + 1 + Math.floor(Math.random() * (count - 1))) % count : idx;
  }

  /**
   * Warm pink-filtered breath aspiration buffer (eliminates harsh white-noise hiss).
   */
  private playBreathAspiration(
    duration: number,
    centerHz: number,
    volume: number,
    q = 1.6,
    attackSec = 0.022,
  ): void {
    if (!this.ctx || !this.charGain || this.settings.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Paul Kellet pink-noise approximation for organic chest/nasal breath texture
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      const t = i / len;
      const windowEnv = Math.sin(Math.min(1, t * 4.5) * Math.PI * 0.5) * Math.pow(1 - t, 1.15);
      data[i] = (b0 + b1 + b2 + white * 0.04) * 3.8 * windowEnv;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(centerHz, now);
    bp.Q.value = q;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(3400, centerHz * 2.1), now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0008, now);
    gain.gain.linearRampToValueAtTime(volume, now + Math.min(attackSec, duration * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

    src.connect(bp);
    bp.connect(lp);
    lp.connect(gain);
    gain.connect(this.charGain);
    src.start(now);
  }

  /**
   * Subtle expedition cloth / leather gear rustle synchronized with agile parkour actions.
   */
  public playGearRustle(intensity = 0.6): void {
    if (!this.ctx || !this.charGain || this.settings.muted || this.ctx.state !== 'running') return;
    const nowMs = performance.now();
    if (nowMs - this.lastRustleAt < 260) return;
    this.lastRustleAt = nowMs;
    const jitter = 0.9 + Math.random() * 0.2;
    this.playBreathAspiration(0.095, 1650 * jitter, 0.042 * intensity, 1.35, 0.015);
  }

  /**
   * Natural, grounded human vocalization engine:
   * - Soft low-passed glottal pulse (zero harsh synthetic sawtooth buzz)
   * - 3 parallel vocal-tract formant resonators with gender-accurate pitch & vowel shaping
   * - Pink-noise chest/oral breath aspiration
   * - 4-variant anti-repeat bank + strict cooldowns so vocals stay restrained and believable.
   */
  public playHumanEffort(kind: EffortKind, gender: 'male' | 'female'): void {
    if (!this.ctx || !this.charGain || this.settings.muted || this.ctx.state !== 'running') return;
    const nowMs = performance.now();
    const cooldowns: Record<EffortKind, number> = {
      light_breath: 3400,
      breath: 2600,
      jump: 520,
      double_jump: 460,
      land_soft: 780,
      land_hard: 620,
      slide: 680,
      near_miss: 1200,
      stumble: 860,
      collision: 860,
      recovery_breath: 2200,
      ability: 1400,
      death: 950,
    };
    const prev = this.lastEffortAt[kind] ?? 0;
    if (nowMs - prev < cooldowns[kind]) return;
    this.lastEffortAt[kind] = nowMs;

    const variant = this.pickAntiRepeatVariant(this.lastEffortVariant[kind] ?? -1, 4);
    this.lastEffortVariant[kind] = variant;

    const variantPitch = [0.95, 1.0, 1.045, 0.975][variant];
    const variantFormant = [0.96, 1.0, 1.05, 0.93][variant];
    const jitter = (0.985 + Math.random() * 0.03) * variantPitch;
    const isFemale = gender === 'female';
    const now = this.ctx.currentTime;

    let dur = 0.14;
    let f0Start = isFemale ? 212 : 118;
    let f0End = isFemale ? 232 : 132;
    let formants: [number, number, number] = isFemale ? [670, 1340, 2580] : [520, 1080, 2260];
    let voiceVol = 0.095;
    let breathVol = 0.08;
    let attackSec = 0.022;

    switch (kind) {
      case 'light_breath':
        dur = 0.21;
        voiceVol = 0.008;
        breathVol = 0.055;
        attackSec = 0.05;
        f0Start = isFemale ? 192 : 108;
        f0End = isFemale ? 178 : 100;
        formants = isFemale ? [600, 1220, 2420] : [470, 980, 2140];
        break;
      case 'breath':
        dur = 0.19;
        voiceVol = 0.022;
        breathVol = 0.078;
        attackSec = 0.035;
        f0Start = isFemale ? 198 : 112;
        f0End = isFemale ? 180 : 102;
        formants = isFemale ? [620, 1260, 2480] : [490, 1020, 2200];
        break;
      case 'recovery_breath':
        dur = 0.28;
        voiceVol = 0.026;
        breathVol = 0.092;
        attackSec = 0.055;
        f0Start = isFemale ? 204 : 115;
        f0End = isFemale ? 172 : 96;
        formants = isFemale ? [640, 1300, 2520] : [500, 1040, 2220];
        break;
      case 'jump':
        dur = 0.125;
        voiceVol = 0.088;
        breathVol = 0.072;
        f0Start = isFemale ? 222 : 128;
        f0End = isFemale ? 256 : 150;
        formants = isFemale ? [710, 1420, 2660] : [560, 1140, 2320];
        break;
      case 'double_jump':
        dur = 0.145;
        voiceVol = 0.102;
        breathVol = 0.085;
        f0Start = isFemale ? 248 : 144;
        f0End = isFemale ? 294 : 174;
        formants = isFemale ? [750, 1560, 2760] : [595, 1240, 2400];
        break;
      case 'land_soft':
        dur = 0.11;
        voiceVol = 0.032;
        breathVol = 0.064;
        f0Start = isFemale ? 198 : 116;
        f0End = isFemale ? 175 : 100;
        formants = isFemale ? [580, 1190, 2410] : [465, 980, 2120];
        break;
      case 'land_hard':
        dur = 0.155;
        voiceVol = 0.105;
        breathVol = 0.098;
        f0Start = isFemale ? 208 : 124;
        f0End = isFemale ? 162 : 94;
        formants = isFemale ? [630, 1220, 2450] : [500, 1020, 2150];
        break;
      case 'slide':
        dur = 0.175;
        voiceVol = 0.056;
        breathVol = 0.095;
        f0Start = isFemale ? 200 : 116;
        f0End = isFemale ? 176 : 101;
        formants = isFemale ? [555, 1300, 2490] : [445, 1050, 2180];
        break;
      case 'near_miss':
        dur = 0.135;
        voiceVol = 0.044;
        breathVol = 0.088;
        attackSec = 0.014;
        f0Start = isFemale ? 236 : 138;
        f0End = isFemale ? 268 : 156;
        formants = isFemale ? [720, 1540, 2680] : [580, 1240, 2360];
        break;
      case 'ability':
        dur = 0.16;
        voiceVol = 0.092;
        breathVol = 0.082;
        f0Start = isFemale ? 230 : 136;
        f0End = isFemale ? 274 : 162;
        formants = isFemale ? [740, 1480, 2720] : [590, 1210, 2380];
        break;
      case 'stumble':
      case 'collision':
        dur = 0.21;
        voiceVol = 0.132;
        breathVol = 0.105;
        attackSec = 0.015;
        f0Start = isFemale ? 252 : 148;
        f0End = isFemale ? 178 : 100;
        formants = isFemale ? [780, 1480, 2680] : [630, 1180, 2300];
        break;
      case 'death':
        dur = 0.34;
        voiceVol = 0.165;
        breathVol = 0.115;
        attackSec = 0.018;
        f0Start = isFemale ? 265 : 156;
        f0End = isFemale ? 136 : 79;
        formants = isFemale ? [810, 1440, 2620] : [650, 1150, 2240];
        break;
    }

    if (voiceVol > 0.012) {
      // Softened glottal source (sawtooth pre-warmed through 1.4kHz lowpass -> natural vocal cords, zero buzz)
      const glottis = this.ctx.createOscillator();
      glottis.type = 'sawtooth';
      glottis.frequency.setValueAtTime(f0Start * jitter, now);
      glottis.frequency.exponentialRampToValueAtTime(Math.max(55, f0End * jitter), now + dur);

      const glottalWarmth = this.ctx.createBiquadFilter();
      glottalWarmth.type = 'lowpass';
      glottalWarmth.frequency.setValueAtTime(isFemale ? 1750 : 1350, now);
      glottis.connect(glottalWarmth);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0008, now);
      env.gain.linearRampToValueAtTime(voiceVol, now + Math.min(attackSec, dur * 0.35));
      env.gain.exponentialRampToValueAtTime(0.0008, now + dur);

      const formantWeights = [1.0, 0.52, 0.22];
      const formantQs = [4.6, 6.2, 7.6];
      formants.forEach((hz, idx) => {
        if (!this.ctx) return;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(hz * variantFormant, now);
        bp.Q.value = formantQs[idx];

        const fg = this.ctx.createGain();
        fg.gain.value = formantWeights[idx];
        glottalWarmth.connect(bp);
        bp.connect(fg);
        fg.connect(env);
      });

      env.connect(this.charGain);
      glottis.start(now);
      glottis.stop(now + dur + 0.03);
    }

    // Organic pink-filtered chest/oral breath exhalation layer
    this.playBreathAspiration(dur * 0.96, formants[1] * 0.88 * variantFormant, breathVol, 1.3, attackSec);
  }

  // Player Surface Footsteps across all 8 grounded terrain types with 4-variant anti-repeat randomization
  public playFootstep(surface: FootstepSurface = 'stone'): void {
    const v = this.pickAntiRepeatVariant(this.lastFootstepVariant, 4);
    this.lastFootstepVariant = v;
    const pitchVar = [0.91, 0.98, 1.05, 1.12][v] * (0.97 + Math.random() * 0.06);
    const volVar = [0.92, 1.0, 1.06, 0.95][v];

    switch (surface) {
      case 'dirt':
        // Soft earthy crunch + muted soil thud
        this.playTone(86 * pitchVar, 44, 0.045, 'sine', 0.095 * volVar, this.charGain);
        this.playNoiseBurst(0.056, 620 * pitchVar, 0.115 * volVar, this.charGain, 1.25);
        this.playNoiseBurst(0.038, 1650 * pitchVar, 0.048 * volVar, this.charGain, 1.8);
        break;
      case 'wet_stone':
        // Crisp damp stone slap + fine splash spray
        this.playTone(124 * pitchVar, 62, 0.044, 'sine', 0.095 * volVar, this.charGain);
        this.playNoiseBurst(0.082, 1880 * pitchVar, 0.125 * volVar, this.charGain, 1.05);
        this.playTone(340 * pitchVar, 155, 0.055, 'sine', 0.065 * volVar, this.charGain);
        break;
      case 'snow':
        // Crisp compacted snow squeak + muffled step
        this.playNoiseBurst(0.068, 1520 * pitchVar, 0.125 * volVar, this.charGain, 1.9);
        this.playNoiseBurst(0.052, 560 * pitchVar, 0.075 * volVar, this.charGain, 1.2);
        break;
      case 'wood':
        // Warm hollow timber thump + dry board tap
        this.playTone(168 * pitchVar, 92, 0.058, 'triangle', 0.125 * volVar, this.charGain);
        this.playNoiseBurst(0.042, 540 * pitchVar, 0.09 * volVar, this.charGain, 2.2);
        break;
      case 'metal':
        // Boot-heel clang + muted steel plate resonance
        this.playTone(690 * pitchVar, 490, 0.068, 'triangle', 0.088 * volVar, this.charGain);
        this.playNoiseBurst(0.046, 1520 * pitchVar, 0.1 * volVar, this.charGain, 2.9);
        break;
      case 'sand':
        // Soft granular slide + low cushioned heel drop
        this.playTone(76 * pitchVar, 40, 0.046, 'sine', 0.07 * volVar, this.charGain);
        this.playNoiseBurst(0.076, 1280 * pitchVar, 0.11 * volVar, this.charGain, 0.95);
        break;
      case 'cave':
        // Resonant damp cavern stone strike + subtle dark echo tail
        this.playTone(116 * pitchVar, 58, 0.055, 'sine', 0.105 * volVar, this.charGain);
        this.playNoiseBurst(0.062, 460 * pitchVar, 0.11 * volVar, this.charGain, 1.9);
        this.playNoiseBurst(0.11, 820 * pitchVar, 0.042 * volVar, this.charGain, 2.5);
        break;
      case 'stone':
      default:
        // Solid weathered flagstone heel/toe tap + fine grit
        this.playTone(108 * pitchVar, 54, 0.044, 'sine', 0.102 * volVar, this.charGain);
        this.playNoiseBurst(0.046, 390 * pitchVar, 0.112 * volVar, this.charGain, 1.65);
        break;
    }
  }

  public playJump(isDouble = false, gender: 'male' | 'female' = 'male'): void {
    this.unlock();
    const base = isDouble ? 340 : 205;
    this.playTone(base, base * 1.95, 0.14, 'triangle', 0.16, this.charGain);
    this.playGearRustle(0.75);
    this.playHumanEffort(isDouble ? 'double_jump' : 'jump', gender);
  }

  public playLand(hard = false, gender: 'male' | 'female' = 'male', surface: FootstepSurface = 'stone'): void {
    this.playTone(hard ? 126 : 94, 38, hard ? 0.17 : 0.095, 'sine', hard ? 0.3 : 0.16, this.charGain);
    const surfaceHz =
      surface === 'snow'
        ? 1280
        : surface === 'wet_stone'
          ? 1680
          : surface === 'sand'
            ? 1120
            : surface === 'wood'
              ? 480
              : surface === 'metal'
                ? 1420
                : 280;
    this.playNoiseBurst(hard ? 0.12 : 0.06, surfaceHz, hard ? 0.2 : 0.11, this.charGain);
    this.playHumanEffort(hard ? 'land_hard' : 'land_soft', gender);
  }

  public playSlide(gender: 'male' | 'female' = 'male', surface: FootstepSurface = 'stone'): void {
    this.unlock();
    const slideHz = surface === 'snow' ? 1320 : surface === 'wet_stone' ? 1480 : surface === 'sand' ? 1050 : 720;
    this.playNoiseBurst(0.28, slideHz, 0.19, this.charGain);
    this.playTone(170, 88, 0.2, 'sine', 0.12, this.charGain);
    this.playGearRustle(0.85);
    this.playHumanEffort('slide', gender);
  }

  public playTurn(): void {
    this.unlock();
    this.playNoiseBurst(0.13, 1080, 0.17, this.charGain);
    this.playTone(255, 410, 0.11, 'triangle', 0.15, this.charGain);
    this.playGearRustle(0.65);
  }

  public playNearMiss(gender: 'male' | 'female' = 'male'): void {
    this.playNoiseBurst(0.15, 1780, 0.22, this.sfxGain);
    this.playTone(520, 290, 0.13, 'sine', 0.17, this.sfxGain);
    this.playHumanEffort('near_miss', gender);
  }

  public playCoin(isBonus = false): void {
    const now = performance.now();
    if (now - this.lastCoinTime < 450) {
      this.coinChainCount = Math.min(12, this.coinChainCount + 1);
    } else {
      this.coinChainCount = 0;
    }
    this.lastCoinTime = now;
    const pitch = (isBonus ? 980 : 760) * Math.pow(1.045, this.coinChainCount);
    this.playTone(pitch, pitch * 1.48, 0.11, 'sine', isBonus ? 0.24 : 0.17, this.sfxGain);
  }

  public playAbilityActivate(gender: 'male' | 'female' = 'male'): void {
    this.unlock();
    this.playTone(320, 740, 0.24, 'triangle', 0.24, this.sfxGain);
    this.playTone(480, 960, 0.28, 'sine', 0.16, this.sfxGain);
    this.playHumanEffort('ability', gender);
  }

  public playShieldBreak(): void {
    this.playNoiseBurst(0.22, 2200, 0.3, this.sfxGain);
    this.playTone(620, 180, 0.24, 'sawtooth', 0.2, this.sfxGain);
  }

  public playCollision(lethal: boolean, gender: 'male' | 'female' = 'male'): void {
    this.playTone(lethal ? 148 : 118, 34, lethal ? 0.34 : 0.2, 'sawtooth', lethal ? 0.38 : 0.26, this.charGain);
    this.playNoiseBurst(lethal ? 0.28 : 0.16, 380, lethal ? 0.32 : 0.2, this.sfxGain);
    this.playHumanEffort(lethal ? 'death' : 'collision', gender);
  }

  public playCollapse(): void {
    this.playNoiseBurst(0.32, 220, 0.3, this.envGain);
    this.playTone(90, 35, 0.28, 'triangle', 0.28, this.envGain);
  }

  public playWindGust(): void {
    if (!this.ctx || !this.envGain || this.settings.muted) return;
    this.playNoiseBurst(0.65, 520 + Math.random() * 280, 0.14, this.envGain, 0.85);
    this.playNoiseBurst(0.45, 1180 + Math.random() * 320, 0.06, this.envGain, 1.4);
  }

  public playDistantRockfall(): void {
    if (!this.ctx || !this.envGain || this.settings.muted) return;
    this.playTone(72, 34, 0.42, 'sine', 0.15, this.envGain);
    this.playNoiseBurst(0.46, 260, 0.18, this.envGain, 1.1);
    setTimeout(() => this.playNoiseBurst(0.24, 520, 0.09, this.envGain, 1.6), 140);
  }

  // The Hollow Pursuer SFX
  public playHollowRoar(proximity = 0.8): void {
    const vol = Math.max(0.12, Math.min(0.52, proximity * 0.46));
    this.playTone(118, 42, 0.7, 'sawtooth', vol, this.hollowGain);
    this.playTone(74, 34, 0.68, 'triangle', vol * 0.7, this.hollowGain);
    this.playNoiseBurst(0.58, 290, vol * 0.85, this.hollowGain);
  }

  public playHollowGrowl(proximity = 0.75): void {
    const nowMs = performance.now();
    if (nowMs - this.lastGrowlAt < 2400) return;
    this.lastGrowlAt = nowMs;
    const vol = Math.max(0.1, Math.min(0.4, proximity * 0.36));
    this.playTone(86, 48, 0.44, 'sawtooth', vol, this.hollowGain);
    this.playNoiseBurst(0.36, 210, vol * 0.75, this.hollowGain, 1.8);
  }

  public playHollowStomp(proximity = 0.7): void {
    const vol = Math.max(0.08, Math.min(0.42, proximity * 0.38));
    this.playTone(82, 28, 0.22, 'sine', vol, this.hollowGain);
    this.playNoiseBurst(0.14, 180, vol * 0.6, this.hollowGain);
  }

  // UI & Outcome SFX
  public playUiClick(): void {
    this.unlock();
    this.playTone(540, 420, 0.06, 'triangle', 0.16, this.uiGain);
  }

  public playUiPurchase(): void {
    this.unlock();
    this.playTone(523.25, 659.25, 0.12, 'triangle', 0.2, this.uiGain);
    setTimeout(() => this.playTone(659.25, 1046.5, 0.18, 'sine', 0.22, this.uiGain), 90);
  }

  public playVictoryFanfare(): void {
    this.unlock();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, n * 1.01, 0.32, 'triangle', 0.24, this.uiGain), idx * 120);
    });
  }

  public playGameOverSting(): void {
    this.unlock();
    this.playTone(260, 185, 0.28, 'sawtooth', 0.22, this.uiGain);
    setTimeout(() => this.playTone(185, 98, 0.48, 'triangle', 0.26, this.uiGain), 190);
  }

  public dispose(): void {
    this.stopMusic();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
