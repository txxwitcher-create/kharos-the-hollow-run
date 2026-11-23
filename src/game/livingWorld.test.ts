import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPAIGN_LEVELS } from '../data/catalog';
import { TrackBranch } from '../types/game';
import { LivingWorldManager, inspectLivingWorldModels } from './livingWorld';
import {
  ALL_CORRUPTED_FLORA_KINDS,
  ALL_WILDLIFE_SPECIES,
  BRANCH_LATERAL_PUSH,
  ROAD_SAFE_HALF_WIDTH,
  canTriggerDistantCrossing,
  computeLodTier,
  computeSafeFloraPlacement,
  computeSafeWildlifePlacement,
  getBiomeLivingProfile,
  selectWeightedNonRepeating,
} from './livingWorldRules';
import {
  ENDLESS_BIOME_SEGMENT_METERS,
  computeProgressiveSpeed,
  findApproachingBranch,
  generateSkillTrackSlice,
  getEndlessBiomeLevelId,
  sampleRoutePose,
  verifyBranchTrackFairness,
} from './track';

test('all 20 campaign levels map to valid living world profiles covering all 8 wildlife species & 4 corrupted flora types', () => {
  const seenSpecies = new Set<string>();
  const seenFlora = new Set<string>();

  for (const level of CAMPAIGN_LEVELS) {
    const profile = getBiomeLivingProfile(level.architecture);
    assert.ok(profile.wildlifeCount >= 6, `Level ${level.id} (${level.name}) has wildlifeCount >= 6`);
    assert.ok(profile.floraCount >= 8, `Level ${level.id} (${level.name}) has floraCount >= 8`);
    for (const [sp, w] of Object.entries(profile.wildlifeWeights)) {
      if ((w ?? 0) > 0) seenSpecies.add(sp);
    }
    for (const [fk, w] of Object.entries(profile.floraWeights)) {
      if ((w ?? 0) > 0) seenFlora.add(fk);
    }
  }

  for (const sp of ALL_WILDLIFE_SPECIES) {
    assert.ok(seenSpecies.has(sp), `Species "${sp}" must appear in campaign biomes`);
  }
  for (const fk of ALL_CORRUPTED_FLORA_KINDS) {
    assert.ok(seenFlora.has(fk), `Corrupted flora "${fk}" must appear in campaign biomes`);
  }

  // Forgotten Jungle (Level 1) specifically features all 8 wildlife species & all 4 corrupted plants
  const jungle = getBiomeLivingProfile(CAMPAIGN_LEVELS[0].architecture);
  for (const sp of ALL_WILDLIFE_SPECIES) {
    assert.ok((jungle.wildlifeWeights[sp] ?? 0) > 0, `Forgotten Jungle must include ${sp}`);
  }
  for (const fk of ALL_CORRUPTED_FLORA_KINDS) {
    assert.ok((jungle.floraWeights[fk] ?? 0) > 0, `Forgotten Jungle must include ${fk}`);
  }
});

test('wildlife and corrupted flora placements stay strictly clear of playable lanes and active branch corridors', () => {
  const sampleBranch: TrackBranch = {
    id: 1,
    startZ: 120,
    splitEndZ: 144,
    mergeStartZ: 186,
    endZ: 210,
    hasCenter: true,
    routes: [
      { id: 'left', style: 'relic_vault', label: 'RELIC VAULT', lateralOffset: -11.4, elevationPeak: -0.3, coinMultiplier: 2, riskTier: 'high_reward' },
      { id: 'center', style: 'main_causeway', label: 'TEMPLE CAUSEWAY', lateralOffset: 0, elevationPeak: 0, coinMultiplier: 1, riskTier: 'balanced' },
      { id: 'right', style: 'sky_bridge', label: 'CANOPY BRIDGE', lateralOffset: 11.4, elevationPeak: 1.5, coinMultiplier: 2, riskTier: 'scenic' },
    ],
    chosenRoute: null,
    resolved: false,
    merged: false,
  };

  for (let i = 0; i < 80; i++) {
    const sp = ALL_WILDLIFE_SPECIES[i % ALL_WILDLIFE_SPECIES.length];
    const straight = computeSafeWildlifePlacement(sp, 35 + i * 0.5, i * 17 + 3, [sampleBranch]);
    assert.ok(
      Math.abs(straight.x) >= ROAD_SAFE_HALF_WIDTH,
      `Straight placement for ${sp} must stay outside road (|x|=${Math.abs(straight.x).toFixed(2)})`,
    );

    const branched = computeSafeWildlifePlacement(sp, 160, i * 19 + 5, [sampleBranch]);
    assert.equal(branched.inBranchMargin, true);
    assert.ok(
      Math.abs(branched.x) >= ROAD_SAFE_HALF_WIDTH + BRANCH_LATERAL_PUSH,
      `Branch placement for ${sp} must clear branch decks (|x|=${Math.abs(branched.x).toFixed(2)})`,
    );

    const fk = ALL_CORRUPTED_FLORA_KINDS[i % ALL_CORRUPTED_FLORA_KINDS.length];
    const fStraight = computeSafeFloraPlacement(fk, 40 + i * 0.5, i * 23 + 7, [sampleBranch]);
    assert.ok(Math.abs(fStraight.x) >= ROAD_SAFE_HALF_WIDTH, `Flora ${fk} stays outside main road`);

    const fBranch = computeSafeFloraPlacement(fk, 165, i * 29 + 11, [sampleBranch]);
    assert.ok(Math.abs(fBranch.x) >= ROAD_SAFE_HALF_WIDTH + BRANCH_LATERAL_PUSH, `Flora ${fk} clears branch decks`);
  }
});

test('distant road-crossing rule enforces generous sightline, cooldown, and safe non-blocking species', () => {
  assert.equal(
    canTriggerDistantCrossing({
      species: 'deer',
      distAhead: 52,
      runnerSpeed: 24,
      introActive: false,
      inBranchZone: false,
      allowsCrossing: true,
      timeSinceLastCrossing: 18,
    }),
    true,
  );
  // Never during opening Hollow chase, branch zones, too close, or for tigers
  assert.equal(
    canTriggerDistantCrossing({
      species: 'tiger',
      distAhead: 52,
      runnerSpeed: 24,
      introActive: false,
      inBranchZone: false,
      allowsCrossing: true,
      timeSinceLastCrossing: 25,
    }),
    false,
  );
  assert.equal(
    canTriggerDistantCrossing({
      species: 'deer',
      distAhead: 24,
      runnerSpeed: 24,
      introActive: false,
      inBranchZone: false,
      allowsCrossing: true,
      timeSinceLastCrossing: 25,
    }),
    false,
  );
  assert.equal(
    canTriggerDistantCrossing({
      species: 'deer',
      distAhead: 52,
      runnerSpeed: 24,
      introActive: true,
      inBranchZone: false,
      allowsCrossing: true,
      timeSinceLastCrossing: 25,
    }),
    false,
  );
});

test('distance LOD tiers and non-repeating weighted selection behave deterministically', () => {
  assert.equal(computeLodTier(-22), 'culled');
  assert.equal(computeLodTier(18), 'near');
  assert.equal(computeLodTier(62), 'mid');
  assert.equal(computeLodTier(104), 'far');
  assert.equal(computeLodTier(135), 'culled');

  const profile = getBiomeLivingProfile('jungle_temple');
  const recent: string[] = [];
  let repeats = 0;
  for (let i = 0; i < 40; i++) {
    const pick = selectWeightedNonRepeating(profile.wildlifeWeights, 100 + i * 7, recent as never);
    if (recent.length > 0 && recent[recent.length - 1] === pick) repeats++;
    recent.push(pick);
    if (recent.length > 3) recent.shift();
  }
  assert.ok(repeats <= 4, `Non-repeating selector keeps back-to-back repeats low (${repeats}/40)`);
});

test('all 8 wildlife models and 4 corrupted flora models are composite multi-part 3D assemblies', () => {
  const { wildlifeParts, floraParts } = inspectLivingWorldModels();
  for (const sp of ALL_WILDLIFE_SPECIES) {
    assert.ok(wildlifeParts[sp] >= 6, `Wildlife ${sp} must be composite multi-part (>= 6 meshes, got ${wildlifeParts[sp]})`);
  }
  for (const fk of ALL_CORRUPTED_FLORA_KINDS) {
    assert.ok(floraParts[fk] >= 5, `Corrupted flora ${fk} must be composite multi-part (>= 5 meshes, got ${floraParts[fk]})`);
  }
});

test('LivingWorldManager recycles wildlife & flora across a 220m run and triggers spore bursts cleanly', () => {
  let bursts = 0;
  const mgr = new LivingWorldManager(null, () => {
    bursts++;
  });
  mgr.applyBiome(CAMPAIGN_LEVELS[0], []);

  const dt = 1 / 30;
  for (let step = 0; step < 300; step++) {
    const t = step * dt;
    const z = step * 0.75; // 0m .. 225m
    mgr.update({
      dt,
      timeSec: t,
      playerTrackZ: z,
      runnerSpeed: 22.5,
      isPlaying: true,
      introActive: z < 35,
      branches: [],
    });
  }

  const diag = mgr.getDiagnostics();
  assert.ok(diag.wildlifeCount >= 12, `Expected rich active wildlife pool (got ${diag.wildlifeCount})`);
  assert.ok(diag.floraCount >= 10, `Expected rich active corrupted flora pool (got ${diag.floraCount})`);
  assert.ok(bursts >= 1, `Expected reactive carnivorous/spore flora bursts during 225m run (got ${bursts})`);
  mgr.dispose();
});

test('Endless Mode generates continuous fair multi-kilometer tracks with evolving biomes and diverse branches', () => {
  const idCounter = { obstacle: 1, coin: 1, turn: 1 };
  const allObstacles = [];
  const allBranches: TrackBranch[] = [];
  let chunk = 0;
  for (let z = 0; z < 2400; z += 160) {
    const biomeId = getEndlessBiomeLevelId(z, 1);
    const level = CAMPAIGN_LEVELS[biomeId - 1];
    const slice = generateSkillTrackSlice(level, z, z + 160, chunk++, 1, idCounter, 'endless', 2.35, allBranches);
    allObstacles.push(...slice.obstacles);
    allBranches.push(...slice.branches);
  }

  assert.ok(allObstacles.length >= 60, `Expected continuous obstacles across 2.4km Endless run (got ${allObstacles.length})`);
  assert.ok(allBranches.length >= 8, `Expected continuous branches across 2.4km Endless run (got ${allBranches.length})`);
  const styles = new Set<string>();
  for (const b of allBranches) {
    for (const r of b.routes) styles.add(r.style);
  }
  assert.ok(
    styles.has('relic_vault') && styles.has('sky_bridge') && styles.has('ruin_gauntlet'),
    'Endless Mode must include relic_vault, sky_bridge, and ruin_gauntlet branch routes',
  );
  assert.equal(verifyBranchTrackFairness(allObstacles, allBranches).fair, true, 'Every Endless Mode obstacle across 2.4km must be mathematically fair');

  const biomesSeen = new Set<number>();
  for (let dist = 0; dist <= ENDLESS_BIOME_SEGMENT_METERS * 8; dist += ENDLESS_BIOME_SEGMENT_METERS) {
    biomesSeen.add(getEndlessBiomeLevelId(dist, 1));
  }
  assert.ok(biomesSeen.size >= 6, `Endless Mode must evolve through diverse biomes (seen ${biomesSeen.size})`);

  const s0 = computeProgressiveSpeed(CAMPAIGN_LEVELS[0], 0, 'endless');
  const s1000 = computeProgressiveSpeed(CAMPAIGN_LEVELS[0], 1000, 'endless');
  const s2400 = computeProgressiveSpeed(CAMPAIGN_LEVELS[0], 2400, 'endless');
  assert.ok(s1000 > s0 && s2400 >= s1000 && s2400 <= 45, 'Endless speed scaling must rise smoothly and stay playable');
});

test('scenic S-curves and sweeping canyon bends are C1-continuous and auto-follow without fork prompts', () => {
  const sCurveBranch: TrackBranch = {
    id: 6,
    startZ: 200,
    splitEndZ: 218,
    mergeStartZ: 270,
    endZ: 288,
    hasCenter: true,
    curveShape: 's_curve',
    routes: [
      {
        id: 'center',
        style: 'sky_bridge',
        label: 'SERPENTINE BEND',
        lateralOffset: 8.2,
        elevationPeak: 1.15,
        coinMultiplier: 1,
        riskTier: 'scenic',
      },
    ],
    chosenRoute: null,
    resolved: false,
    merged: false,
  };

  // Single-route scenic curves must NOT show fork UI prompts
  assert.equal(findApproachingBranch([sCurveBranch], 190, 26), null);

  // Check exact C1 boundary continuity at entry (z=200) and exit (z=288)
  const entry = sampleRoutePose([sCurveBranch], 200, 'center');
  const exit = sampleRoutePose([sCurveBranch], 288, 'center');
  assert.ok(Math.abs(entry.centerX) < 1e-6 && Math.abs(entry.slopeX) < 1e-6, 'S-curve entry must be C1-smooth');
  assert.ok(Math.abs(exit.centerX) < 1e-6 && Math.abs(exit.slopeX) < 1e-6, 'S-curve exit must be C1-smooth');

  // Verify S-curve actually sweeps both positive and negative X with bounded step-to-step heading change
  let minX = Infinity;
  let maxX = -Infinity;
  let prevYaw = 0;
  for (let z = 200; z <= 288; z += 1) {
    const p = sampleRoutePose([sCurveBranch], z, 'center');
    minX = Math.min(minX, p.centerX);
    maxX = Math.max(maxX, p.centerX);
    assert.ok(Math.abs(p.headingYaw - prevYaw) < 0.08, `Heading yaw must vary smoothly at z=${z}`);
    prevYaw = p.headingYaw;
  }
  assert.ok(minX < -3.0 && maxX > 3.0, `S-curve must sweep meaningfully both left and right (minX=${minX.toFixed(2)}, maxX=${maxX.toFixed(2)})`);
});
