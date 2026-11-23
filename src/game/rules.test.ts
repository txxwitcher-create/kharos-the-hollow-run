import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_LEVELS, DAILY_MISSIONS, ACHIEVEMENTS } from '../data/catalog';
import {
  BRANCH_LATERAL_OFFSET,
  activateCharacterAbility,
  calculateLevelReward,
  claimAchievementReward,
  claimMissionReward,
  computeCameraClearanceOffset,
  computeDesiredChaseCamera,
  computeProgressiveSpeed,
  createInitialPlayerSim,
  createInitialSaveData,
  generateFairTrackSlice,
  purchaseOutfit,
  purchaseTheme,
  recordRunResult,
  resolveObstacleImpact,
  sampleRoutePose,
  selectBranchRoute,
  triggerPlayerJump,
  unlockCharacter,
  validateAndRecoverSave,
  verifyTrackFairness,
} from './rules';

test('all 20 campaign levels generate fair, survivable obstacle patterns with clear Opening Chase runway', () => {
  assert.equal(CAMPAIGN_LEVELS.length, 20);
  for (const level of CAMPAIGN_LEVELS) {
    const idStart = { obstacle: 1, coin: 1, turn: 1 };
    const chunk = generateFairTrackSlice(level, 0, level.targetDistance, 1, 0, idStart, 'campaign');
    assert.ok(chunk.obstacles.length > 10, `Level ${level.id} should generate meaningful obstacles`);
    assert.ok(chunk.coins.length > 30, `Level ${level.id} should generate coin trails`);
    // Opening 65m must be hazard-free so Opening Hollow Chase frames cleanly & player survives start without input
    const earlyHazard = chunk.obstacles.find((o) => o.z < 65);
    assert.equal(earlyHazard, undefined, `Level ${level.id} has obstacle too early at z=${earlyHazard?.z}`);
    const verdict = verifyTrackFairness(chunk.obstacles, 12, chunk.branches);
    assert.equal(verdict.fair, true, `Level ${level.id} fairness failed: ${verdict.reason}`);
    assert.ok(chunk.branches.length >= 1, `Level ${level.id} should contain real playable branching routes`);
  }
});

test('level completion bonuses match spec and prevent duplicate first-time rewards', () => {
  assert.equal(CAMPAIGN_LEVELS[0].completionBonus, 500);
  assert.equal(CAMPAIGN_LEVELS[3].completionBonus, 1000);
  assert.equal(CAMPAIGN_LEVELS[6].completionBonus, 1500);
  assert.equal(CAMPAIGN_LEVELS[10].completionBonus, 2500);
  assert.equal(CAMPAIGN_LEVELS[14].completionBonus, 4000);
  assert.equal(CAMPAIGN_LEVELS[17].completionBonus, 6000);
  assert.equal(CAMPAIGN_LEVELS[19].completionBonus, 15000);

  const lvl1 = CAMPAIGN_LEVELS[0];
  const run = {
    mode: 'campaign' as const,
    levelId: 1,
    distance: 650,
    targetDistance: 650,
    coinsCollected: 60,
    obstaclesAvoided: 20,
    nearMisses: 3,
    jumps: 8,
    slides: 5,
    abilitiesUsed: 1,
    secretPathsFound: 1,
    stumbles: 0,
    durationSec: 32,
    isNewRecord: true,
    bestDistance: 650,
  };

  const first = calculateLevelReward(lvl1, run, undefined);
  assert.equal(first.isFirstTime, true);
  assert.equal(first.isPerfectRun, true);
  assert.equal(first.challengeCompleted, true);
  assert.equal(
    first.totalEarned,
    60 + lvl1.completionBonus + lvl1.firstTimeBonus + lvl1.perfectRunBonus + lvl1.challengeBonus,
  );

  const save0 = createInitialSaveData('2026-11-21');
  const { nextSave } = recordRunResult(save0, run, true);
  assert.equal(nextSave.highestUnlockedLevel, 2);
  assert.equal(nextSave.levelRecords[1].completed, true);
  assert.equal(nextSave.levelRecords[1].firstRewardClaimed, true);

  // Replay must NOT pay first-time bonus again
  const replay = calculateLevelReward(lvl1, run, nextSave.levelRecords[1]);
  assert.equal(replay.isFirstTime, false);
  assert.equal(replay.firstTimeBonus, 0);
});

test('economy purchases, unlocks, and anti-duplicate mission/achievement claims', () => {
  let save = createInitialSaveData('2026-11-21');
  save = { ...save, coins: 100000, highestUnlockedLevel: 10 };

  const afterChar = unlockCharacter(save, 'lyra');
  assert.ok(afterChar);
  assert.ok(afterChar.unlockedCharacters.includes('lyra'));
  assert.equal(afterChar.coins, 100000 - 12000);

  const afterOutfit = purchaseOutfit(afterChar, 'kael_basic');
  assert.ok(afterOutfit);
  assert.ok(afterOutfit.unlockedOutfits.includes('kael_basic'));

  const afterTheme = purchaseTheme(afterOutfit, 'sovereign_gold');
  assert.ok(afterTheme);
  assert.equal(afterTheme.selectedTheme, 'sovereign_gold');

  // Mission claiming prevents duplicates
  const m = DAILY_MISSIONS[0];
  const readyForMission = {
    ...afterTheme,
    missionProgress: { [m.id]: m.target },
  };
  const claimed1 = claimMissionReward(readyForMission, m.id);
  assert.ok(claimed1);
  assert.equal(claimed1.coins, readyForMission.coins + m.reward);
  const claimed2 = claimMissionReward(claimed1, m.id);
  assert.equal(claimed2, null);

  // Achievement claiming prevents duplicates
  const ach = ACHIEVEMENTS[0];
  const readyForAch = {
    ...claimed1,
    stats: { ...claimed1.stats, totalDistance: ach.target },
  };
  const achClaim1 = claimAchievementReward(readyForAch, ach.id);
  assert.ok(achClaim1);
  assert.equal(achClaim1.coins, readyForAch.coins + ach.reward);
  assert.equal(claimAchievementReward(achClaim1, ach.id), null);
});

test('player physics: mandatory Opening Hollow Chase, jump, double jump, shield absorb, and lethal collision', () => {
  const sim = createInitialPlayerSim(20);
  // Every level/run launches with the Opening Hollow Chase active and Hollow visibly close behind
  assert.ok(sim.introChaseTimer > 1.8, 'Opening Hollow Chase timer must start active on every run');
  assert.ok(sim.hollowDistance < 6.0, 'The Hollow must start visibly close behind during Opening Chase');
  assert.ok(sim.speed < 20, 'Launch speed should ease smoothly up into baseSpeed');

  assert.equal(triggerPlayerJump(sim, 'double_jump'), 'jump');
  assert.equal(sim.grounded, false);

  // Double jump requires ability active
  assert.equal(triggerPlayerJump(sim, 'double_jump'), 'buffered');
  assert.equal(activateCharacterAbility(sim, 'double_jump', 1), true);
  assert.equal(triggerPlayerJump(sim, 'double_jump'), 'double_jump');
  // Cannot triple jump
  assert.equal(triggerPlayerJump(sim, 'double_jump'), 'buffered');

  // Shield absorbs one hit
  const simShield = createInitialPlayerSim(20);
  assert.equal(activateCharacterAbility(simShield, 'shield', 1), true);
  assert.equal(resolveObstacleImpact(simShield, 'shield', true), 'shield_absorbed');
  assert.equal(simShield.alive, true);

  // Non-lethal trip stumbles and draws The Hollow near
  simShield.invulnerableTimer = 0;
  simShield.hollowDistance = 12;
  assert.equal(resolveObstacleImpact(simShield, 'shield', false), 'stumble');
  assert.equal(simShield.alive, true);
  assert.ok(simShield.hollowDistance < 4);

  // Lethal hit kills cleanly (no Eagle rescue fallback)
  simShield.invulnerableTimer = 0;
  assert.equal(resolveObstacleImpact(simShield, 'shield', true), 'death');
  assert.equal(simShield.alive, false);
});

test('save validation strips legacy Eagle fields and recovers corrupted JSON without crashing', () => {
  const recovered = validateAndRecoverSave('{corrupted_json', '2026-11-21');
  assert.equal(recovered.selectedCharacter, 'kael');
  assert.equal(recovered.highestUnlockedLevel, 1);
  assert.ok(recovered.checksum.startsWith('kh_'));

  const base = createInitialSaveData('2026-11-21');
  const legacyJson = JSON.stringify({
    ...base,
    eagleUpgrades: { emergency_rescue: 2, bonus_trails: 1 },
    settings: {
      ...base.settings,
      audio: { ...base.settings.audio, eagle: 0.7 },
    },
  });
  const migrated = validateAndRecoverSave(legacyJson, '2026-11-21');
  assert.equal('eagleUpgrades' in migrated, false);
  assert.equal('eagle' in (migrated.settings.audio as unknown as Record<string, unknown>), false);
});

test('branching path geometry is C1-smooth across 3-way fork entry, curves, parallel routes, and merge exit', () => {
  const lvl1 = CAMPAIGN_LEVELS[0];
  const chunk = generateFairTrackSlice(lvl1, 0, lvl1.targetDistance, 1, 0, { obstacle: 1, coin: 1, turn: 1 }, 'campaign');
  assert.ok(chunk.branches.length >= 2, 'Campaign level should generate multiple branches (both 3-way and 2-way)');

  // Branch #1 must be a full 3-way Left / Center / Right fork
  assert.equal(chunk.branches[0].hasCenter, true);
  assert.equal(chunk.branches[0].routes.length, 3);

  const has3Way = chunk.branches.some((b) => b.hasCenter && b.routes.length === 3);
  const has2Way = chunk.branches.some((b) => !b.hasCenter && b.routes.length === 2);
  assert.equal(has3Way, true, 'Should generate 3-way Left/Center/Right branch');
  assert.equal(has2Way, true, 'Should generate 2-way Left/Right branch');

  // Verify C1 smoothness (zero position or yaw snap) along Left, Right, and Center routes
  const branch = chunk.branches[0];
  for (const meta of branch.routes) {
    let prev = sampleRoutePose(chunk.branches, branch.startZ - 2, meta.id);
    for (let z = branch.startZ - 1.5; z <= branch.endZ + 2; z += 0.5) {
      const cur = sampleRoutePose(chunk.branches, z, meta.id);
      assert.ok(Math.abs(cur.centerX - prev.centerX) < 0.55, `X discontinuity on ${meta.id} at z=${z}`);
      assert.ok(Math.abs(cur.centerY - prev.centerY) < 0.2, `Y discontinuity on ${meta.id} at z=${z}`);
      assert.ok(Math.abs(cur.headingYaw - prev.headingYaw) < 0.08, `Yaw snap on ${meta.id} at z=${z}`);
      prev = cur;
    }

    const midPose = sampleRoutePose(chunk.branches, (branch.splitEndZ + branch.mergeStartZ) * 0.5, meta.id);
    if (meta.id === 'left') {
      assert.ok(Math.abs(midPose.centerX + BRANCH_LATERAL_OFFSET) < 0.01);
    } else if (meta.id === 'right') {
      assert.ok(Math.abs(midPose.centerX - BRANCH_LATERAL_OFFSET) < 0.01);
    } else {
      assert.equal(midPose.centerX, 0);
    }

    const endPose = sampleRoutePose(chunk.branches, branch.endZ, meta.id);
    assert.ok(Math.abs(endPose.centerX) < 0.001);
    assert.ok(Math.abs(endPose.centerY) < 0.001);
    assert.ok(Math.abs(endPose.headingYaw) < 0.001);
  }

  const fork3 = chunk.branches.find((b) => b.hasCenter)!;
  assert.equal(selectBranchRoute(fork3, -1), 'left');
  assert.equal(selectBranchRoute(fork3, 0), 'center');
  assert.equal(selectBranchRoute(fork3, 1), 'right');
  const fork2 = chunk.branches.find((b) => !b.hasCenter)!;
  assert.equal(selectBranchRoute(fork2, 0, -1), 'left');
  assert.equal(selectBranchRoute(fork2, 0, 1), 'right');
});

test('third-person chase camera follows Left/Right branch curves and dips beneath overhead high_arch lintels', () => {
  const lvl1 = CAMPAIGN_LEVELS[0];
  const chunk = generateFairTrackSlice(lvl1, 0, lvl1.targetDistance, 1, 0, { obstacle: 1, coin: 1, turn: 1 }, 'campaign');
  const branch = chunk.branches[0];
  const midCurveZ = branch.startZ + (branch.splitEndZ - branch.startZ) * 0.5;
  const parallelZ = (branch.splitEndZ + branch.mergeStartZ) * 0.5;

  const leftCurveCam = computeDesiredChaseCamera({
    branches: chunk.branches,
    simZ: midCurveZ,
    laneX: 0,
    playerY: 0,
    slideActive: false,
    activeRoute: 'left',
    speed: 22,
    hollowDistance: 14,
    cameraSensitivity: 1,
    motionMultiplier: 1,
  });
  assert.ok(leftCurveCam.lookX < leftCurveCam.posX - 3, 'Camera must look ahead into the Left curve');

  const rightParallelCam = computeDesiredChaseCamera({
    branches: chunk.branches,
    simZ: parallelZ,
    laneX: 0,
    playerY: 0,
    slideActive: false,
    activeRoute: 'right',
    speed: 24,
    hollowDistance: 14,
    cameraSensitivity: 1,
    motionMultiplier: 1,
  });
  assert.ok(Math.abs(rightParallelCam.posX - BRANCH_LATERAL_OFFSET) < 0.05);
  assert.ok(Math.abs(rightParallelCam.lookX - BRANCH_LATERAL_OFFSET) < 0.05);

  const jumpCam = computeDesiredChaseCamera({
    branches: chunk.branches,
    simZ: 20,
    laneX: 0,
    playerY: 2.2,
    slideActive: false,
    activeRoute: 'main',
    speed: 22,
    hollowDistance: 14,
    cameraSensitivity: 1,
    motionMultiplier: 1,
  });
  const slideCam = computeDesiredChaseCamera({
    branches: chunk.branches,
    simZ: 20,
    laneX: 0,
    playerY: 0,
    slideActive: true,
    activeRoute: 'main',
    speed: 22,
    hollowDistance: 14,
    cameraSensitivity: 1,
    motionMultiplier: 1,
  });
  assert.ok(jumpCam.posY > slideCam.posY + 0.6, 'Camera should adapt cleanly to jumps and slides');

  // Verify camera clearance drops below high_arch beam soffit when camera eye passes beneath it
  const archClearance = computeCameraClearanceOffset(
    100,
    'main',
    [
      {
        id: 999,
        z: 100,
        lane: 0,
        route: 'main',
        kind: 'high_arch',
        width: 7,
        height: 1.55,
        phase: 0,
        passed: false,
        hit: false,
        nearMissed: false,
      },
    ],
    3.9,
  );
  assert.ok(archClearance.posYDrop > 1.5, 'Camera should drop cleanly beneath overhead high_arch beam');
  assert.ok(archClearance.forwardPull > 0.5);
});

test('gradual speed progression ramps smoothly and monotonically with zero sudden spikes', () => {
  const lvl1 = CAMPAIGN_LEVELS[0];
  let prev = computeProgressiveSpeed(lvl1, 0, 'campaign');
  assert.ok(Math.abs(prev - lvl1.baseSpeed) < 0.01);

  for (let z = 10; z <= lvl1.targetDistance; z += 10) {
    const cur = computeProgressiveSpeed(lvl1, z, 'campaign');
    assert.ok(cur >= prev, `Campaign speed must be monotonic at z=${z}`);
    assert.ok(cur - prev < 0.35, `Campaign speed jumped abruptly at z=${z}: +${cur - prev}`);
    prev = cur;
  }
  assert.ok(Math.abs(prev - lvl1.maxSpeed) < 0.05);

  let prevEndless = computeProgressiveSpeed(lvl1, 0, 'endless');
  for (let z = 50; z <= 3000; z += 50) {
    const cur = computeProgressiveSpeed(lvl1, z, 'endless');
    assert.ok(cur >= prevEndless, `Endless speed must be monotonic at z=${z}`);
    assert.ok(cur - prevEndless < 0.85, `Endless speed spiked at z=${z}`);
    prevEndless = cur;
  }
});
