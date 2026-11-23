import { ArchitectureStyle, TrackBranch } from '../types/game';
import { isZInsideBranchZone } from './track';

export type WildlifeSpecies =
  | 'deer'
  | 'tiger'
  | 'cat'
  | 'dog'
  | 'rabbit'
  | 'pigeon'
  | 'peacock'
  | 'sparrow';

export type CorruptedFloraKind =
  | 'corrupted_vine'
  | 'carnivorous_maw'
  | 'blight_fern'
  | 'spore_bulb';

export type WildlifeBehavior =
  | 'grazing'
  | 'alert'
  | 'fleeing'
  | 'resting'
  | 'prowling'
  | 'emerging'
  | 'sitting'
  | 'sleeping'
  | 'walking'
  | 'exploring'
  | 'playing'
  | 'hopping'
  | 'perched'
  | 'taking_flight'
  | 'displaying'
  | 'flocking';

export type FloraBehavior = 'idle' | 'twitching' | 'snapping' | 'sporing';

export type LodTier = 'near' | 'mid' | 'far' | 'culled';

export interface BiomeLivingProfile {
  wildlifeWeights: Partial<Record<WildlifeSpecies, number>>;
  floraWeights: Partial<Record<CorruptedFloraKind, number>>;
  wildlifeCount: number;
  floraCount: number;
  corruptedCoreColor: string;
  corruptedFoliageTint: string;
  sporeColor: string;
  allowsDistantCrossing: boolean;
}

export const ALL_WILDLIFE_SPECIES: readonly WildlifeSpecies[] = [
  'deer',
  'tiger',
  'cat',
  'dog',
  'rabbit',
  'pigeon',
  'peacock',
  'sparrow',
] as const;

export const ALL_CORRUPTED_FLORA_KINDS: readonly CorruptedFloraKind[] = [
  'corrupted_vine',
  'carnivorous_maw',
  'blight_fern',
  'spore_bulb',
] as const;

/** Playable 3-lane deck + curbs occupy [-4.35, +4.35]; keep ground wildlife & flora strictly outside! */
export const ROAD_SAFE_HALF_WIDTH = 4.95;
/** Outer branch corridors expand road footprint up to +/-17.5m; add margin so wildlife never blocks branches. */
export const BRANCH_LATERAL_PUSH = 14.5;
/** Minimum distance ahead (m) before a rare crossing animation may begin so player has >1.6s clear sightline. */
export const MIN_CROSSING_AHEAD_DIST = 44;
export const MAX_CROSSING_AHEAD_DIST = 62;

/**
 * Deterministic fast hash in [0, 1) for varied, non-repeating scenic placement.
 */
export function seededUnit(seed: number): number {
  let x = (Math.imul(seed | 0, 1597334677) ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Curated biome-authentic wildlife and corrupted flora habitat profile for every one of the 20 campaign realms.
 */
export function getBiomeLivingProfile(arch: ArchitectureStyle): BiomeLivingProfile {
  switch (arch) {
    case 'jungle_temple':
      return {
        wildlifeWeights: {
          deer: 1.5,
          peacock: 1.4,
          tiger: 1.0,
          rabbit: 1.3,
          pigeon: 1.2,
          sparrow: 1.4,
          cat: 0.9,
          dog: 0.8,
        },
        floraWeights: {
          corrupted_vine: 1.5,
          carnivorous_maw: 1.2,
          blight_fern: 1.3,
          spore_bulb: 0.9,
        },
        wildlifeCount: 16,
        floraCount: 12,
        corruptedCoreColor: '#84cc16',
        corruptedFoliageTint: '#1f3326',
        sporeColor: '#a3e635',
        allowsDistantCrossing: true,
      };

    case 'whispering_woods':
    case 'giant_canopy':
      return {
        wildlifeWeights: {
          deer: 1.8,
          rabbit: 1.6,
          sparrow: 1.6,
          peacock: 1.2,
          tiger: 0.9,
          cat: 0.7,
          dog: 0.7,
          pigeon: 0.6,
        },
        floraWeights: {
          corrupted_vine: 1.6,
          carnivorous_maw: 1.5,
          blight_fern: 1.5,
          spore_bulb: 1.4,
        },
        wildlifeCount: 16,
        floraCount: 14,
        corruptedCoreColor: '#4ade80',
        corruptedFoliageTint: '#1a2e28',
        sporeColor: '#86efac',
        allowsDistantCrossing: true,
      };

    case 'lost_ziggurat':
    case 'golden_aqueduct':
    case 'colossus_sanctuary':
      return {
        wildlifeWeights: {
          peacock: 1.6,
          pigeon: 1.6,
          cat: 1.4,
          dog: 1.3,
          deer: 1.1,
          sparrow: 1.3,
          rabbit: 0.8,
          tiger: 0.5,
        },
        floraWeights: {
          corrupted_vine: 1.4,
          carnivorous_maw: 0.9,
          blight_fern: 1.2,
          spore_bulb: 0.8,
        },
        wildlifeCount: 15,
        floraCount: 11,
        corruptedCoreColor: '#d97706',
        corruptedFoliageTint: '#2b2c1f',
        sporeColor: '#fbbf24',
        allowsDistantCrossing: true,
      };

    case 'nightfall_city':
    case 'storm_monoliths':
    case 'last_sanctuary':
      return {
        wildlifeWeights: {
          cat: 1.7,
          dog: 1.5,
          pigeon: 1.7,
          sparrow: 1.2,
          deer: 0.7,
          peacock: 0.6,
        },
        floraWeights: {
          corrupted_vine: 1.5,
          blight_fern: 1.3,
          carnivorous_maw: 1.0,
          spore_bulb: 1.1,
        },
        wildlifeCount: 14,
        floraCount: 11,
        corruptedCoreColor: '#60a5fa',
        corruptedFoliageTint: '#1e2533',
        sporeColor: '#93c5fd',
        allowsDistantCrossing: false,
      };

    case 'drowned_arches':
      return {
        wildlifeWeights: {
          pigeon: 1.5,
          sparrow: 1.5,
          peacock: 1.1,
          deer: 0.9,
          cat: 0.8,
          dog: 0.7,
        },
        floraWeights: {
          corrupted_vine: 1.7,
          carnivorous_maw: 1.4,
          spore_bulb: 1.5,
          blight_fern: 1.2,
        },
        wildlifeCount: 13,
        floraCount: 13,
        corruptedCoreColor: '#22d3ee',
        corruptedFoliageTint: '#143336',
        sporeColor: '#67e8f9',
        allowsDistantCrossing: false,
      };

    case 'canyon_bridges':
    case 'desert_pylons':
    case 'sky_colonnade':
      return {
        wildlifeWeights: {
          sparrow: 1.8,
          pigeon: 1.6,
          cat: 1.1,
          dog: 1.1,
          rabbit: 1.0,
          deer: 0.8,
        },
        floraWeights: {
          corrupted_vine: 1.2,
          blight_fern: 1.3,
          carnivorous_maw: 0.8,
          spore_bulb: 0.9,
        },
        wildlifeCount: 13,
        floraCount: 9,
        corruptedCoreColor: '#f59e0b',
        corruptedFoliageTint: '#362c1e',
        sporeColor: '#fde68a',
        allowsDistantCrossing: false,
      };

    case 'ice_spires':
      return {
        wildlifeWeights: {
          deer: 1.6,
          rabbit: 1.5,
          dog: 1.2,
          sparrow: 1.2,
          pigeon: 0.9,
          cat: 0.6,
        },
        floraWeights: {
          corrupted_vine: 1.3,
          blight_fern: 1.4,
          spore_bulb: 1.1,
          carnivorous_maw: 0.7,
        },
        wildlifeCount: 13,
        floraCount: 9,
        corruptedCoreColor: '#38bdf8',
        corruptedFoliageTint: '#1f3542',
        sporeColor: '#bae6fd',
        allowsDistantCrossing: true,
      };

    case 'hollow_ribs':
    case 'crystal_caverns':
    case 'shattered_realm':
      return {
        wildlifeWeights: {
          sparrow: 1.0,
          pigeon: 0.9,
          cat: 0.8,
          dog: 0.6,
        },
        floraWeights: {
          carnivorous_maw: 1.8,
          spore_bulb: 1.7,
          corrupted_vine: 1.7,
          blight_fern: 1.5,
        },
        wildlifeCount: 8,
        floraCount: 15,
        corruptedCoreColor: arch === 'crystal_caverns' ? '#c084fc' : '#2dd4bf',
        corruptedFoliageTint: '#221b30',
        sporeColor: arch === 'crystal_caverns' ? '#e879f9' : '#5eead4',
        allowsDistantCrossing: false,
      };

    case 'volcanic_obelisks':
    case 'iron_mines':
    case 'infernal_fortress':
    default:
      return {
        wildlifeWeights: {
          pigeon: 1.0,
          sparrow: 0.9,
          dog: 0.9,
          cat: 0.8,
        },
        floraWeights: {
          carnivorous_maw: 1.7,
          corrupted_vine: 1.6,
          spore_bulb: 1.5,
          blight_fern: 1.4,
        },
        wildlifeCount: 8,
        floraCount: 14,
        corruptedCoreColor: '#f97316',
        corruptedFoliageTint: '#2e1b18',
        sporeColor: '#fb923c',
        allowsDistantCrossing: false,
      };
  }
}

/**
 * Selects the next species from weighted biome pool while preventing identical back-to-back repetition.
 */
export function selectWeightedNonRepeating<T extends string>(
  weights: Partial<Record<T, number>>,
  seed: number,
  recent: readonly T[],
): T {
  const entries = (Object.entries(weights) as Array<[T, number]>).filter(([, w]) => w > 0);
  if (entries.length === 0) {
    throw new Error('LivingWorld habitat profile must define at least one positive weight');
  }
  if (entries.length === 1) return entries[0][0];

  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];

  let total = 0;
  const adjusted = entries.map(([key, baseW]) => {
    let w = baseW;
    if (key === last) w *= 0.08;
    else if (key === prev) w *= 0.42;
    total += w;
    return [key, w] as const;
  });

  let roll = seededUnit(seed) * total;
  for (const [key, w] of adjusted) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return adjusted[adjusted.length - 1][0];
}

/**
 * Computes distance-based LOD tier for environmental animation & culling.
 * distAhead = (entityTrackZ - playerTrackZ): positive is ahead of player, negative is behind.
 */
export function computeLodTier(distAhead: number): LodTier {
  if (distAhead < -16 || distAhead > 122) return 'culled';
  const absD = Math.abs(distAhead);
  if (absD <= 44) return 'near';
  if (absD <= 82) return 'mid';
  return 'far';
}

export interface SafePlacement {
  x: number;
  y: number;
  side: -1 | 1;
  yaw: number;
  inBranchMargin: boolean;
}

/**
 * Computes a guaranteed gameplay-safe roadside/environmental placement outside both the
 * main 3-lane deck and any active branching corridors.
 */
export function computeSafeWildlifePlacement(
  species: WildlifeSpecies,
  trackZ: number,
  seed: number,
  branches: readonly TrackBranch[],
): SafePlacement {
  const side: -1 | 1 = seededUnit(seed * 3 + 7) < 0.5 ? -1 : 1;
  const r1 = seededUnit(seed * 5 + 13);
  const r2 = seededUnit(seed * 7 + 29);
  const inBranch = Boolean(isZInsideBranchZone(branches as TrackBranch[], trackZ, 16));
  const branchPush = inBranch ? BRANCH_LATERAL_PUSH : 0;

  let baseLateral = 5.4 + r1 * 3.4;
  let y = -0.18;

  switch (species) {
    case 'deer':
      baseLateral = 5.6 + r1 * 3.4;
      y = -0.22;
      break;
    case 'tiger':
      // Tigers prowl/rest in roadside jungle cover (never jumping unfairly into lanes)
      baseLateral = 6.2 + r1 * 3.8;
      y = -0.22;
      break;
    case 'cat':
      // Cats perch on roadside stone ruin blocks / boulders or walk near the edge
      baseLateral = 5.05 + r1 * 2.4;
      y = r2 < 0.56 ? 0.36 : -0.18;
      break;
    case 'dog':
      baseLateral = 5.35 + r1 * 2.8;
      y = -0.2;
      break;
    case 'rabbit':
      baseLateral = 5.1 + r1 * 2.6;
      y = -0.18;
      break;
    case 'pigeon':
      // Pigeons perch on stone coping ledges / ruined masonry pillars outside player lanes
      baseLateral = 4.98 + r1 * 2.2;
      y = r2 < 0.68 ? 0.48 : -0.12;
      break;
    case 'peacock':
      baseLateral = 5.3 + r1 * 2.8;
      y = -0.2;
      break;
    case 'sparrow':
      // Sparrows perch on tree limbs / glide overhead & laterally between canopy & arches
      baseLateral = 5.05 + r1 * 4.2;
      y = 2.4 + r2 * 2.8;
      break;
  }

  const x = side * (Math.max(ROAD_SAFE_HALF_WIDTH, baseLateral) + branchPush);
  // Orient naturally at varied angles (facing slightly inward/along path rather than robotic 90-degree rows)
  const yaw = (side < 0 ? Math.PI * 0.35 : -Math.PI * 0.35) + (r2 - 0.5) * 1.4;

  return { x, y, side, yaw, inBranchMargin: inBranch };
}

/**
 * Computes a gameplay-safe placement for corrupted/zombie vegetation along ruin curbs, banks, and shadowy recesses.
 */
export function computeSafeFloraPlacement(
  kind: CorruptedFloraKind,
  trackZ: number,
  seed: number,
  branches: readonly TrackBranch[],
): SafePlacement {
  const side: -1 | 1 = seededUnit(seed * 11 + 5) < 0.5 ? -1 : 1;
  const r1 = seededUnit(seed * 13 + 17);
  const r2 = seededUnit(seed * 17 + 31);
  const inBranch = Boolean(isZInsideBranchZone(branches as TrackBranch[], trackZ, 16));
  const branchPush = inBranch ? BRANCH_LATERAL_PUSH : 0;

  let baseLateral = 5.05 + r1 * 2.4;
  let y = -0.14;

  if (kind === 'corrupted_vine') {
    baseLateral = 4.98 + r1 * 1.8;
    y = -0.06;
  } else if (kind === 'carnivorous_maw') {
    baseLateral = 5.15 + r1 * 2.0;
    y = -0.12;
  } else if (kind === 'spore_bulb') {
    baseLateral = 5.25 + r1 * 2.6;
    y = -0.16;
  } else {
    // blight_fern
    baseLateral = 5.02 + r1 * 2.8;
    y = -0.18;
  }

  const x = side * (Math.max(ROAD_SAFE_HALF_WIDTH, baseLateral) + branchPush);
  // Face slightly toward the causeway so carnivorous blooms & vines look alive and reactive!
  const yaw = (side < 0 ? Math.PI * 0.45 : -Math.PI * 0.45) + (r2 - 0.5) * 0.7;

  return { x, y, side, yaw, inBranchMargin: inBranch };
}

/**
 * Picks an initial biome-appropriate natural behavior for each wildlife species.
 */
export function pickInitialWildlifeBehavior(species: WildlifeSpecies, seed: number): WildlifeBehavior {
  const r = seededUnit(seed * 19 + 3);
  switch (species) {
    case 'deer':
      return r < 0.68 ? 'grazing' : 'alert';
    case 'tiger':
      return r < 0.42 ? 'resting' : r < 0.82 ? 'prowling' : 'emerging';
    case 'cat':
      return r < 0.4 ? 'sitting' : r < 0.72 ? 'sleeping' : 'walking';
    case 'dog':
      return r < 0.42 ? 'exploring' : r < 0.75 ? 'walking' : 'playing';
    case 'rabbit':
      return 'hopping';
    case 'pigeon':
      return 'perched';
    case 'peacock':
      return r < 0.52 ? 'displaying' : 'walking';
    case 'sparrow':
      return r < 0.55 ? 'flocking' : 'perched';
  }
}

/**
 * Determines whether a rare, clearly readable distant road-crossing moment is 100% safe to trigger.
 * Guarantees >= 1.6s clearance so crossing wildlife NEVER interferes with lane switching or causes unfair hits.
 */
export function canTriggerDistantCrossing(params: {
  species: WildlifeSpecies;
  distAhead: number;
  runnerSpeed: number;
  introActive: boolean;
  inBranchZone: boolean;
  allowsCrossing: boolean;
  timeSinceLastCrossing: number;
}): boolean {
  if (!params.allowsCrossing || params.introActive || params.inBranchZone) return false;
  if (params.species !== 'deer' && params.species !== 'rabbit') return false;
  if (params.timeSinceLastCrossing < 14) return false;
  if (params.distAhead < MIN_CROSSING_AHEAD_DIST || params.distAhead > MAX_CROSSING_AHEAD_DIST) return false;
  const arrivalTimeSec = params.distAhead / Math.max(12, params.runnerSpeed);
  return arrivalTimeSec >= 1.65;
}
