import React, { useState } from 'react';
import { BookOpen, RotateCcw, Trash2, X } from 'lucide-react';
import { DEFAULT_SETTINGS, getThemeById } from '../data/catalog';
import { applyGraphicsPreset } from '../game/rules';
import { AllSettings, GraphicsPreset, SaveData, TargetFps } from '../types/game';

interface SettingsModalProps {
  save: SaveData;
  isSoftwareGl: boolean;
  onUpdateSettings: (next: AllSettings) => void;
  onReplayTutorial: () => void;
  onDeleteSaveData: () => void;
  onClose: () => void;
}

type SettingsTab = 'audio' | 'gameplay' | 'graphics' | 'access' | 'general';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  save,
  isSoftwareGl,
  onUpdateSettings,
  onReplayTutorial,
  onDeleteSaveData,
  onClose,
}) => {
  const [tab, setTab] = useState<SettingsTab>('graphics');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [infoSheet, setInfoSheet] = useState<'privacy' | 'credits' | 'terms' | null>(null);
  const theme = getThemeById(save.selectedTheme);
  const s = save.settings;

  const setAudio = (patch: Partial<AllSettings['audio']>) =>
    onUpdateSettings({ ...s, audio: { ...s.audio, ...patch } });
  const setGameplay = (patch: Partial<AllSettings['gameplay']>) =>
    onUpdateSettings({ ...s, gameplay: { ...s.gameplay, ...patch } });
  const setGraphics = (patch: Partial<AllSettings['graphics']>) =>
    onUpdateSettings({ ...s, graphics: { ...s.graphics, ...patch } });
  const setAccess = (patch: Partial<AllSettings['accessibility']>) =>
    onUpdateSettings({ ...s, accessibility: { ...s.accessibility, ...patch } });
  const setGeneral = (patch: Partial<AllSettings['general']>) =>
    onUpdateSettings({ ...s, general: { ...s.general, ...patch } });

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#0b0e14]/98 p-4">
      <div className="flex items-center justify-between pb-3 border-b border-stone-800">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
            Real-Time Engine & Experience Preferences
          </p>
          <h2 className="font-display font-extrabold text-xl text-stone-100">SETTINGS</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center justify-center"
          aria-label="Close Settings"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-5 gap-1 mt-3 bg-stone-950/80 p-1 rounded-xl border border-stone-800">
        {(
          [
            ['graphics', 'GFX'],
            ['audio', 'Audio'],
            ['gameplay', 'Play'],
            ['access', 'Access'],
            ['general', 'General'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider ${
              tab === id ? 'text-stone-950' : 'text-stone-300'
            }`}
            style={tab === id ? { backgroundColor: theme.uiAccent } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto kharos-scroll mt-3 space-y-3 pr-1">
        {tab === 'audio' && (
          <div className="space-y-2.5">
            <ToggleRow
              label="Mute All Audio"
              checked={s.audio.muted}
              accent={theme.uiAccent}
              onChange={(v) => setAudio({ muted: v })}
            />
            <SliderRow label="Master Volume" value={s.audio.master} min={0} max={1} step={0.05} onChange={(v) => setAudio({ master: v })} />
            <SliderRow label="Music Volume" value={s.audio.music} min={0} max={1} step={0.05} onChange={(v) => setAudio({ music: v })} />
            <SliderRow label="Sound Effects" value={s.audio.sfx} min={0} max={1} step={0.05} onChange={(v) => setAudio({ sfx: v })} />
            <SliderRow label="Environment Audio" value={s.audio.environment} min={0} max={1} step={0.05} onChange={(v) => setAudio({ environment: v })} />
            <SliderRow label="Character Audio" value={s.audio.character} min={0} max={1} step={0.05} onChange={(v) => setAudio({ character: v })} />
            <SliderRow label="The Hollow Audio" value={s.audio.hollow} min={0} max={1} step={0.05} onChange={(v) => setAudio({ hollow: v })} />
            <SliderRow label="UI Audio" value={s.audio.ui} min={0} max={1} step={0.05} onChange={(v) => setAudio({ ui: v })} />
            <SliderRow label="Vibration Intensity" value={s.audio.vibrationIntensity} min={0} max={1} step={0.05} onChange={(v) => setAudio({ vibrationIntensity: v })} />
          </div>
        )}

        {tab === 'gameplay' && (
          <div className="space-y-2.5">
            <SliderRow label="Swipe Sensitivity" value={s.gameplay.swipeSensitivity} min={0.5} max={2.0} step={0.1} suffix="x" onChange={(v) => setGameplay({ swipeSensitivity: v })} />
            <SliderRow label="Camera Sensitivity" value={s.gameplay.cameraSensitivity} min={0.5} max={1.5} step={0.1} suffix="x" onChange={(v) => setGameplay({ cameraSensitivity: v })} />
            <SliderRow label="Camera Shake Intensity" value={s.gameplay.cameraShakeIntensity} min={0} max={1.5} step={0.1} suffix="x" onChange={(v) => setGameplay({ cameraShakeIntensity: v })} />
            <SliderRow label="Camera Motion Intensity" value={s.gameplay.cameraMotionIntensity} min={0.25} max={1.25} step={0.05} suffix="x" onChange={(v) => setGameplay({ cameraMotionIntensity: v })} />
            <ToggleRow label="Haptic Feedback" checked={s.gameplay.haptics} accent={theme.uiAccent} onChange={(v) => setGameplay({ haptics: v })} />
            <ToggleRow label="Visual Feedback Callouts" checked={s.gameplay.visualFeedback} accent={theme.uiAccent} onChange={(v) => setGameplay({ visualFeedback: v })} />
          </div>
        )}

        {tab === 'graphics' && (
          <div className="space-y-3">
            {/* Quality Preset Selector */}
            <div className="rounded-xl bg-stone-900/85 border border-stone-800 p-3">
              <div className="text-xs font-bold text-stone-200 mb-2">Graphics Preset</div>
              <div className="grid grid-cols-5 gap-1">
                {(['auto', 'low', 'medium', 'high', 'ultra'] as GraphicsPreset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        ...s,
                        graphics: applyGraphicsPreset(p, s.graphics, isSoftwareGl),
                      })
                    }
                    className={`py-1.5 rounded-lg text-[10px] font-bold uppercase ${
                      s.graphics.preset === p ? 'text-stone-950' : 'bg-stone-800 text-stone-300'
                    }`}
                    style={s.graphics.preset === p ? { backgroundColor: theme.uiAccent } : undefined}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Target FPS */}
            <div className="rounded-xl bg-stone-900/85 border border-stone-800 p-3">
              <div className="text-xs font-bold text-stone-200 mb-2">Target Frame Rate</div>
              <div className="grid grid-cols-5 gap-1">
                {([30, 60, 90, 120, 0] as TargetFps[]).map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    onClick={() => setGraphics({ targetFps: fps })}
                    className={`py-1.5 rounded-lg text-[10px] font-bold tabular-nums ${
                      s.graphics.targetFps === fps ? 'text-stone-950' : 'bg-stone-800 text-stone-300'
                    }`}
                    style={
                      s.graphics.targetFps === fps ? { backgroundColor: theme.uiAccent } : undefined
                    }
                  >
                    {fps === 0 ? 'Max' : `${fps}`}
                  </button>
                ))}
              </div>
            </div>

            <SliderRow
              label="Resolution Scaling"
              value={s.graphics.resolutionScale}
              min={0.6}
              max={1.0}
              step={0.05}
              onChange={(v) => setGraphics({ resolutionScale: v })}
            />
            <SliderRow
              label="Foliage & Landmark Density"
              value={s.graphics.foliageDensity}
              min={0.35}
              max={1.0}
              step={0.05}
              onChange={(v) => setGraphics({ foliageDensity: v })}
            />

            <ChoiceRow
              label="Texture Quality"
              value={s.graphics.textureQuality}
              options={['low', 'medium', 'high']}
              accent={theme.uiAccent}
              onChange={(v) => setGraphics({ textureQuality: v as 'low' | 'medium' | 'high' })}
            />
            <ChoiceRow
              label="Shadow Quality"
              value={s.graphics.shadowQuality}
              options={['off', 'low', 'high']}
              accent={theme.uiAccent}
              onChange={(v) => setGraphics({ shadowQuality: v as 'off' | 'low' | 'high' })}
            />
            <ChoiceRow
              label="Reflection Quality"
              value={s.graphics.reflectionQuality}
              options={['low', 'medium', 'high']}
              accent={theme.uiAccent}
              onChange={(v) => setGraphics({ reflectionQuality: v as 'low' | 'medium' | 'high' })}
            />
            <ChoiceRow
              label="Effects Quality"
              value={s.graphics.effectsQuality}
              options={['low', 'medium', 'high']}
              accent={theme.uiAccent}
              onChange={(v) => setGraphics({ effectsQuality: v as 'low' | 'medium' | 'high' })}
            />

            <ToggleRow label="Anti-Aliasing" checked={s.graphics.antiAliasing} accent={theme.uiAccent} onChange={(v) => setGraphics({ antiAliasing: v })} />
            <ToggleRow label="Ambient Occlusion" checked={s.graphics.ambientOcclusion} accent={theme.uiAccent} onChange={(v) => setGraphics({ ambientOcclusion: v })} />
            <ToggleRow label="Volumetric Fog" checked={s.graphics.volumetricFog} accent={theme.uiAccent} onChange={(v) => setGraphics({ volumetricFog: v })} />
            <ToggleRow label="Bloom Accents" checked={s.graphics.bloom} accent={theme.uiAccent} onChange={(v) => setGraphics({ bloom: v })} />
            <ToggleRow label="Motion Blur Trails" checked={s.graphics.motionBlur} accent={theme.uiAccent} onChange={(v) => setGraphics({ motionBlur: v })} />
            <ToggleRow label="Depth of Field" checked={s.graphics.depthOfField} accent={theme.uiAccent} onChange={(v) => setGraphics({ depthOfField: v })} />
          </div>
        )}

        {tab === 'access' && (
          <div className="space-y-2.5">
            <ToggleRow label="High Contrast Mode" checked={s.accessibility.highContrast} accent={theme.uiAccent} onChange={(v) => setAccess({ highContrast: v })} />
            <ChoiceRow
              label="Colorblind Filter"
              value={s.accessibility.colorblindMode}
              options={['none', 'protanopia', 'deuteranopia', 'tritanopia']}
              accent={theme.uiAccent}
              onChange={(v) =>
                setAccess({
                  colorblindMode: v as AllSettings['accessibility']['colorblindMode'],
                })
              }
            />
            <SliderRow
              label="UI Scale"
              value={s.accessibility.uiScale}
              min={0.9}
              max={1.15}
              step={0.05}
              suffix="x"
              onChange={(v) => setAccess({ uiScale: v })}
            />
            <ChoiceRow
              label="Subtitle Size"
              value={s.accessibility.subtitleSize}
              options={['small', 'medium', 'large']}
              accent={theme.uiAccent}
              onChange={(v) => setAccess({ subtitleSize: v as 'small' | 'medium' | 'large' })}
            />
            <ToggleRow label="Reduced Camera Motion" checked={s.accessibility.reducedCameraMotion} accent={theme.uiAccent} onChange={(v) => setAccess({ reducedCameraMotion: v })} />
            <ToggleRow label="Reduced Flashing Effects" checked={s.accessibility.reducedFlashing} accent={theme.uiAccent} onChange={(v) => setAccess({ reducedFlashing: v })} />
          </div>
        )}

        {tab === 'general' && (
          <div className="space-y-2.5">
            <div className="rounded-xl bg-stone-900/85 border border-stone-800 p-3 flex items-center justify-between">
              <label htmlFor="lang-select" className="text-xs font-bold text-stone-200">
                Language
              </label>
              <select
                id="lang-select"
                value={s.general.language}
                onChange={(e) =>
                  setGeneral({ language: e.target.value as AllSettings['general']['language'] })
                }
                className="bg-stone-800 text-stone-100 text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-stone-700"
              >
                {(['English', 'Español', 'Français', 'Deutsch', '日本語'] as const).map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={onReplayTutorial}
              className="w-full py-2.5 rounded-xl font-bold text-xs text-stone-950 flex items-center justify-center gap-2 cursor-pointer"
              style={{ backgroundColor: theme.uiAccent }}
            >
              <BookOpen className="w-4 h-4" />
              REPLAY INTERACTIVE TUTORIAL
            </button>

            <button
              type="button"
              onClick={() => onUpdateSettings(structuredClone(DEFAULT_SETTINGS))}
              className="w-full py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-100 text-xs font-bold flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              RESET SETTINGS TO DEFAULT
            </button>

            <div className="grid grid-cols-3 gap-1.5">
              {(['privacy', 'credits', 'terms'] as const).map((sheet) => (
                <button
                  key={sheet}
                  type="button"
                  onClick={() => setInfoSheet(infoSheet === sheet ? null : sheet)}
                  className="py-2 rounded-lg bg-stone-900 border border-stone-800 text-[11px] font-bold uppercase text-stone-300 hover:text-white"
                >
                  {sheet}
                </button>
              ))}
            </div>

            {infoSheet && (
              <div className="rounded-xl bg-stone-950 border border-stone-700 p-3 text-[11px] text-stone-300 leading-relaxed">
                {infoSheet === 'privacy' &&
                  'All progression, coins, unlocks, and settings are stored strictly locally in your device browser storage with automatic integrity validation. Zero personal tracking or third-party ad SDKs.'}
                {infoSheet === 'credits' &&
                  'Kharos: The Hollow Run — Original 3D Portrait Endless Runner. Procedural PBR environments, real-time Web Audio adaptive soundtrack, 20 handcrafted realms, 4 playable explorers, and The Hollow guardian.'}
                {infoSheet === 'terms' &&
                  'All gameplay progression, characters, outfits, ability upgrades, and themes are earnable through fair play. Optional shop bundles in this build operate as non-billed demo grants.'}
              </div>
            )}

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full py-2.5 rounded-xl bg-red-950/70 hover:bg-red-900/80 border border-red-700/60 text-red-200 text-xs font-bold flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                DELETE GAME DATA
              </button>
            ) : (
              <div className="rounded-xl bg-red-950/80 border border-red-500/60 p-3 space-y-2 text-center">
                <p className="text-xs text-red-100 font-semibold">
                  Permanently erase all 20-level progress, coins, unlocks, and records?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="py-1.5 rounded-lg bg-stone-800 text-stone-200 text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(false);
                      onDeleteSaveData();
                    }}
                    className="py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold"
                  >
                    Erase All
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const SliderRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, suffix, onChange }) => (
  <div className="rounded-xl bg-stone-900/85 border border-stone-800 px-3 py-2.5">
    <div className="flex items-center justify-between text-xs mb-1.5">
      <span className="font-semibold text-stone-200">{label}</span>
      <span className="font-bold tabular-nums text-amber-300">
        {suffix ? `${value.toFixed(1)}${suffix}` : `${Math.round(value * 100)}%`}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      aria-label={label}
      className="w-full accent-amber-400 cursor-pointer"
    />
  </div>
);

const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  accent: string;
  onChange: (v: boolean) => void;
}> = ({ label, checked, accent, onChange }) => (
  <div className="rounded-xl bg-stone-900/85 border border-stone-800 px-3 py-2.5 flex items-center justify-between">
    <span className="text-xs font-semibold text-stone-200">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer"
      style={{ backgroundColor: checked ? accent : '#3f3f46' }}
    >
      <span
        className={`block w-5 h-5 rounded-full bg-stone-950 transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
);

const ChoiceRow: React.FC<{
  label: string;
  value: string;
  options: string[];
  accent: string;
  onChange: (v: string) => void;
}> = ({ label, value, options, accent, onChange }) => (
  <div className="rounded-xl bg-stone-900/85 border border-stone-800 p-3">
    <div className="text-xs font-semibold text-stone-200 mb-2">{label}</div>
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`py-1.5 rounded-lg text-[10px] font-bold uppercase ${
            value === opt ? 'text-stone-950' : 'bg-stone-800 text-stone-300'
          }`}
          style={value === opt ? { backgroundColor: accent } : undefined}
        >
          {opt}
        </button>
      ))}
    </div>
  </div>
);
