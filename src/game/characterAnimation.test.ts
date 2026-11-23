import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CAMPAIGN_LEVELS } from '../data/catalog';
import {
  CharacterAnimState,
  CharacterAnimator,
  CharacterMotionInput,
  computeStridePhaseDelta,
} from './characterAnimation';
import { BONE_NAMES, inspectCharacterGeometries } from './characterModel';
import { createInitialPlayerSim, generateFairTrackSlice } from './rules';

function assertPoseFiniteAndAnatomical(anim: CharacterAnimator, label: string): void {
  const { hipPos, rot } = anim.currentPose;
  assert.ok(Number.isFinite(hipPos.x) && Number.isFinite(hipPos.y) && Number.isFinite(hipPos.z), `${label}: hipPos finite`);
  assert.ok(hipPos.y >= 0.16 && hipPos.y <= 1.2, `${label}: hipPos.y (${hipPos.y}) stays grounded above floor`);

  for (const b of BONE_NAMES) {
    const r = rot[b];
    assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z), `${label}: ${b} finite`);
  }
  // Knees bend backward (negative X), elbows bend forward (positive X)
  assert.ok(rot.leftLeg.x <= 0.05, `${label}: left knee must not hyperextend forward (${rot.leftLeg.x})`);
  assert.ok(rot.rightLeg.x <= 0.05, `${label}: right knee must not hyperextend forward (${rot.rightLeg.x})`);
  assert.ok(rot.leftForeArm.x >= -0.05, `${label}: left elbow must bend forward (${rot.leftForeArm.x})`);
  assert.ok(rot.rightForeArm.x >= -0.05, `${label}: right elbow must bend forward (${rot.rightForeArm.x})`);
}

function baseInput(overrides: Partial<CharacterMotionInput> = {}): CharacterMotionInput {
  return {
    mode: 'playing',
    speed: 18,
    dz: 18 * (1 / 60),
    lateralVel: 0,
    vy: 0,
    y: 0,
    grounded: true,
    sliding: false,
    stumbleTimer: 0,
    abilityActive: false,
    strideFrequency: 1.0,
    leanStyle: 1.0,
    ...overrides,
  };
}

test('computeStridePhaseDelta lengthens stride and caps cadence at human sprint limit', () => {
  const dt = 1 / 60;
  const jogDelta = computeStridePhaseDelta(14 * dt, 14, 1.0);
  const sprintDelta = computeStridePhaseDelta(32 * dt, 32, 1.0);
  const extremeDelta = computeStridePhaseDelta(60 * dt, 60, 1.0);

  assert.ok(jogDelta > 0 && sprintDelta > jogDelta, 'sprint cadence exceeds jog cadence');
  // Max angular speed <= 3.35 full cycles/sec
  const maxCyclesPerSec = extremeDelta / dt / (Math.PI * 2);
  assert.ok(maxCyclesPerSec <= 3.36, `cadence capped at human sprint limit, got ${maxCyclesPerSec.toFixed(2)} Hz`);
});

test('all 20 character animation states activate cleanly with finite anatomical transforms', () => {
  const anim = new CharacterAnimator();
  const seen = new Set<CharacterAnimState>();
  const dt = 1 / 60;

  const step = (inp: CharacterMotionInput, frames = 2) => {
    for (let i = 0; i < frames; i++) {
      anim.update(dt, inp);
      seen.add(anim.state);
      assertPoseFiniteAndAnatomical(anim, anim.state);
    }
  };

  // 1. idle
  anim.reset('idle');
  step(baseInput({ mode: 'idle', speed: 0, dz: 0 }), 8);

  // 2. run & 3. sprint
  step(baseInput({ speed: 17, dz: 17 * dt }), 12);
  step(baseInput({ speed: 30, dz: 30 * dt }), 12);

  // 4. lane_left & 5. lane_right
  anim.triggerLaneChange(-1);
  step(baseInput({ lateralVel: -8 }), 4);
  anim.triggerLaneChange(1);
  step(baseInput({ lateralVel: 8 }), 4);

  // 6. turn_left & 7. turn_right
  anim.triggerTurn(-1);
  step(baseInput({ lateralVel: -6 }), 4);
  anim.triggerTurn(1);
  step(baseInput({ lateralVel: 6 }), 4);

  // 8. ability & 9. near_miss
  anim.reset('playing');
  anim.triggerAbility();
  step(baseInput({ abilityActive: true }), 4);
  anim.reset('playing');
  anim.triggerNearMiss(1);
  step(baseInput(), 4);

  // 10. jump_anticipation -> 11. jump_takeoff -> 12. midair -> 13. landing -> 14. hard_landing
  anim.triggerJump(false);
  step(baseInput({ grounded: false, vy: 14, y: 0.2 }), 2); // jump_anticipation
  step(baseInput({ grounded: false, vy: 11, y: 0.8 }), 6); // jump_takeoff
  step(baseInput({ grounded: false, vy: -4, y: 1.5 }), 16); // midair
  anim.triggerLanding(false);
  step(baseInput({ grounded: true, vy: 0, y: 0 }), 4); // landing
  anim.triggerLanding(true);
  step(baseInput({ grounded: true, vy: 0, y: 0 }), 4); // hard_landing

  // 15. slide -> 16. slide_recovery
  anim.triggerSlide();
  step(baseInput({ sliding: true }), 10);
  step(baseInput({ sliding: false }), 6);

  // 17. collision -> 18. stumble -> 19. recovery
  anim.triggerCollision(true);
  step(baseInput({ stumbleTimer: 0.9 }), 4); // collision
  step(baseInput({ stumbleTimer: 0.7 }), 18); // stumble
  step(baseInput({ stumbleTimer: 0 }), 8); // recovery

  // 20. death
  anim.triggerDeath();
  step(baseInput({ mode: 'dead', speed: 0, dz: 0 }), 20);

  const expected: CharacterAnimState[] = [
    'idle',
    'run',
    'sprint',
    'lane_left',
    'lane_right',
    'jump_anticipation',
    'jump_takeoff',
    'midair',
    'landing',
    'hard_landing',
    'slide',
    'slide_recovery',
    'turn_left',
    'turn_right',
    'near_miss',
    'collision',
    'stumble',
    'recovery',
    'ability',
    'death',
  ];
  for (const st of expected) {
    assert.ok(seen.has(st), `Expected state "${st}" to be exercised`);
  }
});

test('pose blending prevents discontinuous snaps across run -> jump -> slide transitions and alternates footsteps', () => {
  const anim = new CharacterAnimator();
  anim.reset('playing');
  const dt = 1 / 60;
  let leftSteps = 0;
  let rightSteps = 0;
  let gearRustles = 0;

  let prevHipY = anim.currentPose.hipPos.y;
  for (let i = 0; i < 90; i++) {
    if (i === 35) anim.triggerSlide();
    const ev = anim.update(dt, baseInput({ sliding: i >= 35 && i < 55 }));
    if (ev.footstep === 'left') leftSteps++;
    if (ev.footstep === 'right') rightSteps++;
    if (ev.gearRustle) gearRustles++;

    const deltaHipY = Math.abs(anim.currentPose.hipPos.y - prevHipY);
    assert.ok(deltaHipY < 0.25, `Smooth hip transition (step ${i}, delta=${deltaHipY.toFixed(3)})`);
    prevHipY = anim.currentPose.hipPos.y;
  }

  assert.ok(leftSteps >= 1 && rightSteps >= 1, `Footsteps alternate cleanly (L=${leftSteps}, R=${rightSteps})`);
  assert.ok(gearRustles >= 1, 'Parkour slide trigger emits gearRustle audio cue');
});

test('skinned human character geometry has valid normalized weights and outward-facing normals on head, BOTH arms, and BOTH hands', () => {
  const geos = inspectCharacterGeometries();
  const namedGeos: Array<[string, THREE.BufferGeometry]> = [
    ['skin', geos.skin],
    ['eyes', geos.eyes],
    ['eyebrows', geos.eyebrows],
    ['shirt', geos.shirt],
    ['vest', geos.vest],
    ['trousers', geos.trousers],
    ['leather', geos.leather],
    ['outsoles', geos.outsoles],
    ['metal', geos.metal],
    ['scarfCape', geos.scarfCape],
    ['hair.kael', geos.hair.kael],
    ['hair.lyra', geos.hair.lyra],
    ['hair.elena', geos.hair.elena],
    ['hair.darius', geos.hair.darius],
  ];

  for (const [label, geo] of namedGeos) {
    const pos = geo.getAttribute('position');
    const norm = geo.getAttribute('normal');
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    assert.ok(pos && pos.count > 12, `${label} must have vertices`);
    assert.ok(norm && norm.count === pos.count, `${label} must have normals`);
    assert.ok(si && sw && si.count === pos.count, `${label} must have skinning attributes`);

    for (let i = 0; i < pos.count; i++) {
      assert.ok(
        Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)),
        `${label} vertex ${i} finite`,
      );
      const wSum = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
      assert.ok(Math.abs(wSum - 1) < 0.02, `${label} vertex ${i} skin weight sum=${wSum.toFixed(3)}`);
      for (const comp of [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)]) {
        assert.ok(comp >= 0 && comp < BONE_NAMES.length, `${label} skinIndex ${comp} in bone range`);
      }
    }
  }

  // Verify outward-facing normals on head (y >= 1.56) and BOTH left/right forearms (y in 0.89..1.18) + sculpted hand counts (y < 0.89)
  const skinPos = geos.skin.getAttribute('position');
  const skinNorm = geos.skin.getAttribute('normal');
  let headOut = 0;
  let headTotal = 0;
  let leftForearmOut = 0;
  let leftForearmTotal = 0;
  let rightForearmOut = 0;
  let rightForearmTotal = 0;
  let leftHandVerts = 0;
  let rightHandVerts = 0;

  for (let i = 0; i < skinPos.count; i++) {
    const x = skinPos.getX(i);
    const y = skinPos.getY(i);
    const z = skinPos.getZ(i);
    const nx = skinNorm.getX(i);
    const ny = skinNorm.getY(i);
    const nz = skinNorm.getZ(i);

    if (y >= 1.56) {
      const dx = x;
      const dy = y - 1.66;
      const dz = z + 0.01;
      const dot = dx * nx + dy * ny + dz * nz;
      if (dot > 0) headOut++;
      headTotal++;
    } else if (y >= 0.89 && y <= 1.18 && Math.abs(x) >= 0.135) {
      const cx = Math.sign(x) * 0.19;
      const dx = x - cx;
      const dz = z;
      const radialDot = dx * nx + dz * nz;
      if (x < 0) {
        if (radialDot > 0) leftForearmOut++;
        leftForearmTotal++;
      } else {
        if (radialDot > 0) rightForearmOut++;
        rightForearmTotal++;
      }
    } else if (y >= 0.72 && y < 0.89 && Math.abs(x) >= 0.13) {
      if (x < 0) leftHandVerts++;
      else rightHandVerts++;
    }
  }

  assert.ok(headTotal > 200 && headOut / headTotal > 0.8, `Head outward normals (${headOut}/${headTotal})`);
  assert.ok(leftForearmTotal >= 60 && leftForearmOut / leftForearmTotal > 0.9, `Left forearm outward normals (${leftForearmOut}/${leftForearmTotal})`);
  assert.ok(rightForearmTotal >= 60 && rightForearmOut / rightForearmTotal > 0.9, `Right forearm outward normals (${rightForearmOut}/${rightForearmTotal})`);
  assert.ok(leftHandVerts >= 400 && rightHandVerts >= 400, `Both sculpted 5-fingered hands present (L=${leftHandVerts}, R=${rightHandVerts})`);
});

test('Opening Hollow Chase lasts 2-4s and all 20 campaign levels keep opening runway clear', () => {
  const sim = createInitialPlayerSim(20);
  assert.ok(sim.introChaseTimer >= 2.0 && sim.introChaseTimer <= 4.0, `introChaseTimer=${sim.introChaseTimer}`);
  assert.ok(sim.hollowDistance > 2.5 && sim.hollowDistance < 6.0, `hollowDistance=${sim.hollowDistance}`);

  for (const level of CAMPAIGN_LEVELS) {
    const chunk = generateFairTrackSlice(level, 0, level.targetDistance, 1, 0, { obstacle: 1, coin: 1, turn: 1 }, 'campaign');
    const tooEarly = chunk.obstacles.find((o) => o.z < 74);
    assert.equal(tooEarly, undefined, `Level ${level.id} must keep first 74m clear for 2.85s Hollow chase`);
  }
});

