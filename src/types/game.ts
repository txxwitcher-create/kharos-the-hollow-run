export type GameState = 'title' | 'loading' | 'playing' | 'paused' | 'gameover' | 'victory';

export type PlayMode = 'campaign' | 'endless' | 'tutorial';

export type AbilityId = 'magnet' | 'rush' | 'shield' | 'double_jump';

export type CharacterId = 'kael' | 'lyra' | 'elena' | 'darius';

export type Rarity = 'Default' | 'Basic' | 'Rare' | 'Epic' | 'Legendary';

export type DifficultyTier =
  | 'Easy'
  | 'Normal'
  | 'Challenging'
  | 'Hard'
  | 'Very Hard'
  | 'Extreme'
  | 'Final Challenge';

export type ArchitectureStyle =
  | 'jungle_temple'
  | 'ice_spires'
  | 'volcanic_obelisks'
  | 'lost_ziggurat'
  | 'hollow_ribs'
  | 'desert_pylons'
  | 'canyon_bridges'
  | 'whispering_woods'
  | 'drowned_arches'
  | 'golden_aqueduct'
  | 'storm_monoliths'
  | 'iron_mines'
  | 'giant_canopy'
  | 'crystal_caverns'
  | 'nightfall_city'
  | 'colossus_sanctuary'
  | 'infernal_fortress'
  | 'sky_colonnade'
  | 'shattered_realm'
  | 'last_sanctuary';

export type WeatherType =
  | 'dust'
  | 'snow'
  | 'embers'
  | 'mist'
  | 'ash'
  | 'sand'
  | 'wind'
  | 'fireflies'
  | 'bubbles'
  | 'gold_motes'
  | 'rain'
  | 'sparks'
  | 'spores'
  | 'crystal_glint'
  | 'drizzle'
  | 'petals'
  | 'cinder'
  | 'clouds'
  | 'rift_motes'
  | 'aurora';

export type ObstacleKind =
  | 'low_barrier'      // Jump over
  | 'high_arch'        // Slide under
  | 'tall_pillar'      // Dodge left/right
  | 'gap'              // Jump over chasm / broken bridge
  | 'collapsing_floor' // Shakes & collapses if lingered / must jump or sidestep
  | 'moving_block'     // Slides across lanes
  | 'swinging_blade'   // Pendulum hazard
  | 'rotating_spinner' // Rotating stone bar (jump or dodge)
  | 'spike_trap'       // Ground spikes (jump or dodge)
  | 'fire_vent'        // Flame / lava / water hazard (jump or dodge)
  | 'mine_cart'        // Oncoming fast cart in a lane
  | 'falling_debris'   // Shadow telegraph then drops in lane
  | 'narrow_bridge';   // Only center lane is solid

export type SegmentKind =
  | 'straight'
  | 'curve_left'
  | 'curve_right'
  | 'turn_left'
  | 'turn_right'
  | 'branch_fork'
  | 'narrow'
  | 'elevation_up'
  | 'elevation_down';

export type RouteId = 'main' | 'left' | 'center' | 'right';

export type RouteStyle =
  | 'main_causeway'
  | 'relic_vault'
  | 'sky_bridge'
  | 'ruin_gauntlet';

export interface BranchRouteMeta {
  id: Exclude<RouteId, 'main'>;
  style: RouteStyle;
  label: string;
  lateralOffset: number; // -11.4 for left, 0 for center, +11.4 for right
  elevationPeak: number; // e.g. 0, +1.35 for elevated bridge, -0.35 for sunken vault
  coinMultiplier: number;
  riskTier: 'balanced' | 'scenic' | 'high_reward';
}

export interface TrackBranch {
  id: number;
  startZ: number;      // Fork split begins curving outward
  splitEndZ: number;   // Parallel branches fully separated
  mergeStartZ: number; // Branches begin curving back together
  endZ: number;        // Branches fully merged back to main causeway
  hasCenter: boolean;  // true = 3-way (Left/Center/Right), false = 2-way (Left/Right)
  curveShape?: 'branch' | 's_curve' | 'sweep_left' | 'sweep_right';
  routes: BranchRouteMeta[];
  chosenRoute: Exclude<RouteId, 'main'> | null;
  resolved: boolean;
  merged: boolean;
}

export interface OutfitPalette {
  primary: string;
  secondary: string;
  accent: string;
  skin: string;
  hair: string;
  boots: string;
  metalness: number;
  roughness: number;
  cloak?: string;
}

export interface OutfitDef {
  id: string;
  characterId: CharacterId;
  name: string;
  rarity: Rarity;
  price: number;
  description: string;
  palette: OutfitPalette;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  title: string;
  age: 18 | 35;
  gender: 'male' | 'female';
  isDefault: boolean;
  unlockCost: number;
  unlockLevelReq: number;
  abilityId: AbilityId;
  abilityName: string;
  abilityDescription: string;
  bio: string;
  heightScale: number;
  shoulderScale: number;
  strideFrequency: number;
  leanStyle: number;
}

export interface ThemeDef {
  id: string;
  name: string;
  rarity: Rarity;
  price: number;
  description: string;
  uiAccent: string;
  uiSurface: string;
  uiBorder: string;
  coinColor: string;
  coinEmissive: string;
  particleTint: string;
  rimLightTint: string;
  fogBlend: number;
}

export interface LevelEnvironmentPalette {
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  fogDensity: number;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  pathBase: string;
  pathTrim: string;
  terrainColor: string;
  archPrimary: string;
  archAccent: string;
  foliageColor: string;
  hazardGlow: string;
  particleColor: string;
}

export interface LevelDef {
  id: number;
  name: string;
  subtitle: string;
  difficulty: DifficultyTier;
  targetDistance: number;
  baseSpeed: number;
  maxSpeed: number;
  completionBonus: number;
  firstTimeBonus: number;
  perfectRunBonus: number;
  challengeTargetCoins: number;
  challengeBonus: number;
  architecture: ArchitectureStyle;
  weather: WeatherType;
  musicMood: string;
  musicBpm: number;
  musicRootHz: number;
  musicScale: number[];
  palette: LevelEnvironmentPalette;
  obstaclePool: ObstacleKind[];
  turnFrequency: number;
  hazardDensity: number;
  storySnippet: string;
}

export interface TrackObstacle {
  id: number;
  z: number;
  lane: -1 | 0 | 1;
  route: RouteId;
  branchId?: number;
  kind: ObstacleKind;
  width: number;
  height: number;
  phase: number;
  passed: boolean;
  hit: boolean;
  nearMissed: boolean;
  collapsed?: boolean;
  secretPath?: boolean;
}

export interface TrackCoin {
  id: number;
  z: number;
  lane: -1 | 0 | 1;
  route: RouteId;
  branchId?: number;
  y: number;
  value: number;
  collected: boolean;
  isBonusTrail?: boolean;
}

export interface TrackTurn {
  id: number;
  z: number;
  direction: -1 | 1; // -1 left, 1 right
  isBranch?: boolean;
  resolved: boolean;
  secretBonus?: boolean;
}

export interface DailyMissionDef {
  id: string;
  title: string;
  metric: 'coins' | 'distance' | 'jumps' | 'slides' | 'obstacles' | 'abilities' | 'levels' | 'secrets';
  target: number;
  reward: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  metric: 'totalDistance' | 'totalCoins' | 'levelsCompleted' | 'obstaclesAvoided' | 'runsSurvived' | 'charactersUnlocked' | 'campaignComplete';
  target: number;
  reward: number;
}

export interface CoinPackDef {
  id: string;
  name: string;
  coins: number;
  priceLabel: string;
  valueBadge?: string;
}

export type GraphicsPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type TargetFps = 30 | 60 | 90 | 120 | 0; // 0 = unlocked / display max

export interface GraphicsSettings {
  preset: GraphicsPreset;
  targetFps: TargetFps;
  resolutionScale: number; // 0.6 to 1.0
  textureQuality: 'low' | 'medium' | 'high';
  shadowQuality: 'off' | 'low' | 'high';
  antiAliasing: boolean;
  ambientOcclusion: boolean;
  reflectionQuality: 'low' | 'medium' | 'high';
  foliageDensity: number; // 0.35 to 1.0
  effectsQuality: 'low' | 'medium' | 'high';
  motionBlur: boolean;
  bloom: boolean;
  depthOfField: boolean;
  volumetricFog: boolean;
}

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  environment: number;
  character: number;
  hollow: number;
  ui: number;
  vibrationIntensity: number;
  muted: boolean;
}

export interface GameplaySettings {
  swipeSensitivity: number; // 0.5 to 2.0
  cameraSensitivity: number; // 0.5 to 1.5
  cameraShakeIntensity: number; // 0 to 1.5
  cameraMotionIntensity: number; // 0.25 to 1.25
  haptics: boolean;
  visualFeedback: boolean;
}

export interface AccessibilitySettings {
  highContrast: boolean;
  colorblindMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  uiScale: number; // 0.9 to 1.15
  subtitleSize: 'small' | 'medium' | 'large';
  reducedCameraMotion: boolean;
  reducedFlashing: boolean;
}

export interface GeneralSettings {
  language: 'English' | 'Español' | 'Français' | 'Deutsch' | '日本語';
}

export interface AllSettings {
  audio: AudioSettings;
  gameplay: GameplaySettings;
  graphics: GraphicsSettings;
  accessibility: AccessibilitySettings;
  general: GeneralSettings;
}

export interface LevelProgressRecord {
  completed: boolean;
  bestDistance: number;
  bestCoins: number;
  perfectCleared: boolean;
  firstRewardClaimed: boolean;
}

export interface SaveData {
  version: number;
  checksum: string;
  coins: number;
  selectedCharacter: CharacterId;
  unlockedCharacters: CharacterId[];
  equippedOutfits: Record<CharacterId, string>;
  unlockedOutfits: string[];
  abilityLevels: Record<AbilityId, number>;
  selectedTheme: string;
  unlockedThemes: string[];
  highestUnlockedLevel: number;
  levelRecords: Record<number, LevelProgressRecord>;
  bestEndlessDistance: number;
  tutorialCompleted: boolean;
  missionDateKey: string;
  missionProgress: Record<string, number>;
  claimedMissions: string[];
  claimedAchievements: string[];
  stats: {
    totalDistance: number;
    totalCoins: number;
    totalJumps: number;
    totalSlides: number;
    obstaclesAvoided: number;
    runsSurvived: number;
    totalNearMisses: number;
    secretPathsFound: number;
    abilitiesUsed: number;
  };
  transactionLog: Array<{ id: string; delta: number; reason: string; ts: number }>;
  settings: AllSettings;
}

export interface RunStats {
  mode: PlayMode;
  levelId: number;
  distance: number;
  targetDistance: number;
  coinsCollected: number;
  obstaclesAvoided: number;
  nearMisses: number;
  jumps: number;
  slides: number;
  abilitiesUsed: number;
  secretPathsFound: number;
  stumbles: number;
  durationSec: number;
  isNewRecord: boolean;
  bestDistance: number;
  causeOfDeath?: string;
}

export interface LevelRewardBreakdown {
  runCoins: number;
  completionBonus: number;
  firstTimeBonus: number;
  perfectRunBonus: number;
  challengeBonus: number;
  totalEarned: number;
  isFirstTime: boolean;
  isPerfectRun: boolean;
  challengeCompleted: boolean;
}

export interface LiveHudSnapshot {
  distance: number;
  targetDistance: number;
  coins: number;
  speedKmh: number;
  abilityCharge: number; // 0..100
  abilityActiveRatio: number; // 0..1
  abilityReady: boolean;
  shieldActive: boolean;
  hollowThreat: number; // 0..1 (1 = right behind player)
  turnPrompt: 'LEFT' | 'RIGHT' | 'FORK' | 'FORK3' | null;
  activeRouteLabel: string | null;
  tutorialHint: string | null;
  tutorialStep: number;
  tutorialTotal: number;
  nearMissBanner: string | null;
  fps: number;
}
