import {
  ACHIEVEMENTS,
  CAMPAIGN_LEVELS,
  CHARACTERS,
  DAILY_MISSIONS,
  DEFAULT_SETTINGS,
  OUTFITS,
  PREMIUM_THEMES,
  getCharacterById,
  getLevelById,
} from '../data/catalog';
import {
  AbilityId,
  AllSettings,
  CharacterId,
  GraphicsPreset,
  GraphicsSettings,
  LevelDef,
  LevelRewardBreakdown,
  ObstacleKind,
  PlayMode,
  RouteId,
  RunStats,
  SaveData,
  TrackBranch,
  TrackCoin,
  TrackObstacle,
  TrackTurn,
} from '../types/game';
import {
  BRANCH_CURVE_LENGTH,
  BRANCH_LATERAL_OFFSET,
  computeCameraClearanceOffset,
  computeDesiredChaseCamera,
  computeProgressiveSpeed,
  findApproachingBranch,
  generateSkillTrackSlice,
  isZInsideBranchZone,
  sampleRoutePose,
  sampleTrackPoint,
  selectBranchRoute,
  verifyBranchTrackFairness,
} from './track';

export {
  BRANCH_CURVE_LENGTH,
  BRANCH_LATERAL_OFFSET,
  computeCameraClearanceOffset,
  computeDesiredChaseCamera,
  computeProgressiveSpeed,
  findApproachingBranch,
  generateSkillTrackSlice,
  isZInsideBranchZone,
  sampleRoutePose,
  sampleTrackPoint,
  selectBranchRoute,
  verifyBranchTrackFairness,
};

export const SAVE_STORAGE_KEY = 'kharos_hollow_run_save_v1';
export const SAVE_BACKUP_KEY = 'kharos_hollow_run_save_backup_v1';
export const SAVE_VERSION = 1;

export const LANE_WIDTH = 2.35;
export const GRAVITY = 38;
export const JUMP_VELOCITY = 14.6;
export const DOUBLE_JUMP_VELOCITY = 13.4;
export const SLIDE_DURATION = 0.72;
export const COYOTE_TIME = 0.11;
export const INPUT_BUFFER_TIME = 0.13;

export function getTodayDateKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function computeSaveChecksum(data: Omit<SaveData, 'checksum'>): string {
  const payload = JSON.stringify({
    v: data.version,
    c: data.coins,
    hl: data.highestUnlockedLevel,
    uc: data.unlockedCharacters,
    uo: data.unlockedOutfits.length,
    ut: data.unlockedThemes.length,
    lr: Object.keys(data.levelRecords).length,
    cm: data.claimedMissions.length,
    ca: data.claimedAchievements.length,
  });
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `kh_${(hash >>> 0).toString(16)}`;
}

export function createInitialSaveData(dateKey = getTodayDateKey()): SaveData {
  const base: Omit<SaveData, 'checksum'> = {
    version: SAVE_VERSION,
    coins: 2500,
    selectedCharacter: 'kael',
    unlockedCharacters: ['kael'],
    equippedOutfits: {
      kael: 'kael_default',
      lyra: 'lyra_default',
      elena: 'elena_default',
      darius: 'darius_default',
    },
    unlockedOutfits: ['kael_default', 'lyra_default', 'elena_default', 'darius_default'],
    abilityLevels: {
      magnet: 1,
      rush: 1,
      shield: 1,
      double_jump: 1,
    },
    selectedTheme: 'classic_kharos',
    unlockedThemes: ['classic_kharos'],
    highestUnlockedLevel: 1,
    levelRecords: {},
    bestEndlessDistance: 0,
    tutorialCompleted: false,
    missionDateKey: dateKey,
    missionProgress: {},
    claimedMissions: [],
    claimedAchievements: [],
    stats: {
      totalDistance: 0,
      totalCoins: 2500,
      totalJumps: 0,
      totalSlides: 0,
      obstaclesAvoided: 0,
      runsSurvived: 0,
      totalNearMisses: 0,
      secretPathsFound: 0,
      abilitiesUsed: 0,
    },
    transactionLog: [],
    settings: structuredClone(DEFAULT_SETTINGS),
  };

  return {
    ...base,
    checksum: computeSaveChecksum(base),
  };
}

export function sealSaveData(data: SaveData): SaveData {
  const { checksum: _ignored, ...rest } = data;
  return {
    ...rest,
    checksum: computeSaveChecksum(rest),
  };
}

export function validateAndRecoverSave(rawJson: string | null, dateKey = getTodayDateKey()): SaveData {
  const fresh = createInitialSaveData(dateKey);
  if (!rawJson) return fresh;

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return fresh;

    const { eagleUpgrades: _legacyEagle, settings: rawSettings, ...restParsed } = parsed as Partial<SaveData> & {
      eagleUpgrades?: unknown;
    };
    const rawAudio = (rawSettings?.audio ?? {}) as Partial<AllSettings['audio']> & { eagle?: unknown };
    const { eagle: _legacyEagleAudio, ...cleanAudio } = rawAudio;

    const merged: Omit<SaveData, 'checksum'> = {
      ...fresh,
      ...restParsed,
      version: SAVE_VERSION,
      coins: typeof parsed.coins === 'number' && Number.isFinite(parsed.coins) && parsed.coins >= 0 ? Math.floor(parsed.coins) : fresh.coins,
      highestUnlockedLevel:
        typeof parsed.highestUnlockedLevel === 'number'
          ? Math.max(1, Math.min(20, Math.floor(parsed.highestUnlockedLevel)))
          : 1,
      unlockedCharacters: Array.isArray(parsed.unlockedCharacters)
        ? (Array.from(new Set(['kael', ...parsed.unlockedCharacters])) as CharacterId[])
        : ['kael'],
      equippedOutfits: { ...fresh.equippedOutfits, ...(parsed.equippedOutfits ?? {}) },
      unlockedOutfits: Array.isArray(parsed.unlockedOutfits)
        ? Array.from(new Set([...fresh.unlockedOutfits, ...parsed.unlockedOutfits]))
        : fresh.unlockedOutfits,
      abilityLevels: { ...fresh.abilityLevels, ...(parsed.abilityLevels ?? {}) },
      unlockedThemes: Array.isArray(parsed.unlockedThemes)
        ? Array.from(new Set(['classic_kharos', ...parsed.unlockedThemes]))
        : ['classic_kharos'],
      levelRecords: parsed.levelRecords && typeof parsed.levelRecords === 'object' ? (parsed.levelRecords as SaveData['levelRecords']) : {},
      missionProgress: parsed.missionDateKey === dateKey ? { ...(parsed.missionProgress ?? {}) } : {},
      claimedMissions: parsed.missionDateKey === dateKey && Array.isArray(parsed.claimedMissions) ? (parsed.claimedMissions as string[]) : [],
      missionDateKey: dateKey,
      claimedAchievements: Array.isArray(parsed.claimedAchievements) ? Array.from(new Set(parsed.claimedAchievements as string[])) : [],
      stats: { ...fresh.stats, ...(parsed.stats ?? {}) },
      transactionLog: Array.isArray(parsed.transactionLog) ? parsed.transactionLog.slice(-60) : [],
      settings: {
        audio: { ...DEFAULT_SETTINGS.audio, ...cleanAudio },
        gameplay: { ...DEFAULT_SETTINGS.gameplay, ...(rawSettings?.gameplay ?? {}) },
        graphics: { ...DEFAULT_SETTINGS.graphics, ...(rawSettings?.graphics ?? {}) },
        accessibility: { ...DEFAULT_SETTINGS.accessibility, ...(rawSettings?.accessibility ?? {}) },
        general: { ...DEFAULT_SETTINGS.general, ...(rawSettings?.general ?? {}) },
      },
    };

    if (!merged.unlockedCharacters.includes(merged.selectedCharacter)) {
      merged.selectedCharacter = 'kael';
    }
    if (!merged.unlockedThemes.includes(merged.selectedTheme)) {
      merged.selectedTheme = 'classic_kharos';
    }

    return {
      ...merged,
      checksum: computeSaveChecksum(merged),
    };
  } catch {
    return fresh;
  }
}

export function loadSaveFromStorage(): SaveData {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createInitialSaveData();
  }
  const primary = window.localStorage.getItem(SAVE_STORAGE_KEY);
  if (primary) {
    try {
      JSON.parse(primary);
      return validateAndRecoverSave(primary);
    } catch {
      const backup = window.localStorage.getItem(SAVE_BACKUP_KEY);
      if (backup) return validateAndRecoverSave(backup);
    }
  }
  return createInitialSaveData();
}

export function persistSaveToStorage(data: SaveData): SaveData {
  const sealed = sealSaveData(data);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const serialized = JSON.stringify(sealed);
      const prev = window.localStorage.getItem(SAVE_STORAGE_KEY);
      if (prev) {
        window.localStorage.setItem(SAVE_BACKUP_KEY, prev);
      }
      window.localStorage.setItem(SAVE_STORAGE_KEY, serialized);
    } catch {
      // Storage quota or private browsing guard
    }
  }
  return sealed;
}

export function applyGraphicsPreset(preset: GraphicsPreset, current: GraphicsSettings, isSoftwareGl = false): GraphicsSettings {
  const effective = preset === 'auto' ? (isSoftwareGl ? 'medium' : 'high') : preset;
  switch (effective) {
    case 'low':
      return {
        ...current,
        preset,
        resolutionScale: 0.7,
        textureQuality: 'low',
        shadowQuality: 'off',
        antiAliasing: false,
        ambientOcclusion: false,
        reflectionQuality: 'low',
        foliageDensity: 0.4,
        effectsQuality: 'low',
        motionBlur: false,
        bloom: false,
        depthOfField: false,
        volumetricFog: false,
      };
    case 'medium':
      return {
        ...current,
        preset,
        resolutionScale: 0.85,
        textureQuality: 'medium',
        shadowQuality: 'low',
        antiAliasing: true,
        ambientOcclusion: false,
        reflectionQuality: 'medium',
        foliageDensity: 0.65,
        effectsQuality: 'medium',
        motionBlur: false,
        bloom: true,
        depthOfField: false,
        volumetricFog: true,
      };
    case 'high':
      return {
        ...current,
        preset,
        resolutionScale: 1.0,
        textureQuality: 'high',
        shadowQuality: 'high',
        antiAliasing: true,
        ambientOcclusion: true,
        reflectionQuality: 'high',
        foliageDensity: 0.88,
        effectsQuality: 'high',
        motionBlur: false,
        bloom: true,
        depthOfField: false,
        volumetricFog: true,
      };
    case 'ultra':
      return {
        ...current,
        preset,
        resolutionScale: 1.0,
        textureQuality: 'high',
        shadowQuality: 'high',
        antiAliasing: true,
        ambientOcclusion: true,
        reflectionQuality: 'high',
        foliageDensity: 1.0,
        effectsQuality: 'high',
        motionBlur: true,
        bloom: true,
        depthOfField: true,
        volumetricFog: true,
      };
  }
}

export function getAbilityUpgradeCost(currentLevel: number): number {
  return Math.round(1800 * Math.pow(1.75, Math.max(0, currentLevel - 1)));
}

export function getAbilityDurationSec(abilityId: AbilityId, level: number): number {
  const lvl = Math.max(1, Math.min(5, level));
  switch (abilityId) {
    case 'magnet':
      return 6.5 + (lvl - 1) * 1.4;
    case 'rush':
      return 3.6 + (lvl - 1) * 0.55;
    case 'shield':
      return 9.0 + (lvl - 1) * 1.8;
    case 'double_jump':
      return 8.5 + (lvl - 1) * 1.5;
  }
}

export function getAbilityCooldownSec(abilityId: AbilityId, level: number): number {
  const lvl = Math.max(1, Math.min(5, level));
  const base = abilityId === 'rush' ? 18 : abilityId === 'shield' ? 16 : 14;
  return Math.max(7, base - (lvl - 1) * 1.4);
}

export function spendCoins(save: SaveData, amount: number, reason: string): SaveData | null {
  if (amount < 0 || save.coins < amount) return null;
  const txId = `${reason}_${Date.now()}_${save.transactionLog.length}`;
  return sealSaveData({
    ...save,
    coins: save.coins - amount,
    transactionLog: [...save.transactionLog.slice(-59), { id: txId, delta: -amount, reason, ts: Date.now() }],
  });
}

export function grantCoins(save: SaveData, amount: number, reason: string, uniqueTxId?: string): SaveData {
  if (amount <= 0) return save;
  if (uniqueTxId && save.transactionLog.some((t) => t.id === uniqueTxId)) {
    return save; // Prevent duplicate reward exploit
  }
  const txId = uniqueTxId ?? `${reason}_${Date.now()}_${save.transactionLog.length}`;
  return sealSaveData({
    ...save,
    coins: save.coins + amount,
    stats: {
      ...save.stats,
      totalCoins: save.stats.totalCoins + amount,
    },
    transactionLog: [...save.transactionLog.slice(-59), { id: txId, delta: amount, reason, ts: Date.now() }],
  });
}

export function unlockCharacter(save: SaveData, characterId: CharacterId): SaveData | null {
  if (save.unlockedCharacters.includes(characterId)) return save;
  const charDef = getCharacterById(characterId);
  if (save.highestUnlockedLevel < charDef.unlockLevelReq && save.coins < charDef.unlockCost) {
    return null;
  }
  const afterSpend = spendCoins(save, charDef.unlockCost, `unlock_char_${characterId}`);
  if (!afterSpend) return null;
  return sealSaveData({
    ...afterSpend,
    unlockedCharacters: [...afterSpend.unlockedCharacters, characterId],
    selectedCharacter: characterId,
  });
}

export function purchaseOutfit(save: SaveData, outfitId: string): SaveData | null {
  const outfit = OUTFITS.find((o) => o.id === outfitId);
  if (!outfit) return null;
  if (save.unlockedOutfits.includes(outfitId)) {
    return sealSaveData({
      ...save,
      equippedOutfits: { ...save.equippedOutfits, [outfit.characterId]: outfitId },
    });
  }
  const afterSpend = spendCoins(save, outfit.price, `buy_outfit_${outfitId}`);
  if (!afterSpend) return null;
  return sealSaveData({
    ...afterSpend,
    unlockedOutfits: [...afterSpend.unlockedOutfits, outfitId],
    equippedOutfits: { ...afterSpend.equippedOutfits, [outfit.characterId]: outfitId },
  });
}

export function purchaseTheme(save: SaveData, themeId: string): SaveData | null {
  const theme = PREMIUM_THEMES.find((t) => t.id === themeId);
  if (!theme) return null;
  if (save.unlockedThemes.includes(themeId)) {
    return sealSaveData({ ...save, selectedTheme: themeId });
  }
  const afterSpend = spendCoins(save, theme.price, `buy_theme_${themeId}`);
  if (!afterSpend) return null;
  return sealSaveData({
    ...afterSpend,
    unlockedThemes: [...afterSpend.unlockedThemes, themeId],
    selectedTheme: themeId,
  });
}

export function upgradeAbility(save: SaveData, abilityId: AbilityId): SaveData | null {
  const currentLevel = save.abilityLevels[abilityId] ?? 1;
  if (currentLevel >= 5) return null;
  const cost = getAbilityUpgradeCost(currentLevel);
  const afterSpend = spendCoins(save, cost, `upgrade_ability_${abilityId}_l${currentLevel + 1}`);
  if (!afterSpend) return null;
  return sealSaveData({
    ...afterSpend,
    abilityLevels: {
      ...afterSpend.abilityLevels,
      [abilityId]: currentLevel + 1,
    },
  });
}

export function calculateLevelReward(
  level: LevelDef,
  run: RunStats,
  existingRecord?: SaveData['levelRecords'][number],
): LevelRewardBreakdown {
  const isFirstTime = !existingRecord?.firstRewardClaimed;
  const isPerfectRun = run.stumbles === 0;
  const challengeCompleted = run.coinsCollected >= level.challengeTargetCoins;

  const runCoins = Math.max(0, Math.floor(run.coinsCollected));
  const completionBonus = level.completionBonus;
  const firstTimeBonus = isFirstTime ? level.firstTimeBonus : 0;
  const perfectRunBonus = isPerfectRun ? level.perfectRunBonus : 0;
  const challengeBonus = challengeCompleted ? level.challengeBonus : 0;

  return {
    runCoins,
    completionBonus,
    firstTimeBonus,
    perfectRunBonus,
    challengeBonus,
    totalEarned: runCoins + completionBonus + firstTimeBonus + perfectRunBonus + challengeBonus,
    isFirstTime,
    isPerfectRun,
    challengeCompleted,
  };
}

export function recordRunResult(
  save: SaveData,
  run: RunStats,
  completedCampaignLevel: boolean,
): { nextSave: SaveData; rewardBreakdown: LevelRewardBreakdown | null } {
  const nextMissionProgress = { ...save.missionProgress };
  const addMission = (metric: string, delta: number) => {
    for (const m of DAILY_MISSIONS) {
      if (m.metric === metric) {
        nextMissionProgress[m.id] = Math.min(m.target, (nextMissionProgress[m.id] ?? 0) + delta);
      }
    }
  };

  addMission('coins', run.coinsCollected);
  addMission('distance', Math.floor(run.distance));
  addMission('jumps', run.jumps);
  addMission('slides', run.slides);
  addMission('obstacles', run.obstaclesAvoided);
  addMission('abilities', run.abilitiesUsed);
  addMission('secrets', run.secretPathsFound);
  if (completedCampaignLevel) addMission('levels', 1);

  let updated: SaveData = {
    ...save,
    missionProgress: nextMissionProgress,
    bestEndlessDistance:
      run.mode === 'endless' ? Math.max(save.bestEndlessDistance, Math.floor(run.distance)) : save.bestEndlessDistance,
    tutorialCompleted: run.mode === 'tutorial' && completedCampaignLevel ? true : save.tutorialCompleted,
    stats: {
      totalDistance: save.stats.totalDistance + Math.floor(run.distance),
      totalCoins: save.stats.totalCoins,
      totalJumps: save.stats.totalJumps + run.jumps,
      totalSlides: save.stats.totalSlides + run.slides,
      obstaclesAvoided: save.stats.obstaclesAvoided + run.obstaclesAvoided,
      runsSurvived: save.stats.runsSurvived + (run.distance >= 150 || completedCampaignLevel ? 1 : 0),
      totalNearMisses: save.stats.totalNearMisses + run.nearMisses,
      secretPathsFound: save.stats.secretPathsFound + run.secretPathsFound,
      abilitiesUsed: save.stats.abilitiesUsed + run.abilitiesUsed,
    },
  };

  let rewardBreakdown: LevelRewardBreakdown | null = null;

  if (run.mode === 'campaign') {
    const level = getLevelById(run.levelId);
    const prev = save.levelRecords[run.levelId];

    if (completedCampaignLevel) {
      rewardBreakdown = calculateLevelReward(level, run, prev);
      updated = grantCoins(updated, rewardBreakdown.totalEarned, `level_${run.levelId}_complete`);
      updated.levelRecords = {
        ...updated.levelRecords,
        [run.levelId]: {
          completed: true,
          bestDistance: Math.max(prev?.bestDistance ?? 0, Math.floor(run.distance)),
          bestCoins: Math.max(prev?.bestCoins ?? 0, run.coinsCollected),
          perfectCleared: Boolean(prev?.perfectCleared || rewardBreakdown.isPerfectRun),
          firstRewardClaimed: true,
        },
      };
      updated.highestUnlockedLevel = Math.min(20, Math.max(updated.highestUnlockedLevel, run.levelId + 1));
    } else {
      updated = grantCoins(updated, run.coinsCollected, `level_${run.levelId}_run`);
      updated.levelRecords = {
        ...updated.levelRecords,
        [run.levelId]: {
          completed: Boolean(prev?.completed),
          bestDistance: Math.max(prev?.bestDistance ?? 0, Math.floor(run.distance)),
          bestCoins: Math.max(prev?.bestCoins ?? 0, run.coinsCollected),
          perfectCleared: Boolean(prev?.perfectCleared),
          firstRewardClaimed: Boolean(prev?.firstRewardClaimed),
        },
      };
    }
  } else {
    const bonus = run.mode === 'tutorial' && completedCampaignLevel ? 400 : 0;
    updated = grantCoins(updated, run.coinsCollected + bonus, `${run.mode}_run`);
  }

  return { nextSave: sealSaveData(updated), rewardBreakdown };
}

export function claimMissionReward(save: SaveData, missionId: string): SaveData | null {
  if (save.claimedMissions.includes(missionId)) return null;
  const def = DAILY_MISSIONS.find((m) => m.id === missionId);
  if (!def) return null;
  const progress = save.missionProgress[missionId] ?? 0;
  if (progress < def.target) return null;

  const uniqueKey = `mission_${save.missionDateKey}_${missionId}`;
  const granted = grantCoins(save, def.reward, `claim_mission_${missionId}`, uniqueKey);
  return sealSaveData({
    ...granted,
    claimedMissions: [...granted.claimedMissions, missionId],
  });
}

export function getAchievementProgress(save: SaveData, metric: (typeof ACHIEVEMENTS)[number]['metric']): number {
  const completedCount = Object.values(save.levelRecords).filter((r) => r.completed).length;
  switch (metric) {
    case 'totalDistance':
      return save.stats.totalDistance;
    case 'totalCoins':
      return save.stats.totalCoins;
    case 'levelsCompleted':
    case 'campaignComplete':
      return completedCount;
    case 'obstaclesAvoided':
      return save.stats.obstaclesAvoided;
    case 'runsSurvived':
      return save.stats.runsSurvived;
    case 'charactersUnlocked':
      return save.unlockedCharacters.length;
  }
}

export function claimAchievementReward(save: SaveData, achievementId: string): SaveData | null {
  if (save.claimedAchievements.includes(achievementId)) return null;
  const def = ACHIEVEMENTS.find((a) => a.id === achievementId);
  if (!def) return null;
  if (getAchievementProgress(save, def.metric) < def.target) return null;

  const uniqueKey = `ach_${achievementId}`;
  const granted = grantCoins(save, def.reward, `claim_achievement_${achievementId}`, uniqueKey);
  return sealSaveData({
    ...granted,
    claimedAchievements: [...granted.claimedAchievements, achievementId],
  });
}

// Deterministic PRNG (Mulberry32) so every campaign level has a handcrafted, repeatable layout!
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedTrackChunk {
  obstacles: TrackObstacle[];
  coins: TrackCoin[];
  turns: TrackTurn[];
  branches: TrackBranch[];
}

export function generateFairTrackSlice(
  level: LevelDef,
  startZ: number,
  endZ: number,
  seedOffset: number,
  bonusTrailLevel: number,
  idStart: { obstacle: number; coin: number; turn: number },
  mode: PlayMode = 'campaign',
  existingBranches: readonly TrackBranch[] = [],
): GeneratedTrackChunk {
  const res = generateSkillTrackSlice(
    level,
    startZ,
    endZ,
    seedOffset,
    bonusTrailLevel,
    idStart,
    mode,
    LANE_WIDTH,
    existingBranches,
  );
  return {
    obstacles: res.obstacles,
    coins: res.coins,
    turns: [],
    branches: res.branches,
  };
}

/**
 * Fairness verifier used in QA & unit tests: ensures no z-band blocks all 3 lanes
 * with unavoidable lethal obstacles and that consecutive obstacles leave >= minReactionMeters
 * independently on main and every branch route.
 */
export function verifyTrackFairness(
  obstacles: TrackObstacle[],
  minReactionMeters = 10,
  branches: readonly TrackBranch[] = [],
): {
  fair: boolean;
  reason?: string;
} {
  return verifyBranchTrackFairness(obstacles, branches, minReactionMeters);
}

export interface PlayerSimState {
  z: number;
  lane: -1 | 0 | 1;
  x: number;
  y: number;
  vy: number;
  speed: number;
  activeRoute: RouteId;
  activeBranchId: number | null;
  pendingBranchChoice: Exclude<RouteId, 'main'> | null;
  grounded: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  slideTimer: number;
  doubleJumpUsed: boolean;
  invulnerableTimer: number;
  stumbleTimer: number;
  introChaseTimer: number; // >0 during mandatory Opening Hollow Chase on every level
  hollowDistance: number; // 18 = far, <= 0 = caught
  abilityCharge: number; // 0..100
  abilityActiveTimer: number;
  shieldCharges: number;
  alive: boolean;
}

export function createInitialPlayerSim(baseSpeed: number): PlayerSimState {
  return {
    z: 0,
    lane: 0,
    x: 0,
    y: 0,
    vy: 0,
    speed: baseSpeed * 0.84,
    activeRoute: 'main',
    activeBranchId: null,
    pendingBranchChoice: null,
    grounded: true,
    coyoteTimer: COYOTE_TIME,
    jumpBufferTimer: 0,
    slideTimer: 0,
    doubleJumpUsed: false,
    invulnerableTimer: 0,
    stumbleTimer: 0,
    introChaseTimer: 2.85,
    hollowDistance: 4.5, // Starts visibly roaring right behind the player on every campaign level launch
    abilityCharge: 100, // Start ready so player can immediately test abilities
    abilityActiveTimer: 0,
    shieldCharges: 0,
    alive: true,
  };
}

export function triggerPlayerJump(
  sim: PlayerSimState,
  characterAbility: AbilityId,
): 'jump' | 'double_jump' | 'buffered' | 'none' {
  if (!sim.alive) return 'none';
  if (sim.grounded || sim.coyoteTimer > 0) {
    sim.vy = JUMP_VELOCITY;
    sim.grounded = false;
    sim.coyoteTimer = 0;
    sim.slideTimer = 0;
    sim.doubleJumpUsed = false;
    sim.jumpBufferTimer = 0;
    return 'jump';
  }
  if (characterAbility === 'double_jump' && sim.abilityActiveTimer > 0 && !sim.doubleJumpUsed) {
    sim.vy = DOUBLE_JUMP_VELOCITY;
    sim.doubleJumpUsed = true;
    sim.jumpBufferTimer = 0;
    return 'double_jump';
  }
  sim.jumpBufferTimer = INPUT_BUFFER_TIME;
  return 'buffered';
}

export function triggerPlayerSlide(sim: PlayerSimState): boolean {
  if (!sim.alive) return false;
  if (!sim.grounded) {
    // Fast-fall slam into slide for crisp Temple-Run-style aerial responsiveness
    sim.vy = Math.min(sim.vy, -24);
  }
  sim.slideTimer = SLIDE_DURATION;
  return true;
}

export function activateCharacterAbility(
  sim: PlayerSimState,
  abilityId: AbilityId,
  abilityLevel: number,
): boolean {
  if (!sim.alive || sim.abilityCharge < 100 || sim.abilityActiveTimer > 0) return false;
  sim.abilityCharge = 0;
  sim.abilityActiveTimer = getAbilityDurationSec(abilityId, abilityLevel);
  if (abilityId === 'shield') {
    sim.shieldCharges = 1;
  }
  return true;
}

export function resolveObstacleImpact(
  sim: PlayerSimState,
  abilityId: AbilityId,
  lethal: boolean,
): 'ignored' | 'rush_smashed' | 'shield_absorbed' | 'stumble' | 'death' {
  if (sim.invulnerableTimer > 0) return 'ignored';

  if (abilityId === 'rush' && sim.abilityActiveTimer > 0) {
    return 'rush_smashed';
  }

  if (sim.shieldCharges > 0) {
    sim.shieldCharges = 0;
    if (abilityId === 'shield') sim.abilityActiveTimer = 0;
    sim.invulnerableTimer = 1.1;
    return 'shield_absorbed';
  }

  if (!lethal && sim.hollowDistance > 4.5) {
    sim.stumbleTimer = 0.55;
    sim.invulnerableTimer = 0.85;
    sim.hollowDistance = 3.2; // The Hollow lunges right behind the player!
    return 'stumble';
  }

  sim.alive = false;
  return 'death';
}

export const TUTORIAL_STEPS: Array<{
  title: string;
  hint: string;
  requiredAction: 'lane' | 'jump' | 'slide' | 'turn' | 'coins' | 'ability' | 'chase' | 'complete';
}> = [
  { title: '1 / 9 · Lane Movement', hint: 'Swipe Left/Right or press A / D to change lanes.', requiredAction: 'lane' },
  { title: '2 / 9 · Vaulting', hint: 'Swipe Up or press W / Space to jump barriers.', requiredAction: 'jump' },
  { title: '3 / 9 · Low Slide', hint: 'Swipe Down or press S to slide under stone arches.', requiredAction: 'slide' },
  { title: '4 / 9 · Branching Paths', hint: 'Swipe Left/Right or hold Center at 3-way forks.', requiredAction: 'turn' },
  { title: '5 / 9 · Obstacle Reading', hint: 'Dodge pillars and gaps — near-misses build momentum.', requiredAction: 'lane' },
  { title: '6 / 9 · Relic Coins', hint: 'Follow coin arcs to fund outfits, themes & upgrades.', requiredAction: 'coins' },
  { title: '7 / 9 · Explorer Ability', hint: 'Tap the Ability button or press E when charged.', requiredAction: 'ability' },
  { title: '8 / 9 · The Hollow', hint: 'Stumbling draws The Hollow closer — stay clean to escape!', requiredAction: 'chase' },
  { title: '9 / 9 · Expedition Ready', hint: 'Combine moves to reach the Sanctuary Gate!', requiredAction: 'complete' },
];
