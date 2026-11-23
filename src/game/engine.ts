import * as THREE from 'three';
import {
  getCharacterById,
  getLevelById,
  getOutfitById,
  getThemeById,
} from '../data/catalog';
import { ArchitectureStyle, GameState, LevelDef, LiveHudSnapshot, PlayMode, RunStats, SaveData, TrackBranch, TrackCoin, TrackObstacle, TrackTurn } from '../types/game';
import { FootstepSurface, KharosAudioEngine } from './audio';
import { CharacterAnimator, applySkeletonPoseToRig } from './characterAnimation';
import { LivingWorldManager } from './livingWorld';
import {
  BiomeMaterialPack,
  CharacterRig,
  HollowRig,
  buildBiomeLandmark,
  buildBranchSectionMesh,
  buildCharacterRig,
  buildCoinMesh,
  buildDistantVista,
  buildObstacleMesh,
  buildRealisticBoulderGeo,
  buildRealisticFoliageClusterGeo,
  buildTempleArch,
  buildTheHollowPursuer,
  getBeveledStoneGeo,
  getChamferedArchBeamGeo,
  getSculptedColumnGeo,
} from './models';
import {
  COYOTE_TIME,
  GRAVITY,
  LANE_WIDTH,
  PlayerSimState,
  TUTORIAL_STEPS,
  activateCharacterAbility,
  computeDesiredChaseCamera,
  computeProgressiveSpeed,
  createInitialPlayerSim,
  findApproachingBranch,
  generateFairTrackSlice,
  getAbilityCooldownSec,
  getAbilityDurationSec,
  isZInsideBranchZone,
  resolveObstacleImpact,
  sampleRoutePose,
  sampleTrackPoint,
  selectBranchRoute,
  triggerPlayerJump,
  triggerPlayerSlide,
} from './rules';
import {
  ProceduralTextureSet,
  createEnvironmentTextures,
  createOutdoorEnvironmentTexture,
} from './textures';
import { getEndlessBiomeLevelId } from './track';

interface ActiveObstacleVisual {
  data: TrackObstacle;
  group: THREE.Group;
  baseY: number;
}

interface ActiveCoinVisual {
  data: TrackCoin;
  group: THREE.Group;
}

interface ActiveTurnVisual {
  data: TrackTurn;
  group: THREE.Group;
}

interface ActiveBranchVisual {
  data: TrackBranch;
  group: THREE.Group;
  flames: THREE.Object3D[];
}

interface BurstParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: LiveHudSnapshot) => void;
  onGameOver: (stats: RunStats) => void;
  onVictory: (stats: RunStats) => void;
  onPauseRequested: () => void;
}

export class KharosRunnerEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private audio: KharosAudioEngine;
  private callbacks: EngineCallbacks;
  public readonly isSoftwareGl: boolean;

  private save: SaveData;
  private level: LevelDef;
  private mode: PlayMode = 'campaign';
  private endlessStartLevelId = 1;
  private envEventTimer = 6.5;
  private envEventCounter = 0;
  private gameState: GameState = 'title';

  // Lighting & Environment
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;
  private envTextures: ProceduralTextureSet | null = null;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private skyMesh: THREE.Mesh;

  // Shared biome PBR materials
  private pathMat: THREE.MeshStandardMaterial;
  private stoneMat: THREE.MeshStandardMaterial;
  private trimMat: THREE.MeshStandardMaterial;
  private accentMat: THREE.MeshStandardMaterial;
  private foliageMat: THREE.MeshStandardMaterial;
  private foliageAltMat: THREE.MeshStandardMaterial;
  private canopyMat: THREE.MeshStandardMaterial;
  private vineMat: THREE.MeshStandardMaterial;
  private barkMat: THREE.MeshStandardMaterial;
  private metalMat: THREE.MeshStandardMaterial;
  private terrainMat: THREE.MeshStandardMaterial;
  private hazardMat: THREE.MeshStandardMaterial;
  private flameMat: THREE.MeshBasicMaterial;
  private mistMat: THREE.MeshBasicMaterial;
  private contactShadowMat: THREE.MeshBasicMaterial;
  private shaftMat: THREE.ShaderMaterial;

  // Shared GPU shader animation uniforms (organic wind sway & dappled canopy sunlight)
  private windUniform = { value: 0 };
  private roadScrollUniform = { value: 0 };
  private activeCenterXUniform = { value: 0 };
  private lastEnvKey = '';

  // World groups
  private worldRoot = new THREE.Group();
  private trackPieces: THREE.Mesh[] = [];
  private sideTerrainL: THREE.Mesh;
  private sideTerrainR: THREE.Mesh;
  private landmarks: Array<{ group: THREE.Group; zOffset: number; side: -1 | 1; baseLateral: number }> = [];
  private archFrames: Array<{ group: THREE.Group; zOffset: number }> = [];
  private brazierFlames: THREE.Object3D[] = [];
  private sunShafts: THREE.Mesh[] = [];
  private distantVista: THREE.Group | null = null;
  private scatterRocks: THREE.InstancedMesh;
  private scatterRockData: Array<{ baseX: number; x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }> = [];
  private scatterFoliage: THREE.InstancedMesh;
  private scatterFoliageData: Array<{ baseX: number; x: number; y: number; z: number; s: number; ry: number }> = [];
  private scatterCanopy: THREE.InstancedMesh;
  private scatterCanopyData: Array<{ baseX: number; x: number; y: number; z: number; s: number; ry: number }> = [];
  private mistMesh: THREE.InstancedMesh;
  private mistData: Array<{ x: number; y: number; z: number; s: number; speed: number }> = [];
  private victoryGate: THREE.Group | null = null;

  // Actors & Living World
  private playerRig: CharacterRig;
  private hollowRig: HollowRig;
  private characterAnimator = new CharacterAnimator();
  private livingWorld: LivingWorldManager | null = null;

  // Dynamic entities
  private obstacles: ActiveObstacleVisual[] = [];
  private coins: ActiveCoinVisual[] = [];
  private turns: ActiveTurnVisual[] = [];
  private branches: ActiveBranchVisual[] = [];
  private generatedUpToZ = 0;
  private chunkCounter = 0;
  private idCounter = { obstacle: 1, coin: 1, turn: 1 };

  // Pooled particles (InstancedMesh)
  private weatherMesh: THREE.InstancedMesh;
  private weatherPositions: Float32Array;
  private weatherCount = 120;

  private burstMesh: THREE.InstancedMesh;
  private burstParticles: BurstParticle[] = [];
  private burstCursor = 0;

  // Simulation state
  private sim: PlayerSimState;
  private runCoins = 0;
  private obstaclesAvoided = 0;
  private nearMisses = 0;
  private jumpsCount = 0;
  private slidesCount = 0;
  private abilitiesUsed = 0;
  private secretPathsFound = 0;
  private stumblesCount = 0;
  private runDuration = 0;
  private causeOfDeath = '';

  // Camera & Feel
  private camPos = new THREE.Vector3(0, 3.85, 6.75);
  private camLook = new THREE.Vector3(0, 1.58, -16.5);
  private camInitialized = false;
  private camYaw = 0;
  private targetCamYaw = 0;
  private camRoll = 0;
  private trauma = 0;
  private hitstopTimer = 0;
  private squashX = 1;
  private squashY = 1;
  private lastHollowStompSin = 0;
  private nearMissBanner = '';
  private nearMissBannerTimer = 0;
  private lookAheadX = 0;

  // Tutorial tracking
  private tutorialStepIdx = 0;
  private tutorialStepTimer = 0;

  // Loop & timing
  private frameId = 0;
  private disposed = false;
  private lastTimestamp = 0;
  private lastRenderTime = 0;
  private hudEmitAccum = 0;
  private fpsSamples = 60;
  private resizeObserver: ResizeObserver;

  // Input state
  private keysHeld = new Set<string>();
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeActive = false;
  private swipeConsumed = false;
  private deathDelayTimer = 0;

  // Reusable scratch objects (zero-GC render loop!)
  private readonly _dummy = new THREE.Object3D();
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _c1 = new THREE.Color();

  constructor(
    container: HTMLElement,
    save: SaveData,
    audio: KharosAudioEngine,
    callbacks: EngineCallbacks,
  ) {
    this.container = container;
    this.save = save;
    this.audio = audio;
    this.callbacks = callbacks;
    this.level = getLevelById(Math.min(20, save.highestUnlockedLevel));
    this.sim = createInitialPlayerSim(this.level.baseSpeed);

    // Detect software WebGL (SwiftShader / llvmpipe / WARP) via GPU renderer string
    this.isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl && save.settings.graphics.antiAliasing,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.scene = new THREE.Scene();

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(480, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(56, width / height, 0.2, 260);

    // Realistic sunlit jungle outdoor three-point lighting rig (deep forest bounce + warm directional sunlight + subtle sky rim)
    this.hemiLight = new THREE.HemisphereLight('#a4d4e0', '#1e2e19', 0.72);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff0cc', 2.75);
    this.sunLight.position.set(22, 34, -18);
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 96;
    const d = 22;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight, this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight('#ffe4b0', 0.65);
    this.rimLight.position.set(-16, 12, 22);
    this.scene.add(this.rimLight);

    // Cinematic Procedural Sky Dome (3-band atmospheric gradient + sun disc/Mie halo + drifting cloud strata)
    const skyGeo = new THREE.SphereGeometry(185, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(this.level.palette.skyTop) },
        horizonColor: { value: new THREE.Color(this.level.palette.skyHorizon) },
        sunColor: { value: new THREE.Color(this.level.palette.sunColor) },
        sunDir: { value: new THREE.Vector3(0.32, 0.36, -0.87).normalize() },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        uniform vec3 sunDir;
        uniform float uTime;
        varying vec3 vWorldDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y * 1.4, 0.0, 1.0);
          vec3 midCol = mix(horizonColor, topColor, 0.45);
          vec3 col = mix(horizonColor, midCol, smoothstep(0.0, 0.35, h));
          col = mix(col, topColor, smoothstep(0.28, 1.0, h));

          // Soft celestial sun/moon halo + crisp disc
          float sunDot = max(dot(dir, normalize(sunDir)), 0.0);
          col += sunColor * pow(sunDot, 7.0) * 0.24;
          col += sunColor * smoothstep(0.9965, 0.9992, sunDot) * 0.85;

          // Subtle layered drifting high-altitude clouds
          if (dir.y > 0.04) {
            vec2 cloudUv = dir.xz / (dir.y + 0.22) * 1.35 + vec2(uTime * 0.012, -uTime * 0.008);
            float n = noise2(cloudUv) * 0.62 + noise2(cloudUv * 2.3 + 4.1) * 0.38;
            float cloudMask = smoothstep(0.54, 0.82, n) * smoothstep(0.04, 0.26, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));
            vec3 cloudCol = mix(horizonColor, sunColor, 0.35 + pow(sunDot, 3.0) * 0.45);
            col = mix(col, cloudCol, cloudMask * 0.36);
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyMesh);

    this.scene.add(this.worldRoot);

    // Shared Photorealistic PBR Biome Materials (real albedo + tangent-space normalMap + roughnessMap, zero flatShading!)
    this.pathMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.04,
      normalScale: new THREE.Vector2(1.35, 1.35),
    });
    this.attachDappledCanopyShader(this.pathMat);

    this.stoneMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0.05,
      normalScale: new THREE.Vector2(1.42, 1.42),
    });
    this.trimMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.06,
      normalScale: new THREE.Vector2(1.5, 1.5),
    });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: '#a38952',
      roughness: 0.44,
      metalness: 0.56,
      normalScale: new THREE.Vector2(0.9, 0.9),
    });
    this.foliageMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.0,
      alphaTest: 0.44,
      side: THREE.DoubleSide,
      normalScale: new THREE.Vector2(0.82, 0.82),
    });
    this.foliageAltMat = new THREE.MeshStandardMaterial({
      color: '#edf7dc',
      roughness: 0.76,
      metalness: 0.0,
      alphaTest: 0.44,
      side: THREE.DoubleSide,
      normalScale: new THREE.Vector2(0.82, 0.82),
    });
    this.canopyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.0,
      alphaTest: 0.46,
      side: THREE.DoubleSide,
      normalScale: new THREE.Vector2(0.84, 0.84),
    });
    this.vineMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.02,
      alphaTest: 0.34,
      side: THREE.DoubleSide,
    });
    this.attachWindShader(this.foliageMat, 0.085, false);
    this.attachWindShader(this.foliageAltMat, 0.095, false);
    this.attachWindShader(this.canopyMat, 0.11, false);
    this.attachWindShader(this.vineMat, 0.15, true);

    this.barkMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0.02,
      normalScale: new THREE.Vector2(1.5, 1.5),
    });
    this.metalMat = new THREE.MeshStandardMaterial({
      color: '#34302b',
      roughness: 0.38,
      metalness: 0.82,
    });
    this.terrainMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.98,
      metalness: 0.02,
      normalScale: new THREE.Vector2(1.45, 1.45),
    });
    this.hazardMat = new THREE.MeshStandardMaterial({
      color: '#f97316',
      emissive: '#ea580c',
      emissiveIntensity: 0.68,
      roughness: 0.3,
      metalness: 0.38,
    });
    this.flameMat = new THREE.MeshBasicMaterial({
      color: '#fff4d2',
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mistMat = new THREE.MeshBasicMaterial({
      color: '#d8ece2',
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      color: '#050b07',
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color('#fff4d6') },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float horiz = sin(vUv.x * 3.14159265);
          float vert = smoothstep(0.0, 0.38, vUv.y) * (1.0 - smoothstep(0.68, 1.0, vUv.y));
          float alpha = pow(horiz, 2.2) * vert * 0.105;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    // Build grounded monumental Angkor causeway segments (flagstone deck + carved lotus-trim coping curbs + sculpted stone bollards)
    const roadGeo = new THREE.BoxGeometry(LANE_WIDTH * 3.15, 0.8, 24);
    const apronGeo = new THREE.BoxGeometry(LANE_WIDTH * 3.62, 2.45, 24);
    const curbBaseGeo = getBeveledStoneGeo(0.56, 0.34, 24, 0.07);
    const curbCopingGeo = getBeveledStoneGeo(0.46, 0.16, 24, 0.04);
    const pierBollardGeo = new THREE.CylinderGeometry(0.36, 0.44, 0.62, 8);
    const pierCapGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.14, 8);
    const pierFinialGeo = new THREE.CylinderGeometry(0.14, 0.3, 0.32, 8);

    for (let i = 0; i < 9; i++) {
      const seg = new THREE.Mesh(roadGeo, this.pathMat);
      seg.position.set(0, -0.4, 36 - i * 24);
      seg.receiveShadow = true;

      // Solid stone foundation apron beneath the causeway
      const apron = new THREE.Mesh(apronGeo, this.stoneMat);
      apron.position.set(0, -1.56, 0);
      seg.add(apron);

      // Stepped carved stone & lotus-relief coping curbs
      const curbX = LANE_WIDTH * 1.575 + 0.22;
      for (const s of [-1, 1]) {
        const curbBase = new THREE.Mesh(curbBaseGeo, this.stoneMat);
        curbBase.position.set(s * curbX, 0.34, 0);
        curbBase.receiveShadow = true;
        const curbCoping = new THREE.Mesh(curbCopingGeo, this.trimMat);
        curbCoping.position.set(s * (curbX + 0.03), 0.57, 0);
        curbCoping.receiveShadow = true;
        seg.add(curbBase, curbCoping);
      }

      // Asymmetric ancient weathered sculpted stone balustrade bollards
      const pierOffsets = i % 2 === 0 ? [-7.5] : [3.2];
      for (const bz of pierOffsets) {
        for (const s of [-1, 1]) {
          const tilt = ((i + (s > 0 ? 1 : 0)) % 3 === 0) ? s * 0.05 : 0;
          const post = new THREE.Mesh(pierBollardGeo, this.stoneMat);
          post.position.set(s * (curbX + 0.08), 0.56, bz + (s > 0 ? 1.8 : -1.2));
          post.rotation.z = tilt;
          const cap = new THREE.Mesh(pierCapGeo, this.trimMat);
          cap.position.set(0, 0.36, 0);
          post.add(cap);
          if ((i + (s > 0 ? 2 : 0)) % 2 === 0) {
            const finial = new THREE.Mesh(pierFinialGeo, this.trimMat);
            finial.position.set(0, 0.56, 0);
            post.add(finial);
          }
          seg.add(post);
        }
      }

      this.worldRoot.add(seg);
      this.trackPieces.push(seg);
    }

    // High-resolution undulating canyon floor & mossy cliff terrain flanking BOTH main and Left/Right branching routes
    const buildFlankGeo = (side: -1 | 1) => {
      const geo = new THREE.PlaneGeometry(96, 230, 28, 32);
      const posAttr = geo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const distFromRoad = side > 0 ? x + 48 : 48 - x;
        // Keep [-19..+19] as a depressed mossy temple valley floor so Left/Right branches soar cleanly with zero terrain clipping!
        const innerFade = THREE.MathUtils.clamp((distFromRoad - 13.5) / 14, 0, 1);
        const fbm =
          Math.sin(x * 0.14 + y * 0.04) * 2.4 +
          Math.cos(y * 0.085 - x * 0.06) * 2.1 +
          Math.sin((x - y) * 0.19) * 1.05 +
          Math.cos((x + y) * 0.34) * 0.45;
        const ridge = (fbm + Math.max(0, distFromRoad - 10) * 0.21) * innerFade - (1 - innerFade) * 1.9;
        posAttr.setZ(i, ridge);
      }
      geo.computeVertexNormals();
      return geo;
    };

    this.sideTerrainL = new THREE.Mesh(buildFlankGeo(-1), this.terrainMat);
    this.sideTerrainL.rotation.x = -Math.PI / 2;
    this.sideTerrainL.position.set(-53.5, -1.75, -65);
    this.sideTerrainL.receiveShadow = true;
    this.sideTerrainR = new THREE.Mesh(buildFlankGeo(1), this.terrainMat);
    this.sideTerrainR.rotation.x = -Math.PI / 2;
    this.sideTerrainR.position.set(53.5, -1.75, -65);
    this.sideTerrainR.receiveShadow = true;
    this.scene.add(this.sideTerrainL, this.sideTerrainR);

    // Instanced smooth-displaced mossy boulders & multi-species 3D tropical undergrowth (3 total draw calls!)
    const rockCount = 54;
    const rockGeo = buildRealisticBoulderGeo(31);
    this.scatterRocks = new THREE.InstancedMesh(rockGeo, this.terrainMat, rockCount);
    this.scatterRocks.receiveShadow = true;
    this.scatterRocks.frustumCulled = false;
    for (let i = 0; i < rockCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 14 - i * 3.8 - (i % 3) * 0.7;
      const x = side * (5.3 + ((i * 19) % 10) * 1.15);
      const sx = 0.75 + ((i * 7) % 5) * 0.32;
      const sy = 0.55 + ((i * 11) % 4) * 0.25;
      const sz = 0.75 + ((i * 13) % 5) * 0.3;
      const ry = (i * 1.37) % (Math.PI * 2);
      this.scatterRockData.push({ baseX: x, x, y: -0.92 + sy * 0.22, z, sx, sy, sz, ry });
    }
    this.worldRoot.add(this.scatterRocks);

    const shrubCount = 84;
    const shrubGeo = buildRealisticFoliageClusterGeo(0);
    this.scatterFoliage = new THREE.InstancedMesh(shrubGeo, this.foliageMat, shrubCount);
    this.scatterFoliage.frustumCulled = false;
    for (let i = 0; i < shrubCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 14 - i * 2.55;
      const x = side * (4.95 + ((i * 23) % 12) * 0.92);
      const s = 0.78 + ((i * 5) % 5) * 0.26;
      const ry = (i * 2.13) % (Math.PI * 2);
      this.scatterFoliageData.push({ baseX: x, x, y: -0.72, z, s, ry });
    }
    this.worldRoot.add(this.scatterFoliage);

    const canopyShrubCount = 52;
    const canopyShrubGeo = buildRealisticFoliageClusterGeo(1);
    this.scatterCanopy = new THREE.InstancedMesh(canopyShrubGeo, this.canopyMat, canopyShrubCount);
    this.scatterCanopy.frustumCulled = false;
    for (let i = 0; i < canopyShrubCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 12 - i * 4.1 - (i % 3) * 0.65;
      const x = side * (5.55 + ((i * 17) % 10) * 1.08);
      const s = 0.95 + ((i * 7) % 5) * 0.3;
      const ry = (i * 1.87) % (Math.PI * 2);
      this.scatterCanopyData.push({ baseX: x, x, y: -0.62, z, s, ry });
    }
    this.worldRoot.add(this.scatterCanopy);

    // Low-lying drifting valley mist banks (12 instanced soft quads hugging canyon flanks)
    const mistCount = 12;
    this.mistMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(24, 9), this.mistMat, mistCount);
    this.mistMesh.frustumCulled = false;
    for (let i = 0; i < mistCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.mistData.push({
        x: side * (16 + (i % 3) * 8),
        y: 1.4 + (i % 3) * 1.1,
        z: -10 - i * 11,
        s: 0.9 + (i % 4) * 0.28,
        speed: 0.6 + (i % 3) * 0.35,
      });
    }
    this.scene.add(this.mistMesh);

    // Apply initial environment textures + outdoor PMREM + realistic landmarks + panoramic vista
    this.applyEnvironment(this.level);

    // Build Ultra-Premium Human Skinned Character and Biome-Adapted Hollow with PBR textures
    this.playerRig = this.createPlayerRig();
    this.characterAnimator.reset('idle');
    applySkeletonPoseToRig(this.characterAnimator.currentPose, this.playerRig);
    this.scene.add(this.playerRig.root);

    this.hollowRig = buildTheHollowPursuer(
      this.envTextures!.stoneNormal,
      this.envTextures!.contactShadow,
    );
    this.hollowRig.applyBiome(this.level);
    this.hollowRig.root.position.set(0, 0, 12);
    this.hollowRig.root.visible = false;
    this.scene.add(this.hollowRig.root);

    // Living World: animated biome-authentic wildlife (8 species) & corrupted vegetation (4 flora types)
    this.livingWorld = new LivingWorldManager(
      this.envTextures!.contactShadow,
      (pos, hexColor) => this.spawnBurst(pos, 6, hexColor, 2.6),
    );
    this.livingWorld.setDensityScale(
      this.save.settings.graphics.foliageDensity,
      this.save.settings.graphics.effectsQuality,
    );
    this.livingWorld.applyBiome(this.level, []);
    this.worldRoot.add(this.livingWorld.group);

    // Pooled InstancedMesh soft sunlit pollen/weather motes (zero sharp geometric diamonds!)
    const weatherGeo = new THREE.PlaneGeometry(0.24, 0.24);
    const weatherMat = new THREE.MeshBasicMaterial({
      color: this.level.palette.particleColor,
      map: this.envTextures!.mistMap,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.weatherMesh = new THREE.InstancedMesh(weatherGeo, weatherMat, this.weatherCount);
    this.weatherMesh.frustumCulled = false;
    this.weatherPositions = new Float32Array(this.weatherCount * 3);
    for (let i = 0; i < this.weatherCount; i++) {
      this.weatherPositions[i * 3] = (Math.random() - 0.5) * 32;
      this.weatherPositions[i * 3 + 1] = Math.random() * 14 + 0.5;
      this.weatherPositions[i * 3 + 2] = -Math.random() * 65 + 10;
    }
    this.scene.add(this.weatherMesh);

    // Pooled InstancedMesh soft atmospheric dust & spark burst puffs (zero solid white balls!)
    const burstGeo = new THREE.PlaneGeometry(0.46, 0.46);
    const burstMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: this.envTextures!.mistMap,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const burstCapacity = 90;
    this.burstMesh = new THREE.InstancedMesh(burstGeo, burstMat, burstCapacity);
    this.burstMesh.frustumCulled = false;
    for (let i = 0; i < burstCapacity; i++) {
      this.burstParticles.push({
        active: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.5,
        scale: 1,
        color: new THREE.Color('#b59f7e'),
      });
      this._dummy.position.set(0, -100, 0);
      this._dummy.scale.setScalar(0.001);
      this._dummy.updateMatrix();
      this.burstMesh.setMatrixAt(i, this._dummy.matrix);
      this.burstMesh.setColorAt(i, this._c1.set('#b59f7e'));
    }
    this.burstMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.burstMesh);

    this.applyGraphicsSettings();
    this.handleResize();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // Pre-warm shaders on real GPU (skip on software WebGL per threejs skill)
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindInputListeners();
    this.lastTimestamp = performance.now();
    this.scheduleNextFrame();
  }

  public updateSaveState(save: SaveData): void {
    const prevChar = this.save.selectedCharacter;
    const prevOutfit = this.save.equippedOutfits[prevChar];
    const prevTheme = this.save.selectedTheme;
    const prevGraphics = JSON.stringify(this.save.settings.graphics);
    this.save = save;

    const curOutfit = save.equippedOutfits[save.selectedCharacter];
    if (prevChar !== save.selectedCharacter || prevOutfit !== curOutfit) {
      this.playerRig.applyCharacterAndOutfit(
        getCharacterById(save.selectedCharacter),
        getOutfitById(curOutfit),
      );
    }
    if (prevTheme !== save.selectedTheme) {
      this.applyEnvironment(this.level);
    }
    if (prevGraphics !== JSON.stringify(save.settings.graphics)) {
      this.applyGraphicsSettings();
    }
  }

  public previewLevel(levelId: number): void {
    const nextLevel = getLevelById(levelId);
    if (nextLevel.id !== this.level.id) {
      this.level = nextLevel;
      this.applyEnvironment(this.level);
    }
  }

  public startRun(mode: PlayMode, levelId: number): void {
    this.mode = mode;
    this.endlessStartLevelId = levelId;
    this.level = getLevelById(levelId);
    this.applyEnvironment(this.level);

    // Clear old track entities cleanly
    this.clearDynamicEntities();

    this.sim = createInitialPlayerSim(this.level.baseSpeed);
    this.runCoins = 0;
    this.obstaclesAvoided = 0;
    this.nearMisses = 0;
    this.jumpsCount = 0;
    this.slidesCount = 0;
    this.abilitiesUsed = 0;
    this.secretPathsFound = 0;
    this.stumblesCount = 0;
    this.runDuration = 0;
    this.causeOfDeath = '';
    this.deathDelayTimer = 0;
    this.camYaw = 0;
    this.targetCamYaw = 0;
    this.camRoll = 0;
    this.camInitialized = false;
    this.trauma = 0;
    this.hitstopTimer = 0;
    this.squashX = 1;
    this.squashY = 1;
    this.lookAheadX = 0;
    this.nearMissBanner = 'ESCAPE THE HOLLOW!';
    this.nearMissBannerTimer = 2.6;
    this.characterAnimator.reset('playing');
    this.hollowRig.applyBiome(this.level);
    this.tutorialStepIdx = 0;
    this.tutorialStepTimer = 0;
    this.generatedUpToZ = 0;
    this.chunkCounter = 0;
    this.envEventTimer = 6.5;
    this.envEventCounter = 0;
    this.idCounter = { obstacle: 1, coin: 1, turn: 1 };
    this.keysHeld.clear();
    this.activeCenterXUniform.value = 0;

    // Reset world scroll and roadside scatter to starting horizon
    this.worldRoot.position.z = 0;
    for (let i = 0; i < this.trackPieces.length; i++) {
      this.trackPieces[i].position.z = 36 - i * 24;
      this.trackPieces[i].visible = true;
    }
    for (let i = 0; i < this.landmarks.length; i++) {
      const lm = this.landmarks[i];
      lm.group.position.z = lm.zOffset + (lm.side > 0 ? 2.4 : -1.6);
      lm.group.position.x = lm.side * lm.baseLateral;
    }
    for (let i = 0; i < this.archFrames.length; i++) {
      this.archFrames[i].group.position.z = this.archFrames[i].zOffset;
      this.archFrames[i].group.visible = true;
    }
    this.roadScrollUniform.value = 0;

    // Reset player rig transforms
    this.playerRig.root.position.set(0, 0, 0);
    this.playerRig.root.rotation.set(0, 0, 0);
    this.playerRig.bodyPivot.rotation.set(0, 0, 0);
    this.playerRig.bodyPivot.position.set(0, 0, 0);
    this.hollowRig.root.visible = true;

    // Build victory sanctuary gate for campaign / tutorial
    if (this.victoryGate) {
      this.worldRoot.remove(this.victoryGate);
      this.victoryGate = null;
    }
    const targetDist = mode === 'tutorial' ? 420 : mode === 'campaign' ? this.level.targetDistance : 0;
    if (targetDist > 0) {
      this.victoryGate = this.buildSanctuaryGate();
      this.victoryGate.position.set(0, 0, -targetDist);
      this.worldRoot.add(this.victoryGate);
    }

    // Generate initial track horizon (including first real branching path!)
    this.streamAheadTrack();

    // Place roadside scatter & living world wildlife/flora cleanly outside any generated branch corridors
    const activeBranches = this.branches.map((b) => b.data);
    this.livingWorld?.resetForNewRun(activeBranches);
    for (let i = 0; i < this.scatterRockData.length; i++) {
      const d = this.scatterRockData[i];
      d.z = 14 - i * 3.8 - (i % 3) * 0.7;
      d.x = isZInsideBranchZone(activeBranches, -d.z, 14) ? d.baseX + Math.sign(d.baseX) * 14.5 : d.baseX;
      this._dummy.position.set(d.x, d.y, d.z);
      this._dummy.rotation.set(0.15, d.ry, 0.1);
      this._dummy.scale.set(d.sx, d.sy, d.sz);
      this._dummy.updateMatrix();
      this.scatterRocks.setMatrixAt(i, this._dummy.matrix);
    }
    this.scatterRocks.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.scatterFoliageData.length; i++) {
      const d = this.scatterFoliageData[i];
      d.z = 14 - i * 2.55;
      d.x = isZInsideBranchZone(activeBranches, -d.z, 14) ? d.baseX + Math.sign(d.baseX) * 14.5 : d.baseX;
      this._dummy.position.set(d.x, d.y, d.z);
      this._dummy.rotation.set(0, d.ry, 0);
      this._dummy.scale.set(d.s, d.s * 0.92, d.s);
      this._dummy.updateMatrix();
      this.scatterFoliage.setMatrixAt(i, this._dummy.matrix);
    }
    this.scatterFoliage.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.scatterCanopyData.length; i++) {
      const d = this.scatterCanopyData[i];
      d.z = 12 - i * 4.1 - (i % 3) * 0.65;
      d.x = isZInsideBranchZone(activeBranches, -d.z, 14) ? d.baseX + Math.sign(d.baseX) * 14.5 : d.baseX;
      this._dummy.position.set(d.x, d.y, d.z);
      this._dummy.rotation.set(0, d.ry, 0);
      this._dummy.scale.set(d.s, d.s * 0.96, d.s);
      this._dummy.updateMatrix();
      this.scatterCanopy.setMatrixAt(i, this._dummy.matrix);
    }
    this.scatterCanopy.instanceMatrix.needsUpdate = true;

    // Sync actors & dramatic Opening Hollow Chase camera immediately (zero pop!)
    this.hollowRig.root.position.set(0, 0, this.sim.hollowDistance);
    this.gameState = 'playing';
    const startChar = getCharacterById(this.save.selectedCharacter);
    this.updateActorsAnimation(0.016, 0.35, 0, startChar);
    this.updateCamera(0.016);
    this.renderer.render(this.scene, this.camera);

    this.audio.setPaused(false);
    this.audio.startEnvironmentSoundtrack(this.level);
    this.audio.playHollowRoar(0.92);
    this.emitHud();
  }

  public setGameState(state: GameState): void {
    this.gameState = state;
    if (state === 'paused') {
      this.keysHeld.clear();
      this.audio.setPaused(true);
    } else if (state === 'playing') {
      this.keysHeld.clear();
      this.audio.setPaused(false);
    } else if (state === 'title') {
      this.keysHeld.clear();
      this.audio.stopMusic();
      this.clearDynamicEntities();
      if (this.victoryGate) {
        this.worldRoot.remove(this.victoryGate);
        this.victoryGate = null;
      }
      this.hollowRig.root.visible = false;
      this.activeCenterXUniform.value = 0;
      this.skyMesh.position.set(0, 0, 0);
      if (this.distantVista) this.distantVista.position.x = 0;
      this.worldRoot.position.z = 0;
      for (let i = 0; i < this.trackPieces.length; i++) {
        this.trackPieces[i].position.z = 36 - i * 24;
        this.trackPieces[i].visible = true;
      }
      for (let i = 0; i < this.landmarks.length; i++) {
        const lm = this.landmarks[i];
        lm.group.position.z = lm.zOffset + (lm.side > 0 ? 2.4 : -1.6);
        lm.group.position.x = lm.side * lm.baseLateral;
      }
      for (let i = 0; i < this.archFrames.length; i++) {
        this.archFrames[i].group.position.z = this.archFrames[i].zOffset;
        this.archFrames[i].group.visible = true;
      }
      this.playerRig.root.position.set(0, 0, 0);
      this.playerRig.root.rotation.set(0, 0, 0);
      this.playerRig.bodyPivot.rotation.set(0, 0, 0);
      this.playerRig.bodyPivot.position.set(0, 0, 0);
      this.playerRig.shieldMesh.visible = false;
      this.playerRig.magnetRing.visible = false;
      this.playerRig.rushCone.visible = false;
      this.characterAnimator.reset('idle');
      applySkeletonPoseToRig(this.characterAnimator.currentPose, this.playerRig);
    }
  }

  public triggerAbilityFromUi(): void {
    if (this.gameState !== 'playing' || !this.sim.alive) return;
    this.handleAbilityPress();
  }

  private attachWindShader(mat: THREE.MeshStandardMaterial, amplitude: number, isHanging: boolean): void {
    mat.customProgramCacheKey = () => (isHanging ? 'kharos_wind_vine_v2' : 'kharos_wind_leaf_v2');
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windUniform;
      shader.uniforms.uWindAmp = { value: amplitude };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWindTime;
          uniform float uWindAmp;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec4 windWp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #else
            vec4 windWp = modelMatrix * vec4(transformed, 1.0);
          #endif
          float windPhase = uWindTime * 1.85 + windWp.x * 0.42 + windWp.z * 0.34 + windWp.y * 0.22;
          float windMask = ${isHanging ? 'clamp(1.0 - uv.y, 0.0, 1.0)' : 'clamp(uv.y * 0.85 + 0.15, 0.0, 1.0)'};
          transformed.x += (sin(windPhase) * 0.65 + sin(windPhase * 2.17 + 1.3) * 0.35) * uWindAmp * windMask;
          transformed.z += cos(windPhase * 1.28 + 0.7) * uWindAmp * 0.55 * windMask;`,
        );
    };
  }

  private attachDappledCanopyShader(mat: THREE.MeshStandardMaterial): void {
    mat.customProgramCacheKey = () => 'kharos_dappled_path_v3';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windUniform;
      shader.uniforms.uRoadScroll = this.roadScrollUniform;
      shader.uniforms.uActiveCenterX = this.activeCenterXUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vDappleWorldPos;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vDappleWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWindTime;
          uniform float uRoadScroll;
          uniform float uActiveCenterX;
          varying vec3 vDappleWorldPos;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `vec2 canopyUv = vec2(vDappleWorldPos.x * 0.27, (vDappleWorldPos.z - uRoadScroll) * 0.21);
          float breezeShift = sin(uWindTime * 0.9 + canopyUv.y * 0.55) * 0.14;
          float c1 = sin(canopyUv.x * 2.05 + breezeShift) * cos(canopyUv.y * 1.62 - breezeShift * 0.7);
          float c2 = sin((canopyUv.x - canopyUv.y) * 2.95 + breezeShift * 1.1) * 0.45;
          float relX = abs(vDappleWorldPos.x - uActiveCenterX);
          float centerClearing = smoothstep(5.4, 2.0, relX);
          float sunPool = smoothstep(-0.32, 0.7, c1 + c2);
          vec3 canopyMod = mix(vec3(0.80, 0.86, 0.82), vec3(1.13, 1.08, 0.96), sunPool * (0.5 + 0.5 * centerClearing));
          float curbAo = mix(0.86, 1.0, smoothstep(5.0, 3.4, relX));
          outgoingLight *= canopyMod * curbAo;
          #include <opaque_fragment>`,
        );
    };
  }

  private createPlayerRig(): CharacterRig {
    const charDef = getCharacterById(this.save.selectedCharacter);
    const outfitDef = getOutfitById(this.save.equippedOutfits[this.save.selectedCharacter]);
    const tex = this.envTextures!;
    return buildCharacterRig(charDef, outfitDef, {
      contactShadow: tex.contactShadow,
      clothMap: tex.explorerClothMap,
      neutralClothMap: tex.explorerNeutralClothMap,
      clothNormal: tex.explorerClothNormal,
      clothRoughness: tex.explorerClothRoughness,
      leatherMap: tex.explorerLeatherMap,
      leatherNormal: tex.explorerLeatherNormal,
      leatherRoughness: tex.explorerLeatherRoughness,
      hairMap: tex.hairMap,
      hairNormal: tex.hairNormal,
      faceMap: tex.faceMap,
      skinNormal: tex.skinNormal,
      skinRoughness: tex.skinRoughness,
      eyeMap: tex.eyeMap,
    });
  }

  private buildSanctuaryGate(): THREE.Group {
    const g = new THREE.Group();
    const colGeo = getSculptedColumnGeo();
    for (const sx of [-4.3, 4.3]) {
      const col = new THREE.Mesh(colGeo, this.stoneMat);
      col.scale.set(0.92, 1.32, 0.92);
      col.position.set(sx, 0, 0);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.11, 8, 16), this.accentMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(sx, 7.1, 0);
      g.add(col, collar);
    }
    const lintel = new THREE.Mesh(getChamferedArchBeamGeo(), this.trimMat);
    lintel.scale.set(1.22, 1.05, 1.15);
    lintel.position.set(0, 7.6, 0);
    const keystone = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.72, 1.15, 6), this.accentMat);
    keystone.position.set(0, 8.35, 0);
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 6.8),
      new THREE.MeshBasicMaterial({
        color: '#fde047',
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    portal.position.set(0, 3.5, 0);
    g.add(lintel, keystone, portal);
    return g;
  }

  private getBiomeMaterials(): BiomeMaterialPack {
    return {
      stone: this.stoneMat,
      trim: this.trimMat,
      accent: this.accentMat,
      foliage: this.foliageMat,
      foliageAlt: this.foliageAltMat,
      canopy: this.canopyMat,
      vine: this.vineMat,
      bark: this.barkMat,
      terrain: this.terrainMat,
      metal: this.metalMat,
      hazard: this.hazardMat,
      flame: this.flameMat,
      contactShadow: this.contactShadowMat,
      vistaMap: this.envTextures!.vistaMap,
    };
  }

  private applyGraphicsSettings(): void {
    const g = this.save.settings.graphics;
    const dpr = this.isSoftwareGl
      ? 1
      : Math.min(window.devicePixelRatio || 1, 2) * Math.max(0.6, Math.min(1, g.resolutionScale));
    this.renderer.setPixelRatio(dpr);

    const shadowsOn = !this.isSoftwareGl && g.shadowQuality !== 'off';
    this.renderer.shadowMap.enabled = shadowsOn;
    this.sunLight.castShadow = shadowsOn;
    const mapRes = g.shadowQuality === 'high' ? 2048 : 1024;
    if (this.sunLight.shadow.mapSize.width !== mapRes) {
      this.sunLight.shadow.mapSize.set(mapRes, mapRes);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }

    // Real outdoor PMREM envMap reflection intensity
    const envIntensity = g.reflectionQuality === 'high' ? 0.92 : g.reflectionQuality === 'medium' ? 0.62 : 0.35;
    this.pathMat.envMapIntensity = envIntensity * 0.72;
    this.stoneMat.envMapIntensity = envIntensity * 0.72;
    this.trimMat.envMapIntensity = envIntensity * 0.76;
    this.terrainMat.envMapIntensity = envIntensity * 0.65;
    this.barkMat.envMapIntensity = envIntensity * 0.6;
    this.foliageMat.envMapIntensity = envIntensity * 0.36;
    this.foliageAltMat.envMapIntensity = envIntensity * 0.36;
    this.canopyMat.envMapIntensity = envIntensity * 0.38;
    this.accentMat.envMapIntensity = envIntensity * 1.15;
    this.metalMat.envMapIntensity = envIntensity * 1.25;

    // Grounded ambient occlusion shadow depth contrast via hemisphere balance
    this.hemiLight.intensity = this.level.palette.hemiIntensity * (g.ambientOcclusion ? 0.68 : 0.9);
    this.contactShadowMat.opacity = g.ambientOcclusion ? 0.62 : 0.36;

    // Calibrated emissive highlight intensity (clean, realistic, never blown out)
    this.hazardMat.emissiveIntensity = g.bloom ? 0.78 : 0.35;

    // Crisp atmospheric perspective (never milky washed-out foreground!)
    const fogFactor = g.volumetricFog ? 0.44 : 0.28;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = this.level.palette.fogDensity * fogFactor;
    }
    this.mistMesh.visible = g.volumetricFog && g.effectsQuality !== 'low';
    const showShafts =
      g.volumetricFog && g.effectsQuality !== 'low' && !this.save.settings.accessibility.reducedFlashing;
    for (const shaft of this.sunShafts) shaft.visible = showShafts;

    // Foliage, scatter & landmark density
    const density = g.foliageDensity;
    this.landmarks.forEach((lm, idx) => {
      lm.group.visible = (idx % 10) / 10 < density;
    });
    this.scatterFoliage.count = Math.max(16, Math.floor(this.scatterFoliageData.length * density));
    this.scatterCanopy.count = Math.max(12, Math.floor(this.scatterCanopyData.length * density));
    this.scatterRocks.count = Math.max(14, Math.floor(this.scatterRockData.length * Math.max(0.55, density)));

    // Weather particle count & living world density scaled by graphics settings
    const effectRatio = g.effectsQuality === 'high' ? 1 : g.effectsQuality === 'medium' ? 0.65 : 0.3;
    this.weatherMesh.count = Math.max(24, Math.floor(this.weatherCount * effectRatio));
    this.livingWorld?.setDensityScale(density, g.effectsQuality);
  }

  private applyEnvironment(level: LevelDef): void {
    const themeId = this.save.settings ? this.save.selectedTheme : 'classic_kharos';
    const texQuality = this.save.settings.graphics.textureQuality;
    const envKey = `${level.id}:${themeId}:${texQuality}`;
    if (this.envTextures && this.lastEnvKey === envKey) {
      return;
    }
    this.lastEnvKey = envKey;

    const theme = getThemeById(themeId);
    const p = level.palette;

    // Rich cinematic atmospheric perspective fog (crisp high-contrast foreground, misty distant mountains)
    const fogCol = new THREE.Color(p.fogColor);
    if (theme.fogBlend > 0) {
      fogCol.lerp(new THREE.Color(theme.rimLightTint), theme.fogBlend);
    }
    this.scene.background = fogCol;
    const fogFactor = this.save.settings.graphics.volumetricFog ? 0.44 : 0.28;
    this.scene.fog = new THREE.FogExp2(fogCol.getHex(), p.fogDensity * fogFactor);

    // Biome-matched realistic outdoor sunlight + sky + forest bounce PMREM IBL
    this.envRenderTarget?.dispose();
    this.envRenderTarget = createOutdoorEnvironmentTexture(
      this.renderer,
      p.skyTop,
      fogCol.getStyle(),
      p.sunColor,
      p.hemiGround,
    );
    this.scene.environment = this.envRenderTarget.texture;

    const skyUniforms = (this.skyMesh.material as THREE.ShaderMaterial).uniforms;
    skyUniforms.topColor.value.set(p.skyTop);
    skyUniforms.horizonColor.value.copy(fogCol);
    skyUniforms.sunColor.value.set(p.sunColor);

    this.sunLight.color.set(p.sunColor);
    this.sunLight.intensity = p.sunIntensity * 1.28;
    this.hemiLight.color.set(p.hemiSky);
    this.hemiLight.groundColor.set(p.hemiGround);
    this.hemiLight.intensity = p.hemiIntensity * 0.68;
    this.rimLight.color.set(theme.rimLightTint);

    // Load & synthesize real photorealistic PBR textures + Sobel tangent-space normal maps + roughness maps
    this.envTextures?.dispose();
    const texSize = texQuality === 'high' ? 512 : texQuality === 'medium' ? 384 : 256;
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.envTextures = createEnvironmentTextures(
      p.pathBase,
      p.pathTrim,
      p.terrainColor,
      p.archPrimary,
      p.foliageColor,
      texSize,
      maxAniso,
      level.architecture,
    );

    this.pathMat.map = this.envTextures.pathMap;
    this.pathMat.normalMap = this.envTextures.pathNormal;
    this.pathMat.roughnessMap = this.envTextures.pathRoughness;
    this.pathMat.needsUpdate = true;

    this.stoneMat.map = this.envTextures.stoneMap;
    this.stoneMat.normalMap = this.envTextures.stoneNormal;
    this.stoneMat.roughnessMap = this.envTextures.stoneRoughness;
    this.stoneMat.needsUpdate = true;

    this.trimMat.map = this.envTextures.trimMap;
    this.trimMat.normalMap = this.envTextures.trimNormal;
    this.trimMat.roughnessMap = this.envTextures.trimRoughness;
    this.trimMat.needsUpdate = true;

    this.accentMat.normalMap = this.envTextures.trimNormal;
    this.accentMat.color.set(p.archAccent);
    this.accentMat.needsUpdate = true;

    this.barkMat.map = this.envTextures.barkMap;
    this.barkMat.normalMap = this.envTextures.barkNormal;
    this.barkMat.roughnessMap = this.envTextures.barkRoughness;
    this.barkMat.needsUpdate = true;

    this.terrainMat.map = this.envTextures.terrainMap;
    this.terrainMat.normalMap = this.envTextures.terrainNormal;
    this.terrainMat.roughnessMap = this.envTextures.terrainRoughness;
    this.terrainMat.needsUpdate = true;

    this.foliageMat.map = this.envTextures.foliageMap;
    this.foliageMat.normalMap = this.envTextures.foliageNormal;
    this.foliageMat.needsUpdate = true;

    this.foliageAltMat.map = this.envTextures.foliageMap;
    this.foliageAltMat.normalMap = this.envTextures.foliageNormal;
    this.foliageAltMat.needsUpdate = true;

    this.canopyMat.map = this.envTextures.canopyMap;
    this.canopyMat.normalMap = this.envTextures.canopyNormal;
    this.canopyMat.needsUpdate = true;

    this.vineMat.map = this.envTextures.vineMap;
    this.vineMat.needsUpdate = true;

    this.flameMat.map = this.envTextures.flameMap;
    this.flameMat.needsUpdate = true;

    this.contactShadowMat.map = this.envTextures.contactShadow;
    this.contactShadowMat.needsUpdate = true;

    this.hazardMat.color.set(p.hazardGlow);
    this.hazardMat.emissive.set(p.hazardGlow);

    this.mistMat.map = this.envTextures.mistMap;
    this.mistMat.color.copy(fogCol).lerp(new THREE.Color(p.sunColor), 0.18);
    this.mistMat.needsUpdate = true;

    this.shaftMat.uniforms.uColor.value.set(p.sunColor);

    // Keep actor rigs bound to freshly active textures when switching levels or themes
    if (this.playerRig) {
      const prevPos = this.playerRig.root.position.clone();
      const prevRotY = this.playerRig.root.rotation.y;
      this.scene.remove(this.playerRig.root);
      this.playerRig.dispose();
      this.playerRig = this.createPlayerRig();
      this.playerRig.root.position.copy(prevPos);
      this.playerRig.root.rotation.y = prevRotY;
      applySkeletonPoseToRig(this.characterAnimator.currentPose, this.playerRig);
      this.scene.add(this.playerRig.root);
    }
    if (this.hollowRig) {
      const prevPos = this.hollowRig.root.position.clone();
      const prevVis = this.hollowRig.root.visible;
      this.scene.remove(this.hollowRig.root);
      this.hollowRig = buildTheHollowPursuer(
        this.envTextures.stoneNormal,
        this.envTextures.contactShadow,
      );
      this.hollowRig.applyBiome(level);
      this.hollowRig.root.position.copy(prevPos);
      this.hollowRig.root.visible = prevVis;
      this.scene.add(this.hollowRig.root);
    }

    if (this.weatherMesh) {
      const pCol = new THREE.Color(p.particleColor).lerp(new THREE.Color(theme.particleTint), 0.3);
      const wm = this.weatherMesh.material as THREE.MeshBasicMaterial;
      wm.color.copy(pCol);
      wm.map = this.envTextures.mistMap;
      wm.needsUpdate = true;
    }
    if (this.burstMesh) {
      const bm = this.burstMesh.material as THREE.MeshBasicMaterial;
      bm.map = this.envTextures.mistMap;
      bm.needsUpdate = true;
    }

    const mats = this.getBiomeMaterials();

    // Update photorealistic panoramic Angkor canyon & mountain horizon vista + 3D parallax ridges
    if (this.distantVista) {
      this.scene.remove(this.distantVista);
      this.distantVista = null;
    }
    this.distantVista = buildDistantVista(level, mats);
    this.scene.add(this.distantVista);

    // Rebuild non-repetitive realistic branching jungle trees, temple shrines & cliff landmarks
    for (const lm of this.landmarks) this.worldRoot.remove(lm.group);
    for (const af of this.archFrames) this.worldRoot.remove(af.group);
    this.landmarks = [];
    this.archFrames = [];
    this.sunShafts = [];
    this.brazierFlames = [];

    const collectFlames = (obj: THREE.Object3D) => {
      obj.traverse((child) => {
        if (child.name === 'brazier_flame') this.brazierFlames.push(child);
      });
    };

    const zAnchor = this.gameState === 'playing' ? -this.sim.z : 0;
    const activeBranchesNow = this.getActiveBranchData();

    for (let i = 0; i < 20; i++) {
      const zOff = 24 - i * 11;
      for (const side of [-1, 1] as const) {
        const variant = (i * 3 + (side > 0 ? 1 : 0)) % 4;
        const lm = buildBiomeLandmark(level.architecture, mats, side, variant);
        const scale = 0.86 + ((i * 7 + (side > 0 ? 3 : 1)) % 5) * 0.1;
        lm.scale.setScalar(scale);
        const lateral = 7.1 + ((i * 5 + (side > 0 ? 2 : 0)) % 5) * 1.35;
        const placedZ = zAnchor + zOff + (side > 0 ? 2.4 : -1.6);
        const inBranch = Boolean(isZInsideBranchZone(activeBranchesNow, -placedZ, 14));
        lm.position.set(side * (inBranch ? lateral + 13.5 : lateral), -0.85, placedZ);
        lm.rotation.y = (((i * 11 + side * 3) % 7) - 3) * 0.15;
        this.worldRoot.add(lm);
        this.landmarks.push({ group: lm, zOffset: zOff, side, baseLateral: lateral });
        collectFlames(lm);
      }
    }

    // Build 5 varied monumental Angkor temple gateways (including rear archway behind +Z for opening chase!) + sunbeams
    const shaftGeo = new THREE.PlaneGeometry(7.0, 15.5);
    for (let i = 0; i < 5; i++) {
      const zOff = 18 - i * 44;
      const arch = buildTempleArch(i, level.architecture, mats);

      const shaft = new THREE.Mesh(shaftGeo, this.shaftMat);
      shaft.position.set(i % 2 === 0 ? 2.4 : -2.2, 5.4, 1.6);
      shaft.rotation.z = 0.38;
      arch.add(shaft);
      this.sunShafts.push(shaft);

      const archZ = zAnchor + zOff;
      arch.position.set(0, 0, archZ);
      arch.visible = !isZInsideBranchZone(activeBranchesNow, -archZ, 14);
      this.worldRoot.add(arch);
      this.archFrames.push({ group: arch, zOffset: zOff });
      collectFlames(arch);
    }

    // Refresh instanced smooth mossy boulders & multi-species 3D tropical clusters with natural shading variation
    for (let i = 0; i < this.scatterRockData.length; i++) {
      const d = this.scatterRockData[i];
      this._dummy.position.set(d.x, d.y, d.z);
      this._dummy.rotation.set(0.15, d.ry, 0.1);
      this._dummy.scale.set(d.sx, d.sy, d.sz);
      this._dummy.updateMatrix();
      this.scatterRocks.setMatrixAt(i, this._dummy.matrix);
      const shade = 0.84 + (i % 5) * 0.06;
      this._c1.setRGB(shade, shade, shade);
      this.scatterRocks.setColorAt(i, this._c1);
    }
    this.scatterRocks.instanceMatrix.needsUpdate = true;
    if (this.scatterRocks.instanceColor) this.scatterRocks.instanceColor.needsUpdate = true;

    for (let i = 0; i < this.scatterFoliageData.length; i++) {
      const d = this.scatterFoliageData[i];
      this._dummy.position.set(d.x, d.y, d.z);
      this._dummy.rotation.set(0, d.ry, 0);
      this._dummy.scale.set(d.s, d.s * 0.92, d.s);
      this._dummy.updateMatrix();
      this.scatterFoliage.setMatrixAt(i, this._dummy.matrix);
      const shade = 0.82 + (i % 4) * 0.08;
      this._c1.setRGB(shade, Math.min(1, shade * 1.04), shade * 0.96);
      this.scatterFoliage.setColorAt(i, this._c1);
    }
    this.scatterFoliage.instanceMatrix.needsUpdate = true;
    if (this.scatterFoliage.instanceColor) this.scatterFoliage.instanceColor.needsUpdate = true;

    for (let i = 0; i < this.scatterCanopyData.length; i++) {
      const d = this.scatterCanopyData[i];
      this._dummy.position.set(d.x, d.y, d.z);
      this._dummy.rotation.set(0, d.ry, 0);
      this._dummy.scale.set(d.s, d.s * 0.96, d.s);
      this._dummy.updateMatrix();
      this.scatterCanopy.setMatrixAt(i, this._dummy.matrix);
      const shade = 0.8 + (i % 5) * 0.06;
      this._c1.setRGB(shade * 0.96, Math.min(1, shade * 1.05), shade * 0.94);
      this.scatterCanopy.setColorAt(i, this._c1);
    }
    this.scatterCanopy.instanceMatrix.needsUpdate = true;
    if (this.scatterCanopy.instanceColor) this.scatterCanopy.instanceColor.needsUpdate = true;

    // Refresh biome-authentic wildlife & corrupted vegetation without altering terrain or architecture
    if (this.livingWorld) {
      const baseTrackZ = this.gameState === 'playing' ? this.sim.z : 0;
      this.livingWorld.applyBiome(level, activeBranchesNow, baseTrackZ);
    }
  }

  private disposeBranchVisual(b: ActiveBranchVisual): void {
    this.worldRoot.remove(b.group);
    b.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry) {
        obj.geometry.dispose();
      }
    });
  }

  private clearDynamicEntities(): void {
    for (const o of this.obstacles) this.worldRoot.remove(o.group);
    for (const c of this.coins) this.worldRoot.remove(c.group);
    for (const t of this.turns) this.worldRoot.remove(t.group);
    for (const b of this.branches) this.disposeBranchVisual(b);
    this.obstacles = [];
    this.coins = [];
    this.turns = [];
    this.branches = [];
  }

  private getActiveBranchData(): TrackBranch[] {
    return this.branches.map((b) => b.data);
  }

  private getPlayerCameraCoords(): { x: number; y: number; z: number; headingYaw: number; centerX: number; centerY: number } {
    const pose = sampleRoutePose(this.getActiveBranchData(), this.sim.z, this.sim.activeRoute);
    return {
      x: pose.centerX + pose.rightX * this.sim.x,
      y: pose.centerY + this.sim.y,
      z: pose.rightZ * this.sim.x,
      headingYaw: pose.headingYaw,
      centerX: pose.centerX,
      centerY: pose.centerY,
    };
  }

  private streamAheadTrack(): void {
    const horizonZ = this.sim.z + 185;
    const targetLimit =
      this.mode === 'tutorial'
        ? 410
        : this.mode === 'campaign'
          ? this.level.targetDistance - 20
          : Number.POSITIVE_INFINITY;

    const theme = getThemeById(this.save.selectedTheme);

    while (this.generatedUpToZ < Math.min(horizonZ, targetLimit)) {
      const startZ = this.generatedUpToZ;
      const endZ = Math.min(startZ + 145, targetLimit);
      const existingBranches = this.getActiveBranchData();
      const chunk = generateFairTrackSlice(
        this.level,
        startZ,
        endZ,
        ++this.chunkCounter,
        0,
        this.idCounter,
        this.mode,
        existingBranches,
      );

      const mats = this.getBiomeMaterials();

      // Build REAL curved 3D branching road sections first so obstacles/coins align cleanly along them!
      for (const branch of chunk.branches) {
        const group = buildBranchSectionMesh(branch, mats, this.pathMat, LANE_WIDTH);
        const flames: THREE.Object3D[] = [];
        group.traverse((child) => {
          if (child.name === 'brazier_flame') flames.push(child);
        });
        this.worldRoot.add(group);
        this.branches.push({ data: branch, group, flames });
      }

      const allBranches = this.getActiveBranchData();

      for (const obs of chunk.obstacles) {
        const mesh = buildObstacleMesh(obs.kind, this.level, mats);
        const pt = sampleTrackPoint(allBranches, obs.z, obs.lane * LANE_WIDTH, obs.route);
        mesh.position.set(pt.x, pt.y, pt.worldZ);
        mesh.rotation.y = pt.headingYaw;
        this.worldRoot.add(mesh);
        this.obstacles.push({ data: obs, group: mesh, baseY: pt.y });
      }

      for (const coin of chunk.coins) {
        const mesh = buildCoinMesh(theme);
        if (coin.isBonusTrail) mesh.scale.setScalar(1.22);
        const pt = sampleTrackPoint(allBranches, coin.z, coin.lane * LANE_WIDTH, coin.route);
        mesh.position.set(pt.x, pt.y + coin.y, pt.worldZ);
        this.worldRoot.add(mesh);
        this.coins.push({ data: coin, group: mesh });
      }

      const maxBranchEnd = chunk.branches.reduce((m, b) => Math.max(m, b.endZ + 16), endZ);
      this.generatedUpToZ = Math.min(targetLimit, Math.max(endZ, maxBranchEnd));
      if (this.generatedUpToZ >= targetLimit) break;
    }

    // Cull entities behind camera
    const cullZ = this.sim.z - 26;
    this.obstacles = this.obstacles.filter((item) => {
      if (item.data.z < cullZ) {
        this.worldRoot.remove(item.group);
        return false;
      }
      return true;
    });
    this.coins = this.coins.filter((item) => {
      if (item.data.z < cullZ || item.data.collected) {
        this.worldRoot.remove(item.group);
        return false;
      }
      return true;
    });
    this.turns = this.turns.filter((item) => {
      if (item.data.z < cullZ) {
        this.worldRoot.remove(item.group);
        return false;
      }
      return true;
    });
    this.branches = this.branches.filter((item) => {
      if (item.data.endZ + 20 < cullZ) {
        this.disposeBranchVisual(item);
        return false;
      }
      return true;
    });
  }

  private spawnBurst(pos: THREE.Vector3, count: number, hexColor: string, spread = 4.5): void {
    const cap = this.burstParticles.length;
    const reduced = this.save.settings.accessibility.reducedFlashing;
    const actualCount = reduced ? Math.ceil(count * 0.5) : count;
    for (let i = 0; i < actualCount; i++) {
      const p = this.burstParticles[this.burstCursor % cap];
      this.burstCursor++;
      p.active = true;
      p.pos.copy(pos);
      p.vel.set(
        (Math.random() - 0.5) * spread,
        Math.random() * spread * 0.85 + 1.5,
        (Math.random() - 0.5) * spread,
      );
      p.life = 0.42 + Math.random() * 0.25;
      p.maxLife = p.life;
      p.scale = 0.75 + Math.random() * 0.7;
      p.color.set(hexColor);
    }
  }

  private addTrauma(amount: number): void {
    if (this.save.settings.accessibility.reducedCameraMotion) return;
    const mult = this.save.settings.gameplay.cameraShakeIntensity;
    this.trauma = Math.min(1, this.trauma + amount * mult);
  }

  private handleLaneOrTurn(dir: -1 | 1): void {
    if (this.gameState !== 'playing' || !this.sim.alive) return;

    const activeBranches = this.getActiveBranchData();

    // 1. Grace window right after crossing a fork lip (first 4.5m): let last-millisecond swipes smoothly pivot route!
    if (this.sim.activeBranchId !== null) {
      const curBranch = activeBranches.find((b) => b.id === this.sim.activeBranchId);
      if (curBranch && this.sim.z - curBranch.startZ <= 4.8) {
        const current = this.sim.activeRoute;
        let nextRoute: 'left' | 'center' | 'right' | null = null;
        if (curBranch.hasCenter) {
          if (dir < 0 && current === 'right') nextRoute = 'center';
          else if (dir < 0 && current === 'center') nextRoute = 'left';
          else if (dir > 0 && current === 'left') nextRoute = 'center';
          else if (dir > 0 && current === 'center') nextRoute = 'right';
        } else {
          if (dir < 0 && current !== 'left') nextRoute = 'left';
          else if (dir > 0 && current !== 'right') nextRoute = 'right';
        }
        if (nextRoute) {
          this.sim.activeRoute = nextRoute;
          curBranch.chosenRoute = nextRoute;
          const meta = curBranch.routes.find((r) => r.id === nextRoute);
          if (meta) {
            this.nearMissBanner = meta.label;
            this.nearMissBannerTimer = 1.25;
          }
          this.camRoll = -dir * 0.035;
          this.characterAnimator.triggerTurn(dir);
          this.audio.playTurn();
          return;
        }
      }
    }

    // 2. Approaching a real branching fork: naturally align lane & lock intended Left / Center / Right route!
    const approaching = findApproachingBranch(activeBranches, this.sim.z, 26);
    if (approaching) {
      if (!approaching.hasCenter) {
        // 2-way fork: explicit left/right swipe cleanly commits Left or Right route & glides to matching shoulder!
        const chosen: 'left' | 'right' = dir < 0 ? 'left' : 'right';
        this.sim.pendingBranchChoice = chosen;
        this.sim.lane = dir;
        this.camRoll = -dir * 0.038;
        this.characterAnimator.triggerTurn(dir);
        this.audio.playFootstep(this.getFootstepSurface(this.level.architecture));
        this.advanceTutorial('turn');
        return;
      } else {
        // 3-way fork: lane -1 -> Left, lane 0 -> Center, lane +1 -> Right!
        const nextLane = Math.max(-1, Math.min(1, this.sim.lane + dir)) as -1 | 0 | 1;
        this.sim.lane = nextLane;
        this.sim.pendingBranchChoice = nextLane < 0 ? 'left' : nextLane > 0 ? 'right' : 'center';
        this.camRoll = -dir * 0.038;
        this.characterAnimator.triggerLaneChange(dir);
        this.audio.playFootstep(this.getFootstepSurface(this.level.architecture));
        this.advanceTutorial('turn');
        return;
      }
    }

    // 3. Standard crisp 3-lane shift on straight causeway OR inside an active branch route!
    const nextLane = Math.max(-1, Math.min(1, this.sim.lane + dir)) as -1 | 0 | 1;
    if (nextLane !== this.sim.lane) {
      this.sim.lane = nextLane;
      this.camRoll = -dir * 0.042;
      this.characterAnimator.triggerLaneChange(dir);
      this.addTrauma(0.03);
      this.audio.playFootstep(this.getFootstepSurface(this.level.architecture));
      this.advanceTutorial('lane');
    }
  }

  private getFootstepSurface(arch: ArchitectureStyle): FootstepSurface {
    switch (arch) {
      case 'ice_spires':
      case 'crystal_caverns':
        return 'snow';
      case 'drowned_arches':
      case 'storm_monoliths':
      case 'nightfall_city':
        return 'wet_stone';
      case 'canyon_bridges':
      case 'whispering_woods':
      case 'giant_canopy':
        return 'wood';
      case 'iron_mines':
      case 'infernal_fortress':
      case 'shattered_realm':
        return 'metal';
      case 'desert_pylons':
      case 'volcanic_obelisks':
        return 'sand';
      case 'hollow_ribs':
      case 'lost_ziggurat':
        return 'cave';
      case 'jungle_temple':
        return 'dirt';
      case 'golden_aqueduct':
      case 'colossus_sanctuary':
      case 'sky_colonnade':
      case 'last_sanctuary':
      default:
        return 'stone';
    }
  }

  private handleJump(): void {
    if (this.gameState !== 'playing' || !this.sim.alive) return;
    const charDef = getCharacterById(this.save.selectedCharacter);
    const res = triggerPlayerJump(this.sim, charDef.abilityId);
    if (res === 'jump' || res === 'double_jump') {
      this.jumpsCount++;
      this.squashX = 0.9;
      this.squashY = 1.1;
      this.characterAnimator.triggerJump(res === 'double_jump');
      this.audio.playJump(res === 'double_jump', charDef.gender);
      this.addTrauma(0.04);
      const p = this.getPlayerCameraCoords();
      this._v1.set(p.x, p.y + 0.15, p.z);
      this.spawnBurst(this._v1, res === 'double_jump' ? 10 : 5, res === 'double_jump' ? '#38bdf8' : '#d6cfc2', 3.2);
      this.advanceTutorial('jump');
    }
  }

  private handleSlide(): void {
    if (this.gameState !== 'playing' || !this.sim.alive) return;
    const charDef = getCharacterById(this.save.selectedCharacter);
    if (triggerPlayerSlide(this.sim)) {
      this.slidesCount++;
      this.squashX = 1.08;
      this.squashY = 0.92;
      this.characterAnimator.triggerSlide();
      this.audio.playSlide(charDef.gender, this.getFootstepSurface(this.level.architecture));
      const p = this.getPlayerCameraCoords();
      this._v1.set(p.x, p.centerY + 0.15, p.z + 0.3);
      this.spawnBurst(this._v1, 6, '#d6d3d1', 3.5);
      this.advanceTutorial('slide');
    }
  }

  private handleAbilityPress(): void {
    if (this.gameState !== 'playing' || !this.sim.alive) return;
    const charDef = getCharacterById(this.save.selectedCharacter);
    const lvl = this.save.abilityLevels[charDef.abilityId] ?? 1;
    if (activateCharacterAbility(this.sim, charDef.abilityId, lvl)) {
      this.abilitiesUsed++;
      this.characterAnimator.triggerAbility();
      this.audio.playAbilityActivate(charDef.gender);
      this.audio.vibrate(35, this.save.settings.gameplay.haptics);
      this.addTrauma(0.18);
      const p = this.getPlayerCameraCoords();
      this._v1.set(p.x, p.y + 1.0, p.z);
      this.spawnBurst(this._v1, 14, '#facc15', 5.2);
      this.nearMissBanner = `${charDef.abilityName.toUpperCase()} ACTIVE`;
      this.nearMissBannerTimer = 1.3;
      this.advanceTutorial('ability');
    }
  }

  private advanceTutorial(action: 'lane' | 'jump' | 'slide' | 'turn' | 'coins' | 'ability' | 'chase'): void {
    if (this.mode !== 'tutorial') return;
    const step = TUTORIAL_STEPS[this.tutorialStepIdx];
    if (step && step.requiredAction === action) {
      this.tutorialStepIdx = Math.min(TUTORIAL_STEPS.length - 1, this.tutorialStepIdx + 1);
      this.tutorialStepTimer = 0;
      this.audio.playUiPurchase();
    }
  }

  private updateSimulation(dt: number): void {
    const nowSec = performance.now() * 0.001;
    this.windUniform.value = nowSec;
    const skyUniforms = (this.skyMesh.material as THREE.ShaderMaterial).uniforms;
    if (skyUniforms.uTime) skyUniforms.uTime.value = nowSec;

    if (this.gameState === 'title') {
      // Heroic 3/4 cinematic showcase camera framing Explorer's full human silhouette & Angkor vista
      const t = nowSec;
      const sway = Math.sin(t * 0.38) * 0.68;
      this.camera.position.set(1.16 + sway * 0.32, 2.18 + Math.sin(t * 0.62) * 0.06, 4.35);
      this.camera.lookAt(0, 1.38, -5.0);

      const charDef = getCharacterById(this.save.selectedCharacter);
      this.playerRig.root.position.set(0, 0, 0);
      this.playerRig.root.rotation.y = 0.24;
      this.playerRig.bodyPivot.position.set(0, 0, 0);
      this.playerRig.bodyPivot.rotation.set(0, 0, 0);
      this.playerRig.bodyPivot.scale.set(charDef.shoulderScale, charDef.heightScale, charDef.shoulderScale);

      this.characterAnimator.update(dt, {
        mode: 'idle',
        speed: 0,
        dz: 0,
        lateralVel: 0,
        vy: 0,
        y: 0,
        grounded: true,
        sliding: false,
        stumbleTimer: 0,
        abilityActive: false,
        strideFrequency: charDef.strideFrequency,
        leanStyle: charDef.leanStyle,
      });
      applySkeletonPoseToRig(this.characterAnimator.currentPose, this.playerRig);

      this.livingWorld?.update({
        dt,
        timeSec: nowSec,
        playerTrackZ: 0,
        runnerSpeed: 0,
        isPlaying: false,
        introActive: false,
        branches: [],
      });
      this.updateWeatherAndParticles(dt, 3.5);
      return;
    }

    if (this.gameState !== 'playing') return;

    // Hitstop ticks in real dt while simulation freezes for crisp impact weight
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      this.updateCamera(dt);
      this.updateWeatherAndParticles(dt, 0);
      return;
    }

    // Handle post-death articulated skeletal collapse before showing Game Over modal
    if (!this.sim.alive) {
      this.deathDelayTimer -= dt;
      const charDef = getCharacterById(this.save.selectedCharacter);
      this.characterAnimator.update(dt, {
        mode: 'dead',
        speed: 0,
        dz: 0,
        lateralVel: 0,
        vy: 0,
        y: this.sim.y,
        grounded: true,
        sliding: false,
        stumbleTimer: 0,
        abilityActive: false,
        strideFrequency: charDef.strideFrequency,
        leanStyle: charDef.leanStyle,
      });
      applySkeletonPoseToRig(this.characterAnimator.currentPose, this.playerRig);
      this.updateCamera(dt);
      this.updateWeatherAndParticles(dt, 2);
      if (this.deathDelayTimer <= 0) {
        this.finishRun(false);
      }
      return;
    }

    this.runDuration += dt;
    const charDef = getCharacterById(this.save.selectedCharacter);
    const abilityLvl = this.save.abilityLevels[charDef.abilityId] ?? 1;

    // Smooth 5-phase gradual speed progression across distance (zero sudden spikes!)
    const targetDist = this.mode === 'tutorial' ? 420 : this.level.targetDistance;
    const progressRatio = this.mode === 'endless' ? Math.min(1, this.sim.z / 2600) : Math.min(1, this.sim.z / targetDist);
    const rushBoost = charDef.abilityId === 'rush' && this.sim.abilityActiveTimer > 0 ? 1.32 : 1.0;
    const stumbleSlow = this.sim.stumbleTimer > 0 ? 0.72 : 1.0;
    const baseTargetSpeed = computeProgressiveSpeed(this.level, this.sim.z, this.mode);
    const desiredSpeed = baseTargetSpeed * rushBoost * stumbleSlow;
    this.sim.speed = THREE.MathUtils.damp(this.sim.speed, desiredSpeed, 4.0, dt);

    // Advance forward distance along path
    const dz = this.sim.speed * dt;
    this.sim.z += dz;

    // Stream upcoming track & real 3D branches before resolving branch entry/merge!
    this.streamAheadTrack();
    const activeBranches = this.getActiveBranchData();

    // Real Branching Path & Scenic S-Curve State Machine: smoothly enter Left/Center/Right route & merge back to Main!
    if (this.sim.activeBranchId === null) {
      for (const b of activeBranches) {
        if (!b.resolved && this.sim.z >= b.startZ && this.sim.z < b.endZ) {
          const isSingleScenic = b.routes.length === 1;
          const chosen = isSingleScenic
            ? b.routes[0].id
            : (this.sim.pendingBranchChoice ?? selectBranchRoute(b, this.sim.lane));
          b.chosenRoute = chosen;
          b.resolved = true;
          this.sim.activeRoute = chosen;
          this.sim.activeBranchId = b.id;
          this.sim.pendingBranchChoice = null;
          if (!isSingleScenic) {
            // Recenter lane target cleanly so player has full 3-lane mobility on their chosen branch!
            this.sim.lane = 0;
          }
          const meta = b.routes.find((r) => r.id === chosen);
          if (meta) {
            this.nearMissBanner = meta.label;
            this.nearMissBannerTimer = isSingleScenic ? 1.15 : 1.5;
          }
          if (!isSingleScenic && chosen !== 'center') {
            this.secretPathsFound++;
            this.characterAnimator.triggerTurn(chosen === 'left' ? -1 : 1);
            this.audio.playTurn();
            this.addTrauma(0.07);
          }
          this.advanceTutorial('turn');
          break;
        }
      }
    } else {
      const curBranch = activeBranches.find((b) => b.id === this.sim.activeBranchId);
      if (!curBranch || this.sim.z >= curBranch.endZ) {
        if (curBranch) curBranch.merged = true;
        this.sim.activeRoute = 'main';
        this.sim.activeBranchId = null;
        this.sim.pendingBranchChoice = null;
      }
    }

    // Lateral lane damping (local to current route's centerline!)
    const targetX = this.sim.lane * LANE_WIDTH;
    const prevX = this.sim.x;
    this.sim.x = THREE.MathUtils.damp(this.sim.x, targetX, 15, dt);
    const lateralVel = (this.sim.x - prevX) / Math.max(0.001, dt);

    // Timers
    if (this.sim.invulnerableTimer > 0) this.sim.invulnerableTimer = Math.max(0, this.sim.invulnerableTimer - dt);
    if (this.sim.stumbleTimer > 0) this.sim.stumbleTimer = Math.max(0, this.sim.stumbleTimer - dt);
    if (this.sim.slideTimer > 0) this.sim.slideTimer = Math.max(0, this.sim.slideTimer - dt);
    if (this.nearMissBannerTimer > 0) {
      this.nearMissBannerTimer = Math.max(0, this.nearMissBannerTimer - dt);
      if (this.nearMissBannerTimer === 0) this.nearMissBanner = '';
    }

    // Ability duration & recharge
    if (this.sim.abilityActiveTimer > 0) {
      this.sim.abilityActiveTimer = Math.max(0, this.sim.abilityActiveTimer - dt);
      if (this.sim.abilityActiveTimer === 0 && charDef.abilityId === 'shield') {
        this.sim.shieldCharges = 0;
      }
    } else if (this.sim.abilityCharge < 100) {
      const cd = getAbilityCooldownSec(charDef.abilityId, abilityLvl);
      this.sim.abilityCharge = Math.min(100, this.sim.abilityCharge + (100 / cd) * dt);
    }

    // Vertical physics (gravity, coyote time, jump buffer, landing squash)
    if (this.sim.grounded) {
      this.sim.coyoteTimer = COYOTE_TIME;
      if (this.sim.jumpBufferTimer > 0) {
        this.handleJump();
      }
    } else {
      this.sim.coyoteTimer = Math.max(0, this.sim.coyoteTimer - dt);
      this.sim.jumpBufferTimer = Math.max(0, this.sim.jumpBufferTimer - dt);
      this.sim.vy -= GRAVITY * dt;
      this.sim.y += this.sim.vy * dt;
      if (this.sim.y <= 0) {
        const hardLand = this.sim.vy < -18;
        this.sim.y = 0;
        this.sim.vy = 0;
        this.sim.grounded = true;
        this.sim.doubleJumpUsed = false;
        this.squashX = hardLand ? 1.09 : 1.05;
        this.squashY = hardLand ? 0.91 : 0.95;
        this.characterAnimator.triggerLanding(hardLand);
        this.audio.playLand(hardLand, charDef.gender, this.getFootstepSurface(this.level.architecture));
        this.addTrauma(hardLand ? 0.11 : 0.04);
        const p = this.getPlayerCameraCoords();
        this._v1.set(p.x, p.centerY + 0.08, p.z);
        this.spawnBurst(this._v1, hardLand ? 8 : 4, '#d6cfc2', 3.4);
      }
    }

    // Mandatory Opening Hollow Chase countdown (~2.85s) -> smoothly drops back once explorer breaks away
    if (this.sim.introChaseTimer > 0) {
      this.sim.introChaseTimer = Math.max(0, this.sim.introChaseTimer - dt);
    }

    // The Hollow pursuer dynamics (roars close during Opening Chase Beats 1-2 & stumbles, recedes cleanly when running strong)
    const hollowTargetDist =
      this.sim.introChaseTimer > 0.95
        ? 4.45
        : this.sim.introChaseTimer > 0
          ? 7.2
          : this.sim.stumbleTimer > 0
            ? 3.0
            : 18.0;
    const hollowRate = this.sim.introChaseTimer > 0 ? 2.1 : this.sim.stumbleTimer > 0 ? 3.5 : 0.42;
    this.sim.hollowDistance = THREE.MathUtils.damp(this.sim.hollowDistance, hollowTargetDist, hollowRate, dt);
    const threat = Math.max(0, Math.min(1, 1 - (this.sim.hollowDistance - 2.5) / 14));
    this.audio.setIntensity(Math.max(progressRatio * 0.7, threat));
    if (threat > 0.58) {
      this.audio.playHollowGrowl(threat);
    }

    // Endless Mode seamless evolving environments: cycle into the next world biome every ~340m on straightaways!
    if (this.mode === 'endless' && this.sim.activeBranchId === null && this.sim.z >= 320) {
      const targetBiomeId = getEndlessBiomeLevelId(this.sim.z, this.endlessStartLevelId);
      if (targetBiomeId !== this.level.id) {
        this.level = getLevelById(targetBiomeId);
        this.applyEnvironment(this.level);
        this.audio.startEnvironmentSoundtrack(this.level);
        this.nearMissBanner = `ENTERING ${this.level.name.toUpperCase()}`;
        this.nearMissBannerTimer = 2.1;
      }
    }

    // Tutorial auto-progression for passive observation steps (chase, turn)
    if (this.mode === 'tutorial') {
      this.tutorialStepTimer += dt;
      const curStep = TUTORIAL_STEPS[this.tutorialStepIdx];
      if (curStep && (curStep.requiredAction === 'chase' || curStep.requiredAction === 'turn') && this.tutorialStepTimer > 4.5) {
        this.advanceTutorial(curStep.requiredAction);
      }
    }

    // Scroll world & infinite road pieces relative to player, clearing straight meshes inside active curved branch zones!
    this.worldRoot.position.z = this.sim.z;
    this.roadScrollUniform.value = this.sim.z;
    const density = this.save.settings.graphics.foliageDensity;

    for (const seg of this.trackPieces) {
      const worldZ = seg.position.z + this.sim.z;
      if (worldZ > 42) {
        seg.position.z -= this.trackPieces.length * 24;
      }
      // Hide straight road piece inside any branch section (buildBranchSectionMesh renders the real curved decks!)
      const segTrackZ = -seg.position.z;
      seg.visible = !isZInsideBranchZone(activeBranches, segTrackZ, 2);
    }

    for (let i = 0; i < this.landmarks.length; i++) {
      const lm = this.landmarks[i];
      const worldZ = lm.group.position.z + this.sim.z;
      if (worldZ > 32) {
        lm.group.position.z -= 20 * 11;
      }
      const lmTrackZ = -lm.group.position.z;
      const inBranch = isZInsideBranchZone(activeBranches, lmTrackZ, 14);
      // Push jungle trees & ruin shrines outside the Left/Right branch corridors so ZERO trees block roads or camera!
      lm.group.position.x = inBranch
        ? lm.side * (lm.baseLateral + 13.5)
        : lm.side * lm.baseLateral;
      lm.group.visible = (i % 10) / 10 < density;
    }

    for (const af of this.archFrames) {
      const worldZ = af.group.position.z + this.sim.z;
      if (worldZ > 30) {
        af.group.position.z -= 5 * 44;
      }
      // Keep overhead straight temple arches completely clear of branching fork/curve/merge zones!
      const afTrackZ = -af.group.position.z;
      af.group.visible = !isZInsideBranchZone(activeBranches, afTrackZ, 14);
    }

    // Recycle roadside boulders & multi-species tropical clusters seamlessly outside branch corridors
    let rocksDirty = false;
    for (let i = 0; i < this.scatterRockData.length; i++) {
      const d = this.scatterRockData[i];
      if (d.z + this.sim.z > 18) {
        d.z -= this.scatterRockData.length * 3.8;
        d.x = isZInsideBranchZone(activeBranches, -d.z, 14) ? d.baseX + Math.sign(d.baseX) * 14.5 : d.baseX;
        this._dummy.position.set(d.x, d.y, d.z);
        this._dummy.rotation.set(0.15, d.ry, 0.1);
        this._dummy.scale.set(d.sx, d.sy, d.sz);
        this._dummy.updateMatrix();
        this.scatterRocks.setMatrixAt(i, this._dummy.matrix);
        rocksDirty = true;
      }
    }
    if (rocksDirty) this.scatterRocks.instanceMatrix.needsUpdate = true;

    let shrubsDirty = false;
    for (let i = 0; i < this.scatterFoliageData.length; i++) {
      const d = this.scatterFoliageData[i];
      if (d.z + this.sim.z > 18) {
        d.z -= this.scatterFoliageData.length * 2.55;
        d.x = isZInsideBranchZone(activeBranches, -d.z, 14) ? d.baseX + Math.sign(d.baseX) * 14.5 : d.baseX;
        this._dummy.position.set(d.x, d.y, d.z);
        this._dummy.rotation.set(0, d.ry, 0);
        this._dummy.scale.set(d.s, d.s * 0.92, d.s);
        this._dummy.updateMatrix();
        this.scatterFoliage.setMatrixAt(i, this._dummy.matrix);
        shrubsDirty = true;
      }
    }
    if (shrubsDirty) this.scatterFoliage.instanceMatrix.needsUpdate = true;

    let canopyDirty = false;
    for (let i = 0; i < this.scatterCanopyData.length; i++) {
      const d = this.scatterCanopyData[i];
      if (d.z + this.sim.z > 18) {
        d.z -= this.scatterCanopyData.length * 4.1;
        d.x = isZInsideBranchZone(activeBranches, -d.z, 14) ? d.baseX + Math.sign(d.baseX) * 14.5 : d.baseX;
        this._dummy.position.set(d.x, d.y, d.z);
        this._dummy.rotation.set(0, d.ry, 0);
        this._dummy.scale.set(d.s, d.s * 0.96, d.s);
        this._dummy.updateMatrix();
        this.scatterCanopy.setMatrixAt(i, this._dummy.matrix);
        canopyDirty = true;
      }
    }
    if (canopyDirty) this.scatterCanopy.instanceMatrix.needsUpdate = true;

    // Update texture UV scroll on terrain flanks for seamless infinite horizon
    if (this.envTextures) {
      const uvOff = -(this.sim.z * 0.035) % 1;
      this.envTextures.terrainMap.offset.y = uvOff;
      this.envTextures.terrainNormal.offset.y = uvOff;
      this.envTextures.terrainRoughness.offset.y = uvOff;
    }

    // Update & check route-matched coins (Magnet + Eagle Scavenger + Wider Radius)
    this.updateCoins(dt, charDef.abilityId);

    // Update & check route-matched obstacles + fork scout alerts
    this.updateObstaclesAndTurns(dt, charDef.abilityId);

    // Update articulated character animation, Eagle companion, Hollow pursuer, and directional shadows
    this.updateActorsAnimation(dt, dz, lateralVel, charDef);

    // Update living world wildlife & corrupted vegetation (LOD-throttled, branch-safe, zero-GC)
    this.livingWorld?.update({
      dt,
      timeSec: nowSec,
      playerTrackZ: this.sim.z,
      runnerSpeed: this.sim.speed,
      isPlaying: true,
      introActive: this.sim.introChaseTimer > 0,
      branches: activeBranches,
    });

    // Update tangent-following chase camera, pooled particles & dynamic environmental events
    this.updateCamera(dt);
    this.updateWeatherAndParticles(dt, this.sim.speed);
    this.updateDynamicEnvironmentalEvents(dt, nowSec);

    // Check Campaign / Tutorial victory completion!
    if ((this.mode === 'campaign' || this.mode === 'tutorial') && this.sim.z >= targetDist) {
      this.finishRun(true);
      return;
    }

    // Emit HUD at ~10Hz to keep React decoupled from 60fps simulation
    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.095) {
      this.hudEmitAccum = 0;
      this.emitHud();
    }
  }

  private updateCoins(dt: number, abilityId: string): void {
    const magnetOn = abilityId === 'magnet' && this.sim.abilityActiveTimer > 0;
    const pullRadius = magnetOn ? 11.5 : 1.55;
    const now = performance.now() * 0.003;
    const p = this.getPlayerCameraCoords();

    for (const item of this.coins) {
      if (item.data.collected) continue;
      item.group.rotation.y = now + item.data.id * 0.4;

      // Only pull/collect coins on the player's current route (or main road)!
      const onPlayerRoute =
        item.data.route === 'main' ||
        (item.data.route === this.sim.activeRoute &&
          (item.data.branchId === undefined || item.data.branchId === this.sim.activeBranchId));
      if (!onPlayerRoute) continue;

      const coinCamZ = item.group.position.z + this.sim.z;
      const dx = item.group.position.x - p.x;
      const dy = item.group.position.y - (p.y + 0.95);
      const dz = coinCamZ - p.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < pullRadius * pullRadius && dz > -3.2 && dz < pullRadius) {
        const pullSpeed = magnetOn ? 22 : 13;
        item.group.position.x = THREE.MathUtils.damp(item.group.position.x, p.x, pullSpeed, dt);
        item.group.position.y = THREE.MathUtils.damp(item.group.position.y, p.y + 0.95, pullSpeed, dt);
        item.group.position.z = THREE.MathUtils.damp(item.group.position.z, -this.sim.z + p.z, pullSpeed, dt);
      }

      if (distSq < 1.42 * 1.42) {
        item.data.collected = true;
        item.group.visible = false;
        this.runCoins += item.data.value;
        this.sim.abilityCharge = Math.min(100, this.sim.abilityCharge + 1.8);
        this.audio.playCoin(Boolean(item.data.isBonusTrail));
        this._v1.set(p.x, p.y + 1.0, p.z);
        this.spawnBurst(this._v1, item.data.isBonusTrail ? 7 : 3, '#fde047', 3.0);
        if (this.runCoins >= 8) this.advanceTutorial('coins');
      }
    }
  }

  private updateObstaclesAndTurns(dt: number, abilityId: string): void {
    const t = performance.now() * 0.001;
    const activeBranches = this.getActiveBranchData();

    for (const item of this.obstacles) {
      const obs = item.data;
      const distAhead = obs.z - this.sim.z;
      let obsLocalX = obs.lane * LANE_WIDTH;

      // Animate dynamic obstacles cleanly along their own route (straight OR curved branch!)
      if (obs.kind === 'moving_block') {
        obsLocalX = Math.sin(t * 2.1 + obs.phase) * LANE_WIDTH;
        const pt = sampleTrackPoint(activeBranches, obs.z, obsLocalX, obs.route);
        item.group.position.set(pt.x, pt.y, pt.worldZ);
        item.group.rotation.y = pt.headingYaw;
      } else if (obs.kind === 'swinging_blade') {
        const swingAngle = Math.sin(t * 2.8 + obs.phase) * 0.72;
        const pend = item.group.getObjectByName('pendulum');
        if (pend) pend.rotation.z = swingAngle;
        // 1:1 live pendulum bob X offset so hitbox matches the swinging blade exactly!
        obsLocalX = Math.sin(swingAngle) * 3.45;
      } else if (obs.kind === 'rotating_spinner') {
        const rotor = item.group.getObjectByName('rotor');
        if (rotor) rotor.rotation.y += dt * 3.1;
      } else if (obs.kind === 'mine_cart' && distAhead < 55 && distAhead > -12) {
        obs.z -= dt * 7.5;
        const pt = sampleTrackPoint(activeBranches, obs.z, obsLocalX, obs.route);
        item.group.position.set(pt.x, pt.y, pt.worldZ);
        item.group.rotation.y = pt.headingYaw;
      } else if (obs.kind === 'falling_debris' && distAhead < 30 && distAhead > -5) {
        const rock = item.group.getObjectByName('debris_rock');
        if (rock) {
          const dropT = Math.max(0, Math.min(1, (30 - distAhead) / 14));
          rock.position.y = THREE.MathUtils.lerp(7.5, 1.0, dropT * dropT);
        }
      } else if (obs.kind === 'collapsing_floor' && distAhead < 11 && !obs.collapsed) {
        item.group.position.y = item.baseY - Math.max(0, (11 - distAhead) * 0.06);
        item.group.rotation.z = Math.sin(t * 36) * 0.06;
        if (distAhead < 2) {
          obs.collapsed = true;
          this.audio.playCollapse();
          this.addTrauma(0.22);
        }
      } else if (obs.kind === 'fire_vent') {
        const flame = item.group.getObjectByName('flame');
        if (flame) flame.scale.y = 0.8 + Math.sin(t * 14 + obs.phase) * 0.25;
      }

      // Only collide obstacles belonging to the player's active route!
      const onPlayerRoute =
        obs.route === 'main' ||
        (obs.route === this.sim.activeRoute &&
          (obs.branchId === undefined || obs.branchId === this.sim.activeBranchId));
      if (!onPlayerRoute) continue;

      // 1:1 Visual-to-Hitbox Collision check in route-local coordinates (accurate on straight, curved, and elevated routes!)
      const zHalf = obs.kind === 'narrow_bridge' ? 4.1 : obs.kind === 'gap' ? 1.85 : 0.85;
      if (!obs.hit && Math.abs(distAhead) < zHalf) {
        const playerTop = this.sim.y + (this.sim.slideTimer > 0 ? 0.72 : 1.72);
        const playerBottom = this.sim.y;
        const xDiff = Math.abs(this.sim.x - obsLocalX);

        let collided = false;
        let lethal = true;

        switch (obs.kind) {
          case 'low_barrier':
            collided = playerBottom < 0.88;
            lethal = false; // Tripping on low barrier stumbles first!
            break;
          case 'high_arch':
            collided = playerTop > 1.24;
            lethal = true;
            break;
          case 'gap':
            collided = playerBottom < 0.28;
            lethal = true;
            break;
          case 'narrow_bridge':
            collided = Math.abs(this.sim.x) > 1.25 && playerBottom < 0.3;
            lethal = true;
            break;
          case 'collapsing_floor':
            collided = xDiff < 1.05 && playerBottom < 0.3;
            lethal = false;
            break;
          case 'spike_trap':
          case 'fire_vent':
            collided = xDiff < 0.92 && playerBottom < 0.82;
            lethal = true;
            break;
          default:
            collided = xDiff < 0.95 && playerBottom < obs.height - 0.15;
            lethal = obs.kind !== 'rotating_spinner';
            break;
        }

        if (collided) {
          obs.hit = true;
          const outcome = this.handleImpact(lethal, `Hit ${obs.kind.replace('_', ' ')}`, abilityId);
          if (outcome === 'rush_smashed') {
            item.group.visible = false;
            const p = this.getPlayerCameraCoords();
            this._v1.set(p.x, p.y + 1.2, p.z - distAhead);
            this.spawnBurst(this._v1, 18, this.level.palette.hazardGlow, 7.5);
          }
        } else if (!obs.nearMissed && xDiff < 1.55 && obs.kind !== 'high_arch' && obs.kind !== 'low_barrier' && obs.kind !== 'gap') {
          obs.nearMissed = true;
          this.nearMisses++;
          this.runCoins += 5;
          this.sim.abilityCharge = Math.min(100, this.sim.abilityCharge + 6);
          const charDef = getCharacterById(this.save.selectedCharacter);
          this.characterAnimator.triggerNearMiss(this.sim.x >= obsLocalX ? 1 : -1);
          this.audio.playNearMiss(charDef.gender);
          this.addTrauma(0.12);
          this.nearMissBanner = 'NEAR MISS +5';
          this.nearMissBannerTimer = 0.85;
        }
      }

      // Count cleanly passed obstacles
      if (!obs.passed && distAhead < -zHalf - 0.4) {
        obs.passed = true;
        if (!obs.hit) {
          this.obstaclesAvoided++;
        }
      }
    }
  }

  private handleImpact(lethal: boolean, reason: string, abilityId: string): string {
    const charDef = getCharacterById(this.save.selectedCharacter);
    const res = resolveObstacleImpact(
      this.sim,
      abilityId as 'magnet' | 'rush' | 'shield' | 'double_jump',
      lethal,
    );

    if (res === 'ignored') return res;

    if (res === 'rush_smashed') {
      this.audio.playCollision(false, charDef.gender);
      this.addTrauma(0.24);
      this.hitstopTimer = 0.035;
      this.nearMissBanner = 'RUSH SMASH!';
      this.nearMissBannerTimer = 0.8;
      return res;
    }

    const p = this.getPlayerCameraCoords();

    if (res === 'shield_absorbed') {
      this.characterAnimator.triggerCollision(false);
      this.audio.playShieldBreak();
      this.audio.vibrate([40, 30, 40], this.save.settings.gameplay.haptics);
      this.addTrauma(0.32);
      this.hitstopTimer = 0.05;
      this._v1.set(p.x, p.y + 1.1, p.z);
      this.spawnBurst(this._v1, 20, '#38bdf8', 6.5);
      this.nearMissBanner = 'SHIELD ABSORBED!';
      this.nearMissBannerTimer = 1.1;
      return res;
    }

    if (res === 'stumble') {
      this.stumblesCount++;
      this.characterAnimator.triggerCollision(true);
      this.audio.playCollision(false, charDef.gender);
      this.audio.playHollowRoar(0.95);
      this.audio.vibrate(70, this.save.settings.gameplay.haptics);
      this.addTrauma(0.45);
      this.hitstopTimer = 0.05;
      this.nearMissBanner = 'THE HOLLOW APPROACHES!';
      this.nearMissBannerTimer = 1.3;
      this.advanceTutorial('chase');
      return res;
    }

    // Death
    this.causeOfDeath = reason;
    this.deathDelayTimer = 0.72;
    this.hitstopTimer = 0.07;
    this.characterAnimator.triggerDeath();
    this.addTrauma(0.75);
    this.audio.playCollision(true, charDef.gender);
    this.audio.playGameOverSting();
    this.audio.vibrate([120, 40, 140], this.save.settings.gameplay.haptics);
    this._v1.set(p.x, p.y + 0.9, p.z);
    this.spawnBurst(this._v1, 26, this.level.palette.hazardGlow, 7.0);
    return res;
  }

  private updateActorsAnimation(dt: number, dz: number, lateralVel: number, charDef: ReturnType<typeof getCharacterById>): void {
    // Decay subtle elastic squash-and-stretch smoothly
    this.squashX = THREE.MathUtils.damp(this.squashX, 1, 13, dt);
    this.squashY = THREE.MathUtils.damp(this.squashY, 1, 13, dt);

    const activeBranches = this.getActiveBranchData();
    const pose = sampleRoutePose(activeBranches, this.sim.z, this.sim.activeRoute);
    const playerCamX = pose.centerX + pose.rightX * this.sim.x;
    const playerCamY = pose.centerY + this.sim.y;
    const playerCamZ = pose.rightZ * this.sim.x;

    // Position player rig cleanly along straight OR curved/elevated branching causeways!
    this.playerRig.root.position.set(playerCamX, playerCamY, playerCamZ);
    this.playerRig.root.rotation.y = pose.headingYaw;
    this.playerRig.contactShadow.position.y = -this.sim.y + 0.03;
    const shadowScale = Math.max(0.42, 1 - this.sim.y * 0.13);
    this.playerRig.contactShadow.scale.setScalar(shadowScale);

    // Keep dappled canopy illumination, shadow frustum, sky dome & distant vista aligned with active route!
    this.activeCenterXUniform.value = pose.centerX;
    this.sunLight.position.set(playerCamX + 22, pose.centerY + 34, -18);
    this.sunLight.target.position.set(playerCamX, pose.centerY, -4);
    this.sunLight.target.updateMatrixWorld();
    this.skyMesh.position.set(playerCamX, 0, 0);
    if (this.distantVista) {
      this.distantVista.position.x = playerCamX * 0.45;
    }

    // 20-State Blended Skeletal Character Animator (speed-matched stride, zero foot sliding, zero snapping)
    const animEvents = this.characterAnimator.update(dt, {
      mode: this.sim.alive ? 'playing' : 'dead',
      speed: this.sim.speed,
      dz,
      lateralVel,
      vy: this.sim.vy,
      y: this.sim.y,
      grounded: this.sim.grounded,
      sliding: this.sim.slideTimer > 0,
      stumbleTimer: this.sim.stumbleTimer,
      abilityActive: this.sim.abilityActiveTimer > 0,
      strideFrequency: charDef.strideFrequency,
      leanStyle: charDef.leanStyle,
      headingTurnRate: pose.slopeX,
    });

    const pivot = this.playerRig.bodyPivot;
    pivot.position.set(0, 0, 0);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(
      charDef.shoulderScale * this.squashX,
      charDef.heightScale * this.squashY,
      charDef.shoulderScale,
    );
    applySkeletonPoseToRig(this.characterAnimator.currentPose, this.playerRig);

    // Synchronize footsteps, breathing, and gear foley strictly to animation contact frames!
    if (animEvents.footstep && this.sim.grounded && this.sim.slideTimer <= 0 && this.sim.alive && dz > 0.001) {
      const surface = this.getFootstepSurface(this.level.architecture);
      this.audio.playFootstep(surface);
      const dustColor =
        surface === 'snow'
          ? '#dbeafe'
          : surface === 'wet_stone'
            ? '#93c5fd'
            : surface === 'sand'
              ? '#e4c896'
              : '#9e8b6f';
      const footSideX = animEvents.footstep === 'left' ? -0.14 : 0.14;
      this._v1.set(playerCamX + footSideX, pose.centerY + 0.11, playerCamZ + 0.22);
      this.spawnBurst(this._v1, 2, dustColor, 1.35);
    }
    if (animEvents.breath && this.sim.alive) {
      const kind =
        animEvents.breath === 'recovery'
          ? 'recovery_breath'
          : animEvents.breath === 'light'
            ? 'light_breath'
            : 'breath';
      this.audio.playHumanEffort(kind, charDef.gender);
    }
    if (animEvents.gearRustle && this.sim.alive) {
      this.audio.playGearRustle(0.65);
    }

    // Ability FX visuals
    const abilityActive = this.sim.abilityActiveTimer > 0;
    this.playerRig.shieldMesh.visible = this.sim.shieldCharges > 0;
    if (this.playerRig.shieldMesh.visible) {
      this.playerRig.shieldMesh.rotation.y += dt * 1.8;
    }
    this.playerRig.magnetRing.visible = abilityActive && charDef.abilityId === 'magnet';
    if (this.playerRig.magnetRing.visible) {
      this.playerRig.magnetRing.rotation.z += dt * 4.5;
    }
    this.playerRig.rushCone.visible = abilityActive && charDef.abilityId === 'rush';

    // Subtle invulnerability blink cue after stumble
    this.playerRig.root.visible = this.sim.invulnerableTimer <= 0 || Math.floor(performance.now() / 65) % 2 === 0;

    // The Hollow Ancient Guardian Pursuer follows seamlessly along the SAME chosen branch route!
    const hollowVisible = this.sim.introChaseTimer > 0 || this.sim.hollowDistance < 16.5;
    this.hollowRig.root.visible = hollowVisible;
    if (hollowVisible) {
      const hollowZ = Math.max(0, this.sim.z - this.sim.hollowDistance);
      const hPose = sampleRoutePose(activeBranches, hollowZ, this.sim.activeRoute);
      const hTargetX = hPose.centerX + hPose.rightX * this.sim.x;
      const hTargetZ = this.sim.hollowDistance + hPose.rightZ * this.sim.x;
      this.hollowRig.root.position.set(
        THREE.MathUtils.damp(this.hollowRig.root.position.x, hTargetX, 6.2, dt),
        hPose.centerY,
        hTargetZ,
      );
      this.hollowRig.root.rotation.y = hPose.headingYaw;
      const hPhase = this.characterAnimator.runPhase * 0.56;
      const hSin = Math.sin(hPhase);
      this.hollowRig.leftLeg.rotation.x = hSin * 0.72;
      this.hollowRig.rightLeg.rotation.x = -hSin * 0.72;

      // Dramatic roar lift & opening jaw during Opening Hollow Chase Beats 1-2 or lunge
      const introRoarWeight =
        this.sim.introChaseTimer > 1.35
          ? 1.0
          : this.sim.introChaseTimer > 0.75
            ? (this.sim.introChaseTimer - 0.75) / 0.6
            : this.sim.stumbleTimer > 0
              ? 0.65
              : 0;
      this.hollowRig.leftArm.rotation.x = -hSin * 0.85 - 0.35 - introRoarWeight * 0.58;
      this.hollowRig.rightArm.rotation.x = hSin * 0.85 - 0.35 - introRoarWeight * 0.58;
      this.hollowRig.torso.position.y = 1.9 + Math.abs(Math.cos(hPhase)) * 0.24;
      this.hollowRig.torso.rotation.z = hSin * 0.06;
      this.hollowRig.torso.rotation.x = introRoarWeight > 0.1 ? -0.18 * introRoarWeight : 0.08;
      this.hollowRig.jaw.rotation.x = 0.06 + introRoarWeight * 0.44 + Math.abs(hSin) * 0.07;
      this.hollowRig.coreMesh.rotation.y += dt * 2.4;

      if ((this.lastHollowStompSin <= 0 && hSin > 0) || (this.lastHollowStompSin >= 0 && hSin < 0)) {
        const prox = Math.max(0.15, 1 - this.sim.hollowDistance / 16);
        this.audio.playHollowStomp(prox);
        if (prox > 0.45) {
          this.addTrauma(0.1 * prox);
          // Biome-matched ground shockwave dust/ember burst beneath Hollow's stomping foot!
          this._v1.set(
            this.hollowRig.root.position.x + (hSin > 0 ? -0.6 : 0.6),
            hPose.centerY + 0.16,
            this.hollowRig.root.position.z,
          );
          this.spawnBurst(this._v1, 5, this.level.palette.hazardGlow, 3.8);
        }
      }
      this.lastHollowStompSin = hSin;
    }
  }

  private updateCamera(dt: number): void {
    const camSens = this.save.settings.gameplay.cameraSensitivity;
    const motionMult = this.save.settings.accessibility.reducedCameraMotion
      ? 0.25
      : this.save.settings.gameplay.cameraMotionIntensity;

    // Smooth bank roll recovery (tightly capped so horizon stays level!)
    this.camRoll = THREE.MathUtils.damp(this.camRoll, 0, 8.0, dt);

    const activeObs = this.obstacles.map((o) => o.data);
    const desired = computeDesiredChaseCamera({
      branches: this.getActiveBranchData(),
      simZ: this.sim.z,
      laneX: this.sim.x,
      playerY: this.sim.y,
      slideActive: this.sim.slideTimer > 0,
      activeRoute: this.sim.activeRoute,
      pendingBranchChoice: this.sim.pendingBranchChoice,
      speed: this.sim.speed,
      hollowDistance: this.sim.hollowDistance,
      cameraSensitivity: camSens,
      motionMultiplier: motionMult,
      obstacles: activeObs,
    });

    // Mandatory 3-Beat Opening Hollow Chase Camera (~2.85s on every campaign level):
    // Shot A (0.00 -> 0.42): Threat Establishment — low front-3/4 angle framing BOTH human runner & towering biome-adapted Hollow
    // Shot B (0.42 -> 0.62): Escape Acceleration — runner surges ahead as camera widens slightly
    // Shot C (0.62 -> 1.00): Seamless elevated corridor orbit settling smoothly into standard third-person chase camera
    let targetPosX = desired.posX;
    let targetPosY = desired.posY;
    let targetPosZ = desired.posZ;
    let targetLookX = desired.lookX;
    let targetLookY = desired.lookY;
    let targetLookZ = desired.lookZ;
    let targetFov = desired.fov;

    if (this.sim.introChaseTimer > 0) {
      const progress = THREE.MathUtils.clamp(1 - this.sim.introChaseTimer / 2.85, 0, 1);
      const surgeT = THREE.MathUtils.smoothstep(progress, 0.36, 0.62);
      const orbitT = THREE.MathUtils.smoothstep(progress, 0.56, 1.0);
      const lookT = THREE.MathUtils.smoothstep(progress, 0.54, 0.86);

      // Environment-specific opening chase choreography tailored to each biome archetype
      const arch = this.level.architecture;
      let sideSign = 1;
      let startX = 2.05;
      let endX = 2.45;
      let startY = 1.52;
      let endY = 1.78;
      let startZ = -6.4;
      let endZ = -7.25;
      let arcPeak = 2.2;
      let startFov = 53;

      if (arch === 'canyon_bridges' || arch === 'ice_spires' || arch === 'sky_colonnade' || arch === 'desert_pylons') {
        // High scenic left-crane descent framing vertigo canyon/cliff drops & pursuing Hollow
        sideSign = -1;
        startX = 2.35;
        endX = 2.7;
        startY = 2.15;
        endY = 1.92;
        startZ = -6.9;
        endZ = -7.65;
        arcPeak = 2.65;
        startFov = 55;
      } else if (
        arch === 'hollow_ribs' ||
        arch === 'volcanic_obelisks' ||
        arch === 'iron_mines' ||
        arch === 'infernal_fortress' ||
        arch === 'shattered_realm'
      ) {
        // Low claustrophobic aggressive tracking framing towering roaring Hollow tightly behind runner
        sideSign = 1;
        startX = 1.65;
        endX = 2.1;
        startY = 1.24;
        endY = 1.52;
        startZ = -5.85;
        endZ = -6.75;
        arcPeak = 1.8;
        startFov = 51;
      } else if (arch === 'jungle_temple' || arch === 'whispering_woods' || arch === 'giant_canopy') {
        // Low right-flank jungle canopy sweep framing explorer, Hollow, and roadside flora/wildlife
        sideSign = 1;
        startX = 2.05;
        endX = 2.48;
        startY = 1.48;
        endY = 1.76;
        startZ = -6.35;
        endZ = -7.25;
        arcPeak = 2.25;
        startFov = 53;
      } else {
        // Grand temple / aquatic / crystal heroic pull-back arc
        sideSign = -1;
        startX = 1.95;
        endX = 2.35;
        startY = 1.72;
        endY = 1.96;
        startZ = -6.7;
        endZ = -7.5;
        arcPeak = 2.4;
        startFov = 54;
      }

      const arcLift = Math.sin(orbitT * Math.PI) * arcPeak;
      const p = this.getPlayerCameraCoords();
      const introCamX = p.centerX + sideSign * THREE.MathUtils.lerp(startX, endX, surgeT);
      const introCamY = p.centerY + THREE.MathUtils.lerp(startY, endY, surgeT);
      const introCamZ = THREE.MathUtils.lerp(startZ, endZ, surgeT);

      const introLookX = p.centerX + sideSign * 0.12;
      const introLookY = p.centerY + THREE.MathUtils.lerp(1.62, 1.56, surgeT);
      const introLookZ = THREE.MathUtils.lerp(2.55, 1.85, surgeT);

      targetPosX = THREE.MathUtils.lerp(introCamX, desired.posX, orbitT) + sideSign * Math.sin(orbitT * Math.PI) * 0.65;
      targetPosY = THREE.MathUtils.lerp(introCamY, desired.posY, orbitT) + arcLift;
      targetPosZ = THREE.MathUtils.lerp(introCamZ, desired.posZ, orbitT);
      targetLookX = THREE.MathUtils.lerp(introLookX, desired.lookX, lookT);
      targetLookY = THREE.MathUtils.lerp(introLookY, desired.lookY, lookT);
      targetLookZ = THREE.MathUtils.lerp(introLookZ, desired.lookZ, lookT);
      targetFov = THREE.MathUtils.lerp(startFov + surgeT * 4, desired.fov, orbitT);
    }

    // Smooth speed-responsive FOV breathing without distortion
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4.5, dt);
      this.camera.updateProjectionMatrix();
    }

    // Frame-rate-independent exponential chase smoothing along the active route tangent (zero snap, zero lag!)
    if (!this.camInitialized) {
      this.camPos.set(targetPosX, targetPosY, targetPosZ);
      this.camLook.set(targetLookX, targetLookY, targetLookZ);
      this.camInitialized = true;
    } else {
      this.camPos.x = THREE.MathUtils.damp(this.camPos.x, targetPosX, 12.5, dt);
      this.camPos.y = THREE.MathUtils.damp(this.camPos.y, targetPosY, 9.5, dt);
      this.camPos.z = THREE.MathUtils.damp(this.camPos.z, targetPosZ, 12.0, dt);

      this.camLook.x = THREE.MathUtils.damp(this.camLook.x, targetLookX, 11.0, dt);
      this.camLook.y = THREE.MathUtils.damp(this.camLook.y, targetLookY, 9.5, dt);
      this.camLook.z = THREE.MathUtils.damp(this.camLook.z, targetLookZ, 11.0, dt);
    }

    // Event-driven decaying trauma^2 camera shake (ZERO constant jitter!)
    let shakeX = 0;
    let shakeY = 0;
    if (this.trauma > 0.001) {
      const mag = this.trauma * this.trauma * 0.3;
      shakeX = (Math.random() * 2 - 1) * mag;
      shakeY = (Math.random() * 2 - 1) * mag;
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    this.camera.up.set(0, 1, 0);
    this.camera.position.set(this.camPos.x + shakeX, this.camPos.y + shakeY, this.camPos.z);
    this.camera.lookAt(this.camLook.x, this.camLook.y, this.camLook.z);
    // Subtle horizon-safe banking cue capped at +/- 0.035 rad (~2 deg)
    const subtleRoll = THREE.MathUtils.clamp(this.camRoll * motionMult * 0.65, -0.035, 0.035);
    this.camera.rotation.z += subtleRoll;
  }

  private updateWeatherAndParticles(dt: number, forwardSpeed: number): void {
    const count = this.weatherMesh.count;
    const isFalling =
      this.level.weather === 'snow' ||
      this.level.weather === 'rain' ||
      this.level.weather === 'drizzle' ||
      this.level.weather === 'ash';
    const isRising =
      this.level.weather === 'embers' ||
      this.level.weather === 'cinder' ||
      this.level.weather === 'bubbles' ||
      this.level.weather === 'sparks';

    for (let i = 0; i < count; i++) {
      let x = this.weatherPositions[i * 3];
      let y = this.weatherPositions[i * 3 + 1];
      let z = this.weatherPositions[i * 3 + 2];

      z += (forwardSpeed * 0.85 + 3) * dt;
      if (isFalling) y -= (this.level.weather === 'rain' ? 16 : 3.2) * dt;
      else if (isRising) y += 2.6 * dt;
      else y += Math.sin(performance.now() * 0.002 + i) * 0.4 * dt;

      if (z > 10) {
        z = -55 - Math.random() * 14;
        x = (Math.random() - 0.5) * 32;
        y = isRising ? 0.5 + Math.random() * 3 : 2 + Math.random() * 12;
      }
      if (y < 0.2) y = 13;
      if (y > 15) y = 1.2;

      this.weatherPositions[i * 3] = x;
      this.weatherPositions[i * 3 + 1] = y;
      this.weatherPositions[i * 3 + 2] = z;

      this._dummy.position.set(x, y, z);
      const sy = this.level.weather === 'rain' || this.level.weather === 'drizzle' ? 3.5 : 1.0;
      this._dummy.scale.set(0.85, sy, 0.85);
      this._dummy.updateMatrix();
      this.weatherMesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.weatherMesh.instanceMatrix.needsUpdate = true;

    // Pooled burst particles
    let burstDirty = false;
    for (let i = 0; i < this.burstParticles.length; i++) {
      const p = this.burstParticles[i];
      if (!p.active) continue;
      burstDirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this._dummy.position.set(0, -100, 0);
        this._dummy.scale.setScalar(0.001);
        this._dummy.updateMatrix();
        this.burstMesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }
      p.vel.y -= 10 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const ratio = p.life / p.maxLife;
      this._dummy.position.copy(p.pos);
      this._dummy.rotation.set(0, 0, i * 0.7);
      this._dummy.scale.setScalar(p.scale * (0.45 + (1 - ratio) * 0.75) * Math.min(1, ratio * 2.2));
      this._dummy.updateMatrix();
      this.burstMesh.setMatrixAt(i, this._dummy.matrix);
      this.burstMesh.setColorAt(i, p.color);
    }
    if (burstDirty) {
      this.burstMesh.instanceMatrix.needsUpdate = true;
      if (this.burstMesh.instanceColor) this.burstMesh.instanceColor.needsUpdate = true;
    }

    // Organic flickering temple brazier flames (landmarks + active branch Relic Vaults & Wayfinders)
    const flameTime = performance.now() * 0.008;
    for (let i = 0; i < this.brazierFlames.length; i++) {
      const fl = this.brazierFlames[i];
      const f = 0.88 + Math.sin(flameTime + i * 2.1) * 0.14 + Math.cos(flameTime * 1.7 + i) * 0.08;
      fl.scale.set(0.92 + (f - 0.9) * 0.5, f, 0.92 + (f - 0.9) * 0.5);
    }
    for (let b = 0; b < this.branches.length; b++) {
      const bFlames = this.branches[b].flames;
      for (let i = 0; i < bFlames.length; i++) {
        const fl = bFlames[i];
        const f = 0.88 + Math.sin(flameTime + (i + b * 5) * 1.9) * 0.15;
        fl.scale.set(0.92 + (f - 0.9) * 0.5, f, 0.92 + (f - 0.9) * 0.5);
      }
    }

    // Subtle drifting low-lying canyon valley mist banks
    if (this.mistMesh.visible) {
      const now = performance.now() * 0.001;
      for (let i = 0; i < this.mistData.length; i++) {
        const m = this.mistData[i];
        m.z += (forwardSpeed * 0.28 + m.speed) * dt;
        if (m.z > 6) m.z = -126 - (i % 4) * 7;
        this._dummy.position.set(m.x + Math.sin(now * 0.35 + i) * 2.2, m.y, m.z);
        this._dummy.rotation.set(0, 0, 0);
        this._dummy.scale.set(m.s, m.s * 0.85, 1);
        this._dummy.updateMatrix();
        this.mistMesh.setMatrixAt(i, this._dummy.matrix);
      }
      this.mistMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Triggers curated, performance-safe dynamic environmental events during active runs:
   * - Wind-swept dust / leaf / ember gusts sweeping diagonally across the ahead causeway
   * - Distant crumbling cliff rockfalls strictly outside playable lanes (|x| >= 9.5m)
   * - Subtle sunlight & atmospheric lighting shifts between elevated sky bridges and sunken crypts
   */
  private updateDynamicEnvironmentalEvents(dt: number, nowSec: number): void {
    // 1. Subtle dynamic sun warmth & lighting modulation when traversing elevated bridges vs sunken crypts
    let sunMult = 1.0 + Math.sin(nowSec * 0.35) * 0.05;
    if (this.sim.activeBranchId !== null) {
      const curB = this.branches.find((b) => b.data.id === this.sim.activeBranchId)?.data;
      const meta = curB?.routes.find((r) => r.id === this.sim.activeRoute);
      if (meta?.style === 'ruin_gauntlet') {
        sunMult = 0.72; // Moody underground vaulted crypt lighting
      } else if (meta?.style === 'sky_bridge') {
        sunMult = 1.14; // Bright open sunlit canyon aqueduct
      }
    }
    const targetSunIntensity = this.level.palette.sunIntensity * sunMult;
    this.sunLight.intensity = THREE.MathUtils.damp(this.sunLight.intensity, targetSunIntensity, 2.2, dt);

    // 2. Periodic non-obscuring environmental drama events (every 6.8..10.5s, paused during opening chase)
    if (this.sim.introChaseTimer > 0) return;
    this.envEventTimer -= dt;
    if (this.envEventTimer > 0) return;

    this.envEventCounter++;
    this.envEventTimer = 6.8 + (this.envEventCounter % 4) * 1.1;
    const p = this.getPlayerCameraCoords();
    const side = this.envEventCounter % 2 === 0 ? 1 : -1;

    if (this.envEventCounter % 2 === 1) {
      // Wind-swept leaf / dust / ember gust drifting across the far ahead causeway (never blocking vision!)
      const gustColor = this.level.palette.particleColor;
      for (let i = 0; i < 10; i++) {
        const part = this.burstParticles[this.burstCursor % this.burstParticles.length];
        this.burstCursor++;
        part.active = true;
        part.pos.set(p.centerX + side * (5.5 + i * 0.4), p.centerY + 1.2 + (i % 4) * 0.8, -22 - i * 1.4);
        part.vel.set(-side * (5.2 + (i % 3) * 1.4), -0.6 + (i % 2) * 0.5, 4.0);
        part.life = 1.15;
        part.maxLife = 1.15;
        part.scale = 0.65 + (i % 3) * 0.25;
        part.color.set(gustColor);
      }
      this.audio.playWindGust();
    } else {
      // Distant cliffside rockfall / crumbling stone plume strictly outside playable lanes (|x| = 9.8m)
      this._v1.set(p.centerX + side * 9.8, p.centerY + 4.2, -32);
      this.spawnBurst(this._v1, 9, this.level.palette.archPrimary, 5.2);
      this.audio.playDistantRockfall();
    }
  }

  private finishRun(victory: boolean): void {
    this.gameState = victory ? 'victory' : 'gameover';
    this.audio.stopMusic();
    if (victory) {
      this.audio.playVictoryFanfare();
    }

    const prevBest =
      this.mode === 'endless'
        ? this.save.bestEndlessDistance
        : this.save.levelRecords[this.level.id]?.bestDistance ?? 0;

    const finalDist = Math.round(this.sim.z);
    const stats: RunStats = {
      mode: this.mode,
      levelId: this.level.id,
      distance: finalDist,
      targetDistance: this.mode === 'tutorial' ? 420 : this.level.targetDistance,
      coinsCollected: this.runCoins,
      obstaclesAvoided: this.obstaclesAvoided,
      nearMisses: this.nearMisses,
      jumps: this.jumpsCount,
      slides: this.slidesCount,
      abilitiesUsed: this.abilitiesUsed,
      secretPathsFound: this.secretPathsFound,
      stumbles: this.stumblesCount,
      durationSec: Math.round(this.runDuration),
      isNewRecord: finalDist > prevBest && finalDist > 20,
      bestDistance: Math.max(prevBest, finalDist),
      causeOfDeath: victory ? undefined : this.causeOfDeath || 'Caught by The Hollow',
    };

    if (victory) this.callbacks.onVictory(stats);
    else this.callbacks.onGameOver(stats);
  }

  private emitHud(): void {
    const charDef = getCharacterById(this.save.selectedCharacter);
    const lvl = this.save.abilityLevels[charDef.abilityId] ?? 1;
    const maxDur = getAbilityDurationSec(charDef.abilityId, lvl);
    const activeBranches = this.getActiveBranchData();

    const approaching = findApproachingBranch(activeBranches, this.sim.z, 26);
    const turnPrompt = approaching ? (approaching.hasCenter ? 'FORK3' : 'FORK') : null;

    let activeRouteLabel: string | null = null;
    if (this.sim.activeBranchId !== null) {
      const curBranch = activeBranches.find((b) => b.id === this.sim.activeBranchId);
      const meta = curBranch?.routes.find((r) => r.id === this.sim.activeRoute);
      if (meta) activeRouteLabel = meta.label;
    }

    const tutStep = this.mode === 'tutorial' ? TUTORIAL_STEPS[this.tutorialStepIdx] : null;
    const distRounded = Math.round(this.sim.z);
    const speedKmh = Math.round(this.sim.speed * 1.45);

    // Mirror compact invisible state hooks onto document.body.dataset for deterministic QA verification
    document.body.dataset.route = this.sim.activeRoute;
    document.body.dataset.branchActive = this.sim.activeBranchId !== null ? '1' : '0';
    document.body.dataset.distance = String(distRounded);
    document.body.dataset.lane = String(this.sim.lane);
    document.body.dataset.speedKmh = String(speedKmh);
    document.body.dataset.introChase = this.sim.introChaseTimer > 0 ? '1' : '0';
    document.body.dataset.hollowDist = this.sim.hollowDistance.toFixed(1);
    document.body.dataset.animState = this.characterAnimator.state;
    document.body.dataset.levelId = String(this.level.id);
    document.body.dataset.endlessBiome = this.level.name;
    if (this.livingWorld) {
      const diag = this.livingWorld.getDiagnostics();
      document.body.dataset.wildlifeCount = String(diag.wildlifeCount);
      document.body.dataset.floraCount = String(diag.floraCount);
    }

    this.callbacks.onHudUpdate({
      distance: distRounded,
      targetDistance: this.mode === 'tutorial' ? 420 : this.mode === 'campaign' ? this.level.targetDistance : 0,
      coins: this.runCoins,
      speedKmh,
      abilityCharge: Math.round(this.sim.abilityCharge),
      abilityActiveRatio: maxDur > 0 ? this.sim.abilityActiveTimer / maxDur : 0,
      abilityReady: this.sim.abilityCharge >= 100 && this.sim.abilityActiveTimer <= 0,
      shieldActive: this.sim.shieldCharges > 0,
      hollowThreat: Math.max(0, Math.min(1, 1 - (this.sim.hollowDistance - 2.5) / 14)),
      turnPrompt,
      activeRouteLabel,
      tutorialHint: tutStep ? `${tutStep.title} — ${tutStep.hint}` : null,
      tutorialStep: this.tutorialStepIdx + 1,
      tutorialTotal: TUTORIAL_STEPS.length,
      nearMissBanner: this.nearMissBanner || null,
      fps: Math.round(this.fpsSamples),
    });
  }

  // Software-WebGL-safe render loop pacing (per threejs skill)
  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 24);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 24);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick(performance.now()));
    } else {
      this.frameId = requestAnimationFrame((ts) => this.tick(ts));
    }
  }

  private tick(now: number): void {
    if (this.disposed) return;

    // Enforce user's real Target FPS limiter on GPU
    const targetFps = this.save.settings.graphics.targetFps;
    if (!this.isSoftwareGl && targetFps > 0) {
      const minInterval = 1000 / targetFps;
      if (now - this.lastRenderTime < minInterval - 1.5) {
        this.scheduleNextFrame();
        return;
      }
    }

    const rawDt = Math.max(0.001, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;
    this.lastRenderTime = now;
    this.fpsSamples = this.fpsSamples * 0.9 + (1 / rawDt) * 0.1;

    if (this.isSoftwareGl && rawDt > 0.05) {
      // Run bounded fixed substeps on software WebGL so gameplay advances near real-time without tunneling
      const totalDt = Math.min(rawDt, 0.24);
      const steps = Math.max(1, Math.ceil(totalDt / 0.04));
      const stepDt = totalDt / steps;
      for (let s = 0; s < steps; s++) {
        this.updateSimulation(stepDt);
      }
    } else {
      const dt = Math.min(rawDt, 0.05); // Clamped dt <= 0.05s prevents tunneling
      this.updateSimulation(dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.scheduleNextFrame();
  }

  private handleResize(): void {
    const w = Math.max(280, this.container.clientWidth);
    const h = Math.max(400, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  // Input listeners (Keyboard + Touch Swipe + Pointer Swipe)
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.keysHeld.has(e.code)) return;
    this.keysHeld.add(e.code);

    if (this.gameState === 'playing') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        this.handleLaneOrTurn(-1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        this.handleLaneOrTurn(1);
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
        e.preventDefault();
        this.handleJump();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        this.handleSlide();
      } else if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        e.preventDefault();
        this.handleAbilityPress();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysHeld.delete(e.code);
  };

  private onBlur = () => {
    this.keysHeld.clear();
    this.swipeActive = false;
  };

  private onVisibilityChange = () => {
    this.keysHeld.clear();
    if (document.hidden && this.gameState === 'playing') {
      this.callbacks.onPauseRequested();
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.gameState !== 'playing') return;
    this.swipeActive = true;
    this.swipeConsumed = false;
    this.swipeStartX = e.clientX;
    this.swipeStartY = e.clientY;
    this.audio.unlock();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.swipeActive || this.swipeConsumed || this.gameState !== 'playing') return;
    const dx = e.clientX - this.swipeStartX;
    const dy = e.clientY - this.swipeStartY;
    const threshold = Math.max(16, 34 / Math.max(0.5, this.save.settings.gameplay.swipeSensitivity));

    if (Math.max(Math.abs(dx), Math.abs(dy)) >= threshold) {
      this.swipeConsumed = true;
      if (Math.abs(dx) > Math.abs(dy)) {
        this.handleLaneOrTurn(dx > 0 ? 1 : -1);
      } else {
        if (dy < 0) this.handleJump();
        else this.handleSlide();
      }
    }
  };

  private onPointerUp = () => {
    this.swipeActive = false;
    this.swipeConsumed = false;
  };

  private bindInputListeners(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);

    this.livingWorld?.dispose();
    this.playerRig?.dispose();
    this.envRenderTarget?.dispose();
    this.envTextures?.dispose();
    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
