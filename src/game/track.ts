import {
  BranchRouteMeta,
  LevelDef,
  ObstacleKind,
  PlayMode,
  RouteId,
  RouteStyle,
  TrackBranch,
  TrackCoin,
  TrackObstacle,
} from '../types/game';

export const BRANCH_LATERAL_OFFSET = 11.4;
export const BRANCH_CURVE_LENGTH = 24;

/** Curated seamless Endless Mode biome evolution order (cycles endlessly every ~340m). */
export const ENDLESS_BIOME_CYCLE: readonly number[] = [
  1, 8, 4, 7, 9, 13, 11, 14, 15, 16, 3, 5, 18, 6, 2, 10, 12, 17, 19, 20,
] as const;

export const ENDLESS_BIOME_SEGMENT_METERS = 340;

/**
 * Returns the active Endless Mode level/biome ID for a given run distance,
 * rotating seamlessly through diverse landscapes without ever reaching an ending.
 */
export function getEndlessBiomeLevelId(distanceZ: number, startLevelId = 1): number {
  const startIdx = Math.max(0, ENDLESS_BIOME_CYCLE.indexOf(startLevelId));
  const seg = Math.floor(Math.max(0, distanceZ) / ENDLESS_BIOME_SEGMENT_METERS);
  return ENDLESS_BIOME_CYCLE[(startIdx + seg) % ENDLESS_BIOME_CYCLE.length];
}

export interface RoutePose {
  centerX: number;
  centerY: number;
  /** Analytic d(centerX)/dz */
  slopeX: number;
  /** Analytic d(centerY)/dz */
  slopeY: number;
  /** Unit forward vector in world XZ space (z decreases as player advances forward) */
  forwardX: number;
  forwardZ: number;
  /** Unit right vector perpendicular to forward in world XZ space */
  rightX: number;
  rightZ: number;
  /** Yaw rotation around +Y so local -Z faces along (forwardX, 0, forwardZ) */
  headingYaw: number;
  /** Active branch if z lies within [startZ, endZ] */
  branchId: number | null;
}

export interface ChaseCameraPose {
  posX: number;
  posY: number;
  posZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
}

export interface GeneratedBranchTrackSlice {
  obstacles: TrackObstacle[];
  coins: TrackCoin[];
  branches: TrackBranch[];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * C1-continuous cosine S-curve: f(0)=0, f(1)=1, f'(0)=0, f'(1)=0.
 * Zero sudden curvature snap at fork entry, parallel lock-in, or merge exit!
 */
function smoothCosine(t: number): { value: number; deriv: number } {
  const c = clamp01(t);
  return {
    value: 0.5 - 0.5 * Math.cos(Math.PI * c),
    deriv: 0.5 * Math.PI * Math.sin(Math.PI * c),
  };
}

/**
 * Evaluates exact smooth 3D centerline position, elevation, forward tangent,
 * right basis vector, and heading yaw along any active route ('main' | 'left' | 'center' | 'right').
 * Guaranteed C1-smooth everywhere with zero discontinuities at fork or merge boundaries.
 */
export function sampleRoutePose(
  branches: readonly TrackBranch[],
  z: number,
  route: RouteId,
): RoutePose {
  if (route !== 'main') {
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (z >= b.startZ && z <= b.endZ) {
        const meta = b.routes.find((r) => r.id === route);
        if (meta) {
          let s = 1;
          let dsDz = 0;
          let elevS = 1;
          let dElevDz = 0;

          if (b.curveShape === 's_curve') {
            // Exact C1-smooth S-curve: s(0)=0, s'(0)=0, s(1)=0, s'(1)=0; sweeps cleanly left then right!
            const totalLen = Math.max(1, b.endZ - b.startZ);
            const u = clamp01((z - b.startZ) / totalLen);
            const env = 0.5 - 0.5 * Math.cos(Math.PI * 2 * u);
            const dEnvDu = Math.PI * Math.sin(Math.PI * 2 * u);
            const wave = Math.sin(Math.PI * 2 * u);
            const dWaveDu = Math.PI * 2 * Math.cos(Math.PI * 2 * u);
            s = wave * env;
            dsDz = (dWaveDu * env + wave * dEnvDu) / totalLen;
            elevS = env;
            dElevDz = dEnvDu / totalLen;
          } else {
            const splitLen = Math.max(1, b.splitEndZ - b.startZ);
            const mergeLen = Math.max(1, b.endZ - b.mergeStartZ);

            if (z < b.splitEndZ) {
              const c = smoothCosine((z - b.startZ) / splitLen);
              s = c.value;
              dsDz = c.deriv / splitLen;
            } else if (z > b.mergeStartZ) {
              const c = smoothCosine((b.endZ - z) / mergeLen);
              s = c.value;
              dsDz = -c.deriv / mergeLen;
            }
            elevS = s;
            dElevDz = dsDz;
          }

          const centerX = meta.lateralOffset * s;
          const centerY = meta.elevationPeak * elevS;
          const slopeX = meta.lateralOffset * dsDz;
          const slopeY = meta.elevationPeak * dElevDz;

          // Advancing +dz moves along world (slopeX, slopeY, -1)
          const invLen = 1 / Math.hypot(slopeX, 1);
          const forwardX = slopeX * invLen;
          const forwardZ = -invLen;
          const rightX = -forwardZ; // = invLen (> 0)
          const rightZ = forwardX;
          const headingYaw = Math.atan2(-forwardX, -forwardZ);

          return {
            centerX,
            centerY,
            slopeX,
            slopeY,
            forwardX,
            forwardZ,
            rightX,
            rightZ,
            headingYaw,
            branchId: b.id,
          };
        }
      }
    }
  }

  return {
    centerX: 0,
    centerY: 0,
    slopeX: 0,
    slopeY: 0,
    forwardX: 0,
    forwardZ: -1,
    rightX: 1,
    rightZ: 0,
    headingYaw: 0,
    branchId: null,
  };
}

/**
 * Maps a track coordinate (z, lane, route) into worldRoot-local 3D coordinates (x, y, worldZ, headingYaw).
 * worldRoot moves along +Z by sim.z, so worldZ = -z.
 */
export function sampleTrackPoint(
  branches: readonly TrackBranch[],
  z: number,
  laneOffsetX: number,
  route: RouteId,
): { x: number; y: number; worldZ: number; headingYaw: number; pose: RoutePose } {
  const pose = sampleRoutePose(branches, z, route);
  return {
    x: pose.centerX + pose.rightX * laneOffsetX,
    y: pose.centerY,
    worldZ: -z + pose.rightZ * laneOffsetX,
    headingYaw: pose.headingYaw,
    pose,
  };
}

/**
 * Returns true if any active branch overlaps the given z interval (with safety padding).
 * Used to keep side landmarks, arches, and boulders clear of diverging Left/Right routes!
 */
export function isZInsideBranchZone(
  branches: readonly TrackBranch[],
  z: number,
  paddingMeters = 10,
): TrackBranch | null {
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    if (z >= b.startZ - paddingMeters && z <= b.endZ + paddingMeters) {
      return b;
    }
  }
  return null;
}

/**
 * Finds the active or immediately upcoming branch that the player can select a route for.
 */
export function findApproachingBranch(
  branches: readonly TrackBranch[],
  playerZ: number,
  lookAheadMeters = 32,
): TrackBranch | null {
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    if (b.routes.length <= 1) continue; // Single-corridor scenic S-curves / bends auto-follow smoothly without fork UI!
    if (!b.resolved && playerZ >= b.startZ - lookAheadMeters && playerZ <= b.startZ + 4) {
      return b;
    }
  }
  return null;
}

/**
 * Resolves a player's Left/Center/Right route choice when entering a TrackBranch.
 * - On 3-way forks (hasCenter = true): lane -1 -> 'left', lane 0 -> 'center', lane +1 -> 'right'.
 * - On 2-way forks (hasCenter = false): explicit swipe direction or lane sign selects 'left' or 'right'
 *   (if centered without an explicit swipe, smoothly guides into the nearest balanced route).
 */
export function selectBranchRoute(
  branch: TrackBranch,
  playerLane: -1 | 0 | 1,
  explicitDir?: -1 | 1,
): Exclude<RouteId, 'main'> {
  if (explicitDir === -1) return 'left';
  if (explicitDir === 1) return 'right';

  if (branch.hasCenter) {
    if (playerLane < 0) return 'left';
    if (playerLane > 0) return 'right';
    return 'center';
  }

  // 2-way split: left or right
  if (playerLane < 0) return 'left';
  if (playerLane > 0) return 'right';
  // Neutral center on a 2-way split: alternate deterministically by branch id
  return branch.id % 2 === 0 ? 'right' : 'left';
}

/**
 * Smooth 5-phase gradual speed progression with zero sudden spikes!
 * - Phase 1 (0–12%): Comfortable opening warm-up (starts gentle, ramps softly)
 * - Phase 2 (12–35%): Early flow climb
 * - Phase 3 (35–65%): Mid-run rhythmic pace with branches & combos
 * - Phase 4 (65–88%): High-speed technical mastery
 * - Phase 5 (88%+ / Endless): Smooth asymptotic approach toward maxSpeed
 */
export function computeProgressiveSpeed(
  level: LevelDef,
  distanceZ: number,
  mode: PlayMode,
): number {
  const z = Math.max(0, distanceZ);
  if (mode === 'tutorial') {
    const t = clamp01(z / 420);
    return level.baseSpeed * 0.88 + (level.maxSpeed - level.baseSpeed) * 0.35 * (t * t * (3 - 2 * t));
  }

  if (mode === 'endless') {
    // Smooth logarithmic/asymptotic ramp over 3,000m so endless accelerates gradually without sudden jumps
    const ramp = 1 - Math.exp(-z / 1050);
    const maxEndless = Math.min(45, level.maxSpeed + 5.5);
    return level.baseSpeed + (maxEndless - level.baseSpeed) * ramp;
  }

  const targetDist = Math.max(300, level.targetDistance);
  const progress = clamp01(z / targetDist);
  // Gentle ease-in-out S-curve blended with linear steady momentum (never flat, never spiky!)
  const smooth = progress * progress * (3 - 2 * progress);
  const blended = progress * 0.42 + smooth * 0.58;
  return level.baseSpeed + (level.maxSpeed - level.baseSpeed) * blended;
}

/**
 * Computes the ideal third-person chase camera target position & look-at point
 * in player-relative world coordinates (player is at worldZ = 0 while worldRoot translates by +sim.z).
 *
 * Guarantees:
 * - Camera stays smoothly behind the player along the ACTUAL selected route's tangent!
 * - On Left/Right curves, camera naturally rotates into the curve and looks down the selected route!
 * - Never keeps looking down the old main path after branching!
 * - Smoothly tracks lane changes without lateral whip, and adapts to jumps, slides, and speed!
 */
export interface CameraClearanceAdjustment {
  posYDrop: number;
  forwardPull: number;
}

/**
 * Prevents the chase camera from clipping through overhead lintels (`high_arch`, `swinging_blade`)
 * by smoothly dipping below the soffit or nudging forward when camera eye Z passes beneath an arch.
 */
export function computeCameraClearanceOffset(
  camTrackZ: number,
  activeRoute: RouteId,
  obstacles: readonly TrackObstacle[],
  camHeightOffset: number,
): CameraClearanceAdjustment {
  let maxDrop = 0;
  let maxPull = 0;

  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.kind !== 'high_arch' && o.kind !== 'swinging_blade') continue;
    if (o.route !== 'main' && o.route !== activeRoute) continue;

    const dz = Math.abs(o.z - camTrackZ);
    if (dz < 4.2) {
      const prox = 1 - dz / 4.2;
      const smooth = prox * prox * (3 - 2 * prox);
      const beamBottom = o.kind === 'high_arch' ? 2.18 : 2.35;
      const neededDrop = Math.max(0, camHeightOffset - beamBottom);
      maxDrop = Math.max(maxDrop, neededDrop * smooth);
      maxPull = Math.max(maxPull, 0.85 * smooth);
    }
  }

  return {
    posYDrop: maxDrop,
    forwardPull: maxPull,
  };
}

export function computeDesiredChaseCamera(params: {
  branches: readonly TrackBranch[];
  simZ: number;
  laneX: number;
  playerY: number;
  slideActive: boolean;
  activeRoute: RouteId;
  pendingBranchChoice?: Exclude<RouteId, 'main'> | null;
  speed: number;
  hollowDistance: number;
  cameraSensitivity: number;
  motionMultiplier: number;
  obstacles?: readonly TrackObstacle[];
}): ChaseCameraPose {
  const {
    branches,
    simZ,
    laneX,
    playerY,
    slideActive,
    activeRoute,
    pendingBranchChoice = null,
    speed,
    hollowDistance,
    cameraSensitivity,
    motionMultiplier,
  } = params;

  const curPose = sampleRoutePose(branches, simZ, activeRoute);
  // Sample 14.5m ahead along the ACTIVE route (or smoothly anticipate committed pendingBranchChoice within 14m of fork)
  const lookAheadDist = 14.5;
  let lookRoute: RouteId = activeRoute;
  if (activeRoute === 'main' && pendingBranchChoice) {
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (!b.resolved && simZ + lookAheadDist >= b.startZ && simZ <= b.startZ + 2) {
        lookRoute = pendingBranchChoice;
        break;
      }
    }
  }
  const aheadPose = sampleRoutePose(branches, simZ + lookAheadDist, lookRoute);
  const speedRatio = clamp01((speed - 17) / 26);
  const hollowTighten = Math.max(0, 1 - (hollowDistance - 2.5) / 10) * 0.62;
  const baseFollowDist = 6.75 - hollowTighten + speedRatio * 0.65;
  const baseCamHeight = 3.85 + playerY * 0.34 - (slideActive ? 0.24 : 0) + speedRatio * 0.14;
  const clearance = params.obstacles
    ? computeCameraClearanceOffset(simZ - baseFollowDist, activeRoute, params.obstacles, baseCamHeight)
    : { posYDrop: 0, forwardPull: 0 };

  const followDist = Math.max(4.4, baseFollowDist - clearance.forwardPull);
  const camHeight = Math.max(2.05, baseCamHeight - clearance.posYDrop);

  // Compute chord heading from current route center toward the route 14.5m ahead,
  // then blend smoothly with the current tangent so the camera rotates naturally into curves
  // while keeping the player firmly framed inside narrow portrait viewports!
  const chordDx = aheadPose.centerX - curPose.centerX;
  const chordDz = -lookAheadDist;
  const chordLen = Math.hypot(chordDx, chordDz) || 1;
  const chordFx = chordDx / chordLen;
  const chordFz = chordDz / chordLen;

  const blendFx = curPose.forwardX * 0.45 + chordFx * 0.55;
  const blendFz = curPose.forwardZ * 0.45 + chordFz * 0.55;
  const blendLen = Math.hypot(blendFx, blendFz) || 1;
  const camDirX = blendFx / blendLen;
  const camDirZ = blendFz / blendLen;
  // Camera-right perpendicular to blended heading
  const camRightX = -camDirZ;
  const camRightZ = camDirX;

  // Anchor behind the player along blended heading with smooth lane tracking (no lateral whip, never clipped)
  const laneTrack = clamp01(0.68 * cameraSensitivity);
  const anchorX = curPose.centerX + curPose.rightX * (laneX * laneTrack);
  const anchorZ = curPose.rightZ * (laneX * laneTrack);

  const posX = anchorX - camDirX * followDist;
  const posY = curPose.centerY + camHeight;
  const posZ = anchorZ - camDirZ * followDist;

  // Look straight past the player along the blended route heading, with subtle 22% apex anticipation
  const straightLookX = anchorX + camDirX * 14.0 + camRightX * (laneX * 0.12);
  const straightLookZ = anchorZ + camDirZ * 14.0 + camRightZ * (laneX * 0.12);
  const apexLookX = aheadPose.centerX + aheadPose.rightX * (laneX * 0.32);
  const apexLookZ = -lookAheadDist + aheadPose.rightZ * (laneX * 0.32);

  const lookX = straightLookX * 0.78 + apexLookX * 0.22;
  const lookY = aheadPose.centerY * 0.65 + curPose.centerY * 0.35 + 1.56 + playerY * 0.2 - (slideActive ? 0.12 : 0);
  const lookZ = straightLookZ * 0.78 + apexLookZ * 0.22;

  const fov = 56 + speedRatio * 6.5 * motionMultiplier;

  return {
    posX,
    posY,
    posZ,
    lookX,
    lookY,
    lookZ,
    fov,
  };
}

/**
 * Deterministic Mulberry32 PRNG (local copy so track.ts has zero circular deps).
 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds distinct risk/reward route metadata for a 2-way or 3-way branching fork.
 */
function buildBranchRoutes(branchId: number, hasCenter: boolean): BranchRouteMeta[] {
  const variant = branchId % 3;
  const swapSides = branchId % 2 === 1;

  const highRiskRoute = (id: 'left' | 'right'): BranchRouteMeta =>
    variant === 2
      ? {
          id,
          style: 'ruin_gauntlet',
          label: 'SUNKEN CRYPT · 2X',
          lateralOffset: id === 'left' ? -BRANCH_LATERAL_OFFSET : BRANCH_LATERAL_OFFSET,
          elevationPeak: -0.85,
          coinMultiplier: 2,
          riskTier: 'high_reward',
        }
      : {
          id,
          style: 'relic_vault',
          label: 'RELIC VAULT · 2X',
          lateralOffset: id === 'left' ? -BRANCH_LATERAL_OFFSET : BRANCH_LATERAL_OFFSET,
          elevationPeak: -0.3,
          coinMultiplier: 2,
          riskTier: 'high_reward',
        };

  const scenicRoute = (id: 'left' | 'right'): BranchRouteMeta => ({
    id,
    style: 'sky_bridge',
    label: variant === 1 ? 'CLIFFSIDE BRIDGE' : 'CANOPY BRIDGE',
    lateralOffset: id === 'left' ? -BRANCH_LATERAL_OFFSET : BRANCH_LATERAL_OFFSET,
    elevationPeak: variant === 1 ? 1.65 : 1.35,
    coinMultiplier: 2,
    riskTier: 'scenic',
  });

  const leftMeta: BranchRouteMeta = swapSides ? scenicRoute('left') : highRiskRoute('left');
  const rightMeta: BranchRouteMeta = swapSides ? highRiskRoute('right') : scenicRoute('right');

  if (!hasCenter) {
    return [leftMeta, rightMeta];
  }

  const centerMeta: BranchRouteMeta = {
    id: 'center',
    style: 'main_causeway',
    label: 'TEMPLE CAUSEWAY',
    lateralOffset: 0,
    elevationPeak: 0,
    coinMultiplier: 1,
    riskTier: 'balanced',
  };

  return [leftMeta, centerMeta, rightMeta];
}

function pickFromPool(
  pool: readonly ObstacleKind[],
  preferred: readonly ObstacleKind[],
  rng: () => number,
): ObstacleKind {
  const matches = preferred.filter((k) => pool.includes(k));
  if (matches.length > 0) {
    return matches[Math.floor(rng() * matches.length)];
  }
  return pool[Math.floor(rng() * pool.length)] ?? 'low_barrier';
}

/**
 * Generates handcrafted, skill-based obstacles, guiding coin trails, and REAL playable
 * 2-way and 3-way branching routes with speed-scaled fair reaction spacing!
 */
export function generateSkillTrackSlice(
  level: LevelDef,
  startZ: number,
  endZ: number,
  seedOffset: number,
  bonusTrailLevel: number,
  idStart: { obstacle: number; coin: number; turn: number },
  mode: PlayMode = 'campaign',
  laneWidth = 2.35,
  existingBranches: readonly TrackBranch[] = [],
): GeneratedBranchTrackSlice {
  const rng = makeRng(level.id * 9973 + seedOffset * 131 + 17);
  const obstacles: TrackObstacle[] = [];
  const coins: TrackCoin[] = [];
  const branches: TrackBranch[] = [];

  // Keep opening runway clear of hazards so the ~2.85s Opening Hollow Chase frames cleanly & player gets into rhythm!
  const safeStartZ = Math.max(startZ, mode === 'tutorial' ? 42 : 76);

  const pushObstacle = (
    zPos: number,
    lane: -1 | 0 | 1,
    kind: ObstacleKind,
    route: RouteId,
    branchId?: number,
  ) => {
    const isFull = kind === 'gap' || kind === 'low_barrier' || kind === 'high_arch';
    obstacles.push({
      id: idStart.obstacle++,
      z: zPos,
      lane: isFull || kind === 'narrow_bridge' ? 0 : lane,
      route,
      branchId,
      kind,
      width: kind === 'narrow_bridge' ? laneWidth * 1.15 : isFull ? laneWidth * 3.1 : laneWidth * 0.84,
      height:
        kind === 'high_arch'
          ? 1.55
          : kind === 'low_barrier'
            ? 1.02
            : kind === 'spike_trap' || kind === 'fire_vent'
              ? 0.96
              : kind === 'gap' || kind === 'narrow_bridge' || kind === 'collapsing_floor'
                ? 0.22
                : 2.55,
      phase: rng() * Math.PI * 2,
      passed: false,
      hit: false,
      nearMissed: false,
    });
  };

  const pushCoinLine = (
    zStart: number,
    count: number,
    step: number,
    lane: -1 | 0 | 1,
    route: RouteId,
    arcMode: 'flat' | 'jump' | 'slide',
    valueMult: number,
    isBonus: boolean,
    branchId?: number,
  ) => {
    for (let i = 0; i < count; i++) {
      const frac = count > 1 ? i / (count - 1) : 0.5;
      const y =
        arcMode === 'jump'
          ? Math.sin(frac * Math.PI) * 1.85 + 1.15
          : arcMode === 'slide'
            ? 0.62
            : 1.0;
      coins.push({
        id: idStart.coin++,
        z: zStart + i * step,
        lane,
        route,
        branchId,
        y,
        value: Math.max(1, Math.round(valueMult * (isBonus ? 2 : 1))),
        collected: false,
        isBonusTrail: isBonus || valueMult >= 2,
      });
    }
  };

  /**
   * Populates a single route inside a branch with route-specific skill challenges & rewards!
   * Divergence curve [startZ..splitEndZ] & merge curve [mergeStartZ..endZ] stay obstacle-free
   * (lined with rewarding guiding coin ribbons!) so curve navigation feels fluid and 100% fair!
   */
  const populateBranchRoute = (branch: TrackBranch, meta: BranchRouteMeta) => {
    const bonusBoost = bonusTrailLevel * 0.08;
    // Welcoming coin ribbon sweeping along the divergence curve into the chosen route
    pushCoinLine(
      branch.startZ + 4,
      5,
      3.4,
      0,
      meta.id,
      'flat',
      meta.coinMultiplier,
      meta.coinMultiplier >= 2,
      branch.id,
    );

    const speed = computeProgressiveSpeed(level, branch.splitEndZ + 20, mode);
    const fairStep = Math.max(18, speed * 0.86);
    let rz = branch.splitEndZ + 10;
    const rLimit = branch.mergeStartZ - 10;
    let beat = 0;

    while (rz < rLimit) {
      if (meta.style === 'relic_vault' || meta.style === 'ruin_gauntlet') {
        // High-reward skill gauntlet / sunken crypt: alternating Jump -> Slide -> Fast Lane Weave with rich 2x coins!
        if (beat % 3 === 0) {
          const kind = pickFromPool(level.obstaclePool, ['low_barrier', 'spike_trap', 'fire_vent'], rng);
          if (kind === 'low_barrier') {
            pushObstacle(rz, 0, kind, meta.id, branch.id);
            pushCoinLine(rz - 5, 5, 2.5, 0, meta.id, 'jump', meta.coinMultiplier, true, branch.id);
          } else {
            const safeLane: -1 | 0 | 1 = beat % 2 === 0 ? -1 : 1;
            for (const l of ([-1, 0, 1] as const).filter((x) => x !== safeLane)) {
              pushObstacle(rz, l, kind, meta.id, branch.id);
            }
            pushCoinLine(rz - 4.5, 5, 2.4, safeLane, meta.id, 'flat', meta.coinMultiplier, true, branch.id);
          }
        } else if (beat % 3 === 1) {
          pushObstacle(rz, 0, 'high_arch', meta.id, branch.id);
          pushCoinLine(rz - 4.5, 5, 2.4, 0, meta.id, 'slide', meta.coinMultiplier, true, branch.id);
        } else {
          const safeLane: -1 | 0 | 1 = rng() < 0.5 ? -1 : 1;
          const kind = pickFromPool(level.obstaclePool, ['tall_pillar', 'moving_block', 'rotating_spinner'], rng);
          if (kind === 'moving_block' || kind === 'rotating_spinner') {
            pushObstacle(rz, 0, kind, meta.id, branch.id);
            pushCoinLine(rz - 4, 4, 2.6, safeLane, meta.id, 'flat', meta.coinMultiplier, true, branch.id);
          } else {
            for (const l of ([-1, 0, 1] as const).filter((x) => x !== safeLane)) {
              pushObstacle(rz, l, kind, meta.id, branch.id);
            }
            pushCoinLine(rz - 4, 4, 2.6, safeLane, meta.id, 'flat', meta.coinMultiplier, true, branch.id);
          }
        }
      } else if (meta.style === 'sky_bridge') {
        // Elevated scenic aqueduct / canyon bridge: narrow bridge balance + chasm vaults + aerial coin arcs!
        if (beat % 2 === 0) {
          const kind = pickFromPool(level.obstaclePool, ['narrow_bridge', 'gap', 'low_barrier'], rng);
          pushObstacle(rz, 0, kind, meta.id, branch.id);
          pushCoinLine(
            rz - 4.5,
            5,
            2.4,
            0,
            meta.id,
            kind === 'narrow_bridge' ? 'flat' : 'jump',
            meta.coinMultiplier,
            true,
            branch.id,
          );
        } else {
          const safeLane: -1 | 0 | 1 = 0;
          const kind = pickFromPool(level.obstaclePool, ['tall_pillar', 'collapsing_floor', 'swinging_blade'], rng);
          if (kind === 'swinging_blade') {
            pushObstacle(rz, 0, kind, meta.id, branch.id);
            pushCoinLine(rz - 4, 4, 2.5, safeLane, meta.id, 'flat', meta.coinMultiplier, rng() < 0.4 + bonusBoost, branch.id);
          } else {
            pushObstacle(rz, -1, kind, meta.id, branch.id);
            pushObstacle(rz, 1, kind, meta.id, branch.id);
            pushCoinLine(rz - 4, 5, 2.4, safeLane, meta.id, 'flat', meta.coinMultiplier, true, branch.id);
          }
        }
      } else {
        // Center main causeway: balanced lane shifts & steady readable coins
        const safeLane: -1 | 0 | 1 = ([-1, 0, 1] as const)[(beat + branch.id) % 3];
        const kind = pickFromPool(level.obstaclePool, ['tall_pillar', 'low_barrier', 'high_arch'], rng);
        if (kind === 'low_barrier' || kind === 'high_arch') {
          pushObstacle(rz, 0, kind, meta.id, branch.id);
          pushCoinLine(
            rz - 4.5,
            4,
            2.5,
            0,
            meta.id,
            kind === 'low_barrier' ? 'jump' : 'slide',
            1,
            rng() < 0.2 + bonusBoost,
            branch.id,
          );
        } else {
          pushObstacle(rz, safeLane === 0 ? -1 : 0, kind, meta.id, branch.id);
          pushCoinLine(rz - 4, 4, 2.5, safeLane, meta.id, 'flat', 1, rng() < 0.2 + bonusBoost, branch.id);
        }
      }

      beat++;
      rz += fairStep + (beat % 2) * 3;
    }

    // Re-merge guide coins leading smoothly back onto the main causeway
    pushCoinLine(
      branch.mergeStartZ + 5,
      4,
      3.5,
      0,
      meta.id,
      'flat',
      meta.coinMultiplier,
      false,
      branch.id,
    );
  };

  // Track last branch endZ across streamed slices so branches space naturally (~135–165m apart)
  let lastBranchEndZ = existingBranches.reduce((max, b) => Math.max(max, b.endZ), 0);
  // First branch arrives clearly around ~118m on Level 1+ so players experience real branching early!
  let nextBranchTriggerZ = lastBranchEndZ > 0 ? lastBranchEndZ + 72 : 118;

  let z = safeStartZ;
  let patternIdx = seedOffset * 3;

  while (z < endZ - 16) {
    // Check if an existing branch from a prior chunk still covers z
    const activeExisting = isZInsideBranchZone(existingBranches, z, 6);
    if (activeExisting) {
      z = Math.max(z + 10, activeExisting.endZ + 18);
      continue;
    }

    // Spawn a REAL playable 2-way or 3-way branching section when due (and with enough runway before level end)
    const branchTotalLen = 104; // 24m split curve + 56m parallel routes + 24m merge curve
    const hasRoomForBranch =
      mode !== 'tutorial' &&
      z >= nextBranchTriggerZ &&
      (mode === 'endless' || z + branchTotalLen + 36 < level.targetDistance);

    if (hasRoomForBranch) {
      const branchId = idStart.turn++;
      // Interleave real 2-way/3-way forks with flowing Temple Run S-curves & sweeping canyon bends!
      const isScenicCurve = branchId > 1 && branchId % 3 === 0;

      if (isScenicCurve) {
        const isSCurve = branchId % 6 === 0;
        const curveSign = branchId % 2 === 0 ? 1 : -1;
        const startBranchZ = z + 12;
        const splitEndZ = startBranchZ + (isSCurve ? 18 : 22);
        const mergeStartZ = splitEndZ + (isSCurve ? 52 : 44);
        const endBranchZ = mergeStartZ + (isSCurve ? 18 : 22);
        const style: RouteStyle = branchId % 2 === 0 ? 'sky_bridge' : 'main_causeway';

        const curveRoute: BranchRouteMeta = {
          id: 'center',
          style,
          label: isSCurve ? 'SERPENTINE BEND' : curveSign < 0 ? 'CANYON SWEEP LEFT' : 'CLIFFSIDE CURVE',
          lateralOffset: curveSign * (isSCurve ? 8.2 : 7.4),
          elevationPeak: style === 'sky_bridge' ? 1.15 : 0.45,
          coinMultiplier: 1,
          riskTier: 'scenic',
        };

        const curveBranch: TrackBranch = {
          id: branchId,
          startZ: startBranchZ,
          splitEndZ,
          mergeStartZ,
          endZ: endBranchZ,
          hasCenter: true,
          curveShape: isSCurve ? 's_curve' : curveSign < 0 ? 'sweep_left' : 'sweep_right',
          routes: [curveRoute],
          chosenRoute: null,
          resolved: false,
          merged: false,
        };
        branches.push(curveBranch);
        populateBranchRoute(curveBranch, curveRoute);

        lastBranchEndZ = endBranchZ;
        nextBranchTriggerZ = endBranchZ + 66 + Math.floor(rng() * 20);
        z = endBranchZ + 18;
        continue;
      }

      // Prioritize 3-way (Left/Center/Right) forks including Branch #1 while keeping 2-way splits in rotation!
      const hasCenter = branchId === 1 || branchId % 3 !== 2;
      const startBranchZ = z + 14; // Clean approach runway before fork split
      const splitEndZ = startBranchZ + BRANCH_CURVE_LENGTH;
      const mergeStartZ = splitEndZ + 56;
      const endBranchZ = mergeStartZ + BRANCH_CURVE_LENGTH;

      const branch: TrackBranch = {
        id: branchId,
        startZ: startBranchZ,
        splitEndZ,
        mergeStartZ,
        endZ: endBranchZ,
        hasCenter,
        curveShape: 'branch',
        routes: buildBranchRoutes(branchId, hasCenter),
        chosenRoute: null,
        resolved: false,
        merged: false,
      };
      branches.push(branch);

      // Guiding approach coins fanning toward available routes ahead of the fork!
      pushCoinLine(startBranchZ - 14, 3, 2.8, -1, 'main', 'flat', 1, false);
      pushCoinLine(startBranchZ - 14, 3, 2.8, 1, 'main', 'flat', 1, false);
      if (hasCenter) {
        pushCoinLine(startBranchZ - 14, 3, 2.8, 0, 'main', 'flat', 1, false);
      }

      for (const routeMeta of branch.routes) {
        populateBranchRoute(branch, routeMeta);
      }

      lastBranchEndZ = endBranchZ;
      nextBranchTriggerZ = endBranchZ + 74 + Math.floor(rng() * 22);
      // Generous recovery runway after smooth merge back onto main road!
      z = endBranchZ + 22;
      continue;
    }

    // Compute local speed and speed-scaled fair reaction distance (minimum 0.80s reaction time at ALL speeds!)
    const localSpeed = computeProgressiveSpeed(level, z, mode);
    const reactionSpacing = Math.max(16.5, localSpeed * (0.86 - level.hazardDensity * 0.08));
    const progress = mode === 'endless' ? clamp01(z / 1600) : clamp01(z / Math.max(350, level.targetDistance));
    const isBonus = rng() < 0.14 + bonusTrailLevel * 0.08;

    // Phased handcrafted skill-based encounter selection (prevents repetitive wall spam!)
    const phase = progress < 0.25 ? 'early' : progress < 0.62 ? 'mid' : 'advanced';
    const roll = patternIdx % 6;
    patternIdx++;

    if (roll === 0) {
      // SKILL 1: Lane Dodge (1 or 2 lanes blocked -> clearly open lane rewarded with coins)
      const lanes: Array<-1 | 0 | 1> = [-1, 0, 1];
      const safeLane = lanes[Math.floor(rng() * 3)];
      const kind = pickFromPool(
        level.obstaclePool,
        ['tall_pillar', 'spike_trap', 'fire_vent', 'mine_cart', 'falling_debris'],
        rng,
      );
      const blockTwo = phase !== 'early' && rng() < 0.45 + level.hazardDensity * 0.3;
      const blocked = lanes.filter((l) => l !== safeLane).slice(0, blockTwo ? 2 : 1);
      for (const bLane of blocked) {
        pushObstacle(z, bLane, kind, 'main');
      }
      pushCoinLine(z - 4.5, 4, 2.6, safeLane, 'main', 'flat', 1, isBonus);
      z += reactionSpacing + 3;
    } else if (roll === 1) {
      // SKILL 2: Clean Jump Challenge (low barrier or chasm gap with jump-arc coin reward)
      const kind = pickFromPool(level.obstaclePool, ['low_barrier', 'gap'], rng);
      pushObstacle(z, 0, kind, 'main');
      pushCoinLine(z - 5, 5, 2.5, 0, 'main', 'jump', 1, isBonus);
      z += reactionSpacing + 4;
    } else if (roll === 2) {
      // SKILL 3: Clean Slide Challenge (overhead carved arch with low coin ribbon)
      pushObstacle(z, 0, 'high_arch', 'main');
      pushCoinLine(z - 4.5, 5, 2.4, 0, 'main', 'slide', 1, isBonus);
      z += reactionSpacing + 4;
    } else if (roll === 3 && phase !== 'early' && z + reactionSpacing * 2.2 < endZ - 14) {
      // SKILL 4: Handcrafted 2-Move & 3-Move Mastery Combo Sequences (Lane Shift -> Jump -> Slide!)
      const comboType = patternIdx % 3;
      if (comboType === 0) {
        // Dodge right/left around pillar, then jump low barrier with generous reaction window!
        const safeLane: -1 | 0 | 1 = rng() < 0.5 ? -1 : 1;
        const dodgeKind = pickFromPool(level.obstaclePool, ['tall_pillar', 'fire_vent', 'spike_trap'], rng);
        pushObstacle(z, 0, dodgeKind, 'main');
        pushObstacle(z, -safeLane as -1 | 1, dodgeKind, 'main');
        pushCoinLine(z - 4, 3, 2.5, safeLane, 'main', 'flat', 1, false);

        const z2 = z + Math.max(18, localSpeed * 0.92);
        pushObstacle(z2, 0, 'low_barrier', 'main');
        pushCoinLine(z2 - 4.5, 5, 2.4, safeLane, 'main', 'jump', 2, true);
        z = z2 + reactionSpacing + 5;
      } else if (comboType === 1 || phase !== 'advanced' || z + reactionSpacing * 3.2 >= endZ - 14) {
        // Vault low barrier into crisp slide under overhead temple arch!
        pushObstacle(z, 0, 'low_barrier', 'main');
        pushCoinLine(z - 4.5, 4, 2.4, 0, 'main', 'jump', 1, false);

        const z2 = z + Math.max(20, localSpeed * 1.02);
        pushObstacle(z2, 0, 'high_arch', 'main');
        pushCoinLine(z2 - 4, 5, 2.3, 0, 'main', 'slide', 2, true);
        z = z2 + reactionSpacing + 5;
      } else {
        // Advanced 3-Move Skill Flow: Lane Dodge -> Low Barrier Jump -> Overhead Arch Slide (each spaced >= 0.94s!)
        const safeLane: -1 | 0 | 1 = rng() < 0.5 ? -1 : 1;
        const dodgeKind = pickFromPool(level.obstaclePool, ['tall_pillar', 'spike_trap', 'fire_vent'], rng);
        pushObstacle(z, 0, dodgeKind, 'main');
        pushObstacle(z, -safeLane as -1 | 1, dodgeKind, 'main');
        pushCoinLine(z - 3.5, 3, 2.4, safeLane, 'main', 'flat', 1, false);

        const z2 = z + Math.max(19, localSpeed * 0.94);
        pushObstacle(z2, 0, 'low_barrier', 'main');
        pushCoinLine(z2 - 4, 4, 2.3, safeLane, 'main', 'jump', 2, true);

        const z3 = z2 + Math.max(20, localSpeed * 1.0);
        pushObstacle(z3, 0, 'high_arch', 'main');
        pushCoinLine(z3 - 4, 5, 2.3, 0, 'main', 'slide', 2, true);
        z = z3 + reactionSpacing + 6;
      }
    } else if (roll === 4) {
      // SKILL 5: Timing / Dynamic Hazard OR Narrow Bridge Traversal
      const kind = pickFromPool(
        level.obstaclePool,
        ['moving_block', 'swinging_blade', 'rotating_spinner', 'narrow_bridge', 'collapsing_floor'],
        rng,
      );
      if (kind === 'narrow_bridge') {
        pushObstacle(z, 0, 'narrow_bridge', 'main');
        pushCoinLine(z - 5, 5, 2.5, 0, 'main', 'flat', 1, isBonus);
        z += reactionSpacing + 8;
      } else if (kind === 'collapsing_floor') {
        const safeLane: -1 | 0 | 1 = rng() < 0.5 ? -1 : 1;
        pushObstacle(z, 0, 'collapsing_floor', 'main');
        pushCoinLine(z - 4, 4, 2.5, safeLane, 'main', 'flat', 1, isBonus);
        z += reactionSpacing + 3;
      } else {
        pushObstacle(z, 0, kind, 'main');
        const guideLane: -1 | 0 | 1 = rng() < 0.5 ? -1 : 1;
        pushCoinLine(z - 4, 4, 2.5, guideLane, 'main', 'flat', 1, isBonus);
        z += reactionSpacing + 5;
      }
    } else {
      // SKILL 6: Flowing Slalom Weave (encourages active left-right rhythm + coin sweep!)
      const startSide: -1 | 1 = rng() < 0.5 ? -1 : 1;
      const weaveKind = pickFromPool(level.obstaclePool, ['tall_pillar', 'spike_trap', 'fire_vent'], rng);
      pushObstacle(z, startSide, weaveKind, 'main');
      pushCoinLine(z - 4, 4, 2.5, -startSide as -1 | 1, 'main', 'flat', 1, isBonus);

      if (phase === 'advanced' && z + reactionSpacing * 2 < endZ - 14) {
        const z2 = z + Math.max(17, localSpeed * 0.85);
        pushObstacle(z2, -startSide as -1 | 1, weaveKind, 'main');
        pushCoinLine(z2 - 3.5, 4, 2.4, startSide, 'main', 'flat', 2, true);
        z = z2 + reactionSpacing + 4;
      } else {
        z += reactionSpacing + 3;
      }
    }
  }

  return { obstacles, coins, branches };
}

/**
 * Verifies per-route fairness across all main & branch routes:
 * 1. Never blocks all 3 lanes on the same route at the same z with impassable obstacles.
 * 2. Every consecutive obstacle band on the same route leaves >= minReactionMeters.
 * 3. Every branch curve stays clear of obstacles during divergence & merge curves so transitions are smooth.
 */
export function verifyBranchTrackFairness(
  obstacles: readonly TrackObstacle[],
  branches: readonly TrackBranch[],
  minReactionMeters = 12,
): { fair: boolean; reason?: string } {
  // Group obstacles by route so Left, Center, Right, and Main are verified independently!
  const byRoute = new Map<string, TrackObstacle[]>();
  for (const obs of obstacles) {
    const key = `${obs.route}:${obs.branchId ?? 0}`;
    const list = byRoute.get(key) ?? [];
    list.push(obs);
    byRoute.set(key, list);
  }

  for (const [routeKey, routeObs] of byRoute.entries()) {
    const sorted = [...routeObs].sort((a, b) => a.z - b.z);
    const bands: TrackObstacle[][] = [];

    for (const obs of sorted) {
      // Verify branch obstacles never spawn inside the steep divergence/merge curves
      if (obs.branchId !== undefined) {
        const b = branches.find((br) => br.id === obs.branchId);
        if (b && (obs.z < b.splitEndZ + 2 || obs.z > b.mergeStartZ - 2)) {
          return {
            fair: false,
            reason: `Branch obstacle at z=${obs.z} intrudes on curve zone of branch #${b.id}`,
          };
        }
      }

      const last = bands[bands.length - 1];
      if (last && Math.abs(obs.z - last[0].z) < 3.0) {
        last.push(obs);
      } else {
        bands.push([obs]);
      }
    }

    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      if (i > 0) {
        const prevZ = bands[i - 1][0].z;
        if (band[0].z - prevZ < minReactionMeters) {
          return {
            fair: false,
            reason: `Route ${routeKey} band at z=${band[0].z} too close to z=${prevZ}`,
          };
        }
      }
      const impassableLanes = new Set<number>();
      for (const o of band) {
        if (o.kind === 'tall_pillar' || o.kind === 'mine_cart' || o.kind === 'falling_debris') {
          impassableLanes.add(o.lane);
        }
      }
      if (impassableLanes.size >= 3) {
        return {
          fair: false,
          reason: `All 3 lanes blocked by impassable obstacles on ${routeKey} at z=${band[0].z}`,
        };
      }
    }
  }

  return { fair: true };
}
