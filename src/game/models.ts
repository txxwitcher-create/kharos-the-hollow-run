import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ArchitectureStyle,
  LevelDef,
  ObstacleKind,
  ThemeDef,
  TrackBranch,
} from '../types/game';
import { sampleRoutePose } from './track';
export { buildCharacterRig, type CharacterRig, type CharacterTexturePack } from './characterModel';

export interface BiomeMaterialPack {
  stone: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  foliageAlt: THREE.MeshStandardMaterial;
  canopy: THREE.MeshStandardMaterial;
  vine: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  terrain: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  flame: THREE.MeshBasicMaterial;
  contactShadow: THREE.MeshBasicMaterial;
  vistaMap: THREE.Texture;
}

export interface HollowRig {
  root: THREE.Group;
  torso: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  coreMesh: THREE.Mesh;
  jaw: THREE.Mesh;
  applyBiome: (level: LevelDef) => void;
}

// ---------------------------------------------------------------------------
// Geometry Utilities (Organic Curves, Smooth Normals, Draw-Call Merging)
// ---------------------------------------------------------------------------

function normalizeForMerge(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const nonIdx = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!nonIdx.attributes.normal) nonIdx.computeVertexNormals();
  if (!nonIdx.attributes.uv) {
    const count = nonIdx.attributes.position.count;
    nonIdx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  for (const key of Object.keys(nonIdx.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') {
      nonIdx.deleteAttribute(key);
    }
  }
  return nonIdx;
}

function safeMerge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = geos.map(normalizeForMerge);
  const merged = mergeGeometries(clean, false);
  for (const g of clean) g.dispose();
  if (!merged) return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  return merged;
}

function buildCurvedFoliageCardGeo(width: number, height: number, arch = 0.28): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 3, 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nx = x / (width * 0.5);
    const ny = y / (height * 0.5);
    const zCurve = -(nx * nx * 0.45 + ny * ny * 0.55) * arch * Math.max(width, height);
    pos.setZ(i, zCurve);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Lush 3D instanced tropical fern & monstera rosette cluster (merged into 1 BufferGeometry).
 */
export function buildRealisticFoliageClusterGeo(variant = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const count = 4;
  for (let i = 0; i < count; i++) {
    const card = buildCurvedFoliageCardGeo(1.8 + (i % 2) * 0.28, 1.6 + ((i + variant) % 2) * 0.26, 0.24);
    card.rotateX(-0.26 - (i % 2) * 0.2);
    card.rotateY((i / count) * Math.PI * 2 + variant * 0.72);
    card.translate(0, 0.7, 0);
    parts.push(card);
  }
  const crown = buildCurvedFoliageCardGeo(1.75, 1.75, 0.26);
  crown.rotateX(-Math.PI * 0.42);
  crown.rotateY(variant * 1.15);
  crown.translate(0, 1.08, 0);
  parts.push(crown);

  const merged = safeMerge(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * Smooth-shaded high-res organic mossy canyon boulder (ZERO low-poly dodecahedrons!).
 */
export function buildRealisticBoulderGeo(seed = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.0, 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const strata =
      Math.sin(vy * 5.2 + seed * 1.7) * 0.08 +
      Math.cos(vx * 3.4 - vz * 2.8 + seed) * 0.12 +
      Math.sin((vx + vz) * 6.5 + seed * 2.3) * 0.05;
    const flatBase = vy < -0.32 ? -0.32 + (vy + 0.32) * 0.28 : vy;
    const scale = 1.0 + strata;
    pos.setXYZ(i, vx * scale * 1.15, flatBase * scale * 0.78, vz * scale * 1.05);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Tapered organic CatmullRom TubeGeometry for gnarled tree trunks, buttress roots,
 * strangler-fig vines, and curved hair locks.
 */
function buildTaperedBranchGeo(
  points: THREE.Vector3[],
  rStart: number,
  rEnd: number,
  tubularSegs = 10,
  radialSegs = 8,
  twistNoise = 0.08,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, tubularSegs, 1.0, radialSegs, false);
  const pos = geo.attributes.position;
  const ringVerts = radialSegs + 1;

  for (let i = 0; i <= tubularSegs; i++) {
    const t = i / tubularSegs;
    const center = curve.getPointAt(t);
    const baseFlare = t < 0.18 ? 1 + (1 - t / 0.18) * 0.36 : 1;
    const radius = THREE.MathUtils.lerp(rStart, rEnd, Math.pow(t, 0.85)) * baseFlare;

    for (let j = 0; j < ringVerts; j++) {
      const idx = i * ringVerts + j;
      const vx = pos.getX(idx) - center.x;
      const vy = pos.getY(idx) - center.y;
      const vz = pos.getZ(idx) - center.z;
      const angle = (j / radialSegs) * Math.PI * 2;
      const flute = 1 + Math.sin(angle * 4 + t * 5.0) * twistNoise * (1 - t * 0.6);
      pos.setXYZ(
        idx,
        center.x + vx * radius * flute,
        center.y + vy * radius * flute,
        center.z + vz * radius * flute,
      );
    }
  }
  geo.computeVertexNormals();
  return geo;
}

const beveledStoneCache = new Map<string, THREE.BufferGeometry>();
export function getBeveledStoneGeo(
  width: number,
  height: number,
  depth: number,
  bevel = 0.08,
): THREE.BufferGeometry {
  const b = Math.min(bevel, width * 0.24, height * 0.24, depth * 0.24);
  const key = `${width.toFixed(2)}:${height.toFixed(2)}:${depth.toFixed(2)}:${b.toFixed(3)}`;
  const cached = beveledStoneCache.get(key);
  if (cached) return cached;

  const hw = Math.max(0.02, width * 0.5 - b);
  const hh = Math.max(0.02, height * 0.5 - b);
  const c = Math.min(b * 0.45, hw * 0.45, hh * 0.45);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + c, -hh);
  shape.lineTo(hw - c, -hh);
  shape.lineTo(hw, -hh + c);
  shape.lineTo(hw, hh - c);
  shape.lineTo(hw - c, hh);
  shape.lineTo(-hw + c, hh);
  shape.lineTo(-hw, hh - c);
  shape.lineTo(-hw, -hh + c);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.04, depth - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
  });
  geo.center();
  geo.computeVertexNormals();
  beveledStoneCache.set(key, geo);
  return geo;
}

/**
 * Sculpted Angkor/Khmer carved fluted lotus column via LatheGeometry.
 */
let cachedColumnGeo: THREE.BufferGeometry | null = null;
export function getSculptedColumnGeo(): THREE.BufferGeometry {
  if (cachedColumnGeo) return cachedColumnGeo;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(0.98, 0.0),
    new THREE.Vector2(0.98, 0.38),
    new THREE.Vector2(0.86, 0.48),
    new THREE.Vector2(0.86, 0.74),
    new THREE.Vector2(0.74, 0.88),
    new THREE.Vector2(0.82, 1.04),
    new THREE.Vector2(0.68, 1.2),
    new THREE.Vector2(0.64, 2.3),
    new THREE.Vector2(0.69, 2.4),
    new THREE.Vector2(0.62, 2.52),
    new THREE.Vector2(0.59, 4.4),
    new THREE.Vector2(0.65, 4.52),
    new THREE.Vector2(0.58, 4.64),
    new THREE.Vector2(0.54, 6.68),
    new THREE.Vector2(0.62, 6.84),
    new THREE.Vector2(0.55, 7.0),
    new THREE.Vector2(0.75, 7.34),
    new THREE.Vector2(0.88, 7.64),
    new THREE.Vector2(0.96, 7.84),
    new THREE.Vector2(0.96, 8.15),
    new THREE.Vector2(0.01, 8.15),
  ];
  cachedColumnGeo = new THREE.LatheGeometry(pts, 18);
  cachedColumnGeo.computeVertexNormals();
  return cachedColumnGeo;
}

/**
 * Sculpted Angkor Wat Prasat Lotus-Bud Spire Tower Finial (replaces plain smooth cone on temple crowns!).
 */
let cachedPrasatFinialGeo: THREE.BufferGeometry | null = null;
function getAngkorPrasatFinialGeo(): THREE.BufferGeometry {
  if (cachedPrasatFinialGeo) return cachedPrasatFinialGeo;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(1.22, 0.0),
    new THREE.Vector2(1.18, 0.25),
    new THREE.Vector2(0.95, 0.35),
    new THREE.Vector2(1.02, 0.58), // Tier 1 lotus petals
    new THREE.Vector2(0.76, 0.74),
    new THREE.Vector2(0.84, 0.98), // Tier 2 lotus petals
    new THREE.Vector2(0.6, 1.18),
    new THREE.Vector2(0.66, 1.42), // Tier 3 lotus petals
    new THREE.Vector2(0.42, 1.65),
    new THREE.Vector2(0.46, 1.85), // Crown lotus bud
    new THREE.Vector2(0.24, 2.15),
    new THREE.Vector2(0.08, 2.38),
    new THREE.Vector2(0.01, 2.45),
  ];
  cachedPrasatFinialGeo = new THREE.LatheGeometry(pts, 14);
  cachedPrasatFinialGeo.computeVertexNormals();
  return cachedPrasatFinialGeo;
}

let cachedBrazierBowlGeo: THREE.BufferGeometry | null = null;
function getSculptedBrazierBowlGeo(): THREE.BufferGeometry {
  if (cachedBrazierBowlGeo) return cachedBrazierBowlGeo;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(0.24, 0.0),
    new THREE.Vector2(0.18, 0.14),
    new THREE.Vector2(0.22, 0.26),
    new THREE.Vector2(0.42, 0.42),
    new THREE.Vector2(0.52, 0.56),
    new THREE.Vector2(0.46, 0.58),
    new THREE.Vector2(0.36, 0.36),
    new THREE.Vector2(0.01, 0.34),
  ];
  cachedBrazierBowlGeo = new THREE.LatheGeometry(pts, 14);
  cachedBrazierBowlGeo.computeVertexNormals();
  return cachedBrazierBowlGeo;
}

function buildSculptedBrazier(mats: BiomeMaterialPack): THREE.Group {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(getSculptedBrazierBowlGeo(), mats.metal);
  g.add(bowl);

  const emberBed = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), mats.hazard);
  emberBed.scale.set(1.15, 0.36, 1.15);
  emberBed.position.y = 0.38;
  g.add(emberBed);

  const flameGroup = new THREE.Group();
  flameGroup.name = 'brazier_flame';
  flameGroup.position.y = 0.86;
  const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), mats.flame);
  const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), mats.flame);
  f2.rotation.y = Math.PI * 0.5;
  flameGroup.add(f1, f2);
  g.add(flameGroup);

  return g;
}

// ---------------------------------------------------------------------------
// Pre-Merged Multi-Species Branching Jungle Tree Prototypes (3 Draw Calls/Tree!)
// ---------------------------------------------------------------------------

interface MergedTreePrototype {
  barkGeo: THREE.BufferGeometry;
  foliageGeo: THREE.BufferGeometry;
  canopyGeo: THREE.BufferGeometry;
  vineGeo: THREE.BufferGeometry;
}

const cachedTreePrototypes: MergedTreePrototype[] = [];

function getTreePrototype(variantIdx: number): MergedTreePrototype {
  const idx = ((variantIdx % 4) + 4) % 4;
  if (cachedTreePrototypes[idx]) return cachedTreePrototypes[idx];

  const barkParts: THREE.BufferGeometry[] = [];
  const foliageParts: THREE.BufferGeometry[] = [];
  const canopyParts: THREE.BufferGeometry[] = [];
  const vineParts: THREE.BufferGeometry[] = [];

  let s = 1337 + idx * 919;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  const height = 8.8 + idx * 1.15;
  const leanX = (idx % 2 === 0 ? 1 : -1) * (0.85 + rand() * 0.95);
  const leanZ = (rand() - 0.5) * 1.2;

  // 1. Main gnarled curved trunk
  const trunkPts = [
    new THREE.Vector3(0, -0.45, 0),
    new THREE.Vector3(leanX * 0.25, height * 0.32, leanZ * 0.25),
    new THREE.Vector3(leanX * 0.72, height * 0.68, leanZ * 0.65),
    new THREE.Vector3(leanX, height, leanZ),
  ];
  barkParts.push(buildTaperedBranchGeo(trunkPts, 0.66 + idx * 0.05, 0.22, 10, 8, 0.14));

  // 2. 5 Sprawling buttress roots gripping rocks & soil
  for (let r = 0; r < 5; r++) {
    const a = (r / 5) * Math.PI * 2 + rand() * 0.45;
    const reach = 1.75 + rand() * 1.1;
    const rootPts = [
      new THREE.Vector3(Math.cos(a) * 0.34, 1.65 + rand() * 0.65, Math.sin(a) * 0.34),
      new THREE.Vector3(Math.cos(a) * reach * 0.55, 0.48, Math.sin(a) * reach * 0.55),
      new THREE.Vector3(Math.cos(a) * reach, -0.38, Math.sin(a) * reach),
    ];
    barkParts.push(buildTaperedBranchGeo(rootPts, 0.32, 0.09, 6, 6, 0.12));
  }

  // 3. 5 Spreading boughs + forks + dual-species lush tropical leaf canopies (ferns + palm/monstera fronds!)
  const branchCount = 5;
  for (let b = 0; b < branchCount; b++) {
    const tAttach = 0.52 + (b / branchCount) * 0.4;
    const startPt = new THREE.CatmullRomCurve3(trunkPts).getPointAt(tAttach);
    const angle = (b / branchCount) * Math.PI * 2 + idx * 0.8 + rand() * 0.4;
    const spread = 2.6 + rand() * 2.0;
    const rise = 1.35 + rand() * 1.8;

    const midPt = new THREE.Vector3(
      startPt.x + Math.cos(angle) * spread * 0.55,
      startPt.y + rise * 0.68,
      startPt.z + Math.sin(angle) * spread * 0.55,
    );
    const tipPt = new THREE.Vector3(
      startPt.x + Math.cos(angle) * spread,
      startPt.y + rise,
      startPt.z + Math.sin(angle) * spread,
    );
    barkParts.push(buildTaperedBranchGeo([startPt, midPt, tipPt], 0.25, 0.06, 7, 6, 0.08));

    const subAngle = angle + (b % 2 === 0 ? 0.65 : -0.65);
    const subTip = new THREE.Vector3(
      midPt.x + Math.cos(subAngle) * (1.35 + rand() * 0.7),
      midPt.y + 0.85 + rand() * 0.6,
      midPt.z + Math.sin(subAngle) * (1.35 + rand() * 0.7),
    );
    barkParts.push(buildTaperedBranchGeo([midPt, subTip], 0.15, 0.04, 5, 5, 0.06));

    // Mix species 1 (fern/philodendron) and species 2 (palm/monstera canopy) organically
    const clusterCenters = [tipPt, subTip];
    for (let ci = 0; ci < clusterCenters.length; ci++) {
      const center = clusterCenters[ci];
      for (let c = 0; c < 3; c++) {
        const w = 2.8 + rand() * 1.25;
        const h = 2.35 + rand() * 1.05;
        const card = buildCurvedFoliageCardGeo(w, h, 0.28);
        card.rotateX(-0.34 - rand() * 0.52);
        card.rotateY(angle + (c * Math.PI * 2) / 3 + rand() * 0.45);
        card.rotateZ((rand() - 0.5) * 0.35);
        card.translate(
          center.x + (rand() - 0.5) * 0.9,
          center.y + 0.15 + (rand() - 0.3) * 0.6,
          center.z + (rand() - 0.5) * 0.9,
        );
        if ((b + c + ci) % 2 === 0) canopyParts.push(card);
        else foliageParts.push(card);
      }
    }

    if (b < 3) {
      const vh = 3.0 + rand() * 2.2;
      const vineCard = new THREE.PlaneGeometry(1.75, vh, 1, 2);
      vineCard.rotateY(angle + Math.PI * 0.5);
      vineCard.translate(midPt.x, midPt.y - vh * 0.44, midPt.z);
      vineParts.push(vineCard);
    }
  }

  // Crown palm/monstera canopy directly at trunk apex
  const apex = trunkPts[trunkPts.length - 1];
  for (let c = 0; c < 5; c++) {
    const card = buildCurvedFoliageCardGeo(3.4 + rand() * 1.1, 2.95 + rand() * 0.9, 0.3);
    card.rotateX(-0.48 - rand() * 0.42);
    card.rotateY((c / 5) * Math.PI * 2 + rand() * 0.35);
    card.translate(
      apex.x + (rand() - 0.5) * 1.1,
      apex.y + 0.35 + rand() * 0.65,
      apex.z + (rand() - 0.5) * 1.1,
    );
    canopyParts.push(card);
  }

  const proto: MergedTreePrototype = {
    barkGeo: safeMerge(barkParts),
    foliageGeo: safeMerge(foliageParts),
    canopyGeo: safeMerge(canopyParts),
    vineGeo: safeMerge(vineParts),
  };
  for (const g of barkParts) g.dispose();
  for (const g of foliageParts) g.dispose();
  for (const g of canopyParts) g.dispose();
  for (const g of vineParts) g.dispose();

  cachedTreePrototypes[idx] = proto;
  return proto;
}

function buildRealisticBranchingTree(mats: BiomeMaterialPack, variantIdx: number): THREE.Group {
  const g = new THREE.Group();
  const proto = getTreePrototype(variantIdx);

  const barkMesh = new THREE.Mesh(proto.barkGeo, mats.bark);
  barkMesh.castShadow = true;
  barkMesh.receiveShadow = true;
  g.add(barkMesh);

  const foliageMesh = new THREE.Mesh(proto.foliageGeo, variantIdx % 2 === 0 ? mats.foliage : mats.foliageAlt);
  foliageMesh.castShadow = true;
  foliageMesh.receiveShadow = true;
  g.add(foliageMesh);

  const canopyMesh = new THREE.Mesh(proto.canopyGeo, mats.canopy);
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  g.add(canopyMesh);

  const vineMesh = new THREE.Mesh(proto.vineGeo, mats.vine);
  g.add(vineMesh);

  return g;
}

// 1. Playable Human Character Rig is implemented in ./characterModel.ts and re-exported at top of file.


// ---------------------------------------------------------------------------
// 2. The Hollow Pursuer (Sculpted Obsidian-Stone & Magma Dread Guardian)
// ---------------------------------------------------------------------------

export function buildTheHollowPursuer(stoneNormal?: THREE.Texture, contactShadowTex?: THREE.Texture): HollowRig {
  const root = new THREE.Group();
  const obsidianMat = new THREE.MeshStandardMaterial({
    color: '#1b1922',
    roughness: 0.44,
    metalness: 0.46,
    normalMap: stoneNormal ?? null,
    normalScale: new THREE.Vector2(1.35, 1.35),
  });
  const slateArmorMat = new THREE.MeshStandardMaterial({
    color: '#2e2b36',
    roughness: 0.34,
    metalness: 0.6,
    normalMap: stoneNormal ?? null,
    normalScale: new THREE.Vector2(1.15, 1.15),
  });
  const magmaMat = new THREE.MeshStandardMaterial({
    color: '#ff6a1a',
    emissive: '#ea580c',
    emissiveIntensity: 1.45,
    roughness: 0.24,
  });

  if (contactShadowTex) {
    const ao = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({ map: contactShadowTex, transparent: true, opacity: 0.84, depthWrite: false }),
    );
    ao.rotation.x = -Math.PI / 2;
    ao.position.y = 0.03;
    root.add(ao);
  }

  // Seamless overlapping obsidian pelvis & armored hip tassets (eliminates waist ring gap!)
  const pelvis = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.01, -0.32),
        new THREE.Vector2(0.56, -0.26),
        new THREE.Vector2(0.7, -0.02),
        new THREE.Vector2(0.66, 0.26),
        new THREE.Vector2(0.58, 0.42),
        new THREE.Vector2(0.01, 0.44),
      ],
      14,
    ),
    obsidianMat,
  );
  pelvis.scale.set(1.12, 1.0, 0.86);
  pelvis.position.set(0, 1.24, 0);
  const beltArmor = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.095, 8, 16), slateArmorMat);
  beltArmor.rotation.x = Math.PI / 2;
  beltArmor.scale.set(1.08, 0.84, 1);
  beltArmor.position.set(0, 1.44, 0);
  root.add(pelvis, beltArmor);
  for (const s of [-1, 1]) {
    const tasset = new THREE.Mesh(getBeveledStoneGeo(0.46, 0.5, 0.36, 0.08), slateArmorMat);
    tasset.position.set(s * 0.58, 1.12, -0.08);
    tasset.rotation.set(0.1, s * 0.25, -s * 0.22);
    root.add(tasset);
  }

  const torso = new THREE.Group();
  torso.position.y = 1.92;
  root.add(torso);

  // Sculpted organic muscular stone torso Lathe overlapping pelvis smoothly up into broad shoulders
  const chestLathe = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.01, -0.78),
        new THREE.Vector2(0.56, -0.72), // Overlaps pelvis cleanly!
        new THREE.Vector2(0.52, -0.32), // Sculpted abdomen waist
        new THREE.Vector2(0.84, 0.16),  // Broad ribcage
        new THREE.Vector2(1.06, 0.56),  // Massive shoulders/pecs
        new THREE.Vector2(0.76, 0.82),  // Trapezius armor
        new THREE.Vector2(0.01, 0.84),
      ],
      16,
    ),
    obsidianMat,
  );
  chestLathe.scale.set(1.12, 1.0, 0.86);
  chestLathe.castShadow = true;
  torso.add(chestLathe);

  for (let i = -1; i <= 1; i++) {
    const rib = new THREE.Mesh(
      new THREE.TorusGeometry(0.84 - Math.abs(i) * 0.08, 0.078, 8, 18, Math.PI * 1.24),
      slateArmorMat,
    );
    rib.position.set(0, i * 0.26 + 0.14, -0.06);
    rib.rotation.x = Math.PI / 2;
    rib.rotation.z = -Math.PI * 0.12;
    torso.add(rib);

    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.56, 6), slateArmorMat);
    dorsal.position.set(0, i * 0.32 + 0.22, 0.62);
    dorsal.rotation.x = 0.88;
    torso.add(dorsal);
  }

  // Deeply recessed smoldering magma heart caged behind crossed obsidian sternum ribs
  const chestFrame = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 8, 14), slateArmorMat);
  chestFrame.position.set(0, 0.22, -0.66);
  const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), magmaMat);
  coreMesh.scale.set(0.84, 1.15, 0.72);
  coreMesh.position.set(0, 0.22, -0.6);
  torso.add(chestFrame, coreMesh);
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.78, 6), obsidianMat);
    strut.position.set(s * 0.18, 0.22, -0.74);
    strut.rotation.z = s * 0.44;
    torso.add(strut);
  }

  // Sculpted armored skull, fierce overhanging brow horn-plates, recessed ember slit eyes, & fanged obsidian jaw
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.38, 10), obsidianMat);
  neck.position.set(0, 0.84, -0.06);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2), obsidianMat);
  skull.scale.set(0.95, 1.16, 1.08);
  skull.position.set(0, 1.16, -0.15);
  const crownCrest = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.56, 6), slateArmorMat);
  crownCrest.position.set(0, 1.56, -0.02);
  crownCrest.rotation.x = -0.35;
  const jaw = new THREE.Mesh(getBeveledStoneGeo(0.52, 0.34, 0.42, 0.09), slateArmorMat);
  jaw.position.set(0, 0.82, -0.32);
  jaw.rotation.x = -0.18;
  torso.add(neck, skull, crownCrest, jaw);

  // Subtle recessed magma throat fissure + 4 obsidian jaw fangs (no bright orange mouth rectangle!)
  const throatEmber = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), magmaMat);
  throatEmber.scale.set(1.25, 0.45, 0.75);
  throatEmber.position.set(0, 0.94, -0.44);
  torso.add(throatEmber);
  for (let f = -1.5; f <= 1.5; f += 1) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.14, 5), obsidianMat);
    fang.position.set(f * 0.1, 0.96, -0.53);
    torso.add(fang);
  }

  for (const s of [-1, 1]) {
    const browRidge = new THREE.Mesh(getBeveledStoneGeo(0.36, 0.12, 0.22, 0.03), slateArmorMat);
    browRidge.position.set(s * 0.2, 1.24, -0.58);
    browRidge.rotation.set(0.22, s * -0.18, s * -0.28);

    const hornPts = [
      new THREE.Vector3(s * 0.32, 1.32, -0.08),
      new THREE.Vector3(s * 0.7, 1.82, -0.22),
      new THREE.Vector3(s * 0.46, 2.24, -0.52),
    ];
    const horn = new THREE.Mesh(buildTaperedBranchGeo(hornPts, 0.14, 0.03, 7, 7, 0.05), obsidianMat);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), magmaMat);
    eye.scale.set(1.32, 0.54, 0.82);
    eye.rotation.z = s * -0.24;
    eye.position.set(s * 0.2, 1.13, -0.61);

    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), slateArmorMat);
    pauldron.position.set(s * 1.14, 0.56, 0);
    pauldron.rotation.z = -s * 0.38;
    const pSpike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.62, 6), obsidianMat);
    pSpike.position.set(s * 1.44, 0.9, 0);
    pSpike.rotation.z = -s * 0.52;
    torso.add(browRidge, horn, eye, pauldron, pSpike);
  }

  const makeArm = (x: number, y: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    const shoulderJoint = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 10), obsidianMat);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.25, 0.78, 10), obsidianMat);
    upper.position.y = -0.39;
    upper.castShadow = true;
    const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 8), slateArmorMat);
    elbowJoint.position.y = -0.76;
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.21, 0.74, 10), slateArmorMat);
    forearm.position.y = -1.1;
    forearm.castShadow = true;
    const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 1), obsidianMat);
    fist.position.y = -1.52;
    g.add(shoulderJoint, upper, elbowJoint, forearm, fist);
    for (let c = -1; c <= 1; c++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.34, 5), magmaMat);
      claw.position.set(c * 0.11, -1.78, -0.14);
      claw.rotation.x = Math.PI - 0.3;
      g.add(claw);
    }
    return g;
  };

  const makeLeg = (x: number, y: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 10), obsidianMat);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.28, 0.68, 10), obsidianMat);
    thigh.position.y = -0.3;
    thigh.castShadow = true;
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.62, 10), slateArmorMat);
    shin.position.y = -0.88;
    shin.castShadow = true;
    const kneePlate = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.38, 6), slateArmorMat);
    kneePlate.position.set(0, -0.58, -0.32);
    kneePlate.rotation.x = -Math.PI * 0.42;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.22, 8), obsidianMat);
    foot.scale.set(1.0, 1.0, 1.45);
    foot.position.set(0, -1.14, -0.09);
    g.add(hipBall, thigh, shin, kneePlate, foot);
    return g;
  };

  const leftArm = makeArm(-1.14, 0.5);
  const rightArm = makeArm(1.14, 0.5);
  torso.add(leftArm, rightArm);

  const leftLeg = makeLeg(-0.46, 1.22);
  const rightLeg = makeLeg(0.46, 1.22);
  root.add(leftLeg, rightLeg);

  const applyBiome = (level: LevelDef) => {
    const pal = level.palette;
    const baseDark = new THREE.Color('#191720').lerp(new THREE.Color(pal.archPrimary), 0.24);
    const plateCol = new THREE.Color('#2d2a36').lerp(new THREE.Color(pal.archAccent), 0.28);
    const energyCol = new THREE.Color(pal.hazardGlow);

    obsidianMat.color.copy(baseDark);
    slateArmorMat.color.copy(plateCol);
    magmaMat.color.copy(energyCol).lerp(new THREE.Color('#ffffff'), 0.18);
    magmaMat.emissive.copy(energyCol);

    const isIcy = level.architecture === 'ice_spires' || level.architecture === 'crystal_caverns';
    const isAquatic = level.architecture === 'drowned_arches';
    const isCelestial = level.architecture === 'sky_colonnade' || level.architecture === 'last_sanctuary';
    slateArmorMat.roughness = isIcy || isAquatic ? 0.22 : isCelestial ? 0.26 : 0.36;
    slateArmorMat.metalness = isCelestial ? 0.78 : isIcy ? 0.52 : 0.6;
    magmaMat.emissiveIntensity = isCelestial || isIcy ? 1.35 : 1.55;
  };

  return { root, torso, leftArm, rightArm, leftLeg, rightLeg, coreMesh, jaw, applyBiome };
}

// ---------------------------------------------------------------------------
// 4. Collectible Relic Coins
// ---------------------------------------------------------------------------

const sharedCoinGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.1, 18);
const sharedCoinRimGeo = new THREE.TorusGeometry(0.35, 0.048, 8, 20);
const sharedCoinCoreGeo = new THREE.OctahedronGeometry(0.14, 0);

export function buildCoinMesh(theme: ThemeDef): THREE.Group {
  const g = new THREE.Group();
  const coinMat = new THREE.MeshStandardMaterial({
    color: theme.coinColor,
    emissive: theme.coinEmissive,
    emissiveIntensity: 0.42,
    roughness: 0.22,
    metalness: 0.9,
  });
  const disc = new THREE.Mesh(sharedCoinGeo, coinMat);
  disc.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(sharedCoinRimGeo, coinMat);
  const core = new THREE.Mesh(sharedCoinCoreGeo, coinMat);
  g.add(disc, rim, core);
  return g;
}

// ---------------------------------------------------------------------------
// 5. Realistic Temple Obstacles (Detailed Stone/Wood/Forged Iron + Clear Silhouettes)
// ---------------------------------------------------------------------------

const sharedObsBoulderGeo = buildRealisticBoulderGeo(7);
const sharedFernTuftGeo = buildRealisticFoliageClusterGeo(2);

let cachedArchBeamGeo: THREE.BufferGeometry | null = null;
export function getChamferedArchBeamGeo(): THREE.BufferGeometry {
  if (cachedArchBeamGeo) return cachedArchBeamGeo;
  const s = new THREE.Shape();
  s.moveTo(-4.1, 0);
  s.lineTo(4.1, 0);
  s.lineTo(4.3, 0.72);
  s.lineTo(3.9, 1.04);
  s.lineTo(-3.9, 1.04);
  s.lineTo(-4.3, 0.72);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.78,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.08,
    bevelSegments: 2,
  });
  geo.center();
  geo.computeVertexNormals();
  return (cachedArchBeamGeo = geo);
}

let cachedMonolithPrismGeo: THREE.BufferGeometry | null = null;
function getCarvedMonolithPrismGeo(): THREE.BufferGeometry {
  if (cachedMonolithPrismGeo) return cachedMonolithPrismGeo;
  const s = new THREE.Shape();
  s.moveTo(-0.72, -0.78);
  s.lineTo(0.72, -0.78);
  s.lineTo(0.95, -0.42);
  s.lineTo(0.95, 0.42);
  s.lineTo(0.72, 0.78);
  s.lineTo(-0.72, 0.78);
  s.lineTo(-0.95, 0.42);
  s.lineTo(-0.95, -0.42);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 2.15,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.09,
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return (cachedMonolithPrismGeo = geo);
}

let cachedHopperGeo: THREE.BufferGeometry | null = null;
function getOreCartHopperGeo(): THREE.BufferGeometry {
  if (cachedHopperGeo) return cachedHopperGeo;
  const s = new THREE.Shape();
  s.moveTo(-0.56, 0);
  s.lineTo(0.56, 0);
  s.lineTo(0.84, 0.96);
  s.lineTo(-0.84, 0.96);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 2.05,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  geo.center();
  geo.computeVertexNormals();
  return (cachedHopperGeo = geo);
}

export function buildObstacleMesh(
  kind: ObstacleKind,
  level: LevelDef,
  mats: BiomeMaterialPack,
): THREE.Group {
  const g = new THREE.Group();
  const { stone, trim, accent, bark, foliage, vine, metal, hazard, flame, contactShadow } = mats;

  switch (kind) {
    case 'low_barrier': {
      const logPts = [
        new THREE.Vector3(-3.8, 0.44, 0.08),
        new THREE.Vector3(-1.3, 0.52, -0.05),
        new THREE.Vector3(1.4, 0.48, 0.06),
        new THREE.Vector3(3.8, 0.44, -0.05),
      ];
      const fallenLog = new THREE.Mesh(buildTaperedBranchGeo(logPts, 0.42, 0.34, 12, 10, 0.1), bark);
      fallenLog.castShadow = true;
      fallenLog.receiveShadow = true;
      g.add(fallenLog);

      for (const sx of [-3.4, 3.4]) {
        const chock = new THREE.Mesh(sharedObsBoulderGeo, stone);
        chock.scale.set(0.55, 0.52, 0.55);
        chock.position.set(sx, 0.32, 0);
        g.add(chock);
      }
      const trimBand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 6.8, 8), accent);
      trimBand.rotation.z = Math.PI / 2;
      trimBand.position.set(0, 0.72, 0);
      g.add(trimBand);

      if (
        level.architecture === 'jungle_temple' ||
        level.architecture === 'whispering_woods' ||
        level.architecture === 'giant_canopy'
      ) {
        for (const fx of [-2.1, 1.85]) {
          const sprout = new THREE.Mesh(sharedFernTuftGeo, foliage);
          sprout.scale.set(0.55, 0.48, 0.55);
          sprout.position.set(fx, 0.68, 0.12);
          g.add(sprout);
        }
      }
      break;
    }

    case 'high_arch': {
      for (const sx of [-3.65, 3.65]) {
        const col = new THREE.Mesh(getSculptedColumnGeo(), stone);
        col.scale.set(0.52, 0.36, 0.52);
        col.position.set(sx, 0, 0);
        col.castShadow = true;
        g.add(col);
      }
      const lintel = new THREE.Mesh(getChamferedArchBeamGeo(), stone);
      lintel.position.set(0, 1.98, 0);
      lintel.castShadow = true;

      const keystone = new THREE.Mesh(getAngkorPrasatFinialGeo(), trim);
      keystone.scale.setScalar(0.38);
      keystone.position.set(0, 2.52, 0);

      const underRail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 7.2, 8), accent);
      underRail.rotation.z = Math.PI / 2;
      underRail.position.set(0, 1.44, 0);
      g.add(lintel, keystone, underRail);

      const topFern = new THREE.Mesh(sharedFernTuftGeo, foliage);
      topFern.scale.set(0.7, 0.55, 0.7);
      topFern.position.set(-2.2, 2.48, 0);
      g.add(topFern);
      break;
    }

    case 'tall_pillar': {
      const col = new THREE.Mesh(getSculptedColumnGeo(), stone);
      col.scale.set(0.92, 0.54, 0.92);
      col.castShadow = true;
      col.receiveShadow = true;
      const crest = new THREE.Mesh(getAngkorPrasatFinialGeo(), trim);
      crest.scale.setScalar(0.55);
      crest.position.y = 4.35;
      const baseAo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), contactShadow);
      baseAo.rotation.x = -Math.PI / 2;
      baseAo.position.y = 0.03;
      const baseFern = new THREE.Mesh(sharedFernTuftGeo, foliage);
      baseFern.scale.setScalar(0.52);
      baseFern.position.set(0.55, 0.05, 0.45);
      g.add(col, crest, baseAo, baseFern);
      break;
    }

    case 'gap': {
      const voidMat = new THREE.MeshBasicMaterial({ color: '#07090d' });
      const chasm = new THREE.Mesh(new THREE.PlaneGeometry(8.1, 3.6), voidMat);
      chasm.rotation.x = -Math.PI / 2;
      chasm.position.y = 0.015;
      g.add(chasm);

      // Jagged fractured canyon rock lips on entry & exit edges
      for (let i = -3; i <= 3; i++) {
        for (const sz of [-1.85, 1.85]) {
          const rockEdge = new THREE.Mesh(sharedObsBoulderGeo, trim);
          rockEdge.scale.set(0.66, 0.24, 0.34);
          rockEdge.rotation.y = (i * 0.7) + sz;
          rockEdge.position.set(i * 1.15, 0.05, sz);
          g.add(rockEdge);
        }
      }
      const warnRail = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 7.6, 8), hazard);
      warnRail.rotation.z = Math.PI / 2;
      warnRail.position.set(0, 0.14, 1.76);
      g.add(warnRail);
      break;
    }

    case 'narrow_bridge': {
      const chasm = new THREE.Mesh(
        new THREE.PlaneGeometry(8.2, 8.4),
        new THREE.MeshBasicMaterial({ color: '#07090d' }),
      );
      chasm.rotation.x = -Math.PI / 2;
      chasm.position.y = 0.015;
      g.add(chasm);

      // Individual heavy timber planks + side suspension cable rails
      for (let pz = -3.9; pz <= 3.91; pz += 0.65) {
        const plank = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.15, 8), bark);
        plank.rotation.z = Math.PI / 2;
        plank.scale.set(0.95, 1.0, 1.9);
        plank.position.set(0, 0.08, pz);
        plank.receiveShadow = true;
        g.add(plank);
      }
      for (const s of [-1, 1]) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 8.4, 8), metal);
        rope.rotation.x = Math.PI / 2;
        rope.position.set(s * 1.08, 0.24, 0);
        g.add(rope);
      }
      break;
    }

    case 'collapsing_floor': {
      for (const ox of [-0.62, 0.62]) {
        const shard = new THREE.Mesh(sharedObsBoulderGeo, stone);
        shard.scale.set(0.68, 0.18, 1.05);
        shard.position.set(ox, 0.06, ox * 0.12);
        g.add(shard);
      }
      const fissure = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 2.2, 6), hazard);
      fissure.rotation.x = Math.PI / 2;
      fissure.rotation.z = 0.24;
      fissure.position.set(0, 0.12, 0);
      g.add(fissure);
      break;
    }

    case 'moving_block': {
      const monolith = new THREE.Mesh(getCarvedMonolithPrismGeo(), stone);
      monolith.position.y = 0.12;
      monolith.castShadow = true;
      const crown = new THREE.Mesh(getAngkorPrasatFinialGeo(), trim);
      crown.scale.setScalar(0.58);
      crown.position.y = 2.28;
      const runeRing = new THREE.Mesh(new THREE.TorusGeometry(0.94, 0.08, 8, 16), accent);
      runeRing.rotation.x = Math.PI / 2;
      runeRing.position.y = 1.24;
      g.add(monolith, crown, runeRing);
      break;
    }

    case 'swinging_blade': {
      for (const sx of [-3.65, 3.65]) {
        const p = new THREE.Mesh(getSculptedColumnGeo(), stone);
        p.scale.set(0.45, 0.68, 0.45);
        p.position.set(sx, 0, 0);
        g.add(p);
      }
      const beam = new THREE.Mesh(getChamferedArchBeamGeo(), trim);
      beam.scale.set(1.0, 0.56, 0.9);
      beam.position.y = 5.45;
      g.add(beam);

      const pivot = new THREE.Group();
      pivot.name = 'pendulum';
      pivot.position.set(0, 5.2, 0);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.55, 8), metal);
      chain.position.y = -1.78;
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.12, 18, 1, false, 0, Math.PI), metal);
      blade.rotation.x = Math.PI / 2;
      blade.rotation.z = Math.PI;
      blade.position.y = -3.45;
      const bladeEdge = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.04, 6, 18, Math.PI), accent);
      bladeEdge.rotation.z = Math.PI;
      bladeEdge.position.y = -3.45;
      pivot.add(chain, blade, bladeEdge);
      g.add(pivot);
      break;
    }

    case 'rotating_spinner': {
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.55, 12), stone);
      axle.position.y = 0.78;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), metal);
      cap.position.y = 1.56;
      const rotor = new THREE.Group();
      rotor.name = 'rotor';
      rotor.position.y = 0.96;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 4.9, 10), bark);
      bar.rotation.z = Math.PI / 2;
      const tipL = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.52, 8), metal);
      tipL.rotation.z = Math.PI / 2;
      tipL.position.x = -2.6;
      const tipR = tipL.clone();
      tipR.rotation.z = -Math.PI / 2;
      tipR.position.x = 2.6;
      rotor.add(bar, tipL, tipR);
      g.add(axle, cap, rotor);
      break;
    }

    case 'spike_trap': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, 0.16, 8), metal);
      base.scale.set(1.05, 1.0, 0.85);
      base.position.y = 0.08;
      g.add(base);
      for (let ix = -1; ix <= 1; ix++) {
        for (let iz = -1; iz <= 1; iz++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.88, 8), metal);
          spike.position.set(ix * 0.52, 0.48, iz * 0.4);
          g.add(spike);
        }
      }
      break;
    }

    case 'fire_vent': {
      const grate = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.96, 0.24, 14), metal);
      grate.position.y = 0.12;
      const embers = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 12), hazard);
      embers.position.y = 0.2;
      const flamePivot = new THREE.Group();
      flamePivot.name = 'flame';
      flamePivot.position.y = 1.05;
      const fl1 = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 2.05), flame);
      const fl2 = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 2.05), flame);
      fl2.rotation.y = Math.PI / 2;
      flamePivot.add(fl1, fl2);
      g.add(grate, embers, flamePivot);
      break;
    }

    case 'mine_cart': {
      const body = new THREE.Mesh(getOreCartHopperGeo(), bark);
      body.position.y = 0.86;
      body.castShadow = true;
      for (const rz of [-0.62, 0.0, 0.62]) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.045, 6, 12), metal);
        rib.scale.set(1.05, 0.85, 1.0);
        rib.position.set(0, 0.88, rz);
        g.add(rib);
      }
      const ore = new THREE.Mesh(sharedObsBoulderGeo, accent);
      ore.scale.set(0.68, 0.48, 0.86);
      ore.position.y = 1.32;
      const wheelGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.14, 14);
      for (const wx of [-0.88, 0.88]) {
        for (const wz of [-0.72, 0.72]) {
          const w = new THREE.Mesh(wheelGeo, metal);
          w.rotation.z = Math.PI / 2;
          w.position.set(wx, 0.29, wz);
          g.add(w);
        }
      }
      g.add(body, ore);
      break;
    }

    case 'falling_debris': {
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), contactShadow);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.04;
      const rock = new THREE.Mesh(sharedObsBoulderGeo, stone);
      rock.name = 'debris_rock';
      rock.scale.set(0.95, 0.85, 0.95);
      rock.position.y = 7.5;
      rock.castShadow = true;
      g.add(shadow, rock);
      break;
    }
  }

  if (kind === 'high_arch' && (level.architecture === 'jungle_temple' || level.architecture === 'giant_canopy')) {
    const vDrape = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), vine);
    vDrape.position.set(2.3, 1.95, 0.54);
    g.add(vDrape);
  }

  return g;
}

// ---------------------------------------------------------------------------
// 6. Monumental Angkor-Wat Ancient Temple Archways (Carved Trim + Prasat Finials + Borderless Vines)
// ---------------------------------------------------------------------------

export function buildTempleArch(
  variant: number,
  style: ArchitectureStyle,
  mats: BiomeMaterialPack,
): THREE.Group {
  const g = new THREE.Group();
  const { stone, trim, foliage, canopy, vine, bark, contactShadow } = mats;
  const v = variant % 3;
  const isLush =
    style === 'jungle_temple' ||
    style === 'giant_canopy' ||
    style === 'whispering_woods' ||
    style === 'drowned_arches';

  // Twin sculpted fluted Angkor columns + baked contact AO plinth shadows + bronze fire braziers
  for (const s of [-1, 1]) {
    const x = s * 4.84;
    const plinth = new THREE.Mesh(getBeveledStoneGeo(2.2, 0.88, 2.2, 0.14), trim);
    plinth.position.set(x, 0.44, 0);
    plinth.receiveShadow = true;

    const plinthAo = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), contactShadow);
    plinthAo.rotation.x = -Math.PI / 2;
    plinthAo.position.set(x, 0.03, 0);

    const col = new THREE.Mesh(getSculptedColumnGeo(), stone);
    col.position.set(x, 0.84, 0);
    col.scale.set(1.04, 1.05, 1.04);
    col.castShadow = true;
    col.receiveShadow = true;

    const bracket = new THREE.Mesh(getBeveledStoneGeo(0.88, 0.36, 0.68, 0.07), trim);
    bracket.position.set(x - s * 0.82, 4.35, 0.45);
    const brazier = buildSculptedBrazier(mats);
    brazier.position.set(x - s * 0.92, 4.52, 0.45);

    g.add(plinth, plinthAo, col, bracket, brazier);
  }

  if (v === 0) {
    // Variant 0: Grand Angkor-Wat Stepped Prasat Gateway (beveled carved masonry + sculpted spire!)
    const lowerEntablature = new THREE.Mesh(getBeveledStoneGeo(11.6, 0.98, 1.56, 0.12), stone);
    lowerEntablature.position.set(0, 9.75, 0);
    lowerEntablature.castShadow = true;

    const lotusFrieze = new THREE.Mesh(getBeveledStoneGeo(12.35, 0.48, 1.88, 0.09), trim);
    lotusFrieze.position.set(0, 10.42, 0);

    const tier2 = new THREE.Mesh(getBeveledStoneGeo(8.5, 0.9, 1.48, 0.11), stone);
    tier2.position.set(0, 11.08, 0);

    const tier2Trim = new THREE.Mesh(getBeveledStoneGeo(8.9, 0.36, 1.66, 0.08), trim);
    tier2Trim.position.set(0, 11.65, 0);

    const tier3 = new THREE.Mesh(getBeveledStoneGeo(5.2, 0.74, 1.32, 0.1), stone);
    tier3.position.set(0, 12.16, 0);

    const prasatSpire = new THREE.Mesh(getAngkorPrasatFinialGeo(), trim);
    prasatSpire.scale.setScalar(0.95);
    prasatSpire.position.set(0, 12.48, 0);

    for (const s of [-1, 1]) {
      const corbel = new THREE.Mesh(getBeveledStoneGeo(1.5, 0.78, 1.24, 0.1), trim);
      corbel.position.set(s * 3.7, 9.0, 0);
      corbel.rotation.z = s * 0.45;
      const sideFinial = new THREE.Mesh(getAngkorPrasatFinialGeo(), trim);
      sideFinial.scale.setScalar(0.58);
      sideFinial.position.set(s * 4.85, 10.62, 0);
      g.add(corbel, sideFinial);
    }
    g.add(lowerEntablature, lotusFrieze, tier2, tier2Trim, tier3, prasatSpire);
  } else if (v === 1) {
    // Variant 1: Ancient Collapsed Ruin Arch + Thick Strangler-Fig Root Wrapping Fractured Stone
    const leftBeam = new THREE.Mesh(getBeveledStoneGeo(5.8, 1.04, 1.5, 0.12), stone);
    leftBeam.position.set(-2.95, 9.72, 0);
    leftBeam.rotation.z = -0.055;
    leftBeam.castShadow = true;

    const rightBeam = new THREE.Mesh(getBeveledStoneGeo(4.5, 0.98, 1.46, 0.12), stone);
    rightBeam.position.set(3.45, 9.85, 0);
    rightBeam.rotation.z = 0.085;
    rightBeam.castShadow = true;

    const corniceL = new THREE.Mesh(getBeveledStoneGeo(6.15, 0.42, 1.74, 0.08), trim);
    corniceL.position.set(-2.95, 10.42, 0);
    corniceL.rotation.z = -0.055;

    const rootPts = [
      new THREE.Vector3(-5.55, 0.2, 0.92),
      new THREE.Vector3(-5.0, 3.8, 0.85),
      new THREE.Vector3(-4.6, 7.6, 0.78),
      new THREE.Vector3(-3.6, 10.22, 0.55),
      new THREE.Vector3(-1.3, 10.12, 0.25),
    ];
    const stranglerRoot = new THREE.Mesh(buildTaperedBranchGeo(rootPts, 0.35, 0.12, 12, 7, 0.14), bark);
    g.add(leftBeam, rightBeam, corniceL, stranglerRoot);
  } else {
    // Variant 2: Twin-Spired Sanctuary Portal with Carved Lotus Medallion & Stepped Cornice
    const lintel = new THREE.Mesh(getBeveledStoneGeo(11.4, 0.96, 1.5, 0.12), stone);
    lintel.position.set(0, 9.72, 0);
    lintel.castShadow = true;

    const trimBand = new THREE.Mesh(getBeveledStoneGeo(11.9, 0.42, 1.78, 0.08), trim);
    trimBand.position.set(0, 10.38, 0);

    for (const s of [-1, 1]) {
      const spire = new THREE.Mesh(getAngkorPrasatFinialGeo(), trim);
      spire.scale.setScalar(0.84);
      spire.position.set(s * 4.65, 10.55, 0);
      g.add(spire);
    }
    const seal = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.2, 10, 22), trim);
    seal.position.set(0, 10.95, 0.1);
    g.add(lintel, trimBand, seal);
  }

  // Organic Hanging Vines Tucked Up Behind Lintel (ZERO visible rectangular top cutoff edges!) + 3D Woody Lianas
  if (isLush) {
    const vineSpecs = [
      { x: -3.35, y: 8.55, w: 2.35, h: 3.4, z: 0.58, ry: 0.12 },
      { x: -0.25, y: 8.85, w: 2.05, h: 2.75, z: 0.62, ry: -0.08 },
      { x: 2.9, y: 8.45, w: 2.45, h: 3.55, z: 0.58, ry: -0.14 },
    ];
    for (const vs of vineSpecs) {
      const vGeo = new THREE.PlaneGeometry(vs.w, vs.h, 2, 3);
      // Slight natural wind-drape curve so hanging vines feel 3D
      const vp = vGeo.attributes.position;
      for (let i = 0; i < vp.count; i++) {
        const py = vp.getY(i);
        const ny = (vs.h * 0.5 - py) / vs.h; // 0 at top -> 1 at bottom tip
        vp.setZ(i, ny * ny * 0.34);
      }
      vGeo.computeVertexNormals();
      const curtain = new THREE.Mesh(vGeo, vine);
      curtain.position.set(vs.x, vs.y, vs.z);
      curtain.rotation.y = vs.ry;
      g.add(curtain);
    }

    // Real 3D woody liana vines draping organically over the temple cornice
    const lianaPts = [
      new THREE.Vector3(-4.2, 10.6, 0.8),
      new THREE.Vector3(-2.1, 9.15, 0.88),
      new THREE.Vector3(0.4, 9.65, 0.84),
      new THREE.Vector3(3.6, 8.95, 0.86),
    ];
    const liana = new THREE.Mesh(buildTaperedBranchGeo(lianaPts, 0.08, 0.04, 12, 6, 0.06), bark);
    g.add(liana);

    // Lush multi-species ferns & palm fronds sprouting naturally from top stone crevices
    for (const fx of [v === 1 ? -3.1 : 3.25, -4.65, 0.35]) {
      const fern = new THREE.Mesh(sharedFernTuftGeo, fx > 0 ? canopy : foliage);
      fern.scale.set(1.25, 1.0, 1.25);
      fern.position.set(fx, 10.05, 0.35);
      g.add(fern);
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// 7. Non-Repetitive Realistic Biome Landmarks (Multi-Species Trees + Sculpted Angkor Ruins)
// ---------------------------------------------------------------------------

const sharedCliffRockGeo = buildRealisticBoulderGeo(19);
const sharedCliffRockGeo2 = buildRealisticBoulderGeo(43);

export function buildBiomeLandmark(
  style: ArchitectureStyle,
  mats: BiomeMaterialPack,
  side: -1 | 1,
  variant: number,
): THREE.Group {
  const g = new THREE.Group();
  const { stone, trim, foliage, foliageAlt, canopy, bark, terrain, metal, hazard, contactShadow } = mats;
  const v = ((variant % 4) + 4) % 4;

  const isIce = style === 'ice_spires' || style === 'crystal_caverns';
  const isVolcanic =
    style === 'volcanic_obelisks' ||
    style === 'infernal_fortress' ||
    style === 'hollow_ribs' ||
    style === 'shattered_realm';
  const isArid = style === 'desert_pylons' || style === 'canyon_bridges' || style === 'lost_ziggurat';
  const isImperial =
    style === 'drowned_arches' ||
    style === 'golden_aqueduct' ||
    style === 'sky_colonnade' ||
    style === 'last_sanctuary' ||
    style === 'colossus_sanctuary';
  const isIndustrial = style === 'iron_mines' || style === 'storm_monoliths' || style === 'nightfall_city';

  if (isIce) {
    const crystalMat = new THREE.MeshStandardMaterial({
      color: '#bae6fd',
      emissive: '#0284c7',
      emissiveIntensity: 0.24,
      roughness: 0.14,
      metalness: 0.35,
    });
    if (v === 0 || v === 2) {
      for (let i = 0; i < 5; i++) {
        const h = 4.2 + (i % 3) * 2.6 + v * 0.6;
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.72 + i * 0.14, h, 7), crystalMat);
        spire.position.set((i - 2) * 0.72, h * 0.45, (i % 2) * 0.9 - 0.4);
        spire.rotation.set((i - 1) * 0.08, i * 0.7, side * (0.12 + i * 0.05));
        g.add(spire);
      }
      const baseRock = new THREE.Mesh(sharedCliffRockGeo, terrain);
      baseRock.scale.set(2.4, 1.3, 2.2);
      baseRock.position.y = 0.6;
      g.add(baseRock);
    } else {
      const col = new THREE.Mesh(getSculptedColumnGeo(), stone);
      col.scale.set(0.95, 0.88, 0.95);
      col.rotation.z = side * 0.06;
      const frost = new THREE.Mesh(new THREE.ConeGeometry(0.65, 3.8, 6), crystalMat);
      frost.position.set(-side * 0.9, 1.8, 0.5);
      g.add(col, frost);
    }
    return g;
  }

  if (isVolcanic) {
    if (v === 0 || v === 2) {
      const crag = new THREE.Mesh(sharedCliffRockGeo, terrain);
      crag.scale.set(2.8, 3.9 + v * 0.6, 2.5);
      crag.position.y = 2.2;
      const magmaVein = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.28, 4.2, 6), hazard);
      magmaVein.position.set(-side * 0.8, 2.0, 0.6);
      const brazier = buildSculptedBrazier(mats);
      brazier.scale.setScalar(1.35);
      brazier.position.set(-side * 1.4, 1.4, 0.8);
      g.add(crag, magmaVein, brazier);
    } else {
      const ribPts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(-side * 0.8, 4.5, 0.2),
        new THREE.Vector3(-side * 2.2, 8.2, -0.3),
      ];
      const rib = new THREE.Mesh(buildTaperedBranchGeo(ribPts, 0.85, 0.22, 10, 8, 0.14), stone);
      const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 4.1, 6), hazard);
      ember.position.set(-side * 0.4, 2.1, 0.55);
      g.add(rib, ember);
    }
    return g;
  }

  if (isArid) {
    if (v === 0 || v === 2) {
      const mesa = new THREE.Mesh(sharedCliffRockGeo2, terrain);
      mesa.scale.set(3.1, 2.6 + v * 0.7, 2.6);
      mesa.position.y = 1.6;
      const mesaTop = new THREE.Mesh(sharedCliffRockGeo, stone);
      mesaTop.scale.set(2.2, 1.4, 2.0);
      mesaTop.position.set(side * 0.4, 3.8, 0);
      g.add(mesa, mesaTop);
    } else if (style === 'canyon_bridges') {
      // Heavy timber canyon trestle & suspended mine lantern
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 7.6, 10), bark);
      post.position.y = 3.8;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 5.2, 8), bark);
      strut.position.set(-side * 0.95, 2.5, 0);
      strut.rotation.z = side * 0.48;
      const brazier = buildSculptedBrazier(mats);
      brazier.position.set(-side * 1.4, 3.9, 0.2);
      g.add(post, strut, brazier);
    } else {
      // Stepped Desert Sandstone Ziggurat Pylon
      for (let t = 0; t < 3; t++) {
        const tier = new THREE.Mesh(new THREE.CylinderGeometry(1.9 - t * 0.45, 2.15 - t * 0.45, 1.45, 4), stone);
        tier.rotation.y = Math.PI * 0.25;
        tier.position.y = 0.72 + t * 1.45;
        g.add(tier);
      }
      const brazier = buildSculptedBrazier(mats);
      brazier.position.set(-side * 1.2, 1.4, 0.7);
      g.add(brazier);
    }
    return g;
  }

  if (isImperial) {
    // Fluted Marble Aqueduct & Sanctuary Obelisks
    if (v === 0 || v === 2) {
      const col = new THREE.Mesh(getSculptedColumnGeo(), trim);
      col.scale.set(1.02, 1.04, 1.02);
      const crown = new THREE.Mesh(getAngkorPrasatFinialGeo(), mats.accent);
      crown.scale.setScalar(0.8);
      crown.position.y = 8.4;
      const brazier = buildSculptedBrazier(mats);
      brazier.position.set(-side * 1.35, 1.15, 0.6);
      g.add(col, crown, brazier);
    } else {
      // Tapered Sanctuary Obelisk
      const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.15, 8.8, 4), stone);
      obelisk.rotation.y = Math.PI * 0.25;
      obelisk.position.y = 4.4;
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), mats.accent);
      cap.position.y = 9.05;
      g.add(obelisk, cap);
    }
    return g;
  }

  if (isIndustrial) {
    // Storm Monoliths / Iron Mines / Nightfall Lantern Towers
    if (v === 0 || v === 2) {
      const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 8.2, 6), metal);
      frame.position.y = 4.1;
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.14, 8, 18), hazard);
      coil.rotation.x = Math.PI / 2;
      coil.position.y = 6.2;
      const brazier = buildSculptedBrazier(mats);
      brazier.position.set(-side * 1.15, 2.2, 0.4);
      g.add(frame, coil, brazier);
    } else {
      const rock = new THREE.Mesh(sharedCliffRockGeo, terrain);
      rock.scale.set(2.4, 2.2, 2.2);
      rock.position.y = 1.1;
      const lantern = buildSculptedBrazier(mats);
      lantern.position.set(-side * 1.1, 1.5, 0.7);
      g.add(rock, lantern);
    }
    return g;
  }

  // Lush Ancient Jungle & Sanctuary Biomes
  if (v === 0) {
    const tree = buildRealisticBranchingTree(mats, side > 0 ? 0 : 1);
    tree.rotation.y = side > 0 ? -0.4 : 2.6;
    g.add(tree);

    const boulder = new THREE.Mesh(sharedCliffRockGeo, terrain);
    boulder.scale.set(1.9, 1.15, 1.65);
    boulder.position.set(-side * 1.25, 0.45, 0.85);
    boulder.receiveShadow = true;

    const fern = new THREE.Mesh(sharedFernTuftGeo, canopy);
    fern.scale.set(1.45, 1.18, 1.45);
    fern.position.set(-side * 1.7, 0.15, -0.75);
    g.add(boulder, fern);
  } else if (v === 1) {
    // Overgrown Angkor Temple Ruin Shrine with beveled stone masonry + Prasat roof finial + strangler roots
    const basePlinth = new THREE.Mesh(getBeveledStoneGeo(4.4, 1.4, 3.8, 0.15), stone);
    basePlinth.position.y = 0.7;
    basePlinth.receiveShadow = true;
    basePlinth.castShadow = true;

    const ao = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 5.4), contactShadow);
    ao.rotation.x = -Math.PI / 2;
    ao.position.y = 0.04;

    const wall = new THREE.Mesh(getBeveledStoneGeo(3.6, 3.6, 2.8, 0.14), stone);
    wall.position.set(side * 0.25, 3.1, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;

    const cornice = new THREE.Mesh(getBeveledStoneGeo(4.2, 0.5, 3.3, 0.1), trim);
    cornice.position.set(side * 0.25, 5.05, 0);

    const spire = new THREE.Mesh(getAngkorPrasatFinialGeo(), trim);
    spire.scale.setScalar(0.85);
    spire.position.set(side * 0.25, 5.25, 0);

    const col = new THREE.Mesh(getSculptedColumnGeo(), stone);
    col.scale.set(0.62, 0.62, 0.62);
    col.position.set(-side * 1.45, 1.2, 1.15);
    col.castShadow = true;

    const rootPts = [
      new THREE.Vector3(side * 1.6, 5.6, 0.4),
      new THREE.Vector3(side * 0.2, 4.9, 1.35),
      new THREE.Vector3(-side * 0.9, 2.6, 1.55),
      new THREE.Vector3(-side * 1.4, 0.1, 1.8),
    ];
    const root = new THREE.Mesh(buildTaperedBranchGeo(rootPts, 0.28, 0.1, 10, 7, 0.12), bark);

    const roofFern = new THREE.Mesh(sharedFernTuftGeo, foliageAlt);
    roofFern.scale.set(1.65, 1.25, 1.65);
    roofFern.position.set(side * 0.1, 5.15, 0.45);

    const brazier = buildSculptedBrazier(mats);
    brazier.position.set(-side * 1.55, 1.42, -1.05);

    g.add(basePlinth, ao, wall, cornice, spire, col, root, roofFern, brazier);
  } else if (v === 2) {
    const cliff1 = new THREE.Mesh(sharedCliffRockGeo2, terrain);
    cliff1.scale.set(2.95, 2.25, 2.65);
    cliff1.position.set(side * 0.6, 1.2, 0);
    cliff1.receiveShadow = true;

    const cliff2 = new THREE.Mesh(sharedCliffRockGeo, terrain);
    cliff2.scale.set(2.15, 1.55, 2.0);
    cliff2.position.set(-side * 0.85, 0.75, 1.35);

    const tree = buildRealisticBranchingTree(mats, side > 0 ? 2 : 3);
    tree.position.set(side * 0.5, 1.8, -0.4);
    tree.scale.setScalar(0.95);
    tree.rotation.z = -side * 0.14;

    const fernL = new THREE.Mesh(sharedFernTuftGeo, foliage);
    fernL.scale.set(1.5, 1.15, 1.5);
    fernL.position.set(-side * 1.65, 0.25, 0.2);

    g.add(cliff1, cliff2, tree, fernL);
  } else {
    const col = new THREE.Mesh(getSculptedColumnGeo(), stone);
    col.scale.set(1.05, 0.78, 1.05);
    col.position.set(-side * 0.4, 0, 0.2);
    col.rotation.z = side * 0.08;
    col.castShadow = true;

    const fallenDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 2.1, 14), stone);
    fallenDrum.rotation.z = Math.PI * 0.48;
    fallenDrum.rotation.y = 0.55;
    fallenDrum.position.set(-side * 1.4, 0.56, 1.45);

    const backTree = buildRealisticBranchingTree(mats, 1);
    backTree.position.set(side * 2.2, -0.2, -1.6);
    backTree.scale.setScalar(1.1);

    const fern = new THREE.Mesh(sharedFernTuftGeo, canopy);
    fern.scale.set(1.55, 1.22, 1.55);
    fern.position.set(-side * 1.35, 0.2, -0.8);

    const ironRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.07, 8, 16), metal);
    ironRing.rotation.x = Math.PI / 2;
    ironRing.position.set(-side * 0.4, 3.6, 0.2);

    g.add(col, fallenDrum, backTree, fern, ironRing);
  }

  return g;
}

// ---------------------------------------------------------------------------
// 8. Photorealistic Panoramic Distant Vista + Smooth 3D Parallax Mountain Ridges
// ---------------------------------------------------------------------------

export function buildDistantVista(level: LevelDef, mats: BiomeMaterialPack): THREE.Group {
  const g = new THREE.Group();
  const horizonCol = new THREE.Color(level.palette.fogColor);
  const skyTopCol = new THREE.Color(level.palette.skyTop);

  // Seamless 360° distant jungle & mountain panorama (frames BOTH forward run and rear Opening Hollow Chase!)
  const panoGeo = new THREE.CylinderGeometry(
    158,
    158,
    92,
    48,
    1,
    true,
    0,
    Math.PI * 2,
  );
  const uvAttr = panoGeo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setX(i, 1 - uvAttr.getX(i));
  }

  const panoMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uMap: { value: mats.vistaMap },
      uFogColor: { value: horizonCol },
      uSkyColor: { value: skyTopCol },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      uniform vec3 uSkyColor;
      varying vec2 vUv;
      void main() {
        float pingPongU = 1.0 - abs(mod(vUv.x * 2.0, 2.0) - 1.0);
        vec4 tex = texture2D(uMap, vec2(pingPongU, vUv.y));
        vec3 col = mix(tex.rgb, uFogColor, 0.16);
        float topFade = 1.0 - smoothstep(0.84, 1.0, vUv.y);
        float bottomFade = smoothstep(0.0, 0.14, vUv.y);
        float alpha = topFade * bottomFade;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const panoMesh = new THREE.Mesh(panoGeo, panoMat);
  panoMesh.position.set(0, 18, 0);
  g.add(panoMesh);

  // Soft sunlit atmospheric valley mist veil bridging the far road vanishing point cleanly into the canyon
  const vanishMistMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uColor: { value: horizonCol.clone().lerp(new THREE.Color(level.palette.sunColor), 0.28) },
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
        float dx = (vUv.x - 0.5) * 2.0;
        float dy = (vUv.y - 0.35) * 2.0;
        float r = clamp(1.0 - sqrt(dx * dx * 0.65 + dy * dy * 1.1), 0.0, 1.0);
        float alpha = pow(r, 1.8) * 0.56;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  const vanishMist = new THREE.Mesh(new THREE.PlaneGeometry(84, 34), vanishMistMat);
  vanishMist.position.set(0, 6.5, -138);
  g.add(vanishMist);

  const buildSmoothRidge = (width: number, height: number, seed: number) => {
    const geo = new THREE.PlaneGeometry(width, height, 32, 12);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const u = (x + width * 0.5) / width;
      const v = (y + height * 0.5) / height;
      const ridgeEnv = Math.sin(u * Math.PI);
      const peakProfile =
        (Math.sin(u * 9.5 + seed) * 0.42 +
          Math.cos(u * 18.0 - seed * 1.4) * 0.24 +
          Math.sin(u * 31.0 + seed * 2.1) * 0.12 +
          0.62) *
        ridgeEnv;
      const newY = (v * peakProfile - 0.35) * height;
      const cragZ = Math.sin(u * 14.0 + v * 6.0 + seed) * 4.5 * v;
      pos.setXYZ(i, x, newY, cragZ);
    }
    geo.computeVertexNormals();
    return geo;
  };

  const ridgeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(level.palette.terrainColor).lerp(horizonCol, 0.35),
    map: mats.terrain.map,
    normalMap: mats.terrain.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.94,
    metalness: 0.02,
  });

  const leftRidge = new THREE.Mesh(buildSmoothRidge(115, 42, 1.4), ridgeMat);
  leftRidge.position.set(-58, 12, -112);
  leftRidge.rotation.y = 0.38;

  const rightRidge = new THREE.Mesh(buildSmoothRidge(115, 46, 3.7), ridgeMat);
  rightRidge.position.set(58, 13, -112);
  rightRidge.rotation.y = -0.38;

  // Distant rear mountain ridge closing the +Z skyline behind The Hollow Pursuer during opening chase!
  const rearRidge = new THREE.Mesh(buildSmoothRidge(165, 44, 5.2), ridgeMat);
  rearRidge.position.set(0, 12.5, 118);
  rearRidge.rotation.y = Math.PI;

  g.add(leftRidge, rightRidge, rearRidge);
  return g;
}

// ---------------------------------------------------------------------------
// 9. Real Curved 3D Branching Causeways, Sky Bridges & Fork Wayfinders
// ---------------------------------------------------------------------------

interface RibbonSample {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  rz: number;
  arc: number;
  z: number;
}

function buildCurvedRibbonGeometry(
  samples: readonly RibbonSample[],
  leftOffset: number,
  rightOffset: number,
  yOffset: number,
  uvScaleV: number,
): THREE.BufferGeometry {
  const n = samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const lx = s.cx + s.rx * leftOffset;
    const lz = s.cz + s.rz * leftOffset;
    const rx = s.cx + s.rx * rightOffset;
    const rz = s.cz + s.rz * rightOffset;
    const y = s.cy + yOffset;

    const vi = i * 2;
    positions[vi * 3] = lx;
    positions[vi * 3 + 1] = y;
    positions[vi * 3 + 2] = lz;
    normals[vi * 3] = 0;
    normals[vi * 3 + 1] = 1;
    normals[vi * 3 + 2] = 0;
    uvs[vi * 2] = 0;
    uvs[vi * 2 + 1] = s.arc * uvScaleV;

    positions[(vi + 1) * 3] = rx;
    positions[(vi + 1) * 3 + 1] = y;
    positions[(vi + 1) * 3 + 2] = rz;
    normals[(vi + 1) * 3] = 0;
    normals[(vi + 1) * 3 + 1] = 1;
    normals[(vi + 1) * 3 + 2] = 0;
    uvs[(vi + 1) * 2] = 1;
    uvs[(vi + 1) * 2 + 1] = s.arc * uvScaleV;

    if (i < n - 1) {
      const a = vi;
      const b = vi + 1;
      const c = vi + 2;
      const d = vi + 3;
      // Top-facing CCW winding (looking from +Y down onto XZ where z goes negative forward)
      indices.push(a, b, d, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildCurvedWallStripGeometry(
  samples: readonly RibbonSample[],
  lateralOffset: number,
  yTop: number,
  yBottom: number,
  facingOutwardSign: -1 | 1,
  uvScaleV: number,
): THREE.BufferGeometry {
  const n = samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const x = s.cx + s.rx * lateralOffset;
    const z = s.cz + s.rz * lateralOffset;

    const vi = i * 2;
    positions[vi * 3] = x;
    positions[vi * 3 + 1] = s.cy + yTop;
    positions[vi * 3 + 2] = z;
    uvs[vi * 2] = 0;
    uvs[vi * 2 + 1] = s.arc * uvScaleV;

    positions[(vi + 1) * 3] = x;
    positions[(vi + 1) * 3 + 1] = s.cy + yBottom;
    positions[(vi + 1) * 3 + 2] = z;
    uvs[(vi + 1) * 2] = 1;
    uvs[(vi + 1) * 2 + 1] = s.arc * uvScaleV;

    if (i < n - 1) {
      const a = vi;
      const b = vi + 1;
      const c = vi + 2;
      const d = vi + 3;
      if (facingOutwardSign > 0) {
        indices.push(a, b, d, a, d, c);
      } else {
        indices.push(a, d, b, a, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a complete, seamlessly connected 3D branching road network for a TrackBranch:
 * - Real curved C1-smooth flagstone causeway decks for Left, Right, and (on 3-way splits) Center
 * - Solid carved stone underside aprons & stepped outer curbs
 * - Route-specific architecture: elevated stone aqueduct piers on Sky Bridge,
 *   burning temple braziers & sculpted pilasters on Relic Vault, and fork wayfinder monoliths
 */
export function buildBranchSectionMesh(
  branch: TrackBranch,
  mats: BiomeMaterialPack,
  pathMat: THREE.MeshStandardMaterial,
  laneWidth: number,
): THREE.Group {
  const g = new THREE.Group();
  const halfRoad = laneWidth * 1.575;
  const curbInner = halfRoad + 0.02;
  const curbOuter = halfRoad + 0.54;
  const apronOuter = halfRoad + 0.72;
  const zMin = branch.startZ - 14;
  const zMax = branch.endZ + 14;
  const stepZ = 2.0;

  const branchArr = [branch];

  for (let rIdx = 0; rIdx < branch.routes.length; rIdx++) {
    const meta = branch.routes[rIdx];
    const samples: RibbonSample[] = [];
    let arc = 0;
    let prevX = 0;
    let prevY = 0;
    let prevZ = 0;

    for (let z = zMin; z <= zMax + 0.01; z += stepZ) {
      const clampedZ = Math.min(z, zMax);
      const pose = sampleRoutePose(branchArr, clampedZ, meta.id);
      const wz = -clampedZ;
      if (samples.length > 0) {
        arc += Math.hypot(pose.centerX - prevX, pose.centerY - prevY, wz - prevZ);
      }
      samples.push({
        cx: pose.centerX,
        cy: pose.centerY,
        cz: wz,
        rx: pose.rightX,
        rz: pose.rightZ,
        arc,
        z: clampedZ,
      });
      prevX = pose.centerX;
      prevY = pose.centerY;
      prevZ = wz;
    }

    // Tiny vertical layer bias (0.008m) only in overlap zones prevents any Z-fighting between diverging decks
    const deckBias = meta.id === 'center' ? 0.012 : meta.id === 'left' ? 0.004 : 0.0;
    const deckGeo = buildCurvedRibbonGeometry(samples, -halfRoad, halfRoad, deckBias, 1 / 24);
    const deckMesh = new THREE.Mesh(deckGeo, pathMat);
    deckMesh.receiveShadow = true;
    g.add(deckMesh);

    // Outer stone foundation apron walls (solid monumental causeway thickness)
    const wallGeos: THREE.BufferGeometry[] = [
      buildCurvedWallStripGeometry(samples, -apronOuter, deckBias + 0.14, -2.55, -1, 1 / 12),
      buildCurvedWallStripGeometry(samples, apronOuter, deckBias + 0.14, -2.55, 1, 1 / 12),
    ];

    const isSingleScenic = branch.routes.length === 1;

    // Stepped carved curbs along outer edges (keep inner fork seam completely clean of ridges!)
    const trimGeos: THREE.BufferGeometry[] = [];
    const buildOuterEdge = (sideSign: -1 | 1) => {
      // Single scenic curves have solid continuous curbs on both sides; forks keep inner seams open!
      const isAlwaysOuter =
        isSingleScenic ||
        (meta.id === 'left' && sideSign === -1) ||
        (meta.id === 'right' && sideSign === 1);

      const curbSamples = isAlwaysOuter
        ? samples
        : samples.filter((s) => s.z >= branch.startZ + 13 && s.z <= branch.endZ - 13);

      if (curbSamples.length >= 2) {
        const lOff = sideSign < 0 ? -curbOuter : curbInner;
        const rOff = sideSign < 0 ? -curbInner : curbOuter;
        trimGeos.push(buildCurvedRibbonGeometry(curbSamples, lOff, rOff, deckBias + 0.24, 1 / 12));
        wallGeos.push(
          buildCurvedWallStripGeometry(
            curbSamples,
            sideSign < 0 ? -curbInner : curbInner,
            deckBias + 0.24,
            deckBias - 0.02,
            sideSign < 0 ? 1 : -1,
            1 / 12,
          ),
        );
      }
    };
    buildOuterEdge(-1);
    buildOuterEdge(1);

    const mergedStone = mergeGeometries(wallGeos, false);
    if (mergedStone) {
      const stoneMesh = new THREE.Mesh(mergedStone, mats.stone);
      stoneMesh.receiveShadow = true;
      g.add(stoneMesh);
    }
    const mergedTrim = mergeGeometries(trimGeos, false);
    if (mergedTrim) {
      const trimMesh = new THREE.Mesh(mergedTrim, mats.trim);
      trimMesh.receiveShadow = true;
      g.add(trimMesh);
    }

    // Route-specific environmental landmarks positioned cleanly outside the curbs (ZERO sightline obstruction!)
    const decorStart = branch.splitEndZ + 2;
    const decorEnd = branch.mergeStartZ - 2;
    const decorStep = meta.style === 'sky_bridge' ? 14 : 16;

    // For elevated sky_bridge crossings, place a shimmering water river channel flowing beneath the aqueduct piers!
    if (meta.style === 'sky_bridge') {
      const midZ = (branch.splitEndZ + branch.mergeStartZ) * 0.5;
      const midPose = sampleRoutePose(branchArr, midZ, meta.id);
      const riverMat = new THREE.MeshStandardMaterial({
        color: '#0e6b7c',
        emissive: '#063340',
        emissiveIntensity: 0.35,
        roughness: 0.14,
        metalness: 0.42,
        transparent: true,
        opacity: 0.84,
      });
      const riverSpan = new THREE.Mesh(new THREE.PlaneGeometry(46, Math.max(26, branch.mergeStartZ - branch.splitEndZ + 12)), riverMat);
      riverSpan.rotation.x = -Math.PI / 2;
      riverSpan.position.set(midPose.centerX, -1.72, -midZ);
      g.add(riverSpan);

      const foamMat = new THREE.MeshBasicMaterial({
        color: '#bae6fd',
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      });
      for (let f = -1; f <= 1; f++) {
        const streak = new THREE.Mesh(new THREE.PlaneGeometry(34, 1.35), foamMat);
        streak.rotation.x = -Math.PI / 2;
        streak.position.set(midPose.centerX + f * 3.2, -1.68, -midZ + f * 7.5);
        g.add(streak);
      }
    }

    for (let dz = decorStart; dz <= decorEnd; dz += decorStep) {
      const pose = sampleRoutePose(branchArr, dz, meta.id);
      const wz = -dz;

      if (meta.style === 'sky_bridge') {
        // Monumental elevated stone aqueduct bridge piers dropping into the river canyon + carved parapet bollards
        for (const s of [-1, 1] as const) {
          const px = pose.centerX + pose.rightX * s * (halfRoad + 0.72);
          const pz = wz + pose.rightZ * s * (halfRoad + 0.72);

          const pierHeight = Math.max(3.6, pose.centerY + 4.4);
          const pier = new THREE.Mesh(getBeveledStoneGeo(1.05, pierHeight, 1.35, 0.11), mats.stone);
          pier.position.set(px, pose.centerY - pierHeight * 0.5 - 0.15, pz);
          pier.rotation.y = pose.headingYaw;
          g.add(pier);

          const bollard = new THREE.Mesh(getBeveledStoneGeo(0.68, 0.92, 0.68, 0.08), mats.trim);
          bollard.position.set(px, pose.centerY + 0.46, pz);
          bollard.rotation.y = pose.headingYaw;
          g.add(bollard);

          const finial = new THREE.Mesh(getAngkorPrasatFinialGeo(), mats.trim);
          finial.scale.setScalar(0.28);
          finial.position.set(px, pose.centerY + 0.94, pz);
          g.add(finial);
        }
      } else if (meta.style === 'ruin_gauntlet') {
        // Subterranean Vaulted Sunken Crypt ribs arching generously overhead (y = 7.2, zero camera clipping!) + wall torches
        const ribGroup = new THREE.Group();
        ribGroup.position.set(pose.centerX, pose.centerY, wz);
        ribGroup.rotation.y = pose.headingYaw;

        for (const s of [-1, 1] as const) {
          const wallPier = new THREE.Mesh(getBeveledStoneGeo(1.15, 7.1, 1.25, 0.1), mats.stone);
          wallPier.position.set(s * (halfRoad + 1.1), 3.4, 0);
          const torch = buildSculptedBrazier(mats);
          torch.scale.setScalar(0.85);
          torch.position.set(s * (halfRoad + 0.58), 2.35, 0.35);
          ribGroup.add(wallPier, torch);
        }
        const vaultBeam = new THREE.Mesh(getBeveledStoneGeo(halfRoad * 2 + 2.8, 0.85, 1.25, 0.1), mats.trim);
        vaultBeam.position.set(0, 7.15, 0);
        ribGroup.add(vaultBeam);
        g.add(ribGroup);
      } else if (meta.style === 'relic_vault') {
        // Golden Relic Vault temple pilasters & flickering bronze fire braziers lining the 2x reward route!
        for (const s of [-1, 1] as const) {
          const px = pose.centerX + pose.rightX * s * (halfRoad + 1.05);
          const pz = wz + pose.rightZ * s * (halfRoad + 1.05);

          const plinth = new THREE.Mesh(getBeveledStoneGeo(1.15, 1.45, 1.15, 0.11), mats.stone);
          plinth.position.set(px, pose.centerY + 0.72, pz);
          plinth.rotation.y = pose.headingYaw;
          g.add(plinth);

          const cap = new THREE.Mesh(getBeveledStoneGeo(1.32, 0.24, 1.32, 0.06), mats.trim);
          cap.position.set(px, pose.centerY + 1.54, pz);
          cap.rotation.y = pose.headingYaw;
          g.add(cap);

          const brazier = buildSculptedBrazier(mats);
          brazier.scale.setScalar(0.92);
          brazier.position.set(px, pose.centerY + 1.66, pz);
          g.add(brazier);
        }
      } else {
        // Center temple causeway / scenic curve coping posts & outer-apex wayfinder torches
        for (const s of [-1, 1] as const) {
          const px = pose.centerX + pose.rightX * s * (halfRoad + 0.68);
          const pz = wz + pose.rightZ * s * (halfRoad + 0.68);
          const post = new THREE.Mesh(getBeveledStoneGeo(0.66, 0.78, 0.66, 0.08), mats.trim);
          post.position.set(px, pose.centerY + 0.39, pz);
          post.rotation.y = pose.headingYaw;
          g.add(post);
          if (isSingleScenic) {
            const br = buildSculptedBrazier(mats);
            br.scale.setScalar(0.75);
            br.position.set(px, pose.centerY + 0.82, pz);
            g.add(br);
          }
        }
      }
    }
  }

  // Fork Entry Wayfinder Architecture (only on multi-route splits — never blocks single-corridor scenic curves!)
  if (branch.routes.length > 1 && !branch.hasCenter) {
    // 2-way split: Sculpted Angkor Wayfinder Monolith standing cleanly in the V-divider between Left & Right roads!
    const divZ = -(branch.startZ + 14.5);
    const divider = new THREE.Group();
    divider.position.set(0, 0, divZ);

    const base = new THREE.Mesh(getBeveledStoneGeo(2.6, 1.1, 2.6, 0.14), mats.stone);
    base.position.y = 0.55;
    const mid = new THREE.Mesh(getBeveledStoneGeo(1.9, 2.2, 1.9, 0.12), mats.trim);
    mid.position.y = 2.15;
    const spire = new THREE.Mesh(getAngkorPrasatFinialGeo(), mats.trim);
    spire.scale.setScalar(0.85);
    spire.position.y = 3.28;

    // Twin golden stone directional chevrons pointing cleanly Left & Right
    const arrowGeo = new THREE.ConeGeometry(0.42, 1.25, 4);
    const leftArrow = new THREE.Mesh(arrowGeo, mats.accent);
    leftArrow.rotation.z = Math.PI / 2;
    leftArrow.position.set(-1.45, 2.45, 0.6);
    const rightArrow = new THREE.Mesh(arrowGeo, mats.accent);
    rightArrow.rotation.z = -Math.PI / 2;
    rightArrow.position.set(1.45, 2.45, 0.6);

    const brazierL = buildSculptedBrazier(mats);
    brazierL.position.set(-1.15, 1.15, 0.95);
    const brazierR = buildSculptedBrazier(mats);
    brazierR.position.set(1.15, 1.15, 0.95);

    divider.add(base, mid, spire, leftArrow, rightArrow, brazierL, brazierR);
    g.add(divider);
  } else if (branch.routes.length > 1) {
    // 3-way split: Twin outer temple wayfinder lanterns framing Left, Center, and Right routes cleanly!
    const gateZ = -(branch.startZ - 2);
    for (const s of [-1, 1] as const) {
      const ped = new THREE.Mesh(getBeveledStoneGeo(1.4, 2.1, 1.4, 0.12), mats.trim);
      ped.position.set(s * (halfRoad + 1.55), 1.05, gateZ);
      const br = buildSculptedBrazier(mats);
      br.scale.setScalar(1.08);
      br.position.set(s * (halfRoad + 1.55), 2.14, gateZ);
      g.add(ped, br);
    }
  }

  return g;
}

