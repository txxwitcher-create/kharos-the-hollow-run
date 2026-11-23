import { BONE_NAMES, BoneName, CharacterRig } from './characterModel';

export type CharacterAnimState =
  | 'idle'
  | 'run'
  | 'sprint'
  | 'lane_left'
  | 'lane_right'
  | 'jump_anticipation'
  | 'jump_takeoff'
  | 'midair'
  | 'landing'
  | 'hard_landing'
  | 'slide'
  | 'slide_recovery'
  | 'turn_left'
  | 'turn_right'
  | 'near_miss'
  | 'collision'
  | 'stumble'
  | 'recovery'
  | 'ability'
  | 'death';

export interface Vec3Pose {
  x: number;
  y: number;
  z: number;
}

export interface SkeletonPose {
  hipPos: Vec3Pose;
  rot: Record<BoneName, Vec3Pose>;
}

export interface CharacterMotionInput {
  mode: 'idle' | 'playing' | 'dead';
  speed: number;
  dz: number;
  lateralVel: number;
  vy: number;
  y: number;
  grounded: boolean;
  sliding: boolean;
  stumbleTimer: number;
  abilityActive: boolean;
  strideFrequency: number;
  leanStyle: number;
  headingTurnRate?: number;
}

export interface CharacterAnimEvents {
  footstep: 'left' | 'right' | null;
  breath: 'normal' | 'light' | 'recovery' | null;
  gearRustle: boolean;
}

const REST_HIP_Y = 0.94;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function createZeroPose(): SkeletonPose {
  const rot = {} as Record<BoneName, Vec3Pose>;
  for (const name of BONE_NAMES) {
    rot[name] = { x: 0, y: 0, z: 0 };
  }
  return {
    hipPos: { x: 0, y: REST_HIP_Y, z: 0 },
    rot,
  };
}

function clearPose(p: SkeletonPose): void {
  p.hipPos.x = 0;
  p.hipPos.y = REST_HIP_Y;
  p.hipPos.z = 0;
  for (let i = 0; i < BONE_NAMES.length; i++) {
    const r = p.rot[BONE_NAMES[i]];
    r.x = 0;
    r.y = 0;
    r.z = 0;
  }
}

/**
 * Computes realistic speed-matched human stride frequency so feet stay planted at low speed
 * and smoothly lengthen stride at high speed instead of spinning like a cartoon windmill.
 */
export function computeStridePhaseDelta(dz: number, speed: number, strideFrequency: number): number {
  if (dz <= 0 || speed <= 0.05) return 0;
  const speedNorm = clamp((speed - 12) / 26, 0, 1);
  // World-speed calibrated stride length: ~1.95 Hz at 14 m/s jog scaling smoothly to ~3.15 Hz at 36 m/s sprint
  const strideLength = lerp(7.2, 11.4, speedNorm) / Math.max(0.75, strideFrequency);
  // Cap maximum cycle angular speed (~3.35 full cycles/sec = elite sprinter max cadence)
  const rawDelta = (dz / strideLength) * Math.PI * 2;
  const maxDelta = (dz / Math.max(speed, 1)) * (3.35 * Math.PI * 2);
  return Math.min(rawDelta, maxDelta);
}

/**
 * Pure-logic hierarchical skeletal character animator supporting all 19 states,
 * smooth exponential pose blending, layered additive reactions, and animation-synced audio events.
 */
export class CharacterAnimator {
  public state: CharacterAnimState = 'idle';
  public runPhase = 0;
  public idleTime = 0;
  public stateTime = 0;

  // Event impulse timers (smoothly decay and layer cleanly over locomotion)
  private laneTimer = 0;
  private laneDir: -1 | 1 = 1;
  private turnTimer = 0;
  private turnDir: -1 | 1 = 1;
  private jumpAnticipationTimer = 0;
  private jumpTakeoffTimer = 0;
  private doubleJumpTwist = 0;
  private landingTimer = 0;
  private hardLanding = false;
  private slideRecoveryTimer = 0;
  private nearMissTimer = 0;
  private nearMissSide: -1 | 1 = 1;
  private collisionTimer = 0;
  private recoveryTimer = 0;
  private abilityGestureTimer = 0;
  private wasSliding = false;
  private wasStumbling = false;
  private lastFootSign = 0;
  private strideCount = 0;
  private pendingGearRustle = false;

  // Secondary spring dynamics for scarf/cape and hair ponytail
  private capePitch = 0.14;
  private capeVel = 0;
  private hairPitch = 0.1;
  private hairVel = 0;

  // Pre-allocated poses (zero per-frame allocations)
  public readonly currentPose: SkeletonPose = createZeroPose();
  private readonly targetPose: SkeletonPose = createZeroPose();
  private readonly events: CharacterAnimEvents = {
    footstep: null,
    breath: null,
    gearRustle: false,
  };

  public reset(mode: 'idle' | 'playing' = 'idle'): void {
    this.state = mode === 'idle' ? 'idle' : 'run';
    this.runPhase = 0;
    this.idleTime = 0;
    this.stateTime = 0;
    this.laneTimer = 0;
    this.turnTimer = 0;
    this.jumpAnticipationTimer = 0;
    this.jumpTakeoffTimer = 0;
    this.doubleJumpTwist = 0;
    this.landingTimer = 0;
    this.hardLanding = false;
    this.slideRecoveryTimer = 0;
    this.nearMissTimer = 0;
    this.collisionTimer = 0;
    this.recoveryTimer = 0;
    this.abilityGestureTimer = 0;
    this.wasSliding = false;
    this.wasStumbling = false;
    this.lastFootSign = 0;
    this.strideCount = 0;
    this.pendingGearRustle = false;
    this.capePitch = 0.14;
    this.capeVel = 0;
    this.hairPitch = 0.1;
    this.hairVel = 0;
    this.evaluateIdlePose(this.targetPose, 0.4);
    this.copyPose(this.currentPose, this.targetPose);
  }

  public triggerLaneChange(dir: -1 | 1): void {
    this.laneDir = dir;
    this.laneTimer = 0.26;
    this.pendingGearRustle = true;
  }

  public triggerTurn(dir: -1 | 1): void {
    this.turnDir = dir;
    this.turnTimer = 0.42;
    this.pendingGearRustle = true;
  }

  public triggerJump(isDoubleJump: boolean): void {
    if (isDoubleJump) {
      this.doubleJumpTwist = Math.PI * 2;
      this.jumpTakeoffTimer = 0.22;
      this.jumpAnticipationTimer = 0;
    } else {
      this.jumpAnticipationTimer = 0.055;
      this.jumpTakeoffTimer = 0.24;
    }
    this.landingTimer = 0;
    this.slideRecoveryTimer = 0;
    this.pendingGearRustle = true;
  }

  public triggerLanding(hard: boolean): void {
    this.hardLanding = hard;
    this.landingTimer = hard ? 0.34 : 0.22;
    this.jumpTakeoffTimer = 0;
    this.jumpAnticipationTimer = 0;
    this.doubleJumpTwist = 0;
  }

  public triggerSlide(): void {
    this.slideRecoveryTimer = 0;
    this.landingTimer = 0;
    this.pendingGearRustle = true;
  }

  public triggerNearMiss(side: -1 | 1 = 1): void {
    this.nearMissSide = side;
    this.nearMissTimer = 0.34;
  }

  public triggerCollision(stumbled: boolean): void {
    this.collisionTimer = 0.24;
    if (stumbled) {
      this.recoveryTimer = 0;
    }
  }

  public triggerAbility(): void {
    this.abilityGestureTimer = 0.48;
  }

  public triggerDeath(): void {
    this.state = 'death';
    this.stateTime = 0;
    this.collisionTimer = 0.16;
  }

  public update(dt: number, input: CharacterMotionInput): CharacterAnimEvents {
    const safeDt = clamp(dt, 0.0001, 0.06);
    this.events.footstep = null;
    this.events.breath = null;
    this.events.gearRustle = this.pendingGearRustle;
    this.pendingGearRustle = false;
    this.stateTime += safeDt;

    // Tick impulse timers
    if (this.laneTimer > 0) this.laneTimer = Math.max(0, this.laneTimer - safeDt);
    if (this.turnTimer > 0) this.turnTimer = Math.max(0, this.turnTimer - safeDt);
    if (this.jumpAnticipationTimer > 0) this.jumpAnticipationTimer = Math.max(0, this.jumpAnticipationTimer - safeDt);
    if (this.jumpTakeoffTimer > 0) this.jumpTakeoffTimer = Math.max(0, this.jumpTakeoffTimer - safeDt);
    if (this.landingTimer > 0) this.landingTimer = Math.max(0, this.landingTimer - safeDt);
    if (this.slideRecoveryTimer > 0) this.slideRecoveryTimer = Math.max(0, this.slideRecoveryTimer - safeDt);
    if (this.nearMissTimer > 0) this.nearMissTimer = Math.max(0, this.nearMissTimer - safeDt);
    if (this.collisionTimer > 0) this.collisionTimer = Math.max(0, this.collisionTimer - safeDt);
    if (this.recoveryTimer > 0) this.recoveryTimer = Math.max(0, this.recoveryTimer - safeDt);
    if (this.abilityGestureTimer > 0) this.abilityGestureTimer = Math.max(0, this.abilityGestureTimer - safeDt);
    if (this.doubleJumpTwist > 0.01) {
      this.doubleJumpTwist = damp(this.doubleJumpTwist, 0, 11, safeDt);
    } else {
      this.doubleJumpTwist = 0;
    }

    // Detect transition edges for slide_recovery & stumble->recovery
    if (this.wasSliding && !input.sliding && input.grounded && input.mode === 'playing') {
      this.slideRecoveryTimer = 0.24;
    }
    this.wasSliding = input.sliding;

    const stumbling = input.stumbleTimer > 0;
    if (this.wasStumbling && !stumbling && input.mode === 'playing') {
      this.recoveryTimer = 0.72;
      this.events.breath = 'recovery';
    }
    this.wasStumbling = stumbling;

    const speedNorm = clamp((input.speed - 14) / 22, 0, 1);

    // Resolve active primary animation state (covers all 19 states cleanly)
    const prevState = this.state;
    if (input.mode === 'dead') {
      this.state = 'death';
    } else if (input.mode === 'idle') {
      this.state = 'idle';
    } else if (this.collisionTimer > 0) {
      this.state = 'collision';
    } else if (input.sliding) {
      this.state = 'slide';
    } else if (!input.grounded) {
      if (this.jumpAnticipationTimer > 0) {
        this.state = 'jump_anticipation';
      } else if (this.jumpTakeoffTimer > 0 && input.vy > 2.5) {
        this.state = 'jump_takeoff';
      } else {
        this.state = 'midair';
      }
    } else if (this.landingTimer > 0) {
      this.state = this.hardLanding ? 'hard_landing' : 'landing';
    } else if (this.slideRecoveryTimer > 0) {
      this.state = 'slide_recovery';
    } else if (stumbling) {
      this.state = 'stumble';
    } else if (this.recoveryTimer > 0) {
      this.state = 'recovery';
    } else if (this.turnTimer > 0) {
      this.state = this.turnDir < 0 ? 'turn_left' : 'turn_right';
    } else if (this.laneTimer > 0) {
      this.state = this.laneDir < 0 ? 'lane_left' : 'lane_right';
    } else if (this.abilityGestureTimer > 0) {
      this.state = 'ability';
    } else if (this.nearMissTimer > 0) {
      this.state = 'near_miss';
    } else {
      this.state = speedNorm >= 0.52 ? 'sprint' : 'run';
    }
    if (this.state !== prevState) {
      this.stateTime = 0;
    }

    // Advance stride phase & emit animation-locked footsteps and rhythmic human breathing
    if (input.mode === 'idle') {
      this.idleTime += safeDt;
    } else if (input.mode === 'playing') {
      const phaseDelta = computeStridePhaseDelta(input.dz, input.speed, input.strideFrequency);
      this.runPhase = (this.runPhase + phaseDelta) % (Math.PI * 200);

      if (input.grounded && !input.sliding && input.dz > 0.0005) {
        const s = Math.sin(this.runPhase);
        if (this.lastFootSign <= 0 && s > 0) {
          this.events.footstep = 'left';
          this.strideCount++;
        } else if (this.lastFootSign >= 0 && s < 0) {
          this.events.footstep = 'right';
          this.strideCount++;
        }
        if (this.events.footstep) {
          if (this.strideCount % 8 === 0) {
            this.events.breath = speedNorm > 0.55 ? 'normal' : 'light';
          }
        }
        this.lastFootSign = s;
      }
    }

    // Build target pose from base locomotion / state + layered additive modifiers
    clearPose(this.targetPose);

    if (input.mode === 'idle') {
      this.evaluateIdlePose(this.targetPose, this.idleTime);
    } else if (input.mode === 'dead') {
      this.evaluateDeathPose(this.targetPose, this.stateTime);
    } else if (input.sliding) {
      this.evaluateSlidePose(this.targetPose, input.lateralVel);
    } else if (!input.grounded) {
      this.evaluateAirPose(this.targetPose, input.vy, input.lateralVel, input.leanStyle);
    } else {
      // Grounded athletic run / sprint foundation (all grounded reactions blend cleanly on top!)
      this.evaluateRunPose(this.targetPose, this.runPhase, speedNorm, input.lateralVel, input.leanStyle);

      if (this.slideRecoveryTimer > 0) {
        const t = clamp(this.slideRecoveryTimer / 0.24, 0, 1);
        this.applySlideRecoveryOverlay(this.targetPose, t);
      }
      if (this.landingTimer > 0) {
        const maxT = this.hardLanding ? 0.34 : 0.22;
        const t = Math.sin(clamp(this.landingTimer / maxT, 0, 1) * Math.PI);
        this.applyLandingOverlay(this.targetPose, t, this.hardLanding);
      }
      if (stumbling) {
        this.applyStumbleOverlay(this.targetPose, this.stateTime, clamp(input.stumbleTimer, 0, 1.2));
      } else if (this.recoveryTimer > 0) {
        const t = clamp(this.recoveryTimer / 0.72, 0, 1);
        this.applyRecoveryOverlay(this.targetPose, t, this.runPhase);
      }
      if (this.turnTimer > 0) {
        const t = Math.sin(clamp(this.turnTimer / 0.42, 0, 1) * Math.PI);
        this.applyTurnOverlay(this.targetPose, this.turnDir, t);
      } else if (this.laneTimer > 0) {
        const t = Math.sin(clamp(this.laneTimer / 0.26, 0, 1) * Math.PI);
        this.applyLaneOverlay(this.targetPose, this.laneDir, t);
      }
    }

    // Layered upper-body additive reactions (never break lower-body stride!)
    if (input.mode === 'playing') {
      if (this.nearMissTimer > 0) {
        const t = Math.sin(clamp(this.nearMissTimer / 0.34, 0, 1) * Math.PI);
        this.applyNearMissAdditive(this.targetPose, this.nearMissSide, t);
      }
      if (this.collisionTimer > 0) {
        const t = clamp(this.collisionTimer / 0.24, 0, 1);
        this.applyCollisionAdditive(this.targetPose, t);
      }
      if (this.abilityGestureTimer > 0) {
        const t = Math.sin(clamp(this.abilityGestureTimer / 0.48, 0, 1) * Math.PI);
        this.applyAbilityAdditive(this.targetPose, t);
      }
    }

    // Secondary spring physics for scarf/cape and braided hair tail
    const targetCape =
      input.mode === 'idle'
        ? 0.12 + Math.sin(this.idleTime * 2.3) * 0.05
        : input.mode === 'dead'
          ? 0.05
          : 0.34 + speedNorm * 0.42 + (input.sliding ? 0.35 : 0) + Math.sin(this.runPhase * 1.1) * 0.1;
    const capeForce = (targetCape - this.capePitch) * 65 - this.capeVel * 11;
    this.capeVel += capeForce * safeDt;
    this.capePitch = clamp(this.capePitch + this.capeVel * safeDt, -0.25, 1.35);

    const targetHair =
      input.mode === 'idle'
        ? 0.08 + Math.sin(this.idleTime * 2.1 + 0.6) * 0.04
        : 0.22 + speedNorm * 0.45 + Math.sin(this.runPhase * 1.0 - 0.5) * 0.14;
    const hairForce = (targetHair - this.hairPitch) * 80 - this.hairVel * 12;
    this.hairVel += hairForce * safeDt;
    this.hairPitch = clamp(this.hairPitch + this.hairVel * safeDt, -0.2, 1.25);

    const sideWind = clamp(input.lateralVel * 0.032, -0.38, 0.38);
    this.targetPose.rot.capeUpper.x = this.capePitch;
    this.targetPose.rot.capeUpper.z = sideWind;
    this.targetPose.rot.capeLower.x = this.capePitch * 0.55 + Math.sin(this.runPhase * 1.1 - 0.85) * 0.16;
    this.targetPose.rot.capeLower.z = sideWind * 0.7;
    this.targetPose.rot.hairTailUpper.x = this.hairPitch;
    this.targetPose.rot.hairTailUpper.z = sideWind * 0.85;
    this.targetPose.rot.hairTailLower.x = this.hairPitch * 0.5 + Math.sin(this.runPhase * 1.0 - 1.1) * 0.14;

    // Smooth blend rate tuned per state (snappy on slide/jump takeoff, fluid on idle/run/recovery)
    const blendLambda =
      this.state === 'slide' || this.state === 'jump_takeoff' || this.state === 'collision'
        ? 22
        : this.state === 'death'
          ? 9
          : this.state === 'idle'
            ? 8
            : 17;

    this.blendPoseToward(this.currentPose, this.targetPose, blendLambda, safeDt);
    return this.events;
  }

  private evaluateIdlePose(p: SkeletonPose, t: number): void {
    const breath = Math.sin(t * 2.05);
    const sway = Math.sin(t * 0.78);
    const look = Math.sin(t * 0.62) * 0.11 + Math.sin(t * 0.29) * 0.05;

    // Natural contrapposto athletic readiness (hips shifted slightly right, left knee softly bent, zero stiff mannequin!)
    p.hipPos.x = 0.018 + sway * 0.011;
    p.hipPos.y = REST_HIP_Y - 0.014 + breath * 0.006;
    p.hipPos.z = 0;

    p.rot.hips.y = 0.11 + sway * 0.02;
    p.rot.hips.z = -0.035 - sway * 0.012;

    // Spine counter-balances hip tilt + rhythmic chest breathing expansion
    p.rot.spine.x = -0.02 + breath * 0.012;
    p.rot.spine.y = -0.04;
    p.rot.spine.z = 0.022 + sway * 0.008;

    p.rot.spine1.x = -0.015 + breath * 0.016;
    p.rot.spine1.y = -0.045;
    p.rot.spine1.z = 0.018;

    p.rot.chest.x = -0.01 + breath * 0.022;
    p.rot.chest.y = -0.055 + sway * 0.02;

    p.rot.neck.x = 0.02 - breath * 0.012;
    p.rot.neck.y = look * 0.45;
    p.rot.head.x = 0.015 - breath * 0.01;
    p.rot.head.y = look * 0.65 - 0.04;
    p.rot.head.z = -0.015 + Math.sin(t * 0.5) * 0.018;

    // Relaxed natural arms (subtle shoulder drop, gentle outward clearance, soft natural elbow bend)
    p.rot.leftShoulder.z = 0.03 - breath * 0.012;
    p.rot.rightShoulder.z = -0.03 + breath * 0.012;

    p.rot.leftArm.x = 0.08 + breath * 0.02;
    p.rot.leftArm.y = 0.06;
    p.rot.leftArm.z = -0.095 - breath * 0.01; // outward (-X) away from torso
    p.rot.leftForeArm.x = 0.34 + breath * 0.02; // natural forward elbow bend
    p.rot.leftHand.z = 0.06;

    p.rot.rightArm.x = -0.05 - breath * 0.018;
    p.rot.rightArm.y = -0.08;
    p.rot.rightArm.z = 0.09 + breath * 0.01; // outward (+X) away from torso
    p.rot.rightForeArm.x = 0.42 + breath * 0.018;
    p.rot.rightHand.z = -0.06;

    // Grounded contrapposto stance: left foot slightly forward & relaxed, right leg carrying primary weight
    p.rot.leftUpLeg.x = 0.14;
    p.rot.leftUpLeg.y = -0.08;
    p.rot.leftUpLeg.z = -0.045;
    p.rot.leftLeg.x = -0.22; // knee bends BACKWARD (-X)
    p.rot.leftFoot.x = 0.08; // keeps sole flat on Y=0
    p.rot.leftFoot.z = 0.04;

    p.rot.rightUpLeg.x = -0.06;
    p.rot.rightUpLeg.y = 0.12;
    p.rot.rightUpLeg.z = 0.045;
    p.rot.rightLeg.x = -0.07;
    p.rot.rightFoot.x = 0.13;
    p.rot.rightFoot.z = -0.03;
  }

  private evaluateRunPose(
    p: SkeletonPose,
    phase: number,
    speedNorm: number,
    lateralVel: number,
    leanStyle: number,
  ): void {
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const doubleWave = Math.cos(phase * 2); // peaks twice per cycle (flight phases)

    // Biomechanical athletic amplitudes scaling smoothly from brisk Run -> Sprint
    const hipSwing = lerp(0.58, 0.86, speedNorm);
    const kneeDriveMax = lerp(1.18, 1.56, speedNorm);
    const armSwing = lerp(0.68, 1.04, speedNorm);
    const forwardLean = lerp(0.16, 0.28, speedNorm);

    // Pelvis vertical flight oscillation, subtle lateral weight shift, and counter-yaw
    p.hipPos.x = -s * 0.024;
    p.hipPos.y = REST_HIP_Y - 0.045 + Math.abs(c) * lerp(0.055, 0.082, speedNorm) - speedNorm * 0.018;
    p.hipPos.z = -speedNorm * 0.025;

    const bank = clamp(-lateralVel * 0.03 * leanStyle, -0.34, 0.34);
    const yawLead = clamp(-lateralVel * 0.022, -0.25, 0.25);

    p.rot.hips.x = -forwardLean * 0.36;
    p.rot.hips.y = -s * lerp(0.11, 0.17, speedNorm) + yawLead * 0.45;
    p.rot.hips.z = bank * 0.55 + s * 0.048;

    // Thoracic spine leans into stride & counter-rotates smoothly against pelvis!
    p.rot.spine.x = -forwardLean * 0.28 + doubleWave * 0.02;
    p.rot.spine.y = s * lerp(0.08, 0.13, speedNorm);
    p.rot.spine.z = bank * 0.25 - s * 0.025;

    p.rot.spine1.x = -forwardLean * 0.24;
    p.rot.spine1.y = s * lerp(0.1, 0.15, speedNorm);
    p.rot.spine1.z = bank * 0.15 - s * 0.022;

    p.rot.chest.x = -forwardLean * 0.18;
    p.rot.chest.y = s * lerp(0.11, 0.16, speedNorm) + yawLead * 0.3;

    // Head stabilizes horizontally & leads gaze into lane changes
    p.rot.neck.x = forwardLean * 0.52;
    p.rot.neck.y = -s * 0.08 + yawLead * 0.35;
    p.rot.head.x = forwardLean * 0.42 - doubleWave * 0.015;
    p.rot.head.y = -s * 0.07 + yawLead * 0.5;
    p.rot.head.z = -bank * 0.42;

    // Left & Right Legs (exact biomechanical gait cycle: knee bends backward = negative X!)
    this.solveRunLeg(phase, hipSwing, kneeDriveMax, p.rot.leftUpLeg, p.rot.leftLeg, p.rot.leftFoot, p.rot.leftToeBase, -1);
    this.solveRunLeg(
      phase + Math.PI,
      hipSwing,
      kneeDriveMax,
      p.rot.rightUpLeg,
      p.rot.rightLeg,
      p.rot.rightFoot,
      p.rot.rightToeBase,
      1,
    );

    // Opposite-phase athletic arm drive (elbow bends forward = positive X!)
    const lArmPhase = -s; // left arm drives forward when right leg drives forward
    const rArmPhase = s;

    p.rot.leftShoulder.y = lArmPhase * 0.08;
    p.rot.rightShoulder.y = rArmPhase * 0.08;

    p.rot.leftArm.x = lArmPhase * armSwing + 0.06;
    p.rot.leftArm.y = Math.max(0, lArmPhase) * 0.18; // natural subtle inward drive on upswing
    p.rot.leftArm.z = -0.11 - speedNorm * 0.04;
    p.rot.leftForeArm.x = lerp(1.05, 1.32, speedNorm) + Math.max(0, lArmPhase) * 0.38 - Math.max(0, -lArmPhase) * 0.18;
    p.rot.leftHand.x = 0.06;

    p.rot.rightArm.x = rArmPhase * armSwing + 0.06;
    p.rot.rightArm.y = -Math.max(0, rArmPhase) * 0.18;
    p.rot.rightArm.z = 0.11 + speedNorm * 0.04;
    p.rot.rightForeArm.x = lerp(1.05, 1.32, speedNorm) + Math.max(0, rArmPhase) * 0.38 - Math.max(0, -rArmPhase) * 0.18;
    p.rot.rightHand.x = 0.06;
  }

  private solveRunLeg(
    p: number,
    hipSwing: number,
    kneeDriveMax: number,
    upLeg: Vec3Pose,
    leg: Vec3Pose,
    foot: Vec3Pose,
    toe: Vec3Pose,
    side: -1 | 1,
  ): void {
    const s = Math.sin(p);
    const c = Math.cos(p);

    // Forward swing lifts thigh high (+X), rear push extends smoothly behind (-X)
    const hipX = s > 0 ? s * hipSwing * 1.08 : s * hipSwing * 0.88;
    upLeg.x = hipX;
    upLeg.z = side * 0.025;

    // Realistic asymmetric knee flexion (negative X bends shin behind thigh):
    // - At push-off (s ~ -1): nearly extended (-0.18)
    // - During swing recovery (c > 0): high heel tuck (-kneeDriveMax)
    // - Just before foot strike (s ~ +1, c < 0): extends forward to strike (-0.28)
    const recoveryTuck = Math.max(0, c) * kneeDriveMax;
    const midStanceCushion = Math.max(0, -c) * 0.34;
    const kneeFlex = -(0.16 + recoveryTuck * 0.86 + midStanceCushion);
    leg.x = clamp(kneeFlex, -1.72, -0.14);

    // Ankle articulation: dorsiflex (+X) before strike, plantarflex (-X) at toe-off!
    const pushOff = Math.max(0, -s);
    const strikePrep = Math.max(0, s) * Math.max(0, -c);
    foot.x = clamp(-pushOff * 0.44 + strikePrep * 0.24 - hipX * 0.18, -0.52, 0.36);

    // Toe roll on push-off
    toe.x = pushOff * 0.42;
  }

  private evaluateAirPose(p: SkeletonPose, vy: number, lateralVel: number, leanStyle: number): void {
    const velNorm = clamp(vy / 15, -1, 1); // +1 rising, 0 apex, -1 falling
    const bank = clamp(-lateralVel * 0.03 * leanStyle, -0.32, 0.32);

    if (this.jumpAnticipationTimer > 0) {
      // Brief explosive spring-coil compression right on jump trigger
      p.hipPos.y = REST_HIP_Y - 0.16;
      p.rot.hips.x = -0.16;
      p.rot.spine.x = -0.18;
      p.rot.chest.x = -0.14;
      p.rot.head.x = 0.32;
      p.rot.leftUpLeg.x = 0.65;
      p.rot.leftLeg.x = -1.18;
      p.rot.leftFoot.x = 0.34;
      p.rot.rightUpLeg.x = 0.58;
      p.rot.rightLeg.x = -1.12;
      p.rot.rightFoot.x = 0.32;
      p.rot.leftArm.x = -0.68;
      p.rot.leftForeArm.x = 0.72;
      p.rot.rightArm.x = -0.62;
      p.rot.rightForeArm.x = 0.72;
      return;
    }

    const takeoffBlend = clamp(this.jumpTakeoffTimer / 0.24, 0, 1);

    // Athletic parkour hurdle jump: lead knee drives high, trail leg extends down/back on takeoff then prepares for landing
    p.hipPos.y = REST_HIP_Y - 0.02 + (1 - Math.abs(velNorm)) * 0.05;
    p.rot.hips.x = -0.16 + velNorm * 0.14 - this.doubleJumpTwist;
    p.rot.hips.z = bank * 0.7;

    p.rot.spine.x = -0.14 - velNorm * 0.06;
    p.rot.spine1.x = -0.1;
    p.rot.chest.x = -0.06;
    p.rot.chest.y = 0.16;
    p.rot.neck.x = 0.18;
    p.rot.head.x = 0.16 - velNorm * 0.08;
    p.rot.head.y = -0.1 + clamp(-lateralVel * 0.02, -0.22, 0.22);

    // Lead left leg tucked athletically -> reaches slightly forward on descent
    p.rot.leftUpLeg.x = lerp(0.56, 1.05, Math.max(0, velNorm) * 0.7 + takeoffBlend * 0.3);
    p.rot.leftLeg.x = lerp(-0.55, -1.48, Math.max(0, velNorm) * 0.6 + takeoffBlend * 0.4);
    p.rot.leftFoot.x = lerp(0.18, -0.32, takeoffBlend);

    // Trailing right leg pushes strongly off ground at takeoff -> tucks midair -> reaches down before touchdown
    p.rot.rightUpLeg.x = lerp(0.28, -0.58, takeoffBlend) + (velNorm < 0 ? -velNorm * 0.2 : 0);
    p.rot.rightLeg.x = lerp(-0.42, -0.95, Math.max(0, 1 - Math.abs(velNorm)) * 0.8) - takeoffBlend * 0.12;
    p.rot.rightFoot.x = lerp(0.12, -0.52, takeoffBlend);

    // Expressive balancing arms (drive upward on takeoff, flare outward for midair balance!)
    p.rot.leftArm.x = lerp(0.45, 1.38, Math.max(0, velNorm) * 0.65 + takeoffBlend * 0.35);
    p.rot.leftArm.z = -0.28 - (1 - Math.abs(velNorm)) * 0.18;
    p.rot.leftForeArm.x = lerp(0.85, 1.25, Math.max(0, velNorm));

    p.rot.rightArm.x = lerp(0.18, 0.85, takeoffBlend) - (velNorm < 0 ? -velNorm * 0.32 : 0);
    p.rot.rightArm.z = 0.28 + (1 - Math.abs(velNorm)) * 0.18;
    p.rot.rightForeArm.x = lerp(0.92, 1.15, Math.max(0, velNorm));
  }

  private evaluateSlidePose(p: SkeletonPose, lateralVel: number): void {
    // Realistic low baseball / parkour slide: hips drop cleanly to ground level (Y=0.25),
    // torso reclines cleanly (+X), head tilts forward (-X) keeping eyes down the trail,
    // lead leg extends straight forward, rear leg tucks underneath!
    p.hipPos.y = 0.27;
    p.hipPos.z = 0.06;

    const bank = clamp(-lateralVel * 0.025, -0.22, 0.22);
    p.rot.hips.x = 0.72; // recline backward (+X tips upper torso toward +Z)
    p.rot.hips.y = 0.34;
    p.rot.hips.z = bank * 0.4 - 0.12;

    p.rot.spine.x = 0.16;
    p.rot.spine.y = -0.14;
    p.rot.spine1.x = 0.08;
    p.rot.chest.x = -0.12;
    p.rot.chest.y = -0.22;

    // Chin tucked forward so adventurer looks straight under the obstacle!
    p.rot.neck.x = -0.34;
    p.rot.head.x = -0.38;
    p.rot.head.y = 0.18;

    // Lead left leg extended straight ahead with boot raised slightly off ground
    p.rot.leftUpLeg.x = 0.72;
    p.rot.leftUpLeg.y = -0.14;
    p.rot.leftUpLeg.z = -0.06;
    p.rot.leftLeg.x = -0.18;
    p.rot.leftFoot.x = 0.24;

    // Rear right leg tucked sharply underneath thigh
    p.rot.rightUpLeg.x = 0.28;
    p.rot.rightUpLeg.y = 0.34;
    p.rot.rightUpLeg.z = 0.22;
    p.rot.rightLeg.x = -1.78;
    p.rot.rightFoot.x = -0.32;

    // Lead arm forward-bent for balance, trailing arm angled back-down near ground
    p.rot.leftArm.x = 0.58;
    p.rot.leftArm.z = -0.36;
    p.rot.leftForeArm.x = 0.92;

    p.rot.rightArm.x = -0.82;
    p.rot.rightArm.z = 0.44;
    p.rot.rightForeArm.x = 0.42;
  }

  private evaluateDeathPose(p: SkeletonPose, t: number): void {
    const fall = clamp(t / 0.42, 0, 1);
    const ease = 1 - Math.pow(1 - fall, 3);

    // Athletic forward-sideways tumble collapse to ground (articulated joints, never a rigid board!)
    p.hipPos.y = lerp(REST_HIP_Y - 0.12, 0.22, ease);
    p.hipPos.z = lerp(0, 0.16, ease);
    p.rot.hips.x = lerp(-0.35, -1.32, ease);
    p.rot.hips.y = lerp(0.1, 0.48, ease);
    p.rot.hips.z = lerp(0.12, 0.44, ease);

    p.rot.spine.x = lerp(-0.2, -0.26, ease);
    p.rot.chest.x = lerp(-0.1, -0.18, ease);
    p.rot.head.x = lerp(0.15, 0.34, ease);
    p.rot.head.y = lerp(0, -0.36, ease);

    p.rot.leftUpLeg.x = lerp(0.45, 0.62, ease);
    p.rot.leftLeg.x = lerp(-0.6, -1.18, ease);
    p.rot.rightUpLeg.x = lerp(-0.2, 0.18, ease);
    p.rot.rightLeg.x = lerp(-0.4, -0.85, ease);

    p.rot.leftArm.x = lerp(0.6, 1.15, ease);
    p.rot.leftArm.z = lerp(-0.4, -0.78, ease);
    p.rot.leftForeArm.x = lerp(0.7, 0.48, ease);
    p.rot.rightArm.x = lerp(0.2, 0.72, ease);
    p.rot.rightArm.z = lerp(0.35, 0.62, ease);
    p.rot.rightForeArm.x = lerp(0.6, 0.82, ease);
  }

  private applyLandingOverlay(p: SkeletonPose, w: number, hard: boolean): void {
    const mag = hard ? 1.0 : 0.56;
    const k = w * mag;
    p.hipPos.y -= 0.22 * k;
    p.rot.spine.x -= 0.22 * k;
    p.rot.chest.x -= 0.14 * k;
    p.rot.head.x += 0.24 * k;
    p.rot.leftUpLeg.x += 0.42 * k;
    p.rot.rightUpLeg.x += 0.36 * k;
    p.rot.leftLeg.x -= 0.72 * k;
    p.rot.rightLeg.x -= 0.68 * k;
    p.rot.leftFoot.x += 0.28 * k;
    p.rot.rightFoot.x += 0.28 * k;
    p.rot.leftArm.z -= 0.32 * k;
    p.rot.rightArm.z += 0.32 * k;
    p.rot.leftArm.x -= 0.18 * k;
    p.rot.rightArm.x -= 0.18 * k;
  }

  private applySlideRecoveryOverlay(p: SkeletonPose, t: number): void {
    // Smooth athletic push-up from low crouch back into full sprint posture
    p.hipPos.y = lerp(p.hipPos.y, 0.52, t);
    p.rot.hips.x = lerp(p.rot.hips.x, -0.24, t);
    p.rot.spine.x -= 0.28 * t;
    p.rot.head.x += 0.32 * t;
    p.rot.leftUpLeg.x += 0.48 * t;
    p.rot.leftLeg.x -= 0.68 * t;
    p.rot.rightUpLeg.x += 0.22 * t;
    p.rot.rightLeg.x -= 0.54 * t;
    p.rot.rightArm.x -= 0.35 * t;
  }

  private applyLaneOverlay(p: SkeletonPose, dir: -1 | 1, w: number): void {
    // dir = -1 moves LEFT (-X -> positive Z lean), dir = +1 moves RIGHT (+X -> negative Z lean)
    p.rot.hips.z += -dir * 0.22 * w;
    p.rot.spine.z += -dir * 0.12 * w;
    p.rot.chest.y += -dir * 0.24 * w;
    p.rot.head.y += -dir * 0.28 * w;
    p.rot.leftArm.z -= (dir < 0 ? 0.24 : 0.08) * w;
    p.rot.rightArm.z += (dir > 0 ? 0.24 : 0.08) * w;
  }

  private applyTurnOverlay(p: SkeletonPose, dir: -1 | 1, w: number): void {
    p.hipPos.y -= 0.05 * w;
    p.rot.hips.z += -dir * 0.34 * w;
    p.rot.spine.z += -dir * 0.18 * w;
    p.rot.chest.y += -dir * 0.32 * w;
    p.rot.head.y += -dir * 0.42 * w;
    p.rot.leftArm.z -= 0.22 * w;
    p.rot.rightArm.z += 0.22 * w;
  }

  private applyStumbleOverlay(p: SkeletonPose, stateTime: number, weight: number): void {
    const w = clamp(weight, 0, 1);
    const sway = Math.sin(stateTime * 15) * 0.28 * w;
    p.hipPos.y -= 0.09 * w;
    p.rot.hips.x -= 0.14 * w;
    p.rot.hips.z += sway;
    p.rot.spine.x -= 0.22 * w;
    p.rot.chest.y += sway * 0.9;
    p.rot.head.x += 0.18 * w;
    p.rot.leftArm.x += 0.42 * w + sway;
    p.rot.leftArm.z -= 0.46 * w;
    p.rot.rightArm.x += 0.32 * w - sway;
    p.rot.rightArm.z += 0.46 * w;
  }

  private applyRecoveryOverlay(p: SkeletonPose, w: number, phase: number): void {
    const breathHeave = Math.sin(phase * 0.5) * 0.05 * w;
    p.rot.spine.x -= 0.1 * w;
    p.rot.chest.x += breathHeave;
    p.rot.leftArm.z -= 0.08 * w;
    p.rot.rightArm.z += 0.08 * w;
  }

  private applyNearMissAdditive(p: SkeletonPose, side: -1 | 1, w: number): void {
    // Quick instinctive shoulder pull-away & glance toward the near-missed obstacle
    p.rot.spine.z += side * 0.14 * w;
    p.rot.chest.y += side * 0.22 * w;
    p.rot.head.y -= side * 0.34 * w;
    if (side > 0) {
      p.rot.rightShoulder.z += 0.12 * w;
      p.rot.rightArm.z += 0.2 * w;
    } else {
      p.rot.leftShoulder.z -= 0.12 * w;
      p.rot.leftArm.z -= 0.2 * w;
    }
  }

  private applyCollisionAdditive(p: SkeletonPose, w: number): void {
    // Sharp upper-torso impact recoil
    p.rot.spine.x += 0.34 * w;
    p.rot.chest.x += 0.24 * w;
    p.rot.head.x -= 0.22 * w;
    p.rot.leftArm.z -= 0.35 * w;
    p.rot.rightArm.z += 0.35 * w;
  }

  private applyAbilityAdditive(p: SkeletonPose, w: number): void {
    // Confident chest lift & leading right forearm surge layered over sprint legs
    p.rot.chest.x += 0.16 * w;
    p.rot.chest.y -= 0.18 * w;
    p.rot.rightArm.x = lerp(p.rot.rightArm.x, 1.05, w * 0.85);
    p.rot.rightArm.z += 0.26 * w;
    p.rot.rightForeArm.x = lerp(p.rot.rightForeArm.x, 0.72, w * 0.85);
  }

  private copyPose(dst: SkeletonPose, src: SkeletonPose): void {
    dst.hipPos.x = src.hipPos.x;
    dst.hipPos.y = src.hipPos.y;
    dst.hipPos.z = src.hipPos.z;
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const n = BONE_NAMES[i];
      dst.rot[n].x = src.rot[n].x;
      dst.rot[n].y = src.rot[n].y;
      dst.rot[n].z = src.rot[n].z;
    }
  }

  private blendPoseToward(cur: SkeletonPose, target: SkeletonPose, lambda: number, dt: number): void {
    cur.hipPos.x = damp(cur.hipPos.x, target.hipPos.x, lambda, dt);
    cur.hipPos.y = damp(cur.hipPos.y, target.hipPos.y, lambda, dt);
    cur.hipPos.z = damp(cur.hipPos.z, target.hipPos.z, lambda, dt);
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const n = BONE_NAMES[i];
      const cr = cur.rot[n];
      const tr = target.rot[n];
      cr.x = damp(cr.x, tr.x, lambda, dt);
      cr.y = damp(cr.y, tr.y, lambda, dt);
      cr.z = damp(cr.z, tr.z, lambda, dt);
    }
  }
}

/**
 * Applies a SkeletonPose cleanly onto a CharacterRig's 26-bone hierarchy with zero heap allocations.
 */
export function applySkeletonPoseToRig(pose: SkeletonPose, rig: CharacterRig): void {
  const b = rig.bones;
  b.hips.position.set(pose.hipPos.x, pose.hipPos.y, pose.hipPos.z);
  for (let i = 0; i < BONE_NAMES.length; i++) {
    const name = BONE_NAMES[i];
    const r = pose.rot[name];
    b[name].rotation.set(r.x, r.y, r.z, 'YXZ');
  }
}
