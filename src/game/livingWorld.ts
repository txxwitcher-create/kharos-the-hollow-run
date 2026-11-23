import * as THREE from 'three';
import { LevelDef, TrackBranch } from '../types/game';
import {
  ALL_CORRUPTED_FLORA_KINDS,
  ALL_WILDLIFE_SPECIES,
  BiomeLivingProfile,
  CorruptedFloraKind,
  FloraBehavior,
  WildlifeBehavior,
  WildlifeSpecies,
  canTriggerDistantCrossing,
  computeLodTier,
  computeSafeFloraPlacement,
  computeSafeWildlifePlacement,
  getBiomeLivingProfile,
  pickInitialWildlifeBehavior,
  seededUnit,
  selectWeightedNonRepeating,
} from './livingWorldRules';

interface LivingWorldTextures {
  tigerFur: THREE.CanvasTexture | null;
  deerCoat: THREE.CanvasTexture | null;
  peacockFeather: THREE.CanvasTexture | null;
  corruptedFlora: THREE.CanvasTexture | null;
  dispose: () => void;
}

function makeCanvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  srgb = true,
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createLivingWorldTextures(): LivingWorldTextures {
  const tigerFur = makeCanvasTexture(256, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#c96f24');
    grad.addColorStop(0.55, '#d98432');
    grad.addColorStop(0.84, '#e9c89d');
    grad.addColorStop(1, '#f0dfc4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    // Organic tapered charcoal stripes
    ctx.fillStyle = '#1b1410';
    for (let i = 0; i < 11; i++) {
      const x = (i / 11) * s + ((i % 2) * 7 - 3);
      ctx.beginPath();
      ctx.moveTo(x - 6, 0);
      ctx.quadraticCurveTo(x + 9, s * 0.35, x - 3, s * 0.72);
      ctx.lineTo(x + 5, s * 0.7);
      ctx.quadraticCurveTo(x + 15, s * 0.35, x + 4, 0);
      ctx.closePath();
      ctx.fill();
    }
  });

  const deerCoat = makeCanvasTexture(256, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#6e492d');
    grad.addColorStop(0.55, '#9b6b42');
    grad.addColorStop(0.85, '#c7a47e');
    grad.addColorStop(1, '#e6d8c3');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    // Subtle natural dappled fawn spots on upper back
    ctx.fillStyle = 'rgba(244, 233, 212, 0.42)';
    for (let i = 0; i < 34; i++) {
      const rx = seededUnit(i * 17 + 3) * s;
      const ry = (0.12 + seededUnit(i * 29 + 7) * 0.42) * s;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 4.5, 3.2, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const peacockFeather = makeCanvasTexture(256, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, s, 0, 0);
    grad.addColorStop(0, '#0c4a4e');
    grad.addColorStop(0.45, '#0f766e');
    grad.addColorStop(0.78, '#10b981');
    grad.addColorStop(1, '#14b8a6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Fine iridescent barbules
    ctx.strokeStyle = 'rgba(110, 231, 183, 0.28)';
    ctx.lineWidth = 2;
    for (let y = 16; y < s; y += 8) {
      ctx.beginPath();
      ctx.moveTo(s * 0.5, y);
      ctx.lineTo(0, y - 18);
      ctx.moveTo(s * 0.5, y);
      ctx.lineTo(s, y - 18);
      ctx.stroke();
    }
    // Iconic peacock ocellus ("eye") near feather tip
    const cx = s * 0.5;
    const cy = s * 0.24;
    const rings: Array<[number, number, string]> = [
      [44, 52, '#d97706'],
      [34, 41, '#10b981'],
      [23, 29, '#06b6d4'],
      [13, 17, '#1e1b4b'],
    ];
    for (const [rx, ry, col] of rings) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(cx - 5, cy - 6, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  const corruptedFlora = makeCanvasTexture(256, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, '#18211c');
    grad.addColorStop(0.5, '#261e29');
    grad.addColorStop(1, '#141a17');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    // Subtle dark organic striations + muted corrupted sap veins
    ctx.strokeStyle = 'rgba(116, 178, 84, 0.32)';
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 14; i++) {
      const sx = seededUnit(i * 13 + 5) * s;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.bezierCurveTo(sx + 18, s * 0.35, sx - 22, s * 0.65, sx + 8, s);
      ctx.stroke();
    }
  });

  return {
    tigerFur,
    deerCoat,
    peacockFeather,
    corruptedFlora,
    dispose: () => {
      tigerFur?.dispose();
      deerCoat?.dispose();
      peacockFeather?.dispose();
      corruptedFlora?.dispose();
    },
  };
}

interface LivingWorldMaterialBank {
  deerBody: THREE.MeshStandardMaterial;
  deerBelly: THREE.MeshStandardMaterial;
  antler: THREE.MeshStandardMaterial;
  tigerBody: THREE.MeshStandardMaterial;
  tigerAccent: THREE.MeshStandardMaterial;
  catCoats: THREE.MeshStandardMaterial[];
  dogBody: THREE.MeshStandardMaterial;
  dogAccent: THREE.MeshStandardMaterial;
  rabbitBody: THREE.MeshStandardMaterial;
  whiteTuft: THREE.MeshStandardMaterial;
  pigeonBody: THREE.MeshStandardMaterial;
  pigeonNeck: THREE.MeshStandardMaterial;
  pigeonWing: THREE.MeshStandardMaterial;
  peacockBody: THREE.MeshStandardMaterial;
  peacockFeather: THREE.MeshStandardMaterial;
  sparrowBody: THREE.MeshStandardMaterial;
  sparrowBreast: THREE.MeshStandardMaterial;
  eyeDark: THREE.MeshStandardMaterial;
  eyeAmber: THREE.MeshStandardMaterial;
  beakGold: THREE.MeshStandardMaterial;
  hoofDark: THREE.MeshStandardMaterial;
  corruptedRoot: THREE.MeshStandardMaterial;
  corruptedLeaf: THREE.MeshStandardMaterial;
  corruptedMaw: THREE.MeshStandardMaterial;
  corruptedCore: THREE.MeshStandardMaterial;
  thornPale: THREE.MeshStandardMaterial;
  ruinPerch: THREE.MeshStandardMaterial;
  contactShadow: THREE.MeshBasicMaterial;
  dispose: () => void;
}

function createMaterialBank(
  tex: LivingWorldTextures,
  contactShadowMap: THREE.Texture | null,
): LivingWorldMaterialBank {
  const all: THREE.Material[] = [];
  const reg = <T extends THREE.Material>(m: T): T => {
    all.push(m);
    return m;
  };

  const deerBody = reg(
    new THREE.MeshStandardMaterial({
      color: tex.deerCoat ? 0xffffff : '#8f623c',
      map: tex.deerCoat,
      roughness: 0.84,
      metalness: 0.02,
    }),
  );
  const deerBelly = reg(new THREE.MeshStandardMaterial({ color: '#dfd0ba', roughness: 0.88, metalness: 0.0 }));
  const antler = reg(new THREE.MeshStandardMaterial({ color: '#cbb99d', roughness: 0.68, metalness: 0.05 }));
  const tigerBody = reg(
    new THREE.MeshStandardMaterial({
      color: tex.tigerFur ? 0xffffff : '#cf782a',
      map: tex.tigerFur,
      roughness: 0.82,
      metalness: 0.02,
    }),
  );
  const tigerAccent = reg(new THREE.MeshStandardMaterial({ color: '#eeddc4', roughness: 0.86, metalness: 0.0 }));
  const catCoats = [
    reg(new THREE.MeshStandardMaterial({ color: '#b57b4a', roughness: 0.82, metalness: 0.02 })),
    reg(new THREE.MeshStandardMaterial({ color: '#393d45', roughness: 0.78, metalness: 0.04 })),
    reg(new THREE.MeshStandardMaterial({ color: '#d2b48c', roughness: 0.84, metalness: 0.02 })),
  ];
  const dogBody = reg(new THREE.MeshStandardMaterial({ color: '#9c683b', roughness: 0.85, metalness: 0.02 }));
  const dogAccent = reg(new THREE.MeshStandardMaterial({ color: '#453123', roughness: 0.82, metalness: 0.02 }));
  const rabbitBody = reg(new THREE.MeshStandardMaterial({ color: '#a8927a', roughness: 0.9, metalness: 0.0 }));
  const whiteTuft = reg(new THREE.MeshStandardMaterial({ color: '#f2ece1', roughness: 0.92, metalness: 0.0 }));
  const pigeonBody = reg(new THREE.MeshStandardMaterial({ color: '#707c8a', roughness: 0.72, metalness: 0.06 }));
  const pigeonNeck = reg(new THREE.MeshStandardMaterial({ color: '#336b62', roughness: 0.42, metalness: 0.25 }));
  const pigeonWing = reg(new THREE.MeshStandardMaterial({ color: '#49525e', roughness: 0.78, metalness: 0.04 }));
  const peacockBody = reg(new THREE.MeshStandardMaterial({ color: '#0d4e78', roughness: 0.36, metalness: 0.32 }));
  const peacockFeather = reg(
    new THREE.MeshStandardMaterial({
      color: tex.peacockFeather ? 0xffffff : '#10b981',
      map: tex.peacockFeather,
      roughness: 0.34,
      metalness: 0.28,
      side: THREE.DoubleSide,
    }),
  );
  const sparrowBody = reg(new THREE.MeshStandardMaterial({ color: '#7c5638', roughness: 0.82, metalness: 0.02 }));
  const sparrowBreast = reg(new THREE.MeshStandardMaterial({ color: '#dfd2bc', roughness: 0.86, metalness: 0.0 }));
  const eyeDark = reg(new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.14, metalness: 0.15 }));
  const eyeAmber = reg(
    new THREE.MeshStandardMaterial({
      color: '#eab308',
      emissive: '#78350f',
      emissiveIntensity: 0.32,
      roughness: 0.18,
      metalness: 0.12,
    }),
  );
  const beakGold = reg(new THREE.MeshStandardMaterial({ color: '#c9933c', roughness: 0.48, metalness: 0.08 }));
  const hoofDark = reg(new THREE.MeshStandardMaterial({ color: '#27221d', roughness: 0.56, metalness: 0.06 }));

  const corruptedRoot = reg(
    new THREE.MeshStandardMaterial({
      color: tex.corruptedFlora ? '#d4d8d2' : '#242923',
      map: tex.corruptedFlora,
      roughness: 0.9,
      metalness: 0.04,
    }),
  );
  const corruptedLeaf = reg(
    new THREE.MeshStandardMaterial({
      color: '#1f3326',
      map: tex.corruptedFlora,
      roughness: 0.7,
      metalness: 0.06,
      side: THREE.DoubleSide,
    }),
  );
  const corruptedMaw = reg(
    new THREE.MeshStandardMaterial({
      color: '#4a1d28',
      map: tex.corruptedFlora,
      roughness: 0.56,
      metalness: 0.08,
      side: THREE.DoubleSide,
    }),
  );
  const corruptedCore = reg(
    new THREE.MeshStandardMaterial({
      color: '#84cc16',
      emissive: '#65a30d',
      emissiveIntensity: 0.72,
      roughness: 0.28,
      metalness: 0.1,
    }),
  );
  const thornPale = reg(new THREE.MeshStandardMaterial({ color: '#d8ceb6', roughness: 0.46, metalness: 0.04 }));
  const ruinPerch = reg(new THREE.MeshStandardMaterial({ color: '#645f53', roughness: 0.94, metalness: 0.04 }));
  const contactShadow = reg(
    new THREE.MeshBasicMaterial({
      color: '#060c07',
      map: contactShadowMap,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );

  return {
    deerBody,
    deerBelly,
    antler,
    tigerBody,
    tigerAccent,
    catCoats,
    dogBody,
    dogAccent,
    rabbitBody,
    whiteTuft,
    pigeonBody,
    pigeonNeck,
    pigeonWing,
    peacockBody,
    peacockFeather,
    sparrowBody,
    sparrowBreast,
    eyeDark,
    eyeAmber,
    beakGold,
    hoofDark,
    corruptedRoot,
    corruptedLeaf,
    corruptedMaw,
    corruptedCore,
    thornPale,
    ruinPerch,
    contactShadow,
    dispose: () => {
      for (const m of all) m.dispose();
    },
  };
}

interface SharedGeos {
  shadowDisc: THREE.CircleGeometry;
  sphereLow: THREE.SphereGeometry;
  sphereMid: THREE.SphereGeometry;
  capsuleLimb: THREE.CapsuleGeometry;
  coneSmall: THREE.ConeGeometry;
  wingBlade: THREE.BufferGeometry;
  peacockPlume: THREE.BufferGeometry;
  serratedLeaf: THREE.BufferGeometry;
  mawJaw: THREE.BufferGeometry;
  ruinBlock: THREE.BoxGeometry;
  dispose: () => void;
}

function createWingBladeGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.18, 0.09, 0.36, 0.02);
  shape.quadraticCurveTo(0.24, -0.1, 0, -0.11);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 5);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createPeacockPlumeGeo(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(0.22, 0.92, 2, 5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + 0.46; // pivot at quill base (y=0..0.92)
    const t = y / 0.92;
    const widthScale = 0.25 + Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.85;
    const archZ = -t * t * 0.14;
    pos.setXYZ(i, x * widthScale, y, archZ);
  }
  geo.computeVertexNormals();
  return geo;
}

function createSerratedLeafGeo(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(0.32, 1.18, 2, 6);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + 0.59; // base at y=0
    const t = y / 1.18;
    const widthScale = Math.sin(t * Math.PI) * (1 + (i % 2 === 0 ? 0.18 : -0.1));
    const droopZ = t * t * 0.44;
    pos.setXYZ(i, x * widthScale, y * (1 - t * 0.16), droopZ);
  }
  geo.computeVertexNormals();
  return geo;
}

function createMawJawGeo(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
  geo.scale(0.88, 0.72, 1.18);
  geo.computeVertexNormals();
  return geo;
}

function createSharedGeos(): SharedGeos {
  const shadowDisc = new THREE.CircleGeometry(0.75, 14);
  shadowDisc.rotateX(-Math.PI / 2);
  const sphereLow = new THREE.SphereGeometry(0.5, 10, 8);
  const sphereMid = new THREE.SphereGeometry(0.5, 14, 10);
  const capsuleLimb = new THREE.CapsuleGeometry(0.08, 0.52, 4, 7);
  const coneSmall = new THREE.ConeGeometry(0.12, 0.36, 7);
  const wingBlade = createWingBladeGeo();
  const peacockPlume = createPeacockPlumeGeo();
  const serratedLeaf = createSerratedLeafGeo();
  const mawJaw = createMawJawGeo();
  const ruinBlock = new THREE.BoxGeometry(1.05, 0.72, 0.92);

  return {
    shadowDisc,
    sphereLow,
    sphereMid,
    capsuleLimb,
    coneSmall,
    wingBlade,
    peacockPlume,
    serratedLeaf,
    mawJaw,
    ruinBlock,
    dispose: () => {
      shadowDisc.dispose();
      sphereLow.dispose();
      sphereMid.dispose();
      capsuleLimb.dispose();
      coneSmall.dispose();
      wingBlade.dispose();
      peacockPlume.dispose();
      serratedLeaf.dispose();
      mawJaw.dispose();
      ruinBlock.dispose();
    },
  };
}

export interface WildlifeActor {
  species: WildlifeSpecies;
  root: THREE.Group;
  bodyPivot: THREE.Group;
  neckPivot?: THREE.Group;
  tailPivot?: THREE.Group;
  legs: THREE.Group[];
  wings: THREE.Group[];
  plumes: THREE.Mesh[];
  subBirds: Array<{
    group: THREE.Group;
    wingL: THREE.Group;
    wingR: THREE.Group;
    homeX: number;
    homeY: number;
    homeZ: number;
    phase: number;
    flightDelay: number;
    flightDirX: number;
    flightDirZ: number;
  }>;
  trackZ: number;
  baseX: number;
  baseY: number;
  baseYaw: number;
  side: -1 | 1;
  behavior: WildlifeBehavior;
  behaviorTimer: number;
  phase: number;
  crossingActive: boolean;
  crossingProgress: number;
  crossingStartX: number;
  crossingEndX: number;
  frameSkip: number;
  seed: number;
}

export interface CorruptedFloraActor {
  kind: CorruptedFloraKind;
  root: THREE.Group;
  upperJaw?: THREE.Group;
  lowerJaw?: THREE.Group;
  coreMesh?: THREE.Mesh;
  fronds: THREE.Object3D[];
  vines: THREE.Object3D[];
  trackZ: number;
  baseX: number;
  baseY: number;
  baseYaw: number;
  side: -1 | 1;
  behavior: FloraBehavior;
  reactTimer: number;
  snapped: boolean;
  phase: number;
  seed: number;
}

function addShadow(parent: THREE.Group, geos: SharedGeos, mats: LivingWorldMaterialBank, radius: number): void {
  const s = new THREE.Mesh(geos.shadowDisc, mats.contactShadow);
  s.position.y = 0.025;
  s.scale.setScalar(radius / 0.75);
  parent.add(s);
}

function makeLeg(
  geos: SharedGeos,
  legMat: THREE.Material,
  pawMat: THREE.Material,
  x: number,
  y: number,
  z: number,
  length: number,
  radius: number,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const shaft = new THREE.Mesh(geos.capsuleLimb, legMat);
  shaft.scale.set(radius / 0.08, length / 0.68, radius / 0.08);
  shaft.position.y = -length * 0.48;
  const paw = new THREE.Mesh(geos.sphereLow, pawMat);
  paw.scale.set(radius * 2.1, radius * 1.4, radius * 2.4);
  paw.position.set(0, -length + radius * 0.45, radius * 0.25);
  pivot.add(shaft, paw);
  return pivot;
}

function buildDeerModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  isStag: boolean,
  ownedGeos: THREE.BufferGeometry[],
): Pick<WildlifeActor, 'root' | 'bodyPivot' | 'neckPivot' | 'tailPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'> {
  const root = new THREE.Group();
  addShadow(root, geos, mats, 0.85);
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.92;
  root.add(bodyPivot);

  // Sculpted torso (chest + barrel + hindquarters + cream belly)
  const torso = new THREE.Mesh(geos.sphereMid, mats.deerBody);
  torso.scale.set(0.52, 0.62, 1.32);
  const chest = new THREE.Mesh(geos.sphereLow, mats.deerBody);
  chest.scale.set(0.46, 0.56, 0.56);
  chest.position.set(0, 0.05, 0.46);
  const rump = new THREE.Mesh(geos.sphereLow, mats.deerBody);
  rump.scale.set(0.48, 0.56, 0.58);
  rump.position.set(0, 0.04, -0.46);
  const belly = new THREE.Mesh(geos.sphereLow, mats.deerBelly);
  belly.scale.set(0.4, 0.34, 1.02);
  belly.position.set(0, -0.17, 0);
  bodyPivot.add(torso, chest, rump, belly);

  // Articulated neck + sculpted deer head + ears + branching antlers
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.14, 0.56);
  bodyPivot.add(neckPivot);

  const neck = new THREE.Mesh(geos.capsuleLimb, mats.deerBody);
  neck.scale.set(1.55, 0.92, 1.65);
  neck.position.set(0, 0.34, 0.14);
  neck.rotation.x = 0.34;
  const head = new THREE.Mesh(geos.sphereMid, mats.deerBody);
  head.scale.set(0.28, 0.3, 0.48);
  head.position.set(0, 0.68, 0.32);
  const muzzle = new THREE.Mesh(geos.sphereLow, mats.deerBelly);
  muzzle.scale.set(0.18, 0.18, 0.32);
  muzzle.position.set(0, 0.63, 0.54);
  const nose = new THREE.Mesh(geos.sphereLow, mats.hoofDark);
  nose.scale.set(0.08, 0.07, 0.08);
  nose.position.set(0, 0.65, 0.69);
  neckPivot.add(neck, head, muzzle, nose);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(geos.coneSmall, mats.deerBody);
    ear.scale.set(0.55, 0.68, 0.35);
    ear.position.set(s * 0.15, 0.82, 0.24);
    ear.rotation.set(-0.2, 0, s * -0.58);
    const eye = new THREE.Mesh(geos.sphereLow, mats.eyeDark);
    eye.scale.setScalar(0.052);
    eye.position.set(s * 0.12, 0.72, 0.42);
    neckPivot.add(ear, eye);

    if (isStag) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.06, 0.82, 0.28),
        new THREE.Vector3(s * 0.19, 1.04, 0.24),
        new THREE.Vector3(s * 0.31, 1.24, 0.34),
      ]);
      const mainBeam = new THREE.TubeGeometry(curve, 7, 0.018, 5, false);
      ownedGeos.push(mainBeam);
      neckPivot.add(new THREE.Mesh(mainBeam, mats.antler));

      const tine = new THREE.Mesh(geos.coneSmall, mats.antler);
      tine.scale.set(0.14, 0.48, 0.14);
      tine.position.set(s * 0.22, 1.13, 0.36);
      tine.rotation.set(0.55, 0, s * -0.22);
      neckPivot.add(tine);
    }
  }

  // Short upright white tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.08, -0.72);
  const tailMesh = new THREE.Mesh(geos.coneSmall, mats.whiteTuft);
  tailMesh.scale.set(0.65, 0.6, 0.45);
  tailMesh.rotation.x = -2.35;
  tailMesh.position.set(0, -0.05, -0.06);
  tailPivot.add(tailMesh);
  bodyPivot.add(tailPivot);

  const legs = [
    makeLeg(geos, mats.deerBody, mats.hoofDark, -0.17, -0.1, 0.44, 0.82, 0.044),
    makeLeg(geos, mats.deerBody, mats.hoofDark, 0.17, -0.1, 0.44, 0.82, 0.044),
    makeLeg(geos, mats.deerBody, mats.hoofDark, -0.18, -0.1, -0.45, 0.82, 0.048),
    makeLeg(geos, mats.deerBody, mats.hoofDark, 0.18, -0.1, -0.45, 0.82, 0.048),
  ];
  for (const l of legs) bodyPivot.add(l);

  return { root, bodyPivot, neckPivot, tailPivot, legs, wings: [], plumes: [], subBirds: [] };
}

function buildTigerModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  ownedGeos: THREE.BufferGeometry[],
): Pick<WildlifeActor, 'root' | 'bodyPivot' | 'neckPivot' | 'tailPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'> {
  const root = new THREE.Group();
  addShadow(root, geos, mats, 1.05);
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.78;
  root.add(bodyPivot);

  const torso = new THREE.Mesh(geos.sphereMid, mats.tigerBody);
  torso.scale.set(0.62, 0.64, 1.54);
  const shoulders = new THREE.Mesh(geos.sphereLow, mats.tigerBody);
  shoulders.scale.set(0.66, 0.68, 0.7);
  shoulders.position.set(0, 0.06, 0.48);
  const haunches = new THREE.Mesh(geos.sphereLow, mats.tigerBody);
  haunches.scale.set(0.58, 0.62, 0.68);
  haunches.position.set(0, 0.03, -0.52);
  const chestFur = new THREE.Mesh(geos.sphereLow, mats.tigerAccent);
  chestFur.scale.set(0.46, 0.42, 0.46);
  chestFur.position.set(0, -0.14, 0.58);
  bodyPivot.add(torso, shoulders, haunches, chestFur);

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.14, 0.68);
  bodyPivot.add(neckPivot);

  const head = new THREE.Mesh(geos.sphereMid, mats.tigerBody);
  head.scale.set(0.44, 0.4, 0.48);
  head.position.set(0, 0.12, 0.24);
  const muzzle = new THREE.Mesh(geos.sphereLow, mats.tigerAccent);
  muzzle.scale.set(0.28, 0.22, 0.26);
  muzzle.position.set(0, 0.05, 0.46);
  const nose = new THREE.Mesh(geos.sphereLow, mats.hoofDark);
  nose.scale.set(0.1, 0.08, 0.08);
  nose.position.set(0, 0.08, 0.58);
  neckPivot.add(head, muzzle, nose);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(geos.sphereLow, mats.tigerBody);
    ear.scale.set(0.11, 0.12, 0.07);
    ear.position.set(s * 0.17, 0.28, 0.16);
    const eye = new THREE.Mesh(geos.sphereLow, mats.eyeAmber);
    eye.scale.setScalar(0.052);
    eye.position.set(s * 0.12, 0.17, 0.42);
    neckPivot.add(ear, eye);
  }

  // Long muscular curved feline tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.06, -0.78);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.14, -0.34),
    new THREE.Vector3(0.03, -0.16, -0.68),
    new THREE.Vector3(0.06, -0.02, -0.92),
  ]);
  const tailGeo = new THREE.TubeGeometry(tailCurve, 10, 0.042, 6, false);
  ownedGeos.push(tailGeo);
  tailPivot.add(new THREE.Mesh(tailGeo, mats.tigerBody));
  bodyPivot.add(tailPivot);

  const legs = [
    makeLeg(geos, mats.tigerBody, mats.tigerAccent, -0.21, -0.12, 0.5, 0.66, 0.068),
    makeLeg(geos, mats.tigerBody, mats.tigerAccent, 0.21, -0.12, 0.5, 0.66, 0.068),
    makeLeg(geos, mats.tigerBody, mats.tigerAccent, -0.21, -0.12, -0.52, 0.66, 0.072),
    makeLeg(geos, mats.tigerBody, mats.tigerAccent, 0.21, -0.12, -0.52, 0.66, 0.072),
  ];
  for (const l of legs) bodyPivot.add(l);

  return { root, bodyPivot, neckPivot, tailPivot, legs, wings: [], plumes: [], subBirds: [] };
}

function buildCatModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  coatIndex: number,
  withPerch: boolean,
  ownedGeos: THREE.BufferGeometry[],
): Pick<WildlifeActor, 'root' | 'bodyPivot' | 'neckPivot' | 'tailPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'> {
  const root = new THREE.Group();
  const coatMat = mats.catCoats[coatIndex % mats.catCoats.length];
  if (withPerch) {
    const stone = new THREE.Mesh(geos.ruinBlock, mats.ruinPerch);
    stone.position.set(0, -0.36, 0);
    stone.scale.set(0.85, 1.0, 0.85);
    root.add(stone);
  }
  addShadow(root, geos, mats, 0.42);

  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.34;
  root.add(bodyPivot);

  const torso = new THREE.Mesh(geos.sphereLow, coatMat);
  torso.scale.set(0.26, 0.26, 0.62);
  const chest = new THREE.Mesh(geos.sphereLow, mats.whiteTuft);
  chest.scale.set(0.18, 0.18, 0.2);
  chest.position.set(0, -0.04, 0.24);
  bodyPivot.add(torso, chest);

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.08, 0.26);
  bodyPivot.add(neckPivot);

  const head = new THREE.Mesh(geos.sphereLow, coatMat);
  head.scale.set(0.21, 0.19, 0.23);
  head.position.set(0, 0.1, 0.08);
  neckPivot.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(geos.coneSmall, coatMat);
    ear.scale.set(0.28, 0.3, 0.22);
    ear.position.set(s * 0.075, 0.21, 0.06);
    ear.rotation.z = s * -0.18;
    const eye = new THREE.Mesh(geos.sphereLow, mats.eyeAmber);
    eye.scale.setScalar(0.028);
    eye.position.set(s * 0.055, 0.12, 0.18);
    neckPivot.add(ear, eye);
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.05, -0.3);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.16, -0.14),
    new THREE.Vector3(0, 0.34, -0.12),
    new THREE.Vector3(0, 0.42, -0.02),
  ]);
  const tailGeo = new THREE.TubeGeometry(tailCurve, 8, 0.024, 5, false);
  ownedGeos.push(tailGeo);
  tailPivot.add(new THREE.Mesh(tailGeo, coatMat));
  bodyPivot.add(tailPivot);

  const legs = [
    makeLeg(geos, coatMat, mats.whiteTuft, -0.08, -0.05, 0.19, 0.29, 0.028),
    makeLeg(geos, coatMat, mats.whiteTuft, 0.08, -0.05, 0.19, 0.29, 0.028),
    makeLeg(geos, coatMat, mats.whiteTuft, -0.085, -0.05, -0.2, 0.29, 0.03),
    makeLeg(geos, coatMat, mats.whiteTuft, 0.085, -0.05, -0.2, 0.29, 0.03),
  ];
  for (const l of legs) bodyPivot.add(l);

  return { root, bodyPivot, neckPivot, tailPivot, legs, wings: [], plumes: [], subBirds: [] };
}

function buildDogModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  ownedGeos: THREE.BufferGeometry[],
): Pick<WildlifeActor, 'root' | 'bodyPivot' | 'neckPivot' | 'tailPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'> {
  const root = new THREE.Group();
  addShadow(root, geos, mats, 0.62);
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.56;
  root.add(bodyPivot);

  const torso = new THREE.Mesh(geos.sphereMid, mats.dogBody);
  torso.scale.set(0.4, 0.42, 0.96);
  const chest = new THREE.Mesh(geos.sphereLow, mats.dogBody);
  chest.scale.set(0.38, 0.44, 0.42);
  chest.position.set(0, 0.02, 0.32);
  const collar = new THREE.Mesh(geos.sphereLow, mats.dogAccent);
  collar.scale.set(0.31, 0.14, 0.31);
  collar.position.set(0, 0.12, 0.44);
  bodyPivot.add(torso, chest, collar);

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.14, 0.44);
  bodyPivot.add(neckPivot);

  const head = new THREE.Mesh(geos.sphereLow, mats.dogBody);
  head.scale.set(0.28, 0.28, 0.36);
  head.position.set(0, 0.17, 0.14);
  const snout = new THREE.Mesh(geos.sphereLow, mats.dogAccent);
  snout.scale.set(0.16, 0.15, 0.28);
  snout.position.set(0, 0.13, 0.34);
  const nose = new THREE.Mesh(geos.sphereLow, mats.hoofDark);
  nose.scale.setScalar(0.06);
  nose.position.set(0, 0.16, 0.47);
  neckPivot.add(head, snout, nose);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(geos.coneSmall, mats.dogAccent);
    ear.scale.set(0.44, 0.54, 0.25);
    ear.position.set(s * 0.12, 0.29, 0.1);
    ear.rotation.set(0.2, 0, s * -0.45);
    const eye = new THREE.Mesh(geos.sphereLow, mats.eyeDark);
    eye.scale.setScalar(0.038);
    eye.position.set(s * 0.085, 0.2, 0.27);
    neckPivot.add(ear, eye);
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.08, -0.46);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.14, -0.18),
    new THREE.Vector3(0, 0.28, -0.26),
  ]);
  const tailGeo = new THREE.TubeGeometry(tailCurve, 7, 0.032, 5, false);
  ownedGeos.push(tailGeo);
  tailPivot.add(new THREE.Mesh(tailGeo, mats.dogBody));
  bodyPivot.add(tailPivot);

  const legs = [
    makeLeg(geos, mats.dogBody, mats.dogAccent, -0.13, -0.08, 0.3, 0.48, 0.042),
    makeLeg(geos, mats.dogBody, mats.dogAccent, 0.13, -0.08, 0.3, 0.48, 0.042),
    makeLeg(geos, mats.dogBody, mats.dogAccent, -0.14, -0.08, -0.32, 0.48, 0.045),
    makeLeg(geos, mats.dogBody, mats.dogAccent, 0.14, -0.08, -0.32, 0.48, 0.045),
  ];
  for (const l of legs) bodyPivot.add(l);

  return { root, bodyPivot, neckPivot, tailPivot, legs, wings: [], plumes: [], subBirds: [] };
}

function buildRabbitModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
): Pick<WildlifeActor, 'root' | 'bodyPivot' | 'neckPivot' | 'tailPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'> {
  const root = new THREE.Group();
  addShadow(root, geos, mats, 0.34);
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.22;
  root.add(bodyPivot);

  const rump = new THREE.Mesh(geos.sphereLow, mats.rabbitBody);
  rump.scale.set(0.32, 0.32, 0.44);
  const chest = new THREE.Mesh(geos.sphereLow, mats.rabbitBody);
  chest.scale.set(0.24, 0.26, 0.28);
  chest.position.set(0, 0.05, 0.17);
  const cottonTail = new THREE.Mesh(geos.sphereLow, mats.whiteTuft);
  cottonTail.scale.setScalar(0.13);
  cottonTail.position.set(0, 0.02, -0.23);
  bodyPivot.add(rump, chest, cottonTail);

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.12, 0.22);
  bodyPivot.add(neckPivot);

  const head = new THREE.Mesh(geos.sphereLow, mats.rabbitBody);
  head.scale.set(0.21, 0.2, 0.25);
  head.position.set(0, 0.07, 0.07);
  const nose = new THREE.Mesh(geos.sphereLow, mats.whiteTuft);
  nose.scale.set(0.05, 0.04, 0.04);
  nose.position.set(0, 0.06, 0.19);
  neckPivot.add(head, nose);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(geos.capsuleLimb, mats.rabbitBody);
    ear.scale.set(0.32, 0.42, 0.22);
    ear.position.set(s * 0.065, 0.25, 0.02);
    ear.rotation.set(-0.22, 0, s * -0.18);
    const eye = new THREE.Mesh(geos.sphereLow, mats.eyeDark);
    eye.scale.setScalar(0.026);
    eye.position.set(s * 0.07, 0.09, 0.15);
    neckPivot.add(ear, eye);
  }

  const legs = [
    makeLeg(geos, mats.rabbitBody, mats.whiteTuft, -0.08, -0.05, 0.14, 0.16, 0.026),
    makeLeg(geos, mats.rabbitBody, mats.whiteTuft, 0.08, -0.05, 0.14, 0.16, 0.026),
    makeLeg(geos, mats.rabbitBody, mats.whiteTuft, -0.11, -0.06, -0.1, 0.18, 0.038),
    makeLeg(geos, mats.rabbitBody, mats.whiteTuft, 0.11, -0.06, -0.1, 0.18, 0.038),
  ];
  for (const l of legs) bodyPivot.add(l);

  return { root, bodyPivot, neckPivot, legs, wings: [], plumes: [], subBirds: [] };
}

function buildSingleBird(
  geos: SharedGeos,
  bodyMat: THREE.Material,
  neckMat: THREE.Material,
  wingMat: THREE.Material,
  mats: LivingWorldMaterialBank,
  scale: number,
): { group: THREE.Group; wingL: THREE.Group; wingR: THREE.Group } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(geos.sphereLow, bodyMat);
  body.scale.set(0.18, 0.16, 0.34);
  const neck = new THREE.Mesh(geos.sphereLow, neckMat);
  neck.scale.set(0.12, 0.14, 0.14);
  neck.position.set(0, 0.09, 0.13);
  const head = new THREE.Mesh(geos.sphereLow, bodyMat);
  head.scale.set(0.11, 0.11, 0.13);
  head.position.set(0, 0.17, 0.17);
  const beak = new THREE.Mesh(geos.coneSmall, mats.beakGold);
  beak.scale.set(0.18, 0.22, 0.18);
  beak.rotation.x = Math.PI * 0.5;
  beak.position.set(0, 0.16, 0.25);
  const tail = new THREE.Mesh(geos.wingBlade, wingMat);
  tail.scale.set(0.32, 1, 0.62);
  tail.rotation.y = Math.PI * 0.5;
  tail.position.set(0, 0.01, -0.17);
  group.add(body, neck, head, beak, tail);

  const wingL = new THREE.Group();
  wingL.position.set(-0.08, 0.04, 0.03);
  const wlMesh = new THREE.Mesh(geos.wingBlade, wingMat);
  wlMesh.scale.set(-1.1, 1, 1.0);
  wingL.add(wlMesh);

  const wingR = new THREE.Group();
  wingR.position.set(0.08, 0.04, 0.03);
  const wrMesh = new THREE.Mesh(geos.wingBlade, wingMat);
  wrMesh.scale.set(1.1, 1, 1.0);
  wingR.add(wrMesh);

  group.add(wingL, wingR);
  group.scale.setScalar(scale);
  return { group, wingL, wingR };
}

function buildPigeonGroupModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  seed: number,
  withPerch: boolean,
): Pick<WildlifeActor, 'root' | 'bodyPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'> {
  const root = new THREE.Group();
  if (withPerch) {
    const ledge = new THREE.Mesh(geos.ruinBlock, mats.ruinPerch);
    ledge.scale.set(1.35, 1.0, 1.15);
    ledge.position.set(0, -0.36, 0);
    root.add(ledge);
  }
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const subBirds: WildlifeActor['subBirds'] = [];
  const count = 3 + (seed % 2);
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + seededUnit(seed + i * 7) * 0.8;
    const rad = 0.26 + seededUnit(seed + i * 11) * 0.34;
    const bird = buildSingleBird(geos, mats.pigeonBody, mats.pigeonNeck, mats.pigeonWing, mats, 1.05);
    const hx = Math.cos(ang) * rad;
    const hz = Math.sin(ang) * rad;
    bird.group.position.set(hx, 0.14, hz);
    bird.group.rotation.y = seededUnit(seed + i * 17) * Math.PI * 2;
    bodyPivot.add(bird.group);
    subBirds.push({
      group: bird.group,
      wingL: bird.wingL,
      wingR: bird.wingR,
      homeX: hx,
      homeY: 0.14,
      homeZ: hz,
      phase: i * 1.7 + seededUnit(seed + i) * 3,
      flightDelay: i * 0.11,
      flightDirX: (seededUnit(seed + i * 23) - 0.5) * 1.4,
      flightDirZ: -0.7 - seededUnit(seed + i * 31) * 0.6,
    });
  }

  return { root, bodyPivot, legs: [], wings: [], plumes: [], subBirds };
}

function buildSparrowFlockModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  seed: number,
): Pick<WildlifeActor, 'root' | 'bodyPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'> {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const subBirds: WildlifeActor['subBirds'] = [];
  const count = 4;
  for (let i = 0; i < count; i++) {
    const bird = buildSingleBird(geos, mats.sparrowBody, mats.sparrowBreast, mats.sparrowBody, mats, 0.78);
    const hx = (seededUnit(seed + i * 13) - 0.5) * 2.2;
    const hy = (seededUnit(seed + i * 19) - 0.5) * 1.1;
    const hz = (seededUnit(seed + i * 29) - 0.5) * 2.4;
    bird.group.position.set(hx, hy, hz);
    bodyPivot.add(bird.group);
    subBirds.push({
      group: bird.group,
      wingL: bird.wingL,
      wingR: bird.wingR,
      homeX: hx,
      homeY: hy,
      homeZ: hz,
      phase: i * 1.45 + seededUnit(seed + i * 5) * 4,
      flightDelay: i * 0.08,
      flightDirX: (seededUnit(seed + i * 41) - 0.5) * 1.8,
      flightDirZ: -0.9 - seededUnit(seed + i * 37) * 0.5,
    });
  }

  return { root, bodyPivot, legs: [], wings: [], plumes: [], subBirds };
}

function buildPeacockModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
): Pick<WildlifeActor, 'root' | 'bodyPivot' | 'neckPivot' | 'tailPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'> {
  const root = new THREE.Group();
  addShadow(root, geos, mats, 0.68);
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.52;
  root.add(bodyPivot);

  const body = new THREE.Mesh(geos.sphereMid, mats.peacockBody);
  body.scale.set(0.36, 0.34, 0.66);
  bodyPivot.add(body);

  // Graceful S-curved sapphire neck + head + 3-plume golden crest
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.1, 0.28);
  bodyPivot.add(neckPivot);

  const neck = new THREE.Mesh(geos.capsuleLimb, mats.peacockBody);
  neck.scale.set(0.76, 0.72, 0.76);
  neck.position.set(0, 0.24, 0.05);
  neck.rotation.x = 0.16;
  const head = new THREE.Mesh(geos.sphereLow, mats.peacockBody);
  head.scale.set(0.15, 0.15, 0.2);
  head.position.set(0, 0.49, 0.11);
  const beak = new THREE.Mesh(geos.coneSmall, mats.beakGold);
  beak.scale.set(0.24, 0.32, 0.24);
  beak.rotation.x = Math.PI * 0.5;
  beak.position.set(0, 0.48, 0.23);
  neckPivot.add(neck, head, beak);

  for (const offset of [-0.025, 0, 0.025]) {
    const crest = new THREE.Mesh(geos.coneSmall, mats.beakGold);
    crest.scale.set(0.08, 0.36, 0.08);
    crest.position.set(offset, 0.61, 0.09);
    crest.rotation.z = -offset * 6;
    neckPivot.add(crest);
  }

  // Articulated 9-plume iridescent tail fan!
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.06, -0.32);
  bodyPivot.add(tailPivot);

  const plumes: THREE.Mesh[] = [];
  const plumeCount = 9;
  for (let i = 0; i < plumeCount; i++) {
    const norm = (i / (plumeCount - 1)) * 2 - 1; // -1 .. +1
    const plume = new THREE.Mesh(geos.peacockPlume, mats.peacockFeather);
    const lenScale = 1.08 - Math.abs(norm) * 0.22;
    plume.scale.set(1.0, lenScale, 1.0);
    plume.position.set(0, 0, -Math.abs(norm) * 0.03);
    plume.userData.fanAngle = norm * 1.18;
    tailPivot.add(plume);
    plumes.push(plume);
  }

  const legs = [
    makeLeg(geos, mats.beakGold, mats.beakGold, -0.09, -0.1, 0.02, 0.42, 0.022),
    makeLeg(geos, mats.beakGold, mats.beakGold, 0.09, -0.1, 0.02, 0.42, 0.022),
  ];
  for (const l of legs) bodyPivot.add(l);

  return { root, bodyPivot, neckPivot, tailPivot, legs, wings: [], plumes, subBirds: [] };
}

function buildCorruptedVineModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  seed: number,
  ownedGeos: THREE.BufferGeometry[],
): Pick<CorruptedFloraActor, 'root' | 'fronds' | 'vines' | 'coreMesh'> {
  const root = new THREE.Group();
  const vines: THREE.Object3D[] = [];
  const fronds: THREE.Object3D[] = [];

  // Mossy corrupted ruin stone anchor
  const baseStone = new THREE.Mesh(geos.ruinBlock, mats.ruinPerch);
  baseStone.scale.set(0.95, 0.65, 0.95);
  baseStone.position.y = 0.16;
  root.add(baseStone);

  // 4 sinuous twisting dark vines & creeping roots
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + seededUnit(seed + i * 7) * 0.7;
    const h = 1.15 + seededUnit(seed + i * 13) * 0.85;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(ang) * 0.55, 0, Math.sin(ang) * 0.55),
      new THREE.Vector3(Math.cos(ang + 0.5) * 0.36, h * 0.35, Math.sin(ang + 0.5) * 0.36),
      new THREE.Vector3(Math.cos(ang - 0.35) * 0.44, h * 0.72, Math.sin(ang - 0.35) * 0.44),
      new THREE.Vector3(Math.cos(ang + 0.25) * 0.24, h, Math.sin(ang + 0.25) * 0.24),
    ]);
    const tube = new THREE.TubeGeometry(curve, 11, 0.045 - i * 0.004, 6, false);
    ownedGeos.push(tube);
    const vinePivot = new THREE.Group();
    vinePivot.add(new THREE.Mesh(tube, mats.corruptedRoot));

    const leaf = new THREE.Mesh(geos.serratedLeaf, mats.corruptedLeaf);
    leaf.scale.setScalar(0.55);
    leaf.position.set(Math.cos(ang) * 0.32, h * 0.65, Math.sin(ang) * 0.32);
    leaf.rotation.y = ang;
    vinePivot.add(leaf);
    fronds.push(leaf);

    root.add(vinePivot);
    vines.push(vinePivot);
  }

  // Subtle glowing corrupted sap node nestled inside roots
  const coreMesh = new THREE.Mesh(geos.sphereLow, mats.corruptedCore);
  coreMesh.scale.set(0.24, 0.2, 0.24);
  coreMesh.position.set(0, 0.52, 0);
  root.add(coreMesh);

  return { root, fronds, vines, coreMesh };
}

function buildBlightFernModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  seed: number,
): Pick<CorruptedFloraActor, 'root' | 'fronds' | 'vines' | 'coreMesh'> {
  const root = new THREE.Group();
  const fronds: THREE.Object3D[] = [];

  const bulb = new THREE.Mesh(geos.sphereLow, mats.corruptedRoot);
  bulb.scale.set(0.66, 0.42, 0.66);
  bulb.position.y = 0.16;
  root.add(bulb);

  const count = 7;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + seededUnit(seed + i * 5) * 0.35;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.22, 0);
    pivot.rotation.y = ang;
    pivot.rotation.x = 0.28 + (i % 2) * 0.16;
    const frond = new THREE.Mesh(geos.serratedLeaf, mats.corruptedLeaf);
    frond.scale.set(0.95, 0.92 + (i % 3) * 0.18, 1.0);
    pivot.add(frond);
    root.add(pivot);
    fronds.push(pivot);
  }

  const coreMesh = new THREE.Mesh(geos.sphereLow, mats.corruptedCore);
  coreMesh.scale.setScalar(0.22);
  coreMesh.position.y = 0.36;
  root.add(coreMesh);

  return { root, fronds, vines: [], coreMesh };
}

function buildCarnivorousMawModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  seed: number,
  ownedGeos: THREE.BufferGeometry[],
): Pick<CorruptedFloraActor, 'root' | 'upperJaw' | 'lowerJaw' | 'coreMesh' | 'fronds' | 'vines'> {
  const root = new THREE.Group();
  const vines: THREE.Object3D[] = [];
  const fronds: THREE.Object3D[] = [];

  // Twisted creeping root crown
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + seededUnit(seed + i * 9);
    const rootCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.18, 0),
      new THREE.Vector3(Math.cos(ang) * 0.45, 0.12, Math.sin(ang) * 0.45),
      new THREE.Vector3(Math.cos(ang + 0.3) * 0.92, 0.02, Math.sin(ang + 0.3) * 0.92),
    ]);
    const rGeo = new THREE.TubeGeometry(rootCurve, 7, 0.055, 6, false);
    ownedGeos.push(rGeo);
    const rm = new THREE.Mesh(rGeo, mats.corruptedRoot);
    root.add(rm);
    vines.push(rm);
  }

  // Sinuous thick carnivorous stalk rising up & tilting forward
  const stalkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.1, 0),
    new THREE.Vector3(0.06, 0.65, -0.06),
    new THREE.Vector3(-0.04, 1.15, 0.12),
    new THREE.Vector3(0, 1.48, 0.34),
  ]);
  const stalkGeo = new THREE.TubeGeometry(stalkCurve, 10, 0.09, 7, false);
  ownedGeos.push(stalkGeo);
  root.add(new THREE.Mesh(stalkGeo, mats.corruptedRoot));

  // Base collar leaves
  for (let i = 0; i < 4; i++) {
    const leaf = new THREE.Mesh(geos.serratedLeaf, mats.corruptedLeaf);
    leaf.scale.setScalar(0.68);
    leaf.position.set(0, 0.24, 0);
    leaf.rotation.set(0.65, (i / 4) * Math.PI * 2, 0);
    root.add(leaf);
    fronds.push(leaf);
  }

  // Head calyx + hinged serrated upper & lower jaws + glowing corrupted throat core
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.48, 0.36);
  root.add(headGroup);

  const coreMesh = new THREE.Mesh(geos.sphereLow, mats.corruptedCore);
  coreMesh.scale.set(0.28, 0.24, 0.32);
  coreMesh.position.set(0, 0, 0.06);
  headGroup.add(coreMesh);

  const buildJawHalf = (isUpper: boolean): THREE.Group => {
    const pivot = new THREE.Group();
    const shell = new THREE.Mesh(geos.mawJaw, mats.corruptedMaw);
    shell.position.set(0, 0, 0.28);
    if (!isUpper) shell.rotation.z = Math.PI;
    pivot.add(shell);

    // Pale organic fang-thorns lining jaw rim
    for (let t = -2; t <= 2; t++) {
      const fang = new THREE.Mesh(geos.coneSmall, mats.thornPale);
      fang.scale.set(0.22, 0.42, 0.22);
      const ang = t * 0.45;
      fang.position.set(Math.sin(ang) * 0.31, isUpper ? -0.03 : 0.03, 0.28 + Math.cos(ang) * 0.42);
      fang.rotation.x = isUpper ? Math.PI : 0;
      pivot.add(fang);
    }
    return pivot;
  };

  const upperJaw = buildJawHalf(true);
  const lowerJaw = buildJawHalf(false);
  headGroup.add(upperJaw, lowerJaw);

  return { root, upperJaw, lowerJaw, coreMesh, fronds, vines };
}

function buildSporeBulbModel(
  geos: SharedGeos,
  mats: LivingWorldMaterialBank,
  seed: number,
  ownedGeos: THREE.BufferGeometry[],
): Pick<CorruptedFloraActor, 'root' | 'coreMesh' | 'fronds' | 'vines'> {
  const root = new THREE.Group();
  const vines: THREE.Object3D[] = [];
  const fronds: THREE.Object3D[] = [];

  // Claw-like root ribs cradling a glowing corrupted spore sac
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + seededUnit(seed + i * 11) * 0.3;
    const ribCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(ang) * 0.48, 0, Math.sin(ang) * 0.48),
      new THREE.Vector3(Math.cos(ang) * 0.56, 0.55, Math.sin(ang) * 0.56),
      new THREE.Vector3(Math.cos(ang) * 0.26, 1.05, Math.sin(ang) * 0.26),
    ]);
    const ribGeo = new THREE.TubeGeometry(ribCurve, 8, 0.048, 5, false);
    ownedGeos.push(ribGeo);
    const rib = new THREE.Mesh(ribGeo, mats.corruptedRoot);
    root.add(rib);
    vines.push(rib);
  }

  const coreMesh = new THREE.Mesh(geos.sphereMid, mats.corruptedCore);
  coreMesh.scale.set(0.62, 0.78, 0.62);
  coreMesh.position.y = 0.58;
  root.add(coreMesh);

  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(geos.serratedLeaf, mats.corruptedLeaf);
    leaf.scale.setScalar(0.55);
    leaf.position.set(0, 0.14, 0);
    leaf.rotation.set(0.8, (i / 3) * Math.PI * 2, 0);
    root.add(leaf);
    fronds.push(leaf);
  }

  return { root, coreMesh, fronds, vines };
}

export class LivingWorldManager {
  public readonly group = new THREE.Group();

  private textures: LivingWorldTextures;
  private mats: LivingWorldMaterialBank;
  private geos: SharedGeos;
  private ownedGeos: THREE.BufferGeometry[] = [];

  private wildlife: WildlifeActor[] = [];
  private flora: CorruptedFloraActor[] = [];
  private profile: BiomeLivingProfile;
  private recentWildlife: WildlifeSpecies[] = [];
  private recentFlora: CorruptedFloraKind[] = [];
  private recycleCounter = 1;
  private timeSinceLastCrossing = 9;
  private frameCounter = 0;
  private densityScale = 1;
  private onSporeBurst?: (worldPos: THREE.Vector3, hexColor: string) => void;

  // Scratch vector for zero-GC spore burst emission
  private readonly _burstPos = new THREE.Vector3();

  constructor(
    contactShadowMap: THREE.Texture | null,
    onSporeBurst?: (worldPos: THREE.Vector3, hexColor: string) => void,
  ) {
    this.textures = createLivingWorldTextures();
    this.mats = createMaterialBank(this.textures, contactShadowMap);
    this.geos = createSharedGeos();
    this.profile = getBiomeLivingProfile('jungle_temple');
    this.onSporeBurst = onSporeBurst;
    this.group.name = 'living_world_root';
  }

  public setDensityScale(foliageDensity: number, effectsQuality: 'low' | 'medium' | 'high'): void {
    const eff = effectsQuality === 'high' ? 1.0 : effectsQuality === 'medium' ? 0.78 : 0.55;
    this.densityScale = THREE.MathUtils.clamp(foliageDensity * eff, 0.35, 1.0);
  }

  public applyBiome(level: LevelDef, branches: readonly TrackBranch[] = [], baseTrackZ = 0): void {
    this.clearActors();
    this.profile = getBiomeLivingProfile(level.architecture);
    this.recentWildlife = [];
    this.recentFlora = [];
    this.recycleCounter = level.id * 97 + 13 + Math.floor(baseTrackZ * 0.3);
    this.timeSinceLastCrossing = 8;

    // Tint corrupted vegetation subtly to harmonize with each realm's atmosphere
    this.mats.corruptedLeaf.color.set(this.profile.corruptedFoliageTint);
    this.mats.corruptedCore.color.set(this.profile.corruptedCoreColor);
    this.mats.corruptedCore.emissive.set(this.profile.corruptedCoreColor);
    this.mats.ruinPerch.color.set(level.palette.archPrimary);

    const wCount = Math.max(5, Math.round(this.profile.wildlifeCount * this.densityScale));
    const fCount = Math.max(4, Math.round(this.profile.floraCount * this.densityScale));

    // Seed initial wildlife smoothly along baseTrackZ + 9m .. 115m (works for both title & mid-run Endless transitions!)
    for (let i = 0; i < wCount; i++) {
      const seed = this.recycleCounter++;
      const species = selectWeightedNonRepeating(this.profile.wildlifeWeights, seed, this.recentWildlife);
      this.recentWildlife.push(species);
      if (this.recentWildlife.length > 4) this.recentWildlife.shift();

      const trackZ = baseTrackZ + 9 + i * (104 / wCount) + seededUnit(seed * 3) * 3.8;
      const actor = this.createWildlifeActor(species, trackZ, seed, branches);
      this.wildlife.push(actor);
      this.group.add(actor.root);
    }

    // Seed corrupted/zombie vegetation naturally along ruin flanks baseTrackZ + 11m .. 114m
    for (let i = 0; i < fCount; i++) {
      const seed = this.recycleCounter++;
      const kind = selectWeightedNonRepeating(this.profile.floraWeights, seed, this.recentFlora);
      this.recentFlora.push(kind);
      if (this.recentFlora.length > 3) this.recentFlora.shift();

      const trackZ = baseTrackZ + 11 + i * (102 / fCount) + seededUnit(seed * 5) * 4.2;
      const plant = this.createFloraActor(kind, trackZ, seed, branches);
      this.flora.push(plant);
      this.group.add(plant.root);
    }
  }

  private createWildlifeActor(
    species: WildlifeSpecies,
    trackZ: number,
    seed: number,
    branches: readonly TrackBranch[],
  ): WildlifeActor {
    const place = computeSafeWildlifePlacement(species, trackZ, seed, branches);
    let built: Pick<
      WildlifeActor,
      'root' | 'bodyPivot' | 'neckPivot' | 'tailPivot' | 'legs' | 'wings' | 'plumes' | 'subBirds'
    >;

    switch (species) {
      case 'deer':
        built = buildDeerModel(this.geos, this.mats, seed % 2 === 0, this.ownedGeos);
        break;
      case 'tiger':
        built = buildTigerModel(this.geos, this.mats, this.ownedGeos);
        break;
      case 'cat':
        built = buildCatModel(this.geos, this.mats, seed, place.y > -0.2, this.ownedGeos);
        break;
      case 'dog':
        built = buildDogModel(this.geos, this.mats, this.ownedGeos);
        break;
      case 'rabbit':
        built = buildRabbitModel(this.geos, this.mats);
        break;
      case 'pigeon':
        built = buildPigeonGroupModel(this.geos, this.mats, seed, place.y > -0.2);
        break;
      case 'peacock':
        built = buildPeacockModel(this.geos, this.mats);
        break;
      case 'sparrow':
      default:
        built = buildSparrowFlockModel(this.geos, this.mats, seed);
        break;
    }

    const scaleVar = 1.06 + seededUnit(seed * 23) * 0.24;
    built.root.scale.setScalar(scaleVar);
    built.root.position.set(place.x, place.y, -trackZ);
    built.root.rotation.y = place.yaw;

    return {
      species,
      ...built,
      trackZ,
      baseX: place.x,
      baseY: place.y,
      baseYaw: place.yaw,
      side: place.side,
      behavior: pickInitialWildlifeBehavior(species, seed),
      behaviorTimer: 0,
      phase: seededUnit(seed * 31) * Math.PI * 2,
      crossingActive: false,
      crossingProgress: 0,
      crossingStartX: place.x,
      crossingEndX: -place.x,
      frameSkip: seed % 4,
      seed,
    };
  }

  private createFloraActor(
    kind: CorruptedFloraKind,
    trackZ: number,
    seed: number,
    branches: readonly TrackBranch[],
  ): CorruptedFloraActor {
    const place = computeSafeFloraPlacement(kind, trackZ, seed, branches);
    let built: Pick<CorruptedFloraActor, 'root' | 'upperJaw' | 'lowerJaw' | 'coreMesh' | 'fronds' | 'vines'>;
    switch (kind) {
      case 'corrupted_vine':
        built = buildCorruptedVineModel(this.geos, this.mats, seed, this.ownedGeos);
        break;
      case 'carnivorous_maw':
        built = buildCarnivorousMawModel(this.geos, this.mats, seed, this.ownedGeos);
        break;
      case 'spore_bulb':
        built = buildSporeBulbModel(this.geos, this.mats, seed, this.ownedGeos);
        break;
      case 'blight_fern':
      default:
        built = buildBlightFernModel(this.geos, this.mats, seed);
        break;
    }

    const scaleVar = 1.04 + seededUnit(seed * 19) * 0.3;
    built.root.scale.setScalar(scaleVar);
    built.root.position.set(place.x, place.y, -trackZ);
    built.root.rotation.y = place.yaw;

    return {
      kind,
      ...built,
      trackZ,
      baseX: place.x,
      baseY: place.y,
      baseYaw: place.yaw,
      side: place.side,
      behavior: 'idle',
      reactTimer: 0,
      snapped: false,
      phase: seededUnit(seed * 29) * Math.PI * 2,
      seed,
    };
  }

  public resetForNewRun(branches: readonly TrackBranch[]): void {
    this.timeSinceLastCrossing = 8;
    const wCount = this.wildlife.length;
    for (let i = 0; i < wCount; i++) {
      const a = this.wildlife[i];
      const seed = this.recycleCounter++;
      const trackZ = 14 + i * (102 / Math.max(1, wCount)) + seededUnit(seed * 3) * 4;
      this.repositionWildlife(a, trackZ, seed, branches);
    }
    const fCount = this.flora.length;
    for (let i = 0; i < fCount; i++) {
      const f = this.flora[i];
      const seed = this.recycleCounter++;
      const trackZ = 16 + i * (100 / Math.max(1, fCount)) + seededUnit(seed * 5) * 4;
      this.repositionFlora(f, trackZ, seed, branches);
    }
  }

  private repositionWildlife(
    actor: WildlifeActor,
    newTrackZ: number,
    seed: number,
    branches: readonly TrackBranch[],
  ): void {
    const place = computeSafeWildlifePlacement(actor.species, newTrackZ, seed, branches);
    actor.trackZ = newTrackZ;
    actor.baseX = place.x;
    actor.baseY = place.y;
    actor.baseYaw = place.yaw;
    actor.side = place.side;
    actor.behavior = pickInitialWildlifeBehavior(actor.species, seed);
    actor.behaviorTimer = 0;
    actor.crossingActive = false;
    actor.crossingProgress = 0;
    actor.root.position.set(place.x, place.y, -newTrackZ);
    actor.root.rotation.set(0, place.yaw, 0);
    actor.bodyPivot.rotation.set(0, 0, 0);
    actor.bodyPivot.position.x = 0;
    actor.bodyPivot.position.z = 0;
    for (const sb of actor.subBirds) {
      sb.group.position.set(sb.homeX, sb.homeY, sb.homeZ);
      sb.group.rotation.set(0, actor.phase + sb.phase, 0);
    }
  }

  private repositionFlora(
    plant: CorruptedFloraActor,
    newTrackZ: number,
    seed: number,
    branches: readonly TrackBranch[],
  ): void {
    const place = computeSafeFloraPlacement(plant.kind, newTrackZ, seed, branches);
    plant.trackZ = newTrackZ;
    plant.baseX = place.x;
    plant.baseY = place.y;
    plant.baseYaw = place.yaw;
    plant.side = place.side;
    plant.behavior = 'idle';
    plant.reactTimer = 0;
    plant.snapped = false;
    plant.root.position.set(place.x, place.y, -newTrackZ);
    plant.root.rotation.set(0, place.yaw, 0);
  }

  public update(params: {
    dt: number;
    timeSec: number;
    playerTrackZ: number;
    runnerSpeed: number;
    isPlaying: boolean;
    introActive: boolean;
    branches: readonly TrackBranch[];
  }): void {
    const { dt, timeSec, playerTrackZ, runnerSpeed, isPlaying, introActive, branches } = params;
    this.frameCounter++;
    this.timeSinceLastCrossing += dt;

    // 1. Update Wildlife (with 3-tier LOD + reactive environmental behaviors + smooth recycling!)
    for (let i = 0; i < this.wildlife.length; i++) {
      const a = this.wildlife[i];
      let distAhead = a.trackZ - playerTrackZ;

      if (isPlaying && distAhead < -16) {
        const seed = this.recycleCounter++;
        const newZ = playerTrackZ + 100 + seededUnit(seed * 7) * 20;
        this.repositionWildlife(a, newZ, seed, branches);
        distAhead = a.trackZ - playerTrackZ;
      }

      const lod = computeLodTier(distAhead);
      a.root.visible = lod !== 'culled';
      if (!a.root.visible) continue;

      // Distance-based LOD animation throttling: full 60Hz near, 30Hz mid, 15Hz far!
      if (lod === 'mid' && ((this.frameCounter + a.frameSkip) & 1) !== 0) continue;
      if (lod === 'far' && ((this.frameCounter + a.frameSkip) & 3) !== 0) continue;

      const stepDt = lod === 'near' ? dt : lod === 'mid' ? dt * 2 : dt * 4;
      a.behaviorTimer += stepDt;

      this.animateWildlifeActor(a, stepDt, timeSec, distAhead, runnerSpeed, isPlaying, introActive, branches);
    }

    // 2. Update Corrupted / Zombie Vegetation (organic movement + snap/spore reaction!)
    for (let i = 0; i < this.flora.length; i++) {
      const f = this.flora[i];
      let distAhead = f.trackZ - playerTrackZ;

      if (isPlaying && distAhead < -15) {
        const seed = this.recycleCounter++;
        const newZ = playerTrackZ + 98 + seededUnit(seed * 11) * 20;
        this.repositionFlora(f, newZ, seed, branches);
        distAhead = f.trackZ - playerTrackZ;
      }

      const lod = computeLodTier(distAhead);
      f.root.visible = lod !== 'culled';
      if (!f.root.visible) continue;
      if (lod === 'mid' && ((this.frameCounter + i) & 1) !== 0) continue;
      if (lod === 'far' && ((this.frameCounter + i) & 3) !== 0) continue;

      const stepDt = lod === 'near' ? dt : lod === 'mid' ? dt * 2 : dt * 4;
      this.animateFloraActor(f, stepDt, timeSec, distAhead, playerTrackZ, isPlaying);
    }
  }

  private animateWildlifeActor(
    a: WildlifeActor,
    dt: number,
    timeSec: number,
    distAhead: number,
    runnerSpeed: number,
    isPlaying: boolean,
    introActive: boolean,
    branches: readonly TrackBranch[],
  ): void {
    const t = timeSec + a.phase;

    switch (a.species) {
      case 'deer': {
        // Rare safe distant crossing leap across the far causeway (clears long before runner arrives!)
        if (
          isPlaying &&
          !a.crossingActive &&
          a.behavior !== 'fleeing' &&
          canTriggerDistantCrossing({
            species: 'deer',
            distAhead,
            runnerSpeed,
            introActive,
            inBranchZone: Math.abs(a.baseX) > 15,
            allowsCrossing: this.profile.allowsDistantCrossing,
            timeSinceLastCrossing: this.timeSinceLastCrossing,
          }) &&
          seededUnit(a.seed * 7 + 19) < 0.24
        ) {
          a.crossingActive = true;
          a.crossingProgress = 0;
          a.crossingStartX = a.baseX;
          a.crossingEndX = -a.side * (6.8 + seededUnit(a.seed * 5) * 3.5);
          a.behavior = 'fleeing';
          this.timeSinceLastCrossing = 0;
        }

        if (a.crossingActive) {
          a.crossingProgress = Math.min(1, a.crossingProgress + dt * 0.92);
          const x = THREE.MathUtils.lerp(a.crossingStartX, a.crossingEndX, a.crossingProgress);
          const leap = Math.abs(Math.sin(a.crossingProgress * Math.PI * 3)) * 0.62;
          a.root.position.set(x, a.baseY + leap + (Math.abs(x) < 4.5 ? 0.72 : 0), -a.trackZ);
          a.root.rotation.y = a.crossingEndX > a.crossingStartX ? Math.PI * 0.5 : -Math.PI * 0.5;
          const g = Math.sin(t * 14);
          if (a.legs.length >= 4) {
            a.legs[0].rotation.x = g * 0.85;
            a.legs[1].rotation.x = g * 0.75 + 0.18;
            a.legs[2].rotation.x = -g * 0.85;
            a.legs[3].rotation.x = -g * 0.75 - 0.18;
          }
          if (a.neckPivot) a.neckPivot.rotation.x = 0.12;
          break;
        }

        if (isPlaying && distAhead < 38 && distAhead > 22 && a.behavior === 'grazing') {
          a.behavior = 'alert';
        } else if (isPlaying && distAhead < 22 && distAhead > -4 && a.behavior !== 'fleeing') {
          a.behavior = 'fleeing';
        }

        if (a.behavior === 'grazing') {
          if (a.neckPivot) {
            a.neckPivot.rotation.x = 0.82 + Math.sin(t * 2.1) * 0.14;
            a.neckPivot.rotation.y = Math.sin(t * 0.7) * 0.12;
          }
          if (a.tailPivot) a.tailPivot.rotation.z = Math.sin(t * 4.5) * 0.22;
          for (const l of a.legs) l.rotation.x = THREE.MathUtils.damp(l.rotation.x, 0, 8, dt);
        } else if (a.behavior === 'alert') {
          if (a.neckPivot) {
            a.neckPivot.rotation.x = THREE.MathUtils.damp(a.neckPivot.rotation.x, -0.06, 7, dt);
            a.neckPivot.rotation.y = Math.sin(t * 1.4) * 0.26;
          }
        } else {
          // Bound gracefully outward into jungle foliage
          const fleeDir = a.side;
          a.root.position.x += fleeDir * dt * 6.8;
          a.root.position.z -= dt * 3.2;
          a.root.rotation.y = THREE.MathUtils.damp(a.root.rotation.y, fleeDir > 0 ? 1.12 : -1.12, 6, dt);
          const gal = Math.sin(t * 13);
          a.bodyPivot.position.y = 0.92 + Math.abs(gal) * 0.24;
          if (a.legs.length >= 4) {
            a.legs[0].rotation.x = gal * 0.8;
            a.legs[1].rotation.x = gal * 0.72;
            a.legs[2].rotation.x = -gal * 0.82;
            a.legs[3].rotation.x = -gal * 0.72;
          }
          if (a.neckPivot) a.neckPivot.rotation.x = 0.08;
        }
        break;
      }

      case 'tiger': {
        if (a.behavior === 'resting') {
          a.bodyPivot.position.y = 0.42 + Math.sin(t * 1.6) * 0.025;
          for (const l of a.legs) l.rotation.x = 1.15;
          if (a.neckPivot) {
            a.neckPivot.rotation.x = 0.1;
            a.neckPivot.rotation.y = Math.sin(t * 0.55) * 0.25;
          }
          if (a.tailPivot) a.tailPivot.rotation.y = Math.sin(t * 1.9) * 0.45;
        } else if (a.behavior === 'emerging') {
          // Rare dramatic emerge from jungle foliage toward outer bank (clamped strictly >= 6.3m safe!)
          const trigger = isPlaying && distAhead < 42 && distAhead > 6;
          const targetX = trigger ? a.side * Math.max(6.35, Math.abs(a.baseX) - 2.6) : a.baseX;
          a.root.position.x = THREE.MathUtils.damp(a.root.position.x, targetX, 2.2, dt);
          const moving = Math.abs(a.root.position.x - targetX) > 0.12;
          const stride = moving ? Math.sin(t * 6.5) : Math.sin(t * 1.4) * 0.08;
          a.bodyPivot.position.y = 0.78 + Math.abs(stride) * 0.05;
          if (a.legs.length >= 4) {
            a.legs[0].rotation.x = stride * 0.58;
            a.legs[1].rotation.x = -stride * 0.58;
            a.legs[2].rotation.x = -stride * 0.58;
            a.legs[3].rotation.x = stride * 0.58;
          }
          if (a.tailPivot) a.tailPivot.rotation.y = Math.sin(t * 2.8) * 0.4;
        } else {
          // Prowling naturally through background terrain
          const drift = Math.sin(t * 0.42) * 2.6;
          const safeLateral = Math.max(7.2, Math.abs(a.baseX) + drift);
          a.root.position.x = a.side * safeLateral;
          a.root.rotation.y = a.baseYaw + Math.cos(t * 0.42) * 0.35;
          const s = Math.sin(t * 5.2);
          a.bodyPivot.position.y = 0.78 + Math.abs(s) * 0.05;
          if (a.legs.length >= 4) {
            a.legs[0].rotation.x = s * 0.52;
            a.legs[1].rotation.x = -s * 0.52;
            a.legs[2].rotation.x = -s * 0.52;
            a.legs[3].rotation.x = s * 0.52;
          }
          if (a.tailPivot) a.tailPivot.rotation.y = Math.sin(t * 2.4) * 0.38;
        }
        break;
      }

      case 'cat': {
        if (isPlaying && distAhead < 22 && distAhead > 0 && a.behavior !== 'walking') {
          a.behavior = 'alert';
        }
        if (a.behavior === 'sleeping') {
          a.bodyPivot.position.y = 0.16;
          a.bodyPivot.rotation.z = 0.22;
          for (const l of a.legs) l.rotation.x = 1.25;
          if (a.neckPivot) {
            a.neckPivot.rotation.x = 0.42;
            a.neckPivot.rotation.y = 0.55;
          }
          if (a.tailPivot) a.tailPivot.rotation.y = 0.8 + Math.sin(t * 1.1) * 0.08;
        } else if (a.behavior === 'sitting' || a.behavior === 'alert') {
          a.bodyPivot.position.y = 0.27;
          a.bodyPivot.rotation.x = -0.35;
          if (a.legs.length >= 4) {
            a.legs[0].rotation.x = 0.32;
            a.legs[1].rotation.x = 0.32;
            a.legs[2].rotation.x = 1.15;
            a.legs[3].rotation.x = 1.15;
          }
          if (a.neckPivot) {
            a.neckPivot.rotation.x = 0.25;
            a.neckPivot.rotation.y = a.behavior === 'alert' ? -a.side * 0.55 : Math.sin(t * 1.2) * 0.22;
          }
          if (a.tailPivot) a.tailPivot.rotation.z = Math.sin(t * (a.behavior === 'alert' ? 5.2 : 2.2)) * 0.35;
        } else {
          // Graceful feline walk along outer ruin ledge
          const walkZ = Math.sin(t * 0.7) * 1.6;
          a.root.position.z = -a.trackZ + walkZ;
          const s = Math.sin(t * 6.8);
          a.bodyPivot.position.y = 0.34 + Math.abs(s) * 0.03;
          if (a.legs.length >= 4) {
            a.legs[0].rotation.x = s * 0.55;
            a.legs[1].rotation.x = -s * 0.55;
            a.legs[2].rotation.x = -s * 0.55;
            a.legs[3].rotation.x = s * 0.55;
          }
          if (a.tailPivot) a.tailPivot.rotation.z = Math.sin(t * 3.1) * 0.28;
        }
        break;
      }

      case 'dog': {
        if (a.behavior === 'playing') {
          const bounce = Math.abs(Math.sin(t * 6.5));
          a.bodyPivot.position.y = 0.56 + bounce * 0.14;
          a.bodyPivot.rotation.x = Math.sin(t * 3.2) * 0.22;
          if (a.tailPivot) a.tailPivot.rotation.z = Math.sin(t * 15) * 0.62;
          if (a.legs.length >= 4) {
            a.legs[0].rotation.x = -bounce * 0.55;
            a.legs[1].rotation.x = -bounce * 0.55;
            a.legs[2].rotation.x = bounce * 0.45;
            a.legs[3].rotation.x = bounce * 0.45;
          }
        } else {
          // Exploring/trotting energetically beside ruins & outer banks
          const offsetZ = Math.sin(t * 0.65) * 2.4;
          a.root.position.z = -a.trackZ + offsetZ;
          const s = Math.sin(t * 8.2);
          a.bodyPivot.position.y = 0.56 + Math.abs(s) * 0.06;
          if (a.legs.length >= 4) {
            a.legs[0].rotation.x = s * 0.65;
            a.legs[1].rotation.x = -s * 0.65;
            a.legs[2].rotation.x = -s * 0.65;
            a.legs[3].rotation.x = s * 0.65;
          }
          if (a.neckPivot) a.neckPivot.rotation.x = a.behavior === 'exploring' ? 0.35 + Math.sin(t * 3) * 0.14 : 0.05;
          if (a.tailPivot) a.tailPivot.rotation.z = Math.sin(t * 10.5) * 0.45;
        }
        break;
      }

      case 'rabbit': {
        if (isPlaying && distAhead < 26 && distAhead > -3) {
          a.behavior = 'fleeing';
        }
        const hopFreq = a.behavior === 'fleeing' ? 11.5 : 5.4;
        const hopSin = Math.sin(t * hopFreq);
        const air = Math.max(0, hopSin);
        a.bodyPivot.position.y = 0.22 + air * (a.behavior === 'fleeing' ? 0.42 : 0.24);
        a.bodyPivot.rotation.x = (0.5 - air) * 0.35;
        if (a.behavior === 'fleeing') {
          a.root.position.x += a.side * dt * 5.6;
          a.root.rotation.y = a.side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
        } else {
          a.root.position.z = -a.trackZ + Math.sin(t * 1.1) * 1.1;
        }
        if (a.legs.length >= 4) {
          a.legs[0].rotation.x = -air * 0.7;
          a.legs[1].rotation.x = -air * 0.7;
          a.legs[2].rotation.x = air * 0.9;
          a.legs[3].rotation.x = air * 0.9;
        }
        break;
      }

      case 'pigeon': {
        if (isPlaying && distAhead < 28 && distAhead > -4 && a.behavior === 'perched') {
          a.behavior = 'taking_flight';
          a.behaviorTimer = 0;
        }
        for (const b of a.subBirds) {
          if (a.behavior === 'perched') {
            const peck = Math.max(0, Math.sin(t * 4.5 + b.phase)) * 0.24;
            b.group.position.set(b.homeX, b.homeY, b.homeZ);
            b.group.rotation.x = peck;
            b.wingL.rotation.z = 0.12;
            b.wingR.rotation.z = -0.12;
          } else {
            const ft = Math.max(0, a.behaviorTimer - b.flightDelay);
            const flap = Math.sin((t + b.phase) * 24) * 1.05;
            b.wingL.rotation.z = flap;
            b.wingR.rotation.z = -flap;
            b.group.position.set(
              b.homeX + (a.side * 3.8 + b.flightDirX) * ft,
              b.homeY + ft * 4.4 + Math.sin(ft * 6) * 0.16,
              b.homeZ + b.flightDirZ * ft * 4.2,
            );
            b.group.rotation.x = -0.25;
            b.group.rotation.y = Math.atan2(a.side * 3.8 + b.flightDirX, b.flightDirZ * 4.2);
          }
        }
        break;
      }

      case 'peacock': {
        // Occasionally transition gracefully into regal tail-fan display when the player nears!
        if (isPlaying && distAhead < 48 && distAhead > 16 && a.seed % 3 !== 0) {
          a.behavior = 'displaying';
        }
        const displayTarget = a.behavior === 'displaying' ? 1 : 0;
        if (a.tailPivot) {
          const curUp = THREE.MathUtils.damp(a.tailPivot.rotation.x, displayTarget * 1.38 - 0.18, 3.2, dt);
          a.tailPivot.rotation.x = curUp;
          const fanOpen = THREE.MathUtils.clamp((curUp + 0.18) / 1.38, 0, 1);
          const shimmer = displayTarget > 0.5 ? Math.sin(t * 14) * 0.035 : 0;
          for (const plume of a.plumes) {
            const maxAng = (plume.userData.fanAngle as number) ?? 0;
            plume.rotation.z = maxAng * fanOpen + shimmer;
          }
        }
        if (a.behavior === 'walking') {
          const s = Math.sin(t * 4.4);
          a.root.position.z = -a.trackZ + Math.sin(t * 0.55) * 1.3;
          if (a.legs.length >= 2) {
            a.legs[0].rotation.x = s * 0.45;
            a.legs[1].rotation.x = -s * 0.45;
          }
          if (a.neckPivot) a.neckPivot.rotation.x = Math.sin(t * 4.4) * 0.12;
        } else {
          // Regal proud stance fanning iridescent feathers
          a.root.rotation.y = THREE.MathUtils.damp(a.root.rotation.y, -a.side * 0.65, 2.5, dt);
          if (a.neckPivot) a.neckPivot.rotation.y = Math.sin(t * 1.6) * 0.22;
        }
        break;
      }

      case 'sparrow': {
        if (isPlaying && distAhead < 34 && distAhead > -4 && a.behavior === 'perched') {
          a.behavior = 'flocking';
        }
        for (const b of a.subBirds) {
          if (a.behavior === 'perched') {
            b.group.position.set(b.homeX, b.homeY + Math.abs(Math.sin(t * 3 + b.phase)) * 0.08, b.homeZ);
            b.wingL.rotation.z = 0.08;
            b.wingR.rotation.z = -0.08;
          } else {
            // Swooping cohesive flock arcing gracefully between trees and temple arches
            const ft = t * 1.35 + b.phase;
            const orbitX = Math.sin(ft * 0.9) * 3.6;
            const orbitY = Math.sin(ft * 1.7) * 0.9 + (isPlaying && distAhead < 24 ? (24 - distAhead) * 0.14 : 0);
            const orbitZ = Math.cos(ft * 0.75) * 3.2;
            const dx = Math.cos(ft * 0.9) * 3.2;
            const dz = -Math.sin(ft * 0.75) * 2.4;
            b.group.position.set(b.homeX + orbitX, b.homeY + orbitY, b.homeZ + orbitZ);
            b.group.rotation.y = Math.atan2(dx, dz);
            const flap = Math.sin(ft * 18) * 0.95;
            b.wingL.rotation.z = flap;
            b.wingR.rotation.z = -flap;
          }
        }
        break;
      }
    }

    // Keep unused parameter referenced cleanly without warnings
    void branches;
  }

  private animateFloraActor(
    f: CorruptedFloraActor,
    dt: number,
    timeSec: number,
    distAhead: number,
    playerTrackZ: number,
    isPlaying: boolean,
  ): void {
    const t = timeSec + f.phase;
    const nearby = isPlaying && distAhead < 22 && distAhead > -4;

    if (f.kind === 'carnivorous_maw') {
      if (isPlaying && !f.snapped && distAhead < 11.5 && distAhead > 2.5) {
        f.snapped = true;
        f.behavior = 'snapping';
        f.reactTimer = 0.65;
        if (this.onSporeBurst) {
          // Convert worldRoot-local coordinates into scene coordinates (+playerTrackZ on Z)
          this._burstPos.set(f.baseX, f.baseY + 1.55, -f.trackZ + playerTrackZ);
          this.onSporeBurst(this._burstPos, this.profile.sporeColor);
        }
      }
      if (f.reactTimer > 0) f.reactTimer = Math.max(0, f.reactTimer - dt);

      let jawOpen = 0.34 + Math.sin(t * 2.2) * 0.18;
      if (f.reactTimer > 0) {
        // Dramatic snap shut then slow shuddering reopen!
        const snapPhase = 1 - f.reactTimer / 0.65;
        jawOpen = snapPhase < 0.25 ? THREE.MathUtils.lerp(0.68, 0.02, snapPhase / 0.25) : THREE.MathUtils.lerp(0.02, 0.42, (snapPhase - 0.25) / 0.75);
      } else if (nearby) {
        // Widen jaws anticipating approaching movement
        jawOpen = 0.62 + Math.sin(t * 8) * 0.08;
      }

      if (f.upperJaw) f.upperJaw.rotation.x = -jawOpen;
      if (f.lowerJaw) f.lowerJaw.rotation.x = jawOpen;
      f.root.rotation.z = Math.sin(t * (nearby ? 4.2 : 1.5)) * (nearby ? 0.08 : 0.035);
      if (f.coreMesh) {
        const pulse = 1 + Math.sin(t * 4.5) * 0.14;
        f.coreMesh.scale.set(0.28 * pulse, 0.24 * pulse, 0.32 * pulse);
      }
    } else if (f.kind === 'spore_bulb') {
      if (isPlaying && !f.snapped && distAhead < 14 && distAhead > 2) {
        f.snapped = true;
        f.behavior = 'sporing';
        f.reactTimer = 0.75;
        if (this.onSporeBurst) {
          this._burstPos.set(f.baseX, f.baseY + 0.9, -f.trackZ + playerTrackZ);
          this.onSporeBurst(this._burstPos, this.profile.sporeColor);
        }
      }
      if (f.reactTimer > 0) f.reactTimer = Math.max(0, f.reactTimer - dt);
      const pulse = f.reactTimer > 0 ? 0.78 + Math.sin(f.reactTimer * 22) * 0.18 : 1 + Math.sin(t * 2.8) * 0.12;
      if (f.coreMesh) f.coreMesh.scale.set(0.62 * pulse, 0.78 * (2 - pulse), 0.62 * pulse);
      for (let i = 0; i < f.vines.length; i++) {
        f.vines[i].rotation.y = Math.sin(t * 1.4 + i) * 0.06;
      }
    } else if (f.kind === 'blight_fern') {
      f.behavior = nearby ? 'twitching' : 'idle';
      const amp = nearby ? 0.22 : 0.07;
      const freq = nearby ? 11.5 : 2.3;
      for (let i = 0; i < f.fronds.length; i++) {
        f.fronds[i].rotation.x = 0.32 + Math.sin(t * freq + i * 1.3) * amp;
      }
    } else {
      // corrupted_vine: slow sinister writhing tendrils
      f.behavior = nearby ? 'twitching' : 'idle';
      const amp = nearby ? 0.16 : 0.08;
      const freq = nearby ? 4.8 : 1.7;
      for (let i = 0; i < f.vines.length; i++) {
        f.vines[i].rotation.z = Math.sin(t * freq + i * 1.6) * amp;
        f.vines[i].rotation.x = Math.cos(t * freq * 0.8 + i) * amp * 0.7;
      }
      if (f.coreMesh) {
        const s = 0.24 + Math.sin(t * 3.1) * 0.04;
        f.coreMesh.scale.setScalar(s);
      }
    }
  }

  public getDiagnostics(): { wildlifeCount: number; floraCount: number; activeSpecies: string[] } {
    const species = new Set<string>();
    for (const a of this.wildlife) {
      if (a.root.visible) species.add(a.species);
    }
    return {
      wildlifeCount: this.wildlife.length,
      floraCount: this.flora.length,
      activeSpecies: Array.from(species),
    };
  }

  private clearActors(): void {
    for (const a of this.wildlife) this.group.remove(a.root);
    for (const f of this.flora) this.group.remove(f.root);
    for (const g of this.ownedGeos) g.dispose();
    this.wildlife = [];
    this.flora = [];
    this.ownedGeos = [];
  }

  public dispose(): void {
    this.clearActors();
    this.geos.dispose();
    this.mats.dispose();
    this.textures.dispose();
  }
}

/**
 * Deterministic inspection helper for automated unit tests: builds every wildlife species
 * and every corrupted flora type and verifies multi-part composite geometry integrity.
 */
export function inspectLivingWorldModels(): {
  wildlifeParts: Record<WildlifeSpecies, number>;
  floraParts: Record<CorruptedFloraKind, number>;
} {
  const mgr = new LivingWorldManager(null);
  const geos = createSharedGeos();
  const tex = createLivingWorldTextures();
  const mats = createMaterialBank(tex, null);
  const owned: THREE.BufferGeometry[] = [];

  const countMeshes = (obj: THREE.Object3D): number => {
    let n = 0;
    obj.traverse((c) => {
      if (c instanceof THREE.Mesh) n++;
    });
    return n;
  };

  const wildlifeParts = {} as Record<WildlifeSpecies, number>;
  for (const sp of ALL_WILDLIFE_SPECIES) {
    let root: THREE.Group;
    if (sp === 'deer') root = buildDeerModel(geos, mats, true, owned).root;
    else if (sp === 'tiger') root = buildTigerModel(geos, mats, owned).root;
    else if (sp === 'cat') root = buildCatModel(geos, mats, 0, true, owned).root;
    else if (sp === 'dog') root = buildDogModel(geos, mats, owned).root;
    else if (sp === 'rabbit') root = buildRabbitModel(geos, mats).root;
    else if (sp === 'pigeon') root = buildPigeonGroupModel(geos, mats, 7, true).root;
    else if (sp === 'peacock') root = buildPeacockModel(geos, mats).root;
    else root = buildSparrowFlockModel(geos, mats, 11).root;
    wildlifeParts[sp] = countMeshes(root);
  }

  const floraParts = {} as Record<CorruptedFloraKind, number>;
  for (const fk of ALL_CORRUPTED_FLORA_KINDS) {
    let root: THREE.Group;
    if (fk === 'corrupted_vine') root = buildCorruptedVineModel(geos, mats, 5, owned).root;
    else if (fk === 'carnivorous_maw') root = buildCarnivorousMawModel(geos, mats, 9, owned).root;
    else if (fk === 'spore_bulb') root = buildSporeBulbModel(geos, mats, 13, owned).root;
    else root = buildBlightFernModel(geos, mats, 17).root;
    floraParts[fk] = countMeshes(root);
  }

  for (const g of owned) g.dispose();
  geos.dispose();
  mats.dispose();
  tex.dispose();
  mgr.dispose();

  return { wildlifeParts, floraParts };
}
