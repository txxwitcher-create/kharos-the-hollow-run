import * as THREE from 'three';
import { CharacterDef, OutfitDef } from '../types/game';

export interface CharacterTexturePack {
  contactShadow: THREE.Texture;
  clothMap: THREE.Texture;
  neutralClothMap?: THREE.Texture;
  clothNormal: THREE.Texture;
  clothRoughness?: THREE.Texture;
  leatherMap: THREE.Texture;
  leatherNormal: THREE.Texture;
  leatherRoughness?: THREE.Texture;
  hairMap: THREE.Texture;
  hairNormal: THREE.Texture;
  faceMap: THREE.Texture;
  skinNormal?: THREE.Texture;
  skinRoughness?: THREE.Texture;
  eyeMap?: THREE.Texture;
}

export const BONE_NAMES = [
  'hips',
  'spine',
  'spine1',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftArm',
  'leftForeArm',
  'leftHand',
  'rightShoulder',
  'rightArm',
  'rightForeArm',
  'rightHand',
  'leftUpLeg',
  'leftLeg',
  'leftFoot',
  'leftToeBase',
  'rightUpLeg',
  'rightLeg',
  'rightFoot',
  'rightToeBase',
  'capeUpper',
  'capeLower',
  'hairTailUpper',
  'hairTailLower',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

const BONE_INDEX: Record<BoneName, number> = BONE_NAMES.reduce(
  (acc, name, idx) => {
    acc[name] = idx;
    return acc;
  },
  {} as Record<BoneName, number>,
);

export interface CharacterRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Record<BoneName, THREE.Bone>;
  contactShadow: THREE.Mesh;
  shieldMesh: THREE.Mesh;
  magnetRing: THREE.Mesh;
  rushCone: THREE.Mesh;
  applyCharacterAndOutfit: (char: CharacterDef, outfit: OutfitDef) => void;
  dispose: () => void;
}

interface LoftRing {
  y: number;
  cx?: number;
  cz?: number;
  rx: number;
  rz: number;
  /** Optional cross-section sculpting callback: adjusts (nx, nz) unit circle point before scaling */
  shape?: (angle: number, x: number, z: number) => [number, number];
  /** Up to 4 bone influences [boneName, weight] */
  weights: Array<[BoneName, number]>;
  v?: number;
}

function normalizeWeights(weights: Array<[BoneName, number]>): {
  indices: [number, number, number, number];
  w: [number, number, number, number];
} {
  const indices: [number, number, number, number] = [0, 0, 0, 0];
  const w: [number, number, number, number] = [0, 0, 0, 0];
  let sum = 0;
  for (let i = 0; i < Math.min(4, weights.length); i++) {
    indices[i] = BONE_INDEX[weights[i][0]];
    w[i] = Math.max(0, weights[i][1]);
    sum += w[i];
  }
  if (sum <= 1e-6) {
    w[0] = 1;
  } else {
    for (let i = 0; i < 4; i++) w[i] /= sum;
  }
  return { indices, w };
}

/**
 * Builds an organic, continuous, smoothly skinned lofted BufferGeometry along vertical cross-section rings.
 */
function createSkinnedLoft(
  rings: LoftRing[],
  radialSegments: number,
  capBottom = false,
  capTop = false,
  uRepeat = 1,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  const ringStride = radialSegments + 1;

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const cx = ring.cx ?? 0;
    const cz = ring.cz ?? 0;
    const v = ring.v ?? r / Math.max(1, rings.length - 1);
    const { indices: bi, w: bw } = normalizeWeights(ring.weights);

    for (let s = 0; s <= radialSegments; s++) {
      const uFrac = s / radialSegments;
      // angle = 0 at -Z (front) so UV seam lies invisibly along back (+Z)
      const angle = uFrac * Math.PI * 2;
      let ux = Math.sin(angle);
      let uz = -Math.cos(angle);
      if (ring.shape) {
        [ux, uz] = ring.shape(angle, ux, uz);
      }
      positions.push(cx + ux * ring.rx, ring.y, cz + uz * ring.rz);
      uvs.push(uFrac * uRepeat, v);
      skinIndices.push(bi[0], bi[1], bi[2], bi[3]);
      skinWeights.push(bw[0], bw[1], bw[2], bw[3]);
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    const ascending = rings[r + 1].y >= rings[r].y;
    for (let s = 0; s < radialSegments; s++) {
      const a = r * ringStride + s;
      const b = a + 1;
      const c = (r + 1) * ringStride + s;
      const d = c + 1;
      // Outward winding adapts automatically whether rings ascend (+Y) or descend (-Y)
      if (ascending) {
        indices.push(a, c, b);
        indices.push(b, c, d);
      } else {
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }
  }

  const overallAscending = rings.length < 2 || rings[rings.length - 1].y >= rings[0].y;
  if (capBottom && rings.length > 0) {
    const first = rings[0];
    const centerIdx = positions.length / 3;
    const { indices: bi, w: bw } = normalizeWeights(first.weights);
    positions.push(first.cx ?? 0, first.y, first.cz ?? 0);
    uvs.push(0.5, 0);
    skinIndices.push(bi[0], bi[1], bi[2], bi[3]);
    skinWeights.push(bw[0], bw[1], bw[2], bw[3]);
    for (let s = 0; s < radialSegments; s++) {
      if (overallAscending) indices.push(centerIdx, s, s + 1);
      else indices.push(centerIdx, s + 1, s);
    }
  }

  if (capTop && rings.length > 0) {
    const last = rings[rings.length - 1];
    const baseRow = (rings.length - 1) * ringStride;
    const centerIdx = positions.length / 3;
    const { indices: bi, w: bw } = normalizeWeights(last.weights);
    positions.push(last.cx ?? 0, last.y, last.cz ?? 0);
    uvs.push(0.5, 1);
    skinIndices.push(bi[0], bi[1], bi[2], bi[3]);
    skinWeights.push(bw[0], bw[1], bw[2], bw[3]);
    for (let s = 0; s < radialSegments; s++) {
      if (overallAscending) indices.push(centerIdx, baseRow + s + 1, baseRow + s);
      else indices.push(centerIdx, baseRow + s, baseRow + s + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Wraps any standard BufferGeometry with rigid or blended bone skinning attributes (in world bind-pose coordinates).
 */
function skinGeometry(
  source: THREE.BufferGeometry,
  weightFn: (x: number, y: number, z: number) => Array<[BoneName, number]>,
  matrix?: THREE.Matrix4,
): THREE.BufferGeometry {
  const geo = source.index ? source.clone() : source.clone();
  if (matrix) geo.applyMatrix4(matrix);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const { indices, w } = normalizeWeights(weightFn(pos.getX(i), pos.getY(i), pos.getZ(i)));
    const o = i * 4;
    si[o] = indices[0];
    si[o + 1] = indices[1];
    si[o + 2] = indices[2];
    si[o + 3] = indices[3];
    sw[o] = w[0];
    sw[o + 1] = w[1];
    sw[o + 2] = w[2];
    sw[o + 3] = w[3];
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  if (!geo.attributes.uv) {
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = pos.getX(i) * 2.5 + 0.5;
      uvs[i * 2 + 1] = pos.getY(i) * 2.5;
    }
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}

/**
 * Merges multiple skinned BufferGeometries (all sharing the same Skeleton & Material) into one lean draw call.
 */
function mergeSkinnedGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);
  const si = new Uint16Array(totalVerts * 4);
  const sw = new Float32Array(totalVerts * 4);
  const idx = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  for (const g of geos) {
    const pAttr = g.attributes.position;
    const nAttr = g.attributes.normal;
    const uAttr = g.attributes.uv;
    const siAttr = g.attributes.skinIndex;
    const swAttr = g.attributes.skinWeight;
    const count = pAttr.count;

    pos.set(pAttr.array as Float32Array, vOffset * 3);
    norm.set(nAttr.array as Float32Array, vOffset * 3);
    uv.set(uAttr.array as Float32Array, vOffset * 2);
    si.set(siAttr.array as Uint16Array, vOffset * 4);
    sw.set(swAttr.array as Float32Array, vOffset * 4);

    if (g.index) {
      const srcIdx = g.index.array;
      for (let k = 0; k < srcIdx.length; k++) {
        idx[iOffset + k] = srcIdx[k] + vOffset;
      }
      iOffset += srcIdx.length;
    } else {
      for (let k = 0; k < count; k++) {
        idx[iOffset + k] = vOffset + k;
      }
      iOffset += count;
    }
    vOffset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  merged.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  merged.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  return merged;
}

/**
 * Sculpts a realistic adult human head (cranial vault, brow arch, recessed orbital sockets,
 * continuous sculpted nose bridge/tip/nostrils, cheekbones, sculpted lips, defined jaw/chin, and neck blend)
 * with exact front-centered face UVs (u = 0.5 at front -Z nose axis, v = 0 crown, v = 1 chin).
 */
function buildSculptedHumanHeadGeometry(): THREE.BufferGeometry {
  const segU = 40;
  const segV = 32;
  const positions: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  const headCenterY = 1.655;
  const headCenterZ = -0.008;

  const gaussian = (dx: number, dy: number, sx: number, sy: number) =>
    Math.exp(-((dx * dx) / (2 * sx * sx) + (dy * dy) / (2 * sy * sy)));

  const headIdx = BONE_INDEX.head;
  const neckIdx = BONE_INDEX.neck;

  for (let iv = 0; iv <= segV; iv++) {
    const vFrac = iv / segV; // 0 = crown top, 1 = chin/neck base
    const phi = vFrac * Math.PI; // 0 .. PI
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let iu = 0; iu <= segU; iu++) {
      const uFrac = iu / segU; // 0.5 = center front (-Z)
      // theta = 0 at +Z (back seam), PI at -Z (front nose center)
      const theta = uFrac * Math.PI * 2;
      const nx = -Math.sin(theta) * sinPhi; // +X right, -X left
      const ny = cosPhi; // +1 crown, -1 chin
      const nz = Math.cos(theta) * sinPhi; // -1 front face, +1 occiput

      // Base realistic adult cranium proportions (width ~0.156m, height ~0.226m, depth ~0.194m)
      let x = nx * 0.079;
      let y = ny * 0.114;
      let z = nz * 0.097;

      // 1. Cranial vault & occiput (slightly fuller in upper back, tapered smoothly toward jaw/chin)
      if (ny > 0.08) {
        const crownFactor = Math.min(1, (ny - 0.08) / 0.8);
        x *= 1 + crownFactor * 0.04;
        if (nz > 0) z *= 1 + crownFactor * 0.09; // realistic back of skull
      }
      if (ny < 0.05) {
        // Taper face cleanly into defined adult jawline & chin (no round balloon head!)
        const lowerT = Math.min(1, (0.05 - ny) / 0.95);
        const frontMask = Math.max(0, -nz);
        const jawTaper = 1 - lowerT * (0.28 + frontMask * 0.2);
        x *= jawTaper;
        // Pull back of lower skull slightly inward toward nape so neck connects naturally
        if (nz > 0.15) {
          z -= lowerT * nz * 0.028;
        }
        // Subtle chin prominence at front bottom
        const chinBump = gaussian(nx, ny + 0.78, 0.24, 0.17) * frontMask;
        z -= chinBump * 0.017;
        y -= chinBump * 0.008;
      }

      // 2. Temple inward plane (anatomical temporal fossa above cheekbones)
      const templeDip =
        (gaussian(nx - 0.85, ny - 0.22, 0.22, 0.24) + gaussian(nx + 0.85, ny - 0.22, 0.22, 0.24)) *
        Math.max(0, -nz + 0.35);
      x *= 1 - templeDip * 0.065;

      // 3. Facial sculpting on front hemisphere (-Z is forward!)
      if (nz < 0.1) {
        const front = Math.max(0, -nz);

        // Brow ridge / superciliary arch
        const brow =
          (gaussian(nx - 0.28, ny - 0.24, 0.2, 0.075) +
            gaussian(nx + 0.28, ny - 0.24, 0.2, 0.075) +
            gaussian(nx, ny - 0.21, 0.14, 0.06) * 0.55) *
          front;
        z -= brow * 0.0095;

        // Recessed orbital eye sockets (creates genuine shaded sockets for 3D eyes!)
        const eyeSocket =
          (gaussian(nx - 0.33, ny - 0.06, 0.145, 0.095) + gaussian(nx + 0.33, ny - 0.06, 0.145, 0.095)) * front;
        z += eyeSocket * 0.0165;

        // Sculpted zygomatic cheekbones
        const cheek =
          (gaussian(nx - 0.52, ny + 0.12, 0.2, 0.14) + gaussian(nx + 0.52, ny + 0.12, 0.2, 0.14)) * front;
        z -= cheek * 0.009;
        x += Math.sign(nx) * cheek * 0.004;

        // Subtle hollow beneath cheekbones toward jaw
        const subCheek =
          (gaussian(nx - 0.5, ny + 0.44, 0.18, 0.16) + gaussian(nx + 0.5, ny + 0.44, 0.18, 0.16)) * front;
        z += subCheek * 0.0055;

        // Continuous sculpted human nose: bridge + dorsum + rounded tip + subtle nostril wings
        const noseBridge = gaussian(nx, ny - 0.02, 0.085, 0.17) * front;
        const noseTip = gaussian(nx, ny + 0.2, 0.088, 0.085) * front;
        const nostrils =
          (gaussian(nx - 0.11, ny + 0.24, 0.06, 0.048) + gaussian(nx + 0.11, ny + 0.24, 0.06, 0.048)) * front;
        const underNose = gaussian(nx, ny + 0.31, 0.11, 0.045) * front;
        z -= noseBridge * 0.0155 + noseTip * 0.021 + nostrils * 0.008;
        z += underNose * 0.0065;
        y -= noseTip * 0.003;

        // Sculpted human lips (upper lip bow, mouth line crease, fuller lower lip, mentolabial sulcus)
        const upperLip = gaussian(nx, ny + 0.43, 0.18, 0.045) * front;
        const mouthPart = gaussian(nx, ny + 0.485, 0.17, 0.022) * front;
        const lowerLip = gaussian(nx, ny + 0.54, 0.165, 0.05) * front;
        const lipDip = gaussian(nx, ny + 0.64, 0.16, 0.05) * front;
        z -= upperLip * 0.01 + lowerLip * 0.0095;
        z += mouthPart * 0.0055 + lipDip * 0.0055;
      }

      const wy = headCenterY + y;
      const wz = headCenterZ + z;
      positions.push(x, wy, wz);
      // Map front center (-Z, theta = PI) cleanly to u = 0.5, crown top to v = 0, chin to v = 1
      uvs.push(uFrac, vFrac);

      // Smooth neck-to-head blend near base of jaw/occiput
      const neckBlend = wy < 1.575 ? Math.min(0.65, (1.575 - wy) / 0.075) : 0;
      skinIndices.push(headIdx, neckIdx, 0, 0);
      skinWeights.push(1 - neckBlend, neckBlend, 0, 0);
    }
  }

  const stride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = (iv + 1) * stride + iu;
      const d = c + 1;
      // phi descends (+Y -> -Y) while theta increases around front (-Z -> +X): (a, b, c) faces OUTWARD!
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds sculpted human ears, eyelids, and anatomical hands (5 distinct tapered fingers + palm).
 */
function buildHeadAndHandSkinDetails(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const headWeight = () => [['head', 1] as [BoneName, number]];

  // Sculpted ears (helix rim + lobe) placed naturally on sides of skull
  for (const side of [-1, 1]) {
    const earOuter = new THREE.SphereGeometry(0.022, 12, 10);
    earOuter.scale(0.38, 1.32, 0.78);
    const m = new THREE.Matrix4()
      .makeTranslation(side * 0.079, 1.648, 0.008)
      .multiply(new THREE.Matrix4().makeRotationY(side * -0.28))
      .multiply(new THREE.Matrix4().makeRotationZ(side * -0.1));
    parts.push(skinGeometry(earOuter, headWeight, m));
    earOuter.dispose();

    // Sculpted upper & lower eyelids wrapping naturally around recessed eyeball
    const ex = side * 0.0285;
    const ey = 1.662;
    const ez = -0.0825;

    const upperLid = new THREE.TorusGeometry(0.0135, 0.0036, 7, 14, Math.PI * 1.05);
    const ulMat = new THREE.Matrix4()
      .makeTranslation(ex, ey + 0.0028, ez - 0.005)
      .multiply(new THREE.Matrix4().makeRotationY(side * -0.18))
      .multiply(new THREE.Matrix4().makeRotationX(0.32))
      .multiply(new THREE.Matrix4().makeRotationZ(-0.04 * side));
    parts.push(skinGeometry(upperLid, headWeight, ulMat));
    upperLid.dispose();

    const lowerLid = new THREE.TorusGeometry(0.013, 0.0026, 6, 12, Math.PI * 0.95);
    const llMat = new THREE.Matrix4()
      .makeTranslation(ex, ey - 0.0024, ez - 0.004)
      .multiply(new THREE.Matrix4().makeRotationY(side * -0.18))
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI + 0.04 * side));
    parts.push(skinGeometry(lowerLid, headWeight, llMat));
    lowerLid.dispose();
  }

  // Sculpted continuous 5-fingered adult human hands (palm + thumb + 4 articulated curled fingers!)
  for (const side of [-1, 1]) {
    const handBone: BoneName = side < 0 ? 'leftHand' : 'rightHand';
    const foreArmBone: BoneName = side < 0 ? 'leftForeArm' : 'rightForeArm';
    const hx = side * 0.19;
    const wristY = 0.885;
    const handWeight = (_x: number, y: number): Array<[BoneName, number]> => {
      if (y > wristY - 0.015) return [[handBone, 0.65], [foreArmBone, 0.35]];
      return [[handBone, 1]];
    };

    // Sculpted anatomical palm (tapered wrist -> knuckle bar -> thumb muscle pad)
    const palmRings: LoftRing[] = [
      { y: wristY + 0.005, cx: hx, cz: 0.0, rx: 0.022, rz: 0.027, weights: [[foreArmBone, 0.4], [handBone, 0.6]] },
      { y: wristY - 0.025, cx: hx, cz: -0.003, rx: 0.021, rz: 0.036, weights: [[handBone, 1]] },
      { y: wristY - 0.062, cx: hx - side * 0.003, cz: -0.006, rx: 0.017, rz: 0.041, weights: [[handBone, 1]] },
      { y: wristY - 0.088, cx: hx - side * 0.005, cz: -0.006, rx: 0.013, rz: 0.039, weights: [[handBone, 1]] },
    ];
    parts.push(createSkinnedLoft(palmRings, 12, true, true));

    // Thumb (2 phalanges angled naturally forward-inward)
    const thumbBase = new THREE.CapsuleGeometry(0.0085, 0.026, 5, 8);
    const tbMat = new THREE.Matrix4()
      .makeTranslation(hx - side * 0.012, wristY - 0.056, -0.038)
      .multiply(new THREE.Matrix4().makeRotationX(0.52))
      .multiply(new THREE.Matrix4().makeRotationZ(side * 0.42));
    parts.push(skinGeometry(thumbBase, handWeight, tbMat));
    thumbBase.dispose();

    const thumbTip = new THREE.CapsuleGeometry(0.007, 0.022, 5, 8);
    const ttMat = new THREE.Matrix4()
      .makeTranslation(hx - side * 0.022, wristY - 0.082, -0.048)
      .multiply(new THREE.Matrix4().makeRotationX(0.18))
      .multiply(new THREE.Matrix4().makeRotationZ(side * 0.25));
    parts.push(skinGeometry(thumbTip, handWeight, ttMat));
    thumbTip.dispose();

    // 4 Distinct Fingers (index, middle, ring, pinky) in natural athletic slightly curled pose
    const fingerSpecs = [
      { zOff: -0.032, len: 0.068, rad: 0.0072, curl: 0.24 },
      { zOff: -0.012, len: 0.074, rad: 0.0074, curl: 0.29 },
      { zOff: 0.008, len: 0.068, rad: 0.0069, curl: 0.34 },
      { zOff: 0.026, len: 0.054, rad: 0.0061, curl: 0.4 },
    ];
    for (const f of fingerSpecs) {
      const seg1 = new THREE.CapsuleGeometry(f.rad, f.len * 0.44, 5, 7);
      const m1 = new THREE.Matrix4()
        .makeTranslation(hx - side * 0.008, wristY - 0.088 - f.len * 0.24, f.zOff)
        .multiply(new THREE.Matrix4().makeRotationZ(side * -f.curl * 0.55));
      parts.push(skinGeometry(seg1, handWeight, m1));
      seg1.dispose();

      const seg2 = new THREE.CapsuleGeometry(f.rad * 0.84, f.len * 0.4, 5, 7);
      const m2 = new THREE.Matrix4()
        .makeTranslation(hx - side * (0.016 + f.curl * 0.018), wristY - 0.088 - f.len * 0.66, f.zOff)
        .multiply(new THREE.Matrix4().makeRotationZ(side * -f.curl * 1.15));
      parts.push(skinGeometry(seg2, handWeight, m2));
      seg2.dispose();
    }
  }

  return parts;
}

/**
 * Builds continuous anatomical skinned neck + upper chest + exposed muscular forearms (seamless under rolled cuffs).
 */
function buildBodySkinGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Sculpted Head
  parts.push(buildSculptedHumanHeadGeometry());
  parts.push(...buildHeadAndHandSkinDetails());

  // 2. Sculpted Neck + Upper Chest / Collarbone V-opening (seamless transition into head & shirt collar)
  const neckRings: LoftRing[] = [
    { y: 1.36, cz: -0.012, rx: 0.118, rz: 0.095, weights: [['chest', 1]] },
    { y: 1.44, cz: -0.008, rx: 0.095, rz: 0.082, weights: [['chest', 0.65], ['neck', 0.35]] },
    {
      y: 1.495,
      cz: -0.005,
      rx: 0.062,
      rz: 0.062,
      shape: (a, x, z) => [x * (1 + Math.abs(Math.sin(a * 2)) * 0.04), z], // subtle SCM neck tendons
      weights: [['chest', 0.25], ['neck', 0.75]],
    },
    { y: 1.545, cz: -0.006, rx: 0.055, rz: 0.056, weights: [['neck', 0.7], ['head', 0.3]] },
    { y: 1.59, cz: -0.006, rx: 0.054, rz: 0.055, weights: [['neck', 0.2], ['head', 0.8]] },
  ];
  parts.push(createSkinnedLoft(neckRings, 20, false, false));

  // 3. Exposed Athletic Forearms (emerging naturally from rolled expedition sleeves down to wrist)
  for (const side of [-1, 1]) {
    const armBone: BoneName = side < 0 ? 'leftArm' : 'rightArm';
    const foreBone: BoneName = side < 0 ? 'leftForeArm' : 'rightForeArm';
    const handBone: BoneName = side < 0 ? 'leftHand' : 'rightHand';
    const ax = side * 0.19;
    const armRings: LoftRing[] = [
      { y: 1.185, cx: ax, cz: 0.008, rx: 0.046, rz: 0.049, weights: [[armBone, 0.75], [foreBone, 0.25]] },
      { y: 1.14, cx: ax, cz: 0.009, rx: 0.043, rz: 0.046, weights: [[armBone, 0.35], [foreBone, 0.65]] },
      { y: 1.08, cx: ax, cz: 0.005, rx: 0.045, rz: 0.048, weights: [[foreBone, 1]] }, // brachioradialis muscle swell
      { y: 1.00, cx: ax, cz: 0.001, rx: 0.036, rz: 0.039, weights: [[foreBone, 1]] },
      { y: 0.93, cx: ax, cz: -0.001, rx: 0.029, rz: 0.033, weights: [[foreBone, 0.85], [handBone, 0.15]] },
      { y: 0.885, cx: ax, cz: -0.001, rx: 0.025, rz: 0.029, weights: [[foreBone, 0.35], [handBone, 0.65]] },
    ];
    parts.push(createSkinnedLoft(armRings, 16, false, false));
  }

  return mergeSkinnedGeometries(parts);
}

/**
 * Builds recessed glossy 3D human eyes (mapped cleanly with sclera/iris/pupil texture).
 */
function buildEyesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const headWeight = () => [['head', 1] as [BoneName, number]];

  for (const side of [-1, 1]) {
    const sphere = new THREE.SphereGeometry(0.0128, 16, 14);
    // Remap front hemisphere (-Z) onto planar centered iris UV (u=0.5, v=0.5 at front pole -Z!)
    const pos = sphere.attributes.position as THREE.BufferAttribute;
    const uv = sphere.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const len = Math.max(1e-5, Math.hypot(px, py, pz));
      const nx = px / len;
      const ny = py / len;
      const nz = pz / len;
      // Front (-Z) maps directly to center (0.5, 0.5) of eyeMap
      if (nz < 0) {
        uv.setXY(i, 0.5 + nx * 0.44, 0.5 - ny * 0.44);
      } else {
        uv.setXY(i, 0.05, 0.05);
      }
    }
    const m = new THREE.Matrix4().makeTranslation(side * 0.0285, 1.662, -0.079);
    parts.push(skinGeometry(sphere, headWeight, m));
    sphere.dispose();
  }

  return mergeSkinnedGeometries(parts);
}

/**
 * Builds natural tapered 3D curved eyebrows skinned to `head`.
 */
function buildEyebrowsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const headWeight = () => [['head', 1] as [BoneName, number]];

  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.012, 1.678, -0.0885),
      new THREE.Vector3(side * 0.028, 1.6825, -0.0865),
      new THREE.Vector3(side * 0.044, 1.6795, -0.0765),
      new THREE.Vector3(side * 0.052, 1.674, -0.065),
    ]);
    const tube = new THREE.TubeGeometry(curve, 10, 0.0033, 6, false);
    // Taper outer brow tail naturally
    const pos = tube.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i));
      if (x > 0.036) {
        const shrink = 1 - Math.min(0.55, (x - 0.036) * 24);
        const y = pos.getY(i);
        pos.setY(i, 1.678 + (y - 1.678) * shrink);
      }
    }
    tube.computeVertexNormals();
    parts.push(skinGeometry(tube, headWeight));
    tube.dispose();
  }
  return mergeSkinnedGeometries(parts);
}

/**
 * Helper: creates one curved, tapered organic hair ribbon/lock along a 3D CatmullRomCurve3.
 */
function createHairLock(
  points: THREE.Vector3[],
  widthRoot: number,
  widthTip: number,
  thickness: number,
  weightFn: (x: number, y: number, z: number) => Array<[BoneName, number]>,
  segments = 10,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 4-point almond/ribbon cross section per segment (gives soft 3D hair volume & specular catch!)
  const profile: Array<[number, number]> = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -0.65],
  ];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    // Natural hair clump taper: gentle swell past root, sleek sharp point at tip
    const taper = Math.sin(Math.min(1, t * 0.85 + 0.15) * Math.PI * 0.88);
    const w = THREE.MathUtils.lerp(widthRoot, widthTip, t) * (0.45 + 0.55 * taper);
    const th = thickness * (1 - t * 0.72);

    // Construct stable outward normal away from head center (0, 1.66, 0)
    const out = new THREE.Vector3(p.x, p.y - 1.655, p.z).normalize();
    const tang = frames.tangents[i];
    const side = new THREE.Vector3().crossVectors(tang, out).normalize();
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    const normal = new THREE.Vector3().crossVectors(side, tang).normalize();

    for (let k = 0; k < 4; k++) {
      const [px, py] = profile[k];
      const vx = p.x + side.x * px * w + normal.x * py * th;
      const vy = p.y + side.y * px * w + normal.y * py * th;
      const vz = p.z + side.z * px * w + normal.z * py * th;
      positions.push(vx, vy, vz);
      uvs.push(k / 3, t);
    }
  }

  for (let i = 0; i < segments; i++) {
    const r0 = i * 4;
    const r1 = (i + 1) * 4;
    for (let k = 0; k < 4; k++) {
      const kn = (k + 1) % 4;
      indices.push(r0 + k, r1 + k, r0 + kn);
      indices.push(r0 + kn, r1 + k, r1 + kn);
    }
  }

  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  raw.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  raw.setIndex(indices);
  raw.computeVertexNormals();
  const skinned = skinGeometry(raw, weightFn);
  raw.dispose();
  return skinned;
}

/**
 * Builds a close-fitting textured scalp under-layer so zero scalp gaps peek between layered hair strands.
 */
function buildHairScalpBase(backDropY = 1.61): THREE.BufferGeometry {
  const cap = new THREE.SphereGeometry(0.087, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const pos = cap.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * 0.96;
    let y = pos.getY(i) * 1.18 + 1.662;
    let z = pos.getZ(i) * 1.13 + 0.002;
    // Lift front hairline above forehead, drop softly at back nape
    if (z < -0.025) {
      y += (-z - 0.025) * 0.34;
    } else if (z > 0.03) {
      y = Math.max(backDropY, y - (z - 0.03) * 0.22);
    }
    pos.setXYZ(i, x, y, z);
  }
  cap.computeVertexNormals();
  const skinned = skinGeometry(cap, () => [['head', 1]]);
  cap.dispose();
  return skinned;
}

/**
 * Generates bespoke layered strand hair geometry per character (`kael`, `lyra`, `elena`, `darius`) — ZERO helmet domes!
 */
function buildCharacterHairGeometry(style: 'kael' | 'lyra' | 'elena' | 'darius'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const headOnly = () => [['head', 1] as [BoneName, number]];
  const tailWeight = (_x: number, y: number): Array<[BoneName, number]> => {
    if (y > 1.61) return [['head', 0.45], ['hairTailUpper', 0.55]];
    if (y > 1.49) return [['hairTailUpper', 0.75], ['hairTailLower', 0.25]];
    return [['hairTailUpper', 0.2], ['hairTailLower', 0.8]];
  };

  parts.push(buildHairScalpBase(style === 'darius' ? 1.63 : 1.59));

  if (style === 'kael') {
    // Tousled windswept medium-short explorer hair: swept crown locks + dynamic forehead fringe + layered sides/nape
    for (let i = 0; i < 16; i++) {
      const f = (i / 15) * 2 - 1; // -1..1 left to right
      const arch = Math.cos(f * 1.15);
      const pts = [
        new THREE.Vector3(f * 0.052, 1.755 + arch * 0.024, -0.022 + Math.abs(f) * 0.02),
        new THREE.Vector3(f * 0.072 + 0.008, 1.772 + arch * 0.015, 0.025 + Math.abs(f) * 0.015),
        new THREE.Vector3(f * 0.078, 1.728 - Math.abs(f) * 0.02, 0.095 - Math.abs(f) * 0.015),
        new THREE.Vector3(f * 0.068, 1.652 - (i % 3) * 0.016, 0.118 - Math.abs(f) * 0.012),
      ];
      parts.push(createHairLock(pts, 0.02, 0.005, 0.012, headOnly, 9));
    }
    // Swept forehead & temple bangs (gives charismatic human silhouette in close-up!)
    const bangs = [
      [-0.048, -0.068, 1.712, -0.074, 1.678, -0.078],
      [-0.024, -0.042, 1.724, -0.088, 1.686, -0.092],
      [0.0, -0.018, 1.728, -0.092, 1.694, -0.095],
      [0.022, 0.012, 1.726, -0.09, 1.692, -0.094],
      [0.045, 0.056, 1.718, -0.078, 1.68, -0.082],
      [0.064, 0.078, 1.698, -0.046, 1.652, -0.042],
      [-0.064, -0.078, 1.698, -0.046, 1.652, -0.042],
    ];
    for (const [x0, x1, y1, z1, y2, z2] of bangs) {
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(x0 * 0.7, 1.758, -0.032),
            new THREE.Vector3((x0 + x1) * 0.5, y1, z1),
            new THREE.Vector3(x1, y2, z2),
          ],
          0.017,
          0.003,
          0.009,
          headOnly,
          7,
        ),
      );
    }
    // Layered nape locks
    for (let i = 0; i < 9; i++) {
      const f = (i / 8) * 2 - 1;
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(f * 0.064, 1.675, 0.098),
            new THREE.Vector3(f * 0.06, 1.622, 0.11),
            new THREE.Vector3(f * 0.052, 1.568 - (i % 2) * 0.014, 0.098),
          ],
          0.018,
          0.004,
          0.009,
          headOnly,
          6,
        ),
      );
    }
  } else if (style === 'lyra') {
    // Sleek parted athletic hair + framing cheek waves + dynamic high adventurer ponytail/braid!
    for (let i = 0; i < 16; i++) {
      const f = (i / 15) * 2 - 1;
      const side = Math.sign(f || 1);
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(f * 0.025, 1.772, -0.032),
            new THREE.Vector3(f * 0.082, 1.735, 0.006),
            new THREE.Vector3(side * Math.min(0.082, Math.abs(f) * 0.075 + 0.015), 1.678, 0.082),
            new THREE.Vector3(f * 0.024, 1.648, 0.112),
          ],
          0.021,
          0.007,
          0.01,
          headOnly,
          9,
        ),
      );
    }
    // Face-framing side waves
    for (const side of [-1, 1]) {
      for (const offset of [0, 1]) {
        parts.push(
          createHairLock(
            [
              new THREE.Vector3(side * (0.016 + offset * 0.018), 1.756, -0.056),
              new THREE.Vector3(side * (0.068 + offset * 0.01), 1.702, -0.062 + offset * 0.022),
              new THREE.Vector3(side * (0.078 + offset * 0.006), 1.635, -0.036 + offset * 0.024),
              new THREE.Vector3(side * (0.066 + offset * 0.004), 1.575, -0.014 + offset * 0.02),
            ],
            0.015,
            0.003,
            0.0075,
            headOnly,
            8,
          ),
        );
      }
    }
    // Dynamic high ponytail / layered braid skinned to hairTailUpper & hairTailLower!
    for (let s = 0; s < 7; s++) {
      const ang = (s / 7) * Math.PI * 2;
      const ox = Math.cos(ang) * 0.018;
      const oz = Math.sin(ang) * 0.014;
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(ox * 0.6, 1.648, 0.106),
            new THREE.Vector3(ox * 1.35, 1.605, 0.142 + oz),
            new THREE.Vector3(ox * 1.45, 1.505, 0.158 + oz),
            new THREE.Vector3(ox * 0.85, 1.395 - (s % 3) * 0.022, 0.146 + oz * 0.6),
          ],
          0.019,
          0.004,
          0.01,
          tailWeight,
          10,
        ),
      );
    }
  } else if (style === 'elena') {
    // Refined side-parted explorer waves + sculpted low chignon bun + soft framing strands
    for (let i = 0; i < 16; i++) {
      const f = (i / 15) * 2 - 1;
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(-0.024 + f * 0.032, 1.772, -0.035),
            new THREE.Vector3(f * 0.084, 1.724, 0.008),
            new THREE.Vector3(f * 0.074, 1.642, 0.088),
            new THREE.Vector3(f * 0.026, 1.602, 0.112),
          ],
          0.022,
          0.008,
          0.011,
          headOnly,
          9,
        ),
      );
    }
    // Sculpted swept side-part bangs
    parts.push(
      createHairLock(
        [
          new THREE.Vector3(-0.028, 1.758, -0.056),
          new THREE.Vector3(0.024, 1.728, -0.088),
          new THREE.Vector3(0.072, 1.682, -0.068),
          new THREE.Vector3(0.082, 1.615, -0.025),
        ],
        0.02,
        0.004,
        0.009,
        headOnly,
        9,
      ),
    );
    parts.push(
      createHairLock(
        [
          new THREE.Vector3(-0.032, 1.752, -0.052),
          new THREE.Vector3(-0.072, 1.706, -0.058),
          new THREE.Vector3(-0.08, 1.635, -0.022),
        ],
        0.018,
        0.004,
        0.008,
        headOnly,
        7,
      ),
    );
    // Low twisted chignon bun at nape
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2;
      const a1 = a0 + 1.35;
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(Math.cos(a0) * 0.038, 1.605 + Math.sin(a0) * 0.032, 0.118),
            new THREE.Vector3(Math.cos((a0 + a1) * 0.5) * 0.044, 1.602 + Math.sin((a0 + a1) * 0.5) * 0.038, 0.146),
            new THREE.Vector3(Math.cos(a1) * 0.032, 1.598 + Math.sin(a1) * 0.028, 0.126),
          ],
          0.016,
          0.012,
          0.01,
          headOnly,
          7,
        ),
      );
    }
  } else {
    // Darius: Textured close-cropped rugged hair + anatomically contoured short jaw beard & mustache (zero floating sphere!)
    for (let i = 0; i < 18; i++) {
      const f = (i / 17) * 2 - 1;
      const arch = Math.cos(f * 1.1);
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(f * 0.056, 1.756 + arch * 0.018, -0.036 + Math.abs(f) * 0.022),
            new THREE.Vector3(f * 0.068, 1.766 + arch * 0.014, 0.015),
            new THREE.Vector3(f * 0.072, 1.732 - Math.abs(f) * 0.018, 0.078),
          ],
          0.018,
          0.007,
          0.0085,
          headOnly,
          7,
        ),
      );
    }
    // Tightly contoured jawline beard locks following exact facial mandible curvature
    for (let i = 0; i < 13; i++) {
      const f = (i / 12) * 2 - 1; // -1 left sideburn .. 0 chin .. +1 right sideburn
      const absF = Math.abs(f);
      const jawX = f * 0.068;
      const jawZ = -0.088 + absF * absF * 0.068;
      const topY = 1.594 + absF * 0.042;
      const botY = 1.544 + absF * 0.036;
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(jawX * 1.03, topY, jawZ + 0.004),
            new THREE.Vector3(jawX * 0.99, (topY + botY) * 0.5, jawZ - 0.004),
            new THREE.Vector3(jawX * 0.88, botY, jawZ + 0.008),
          ],
          0.012,
          0.006,
          0.006,
          headOnly,
          5,
        ),
      );
    }
    // Contoured mustache above upper lip
    for (const side of [-1, 1]) {
      parts.push(
        createHairLock(
          [
            new THREE.Vector3(side * 0.003, 1.612, -0.094),
            new THREE.Vector3(side * 0.018, 1.608, -0.091),
            new THREE.Vector3(side * 0.032, 1.598, -0.082),
          ],
          0.0075,
          0.004,
          0.0045,
          headOnly,
          5,
        ),
      );
    }
  }

  return mergeSkinnedGeometries(parts);
}

/**
 * Builds the inner expedition Henley shirt (continuous skinned torso + folded collar + rolled upper-arm sleeves).
 */
function buildInnerShirtGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Continuous anatomically tailored athletic torso shirt (pelvis -> waist -> ribcage -> pectorals/scapulae -> collar)
  const torsoShape = (chestBoost: number, backGroove: number) => (angle: number, x: number, z: number): [number, number] => {
    // Slightly flatten front chest/abs & indent spinal groove along back (+Z)
    let nx = x;
    let nz = z;
    if (nz < 0) {
      // Subtle athletic pectoral fullness on front
      const pec = Math.exp(-Math.pow(Math.abs(nx) - 0.45, 2) / 0.14) * (-nz);
      nz -= pec * chestBoost;
    } else {
      // Subtle spinal hollow along center back
      const spineDip = Math.exp(-(nx * nx) / 0.09) * nz;
      nz -= spineDip * backGroove;
    }
    // Natural subtle fabric drape wave
    const fold = Math.sin(angle * 6) * 0.015;
    return [nx * (1 + fold), nz * (1 + fold)];
  };

  const torsoRings: LoftRing[] = [
    { y: 0.90, cz: 0.004, rx: 0.162, rz: 0.114, shape: torsoShape(0.02, 0.04), weights: [['hips', 0.9], ['spine', 0.1]] },
    { y: 0.97, cz: 0.002, rx: 0.156, rz: 0.108, shape: torsoShape(0.02, 0.06), weights: [['hips', 0.5], ['spine', 0.5]] },
    { y: 1.05, cz: -0.002, rx: 0.144, rz: 0.102, shape: torsoShape(0.03, 0.07), weights: [['spine', 0.85], ['spine1', 0.15]] },
    { y: 1.14, cz: -0.004, rx: 0.154, rz: 0.109, shape: torsoShape(0.05, 0.08), weights: [['spine', 0.25], ['spine1', 0.75]] },
    { y: 1.24, cz: -0.008, rx: 0.174, rz: 0.122, shape: torsoShape(0.09, 0.08), weights: [['spine1', 0.3], ['chest', 0.7]] },
    { y: 1.35, cz: -0.01, rx: 0.194, rz: 0.128, shape: torsoShape(0.11, 0.06), weights: [['chest', 1]] },
    { y: 1.435, cz: -0.006, rx: 0.176, rz: 0.112, shape: torsoShape(0.05, 0.04), weights: [['chest', 0.9], ['neck', 0.1]] },
    { y: 1.482, cz: -0.004, rx: 0.096, rz: 0.088, weights: [['chest', 0.45], ['neck', 0.55]] },
    // Soft raised Henley shirt collar
    { y: 1.515, cz: 0.002, rx: 0.074, rz: 0.074, weights: [['chest', 0.2], ['neck', 0.8]] },
  ];
  parts.push(createSkinnedLoft(torsoRings, 26, false, false, 2));

  // Continuous fitted sleeves from deltoid shoulder cap down to rolled mid-elbow cuff!
  for (const side of [-1, 1]) {
    const shBone: BoneName = side < 0 ? 'leftShoulder' : 'rightShoulder';
    const armBone: BoneName = side < 0 ? 'leftArm' : 'rightArm';
    const foreBone: BoneName = side < 0 ? 'leftForeArm' : 'rightForeArm';
    const ax = side * 0.19;
    const sleeveRings: LoftRing[] = [
      // Rolled linen cuff right above forearm
      { y: 1.168, cx: ax, cz: 0.008, rx: 0.053, rz: 0.056, weights: [[armBone, 0.72], [foreBone, 0.28]] },
      { y: 1.186, cx: ax, cz: 0.008, rx: 0.059, rz: 0.062, weights: [[armBone, 0.85], [foreBone, 0.15]] }, // rolled cuff lip
      { y: 1.202, cx: ax, cz: 0.007, rx: 0.053, rz: 0.056, weights: [[armBone, 0.95], [foreBone, 0.05]] },
      { y: 1.28, cx: ax, cz: 0.005, rx: 0.057, rz: 0.061, weights: [[armBone, 1]] }, // bicep fullness
      { y: 1.365, cx: ax - side * 0.004, cz: 0.004, rx: 0.064, rz: 0.068, weights: [[armBone, 0.82], [shBone, 0.18]] },
      { y: 1.425, cx: ax - side * 0.018, cz: 0.002, rx: 0.068, rz: 0.072, weights: [[armBone, 0.45], [shBone, 0.35], ['chest', 0.2]] },
      { y: 1.462, cx: ax - side * 0.044, cz: 0.0, rx: 0.052, rz: 0.062, weights: [[shBone, 0.45], ['chest', 0.55]] },
    ];
    parts.push(createSkinnedLoft(sleeveRings, 18, true, true, 1));
  }

  return mergeSkinnedGeometries(parts);
}

/**
 * Builds the outer tailored expedition vest / field jacket (open V-front with stitched lapels, stand collar,
 * contoured hip hem & natural layered cloth depth over the inner Henley shirt!).
 */
function buildOuterVestGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segU = 28;
  // Open-front horseshoe wrap from front-left lapel around back to front-right lapel
  const rings: Array<{
    y: number;
    cz: number;
    rx: number;
    rz: number;
    openHalfAngle: number; // radians open at front (-Z)
    weights: Array<[BoneName, number]>;
  }> = [
    { y: 0.85, cz: 0.006, rx: 0.178, rz: 0.128, openHalfAngle: 0.42, weights: [['hips', 0.88], ['spine', 0.12]] },
    { y: 0.96, cz: 0.004, rx: 0.168, rz: 0.121, openHalfAngle: 0.34, weights: [['hips', 0.48], ['spine', 0.52]] },
    { y: 1.06, cz: -0.001, rx: 0.158, rz: 0.115, openHalfAngle: 0.30, weights: [['spine', 0.8], ['spine1', 0.2]] },
    { y: 1.16, cz: -0.004, rx: 0.169, rz: 0.122, openHalfAngle: 0.30, weights: [['spine', 0.22], ['spine1', 0.78]] },
    { y: 1.26, cz: -0.007, rx: 0.188, rz: 0.135, openHalfAngle: 0.35, weights: [['spine1', 0.28], ['chest', 0.72]] },
    { y: 1.36, cz: -0.009, rx: 0.205, rz: 0.140, openHalfAngle: 0.44, weights: [['chest', 1]] },
    { y: 1.445, cz: -0.004, rx: 0.186, rz: 0.124, openHalfAngle: 0.56, weights: [['chest', 0.92], ['neck', 0.08]] },
    { y: 1.495, cz: 0.004, rx: 0.106, rz: 0.098, openHalfAngle: 0.68, weights: [['chest', 0.45], ['neck', 0.55]] },
    { y: 1.535, cz: 0.010, rx: 0.092, rz: 0.088, openHalfAngle: 0.78, weights: [['chest', 0.25], ['neck', 0.75]] },
  ];

  const positions: number[] = [];
  const uvs: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const indices: number[] = [];
  const stride = segU + 1;

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const v = r / (rings.length - 1);
    const { indices: bi, w: bw } = normalizeWeights(ring.weights);
    const startA = ring.openHalfAngle;
    const endA = Math.PI * 2 - ring.openHalfAngle;

    for (let s = 0; s <= segU; s++) {
      const t = s / segU;
      const angle = THREE.MathUtils.lerp(startA, endA, t);
      // Folded lapel flare right along open front edges
      const edgeDist = Math.min(t, 1 - t);
      const lapelFlare = edgeDist < 0.08 ? (1 - edgeDist / 0.08) * 0.012 : 0;
      const ux = Math.sin(angle);
      const uz = -Math.cos(angle);
      positions.push(ux * (ring.rx + lapelFlare), ring.y, ring.cz + uz * (ring.rz + lapelFlare));
      uvs.push(t * 2, v * 1.5);
      si.push(bi[0], bi[1], bi[2], bi[3]);
      sw.push(bw[0], bw[1], bw[2], bw[3]);
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < segU; s++) {
      const a = r * stride + s;
      const b = a + 1;
      const c = (r + 1) * stride + s;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const vestShell = new THREE.BufferGeometry();
  vestShell.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  vestShell.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  vestShell.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  vestShell.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  vestShell.setIndex(indices);
  vestShell.computeVertexNormals();
  parts.push(vestShell);

  return mergeSkinnedGeometries(parts);
}

/**
 * Builds continuous skinned expedition cargo trousers (pelvis saddle -> thighs -> sculpted knee fabric folds -> cuffed calves).
 */
function buildTrousersGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Pelvis / hip saddle (smoothly spans both hip sockets with zero gaps!)
  const pelvisRings: LoftRing[] = [
    { y: 0.785, cz: 0.008, rx: 0.145, rz: 0.106, weights: [['hips', 1]] },
    { y: 0.86, cz: 0.006, rx: 0.172, rz: 0.120, weights: [['hips', 1]] },
    { y: 0.94, cz: 0.004, rx: 0.170, rz: 0.118, weights: [['hips', 0.9], ['spine', 0.1]] },
    { y: 0.99, cz: 0.002, rx: 0.158, rz: 0.110, weights: [['hips', 0.55], ['spine', 0.45]] },
  ];
  parts.push(createSkinnedLoft(pelvisRings, 22, true, true, 1.5));

  // Continuous left & right tailored trouser legs (overlapping seamlessly inside pelvis, cuffed cleanly into boots!)
  for (const side of [-1, 1]) {
    const upBone: BoneName = side < 0 ? 'leftUpLeg' : 'rightUpLeg';
    const legBone: BoneName = side < 0 ? 'leftLeg' : 'rightLeg';
    const footBone: BoneName = side < 0 ? 'leftFoot' : 'rightFoot';
    const lx = side * 0.095;

    const legRings: LoftRing[] = [
      // Tucked boot cuff at top of ankle
      { y: 0.145, cx: lx, cz: 0.01, rx: 0.056, rz: 0.062, weights: [[legBone, 0.72], [footBone, 0.28]] },
      { y: 0.20, cx: lx, cz: 0.012, rx: 0.064, rz: 0.070, weights: [[legBone, 0.95], [footBone, 0.05]] }, // soft trouser blousing above boot!
      { y: 0.30, cx: lx, cz: 0.014, rx: 0.066, rz: 0.072, weights: [[legBone, 1]] }, // gastrocnemius calf fullness
      { y: 0.41, cx: lx, cz: 0.008, rx: 0.063, rz: 0.067, weights: [[legBone, 0.92], [upBone, 0.08]] },
      // Anatomical knee joint with soft weight blend (no hard crease, no ball joint!)
      { y: 0.485, cx: lx, cz: -0.004, rx: 0.066, rz: 0.071, weights: [[upBone, 0.48], [legBone, 0.52]] },
      { y: 0.56, cx: lx, cz: -0.002, rx: 0.073, rz: 0.078, weights: [[upBone, 0.9], [legBone, 0.1]] },
      { y: 0.69, cx: lx, cz: 0.0, rx: 0.085, rz: 0.091, weights: [[upBone, 1]] }, // athletic quadricep/hamstring volume
      { y: 0.82, cx: lx * 0.92, cz: 0.002, rx: 0.094, rz: 0.100, weights: [[upBone, 0.8], ['hips', 0.2]] },
      { y: 0.91, cx: lx * 0.76, cz: 0.004, rx: 0.096, rz: 0.104, weights: [[upBone, 0.35], ['hips', 0.65]] },
    ];
    parts.push(createSkinnedLoft(legRings, 18, false, true, 1.2));

    // Side cargo pocket panel sculpted onto outer thigh
    const pocket = new THREE.BoxGeometry(0.022, 0.13, 0.095);
    const pm = new THREE.Matrix4()
      .makeTranslation(lx + side * 0.082, 0.66, 0.008)
      .multiply(new THREE.Matrix4().makeRotationZ(side * -0.06));
    parts.push(skinGeometry(pocket, () => [[upBone, 1]], pm));
    pocket.dispose();
  }

  return mergeSkinnedGeometries(parts);
}

/**
 * Builds detailed leather expedition gear: utility belt, hip pouches, diagonal baldric strap,
 * expedition rucksack, fingerless climbing gloves, thigh strap, and laced leather boot uppers.
 */
function buildLeatherGearGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Contoured double-stitched leather waist belt
  const beltRings: LoftRing[] = [
    { y: 0.942, cz: 0.004, rx: 0.175, rz: 0.126, weights: [['hips', 0.85], ['spine', 0.15]] },
    { y: 0.968, cz: 0.004, rx: 0.179, rz: 0.130, weights: [['hips', 0.75], ['spine', 0.25]] },
    { y: 0.996, cz: 0.003, rx: 0.175, rz: 0.126, weights: [['hips', 0.6], ['spine', 0.4]] },
  ];
  parts.push(createSkinnedLoft(beltRings, 26, false, false, 2));

  // 2. Sculpted hip pouches with folded flaps
  for (const side of [-1, 1]) {
    const pouch = new THREE.BoxGeometry(0.052, 0.105, 0.085);
    const pm = new THREE.Matrix4()
      .makeTranslation(side * 0.188, 0.935, 0.015)
      .multiply(new THREE.Matrix4().makeRotationZ(side * -0.1));
    parts.push(skinGeometry(pouch, () => [['hips', 0.85], ['spine', 0.15]], pm));
    pouch.dispose();

    const flap = new THREE.BoxGeometry(0.058, 0.036, 0.089);
    const fm = new THREE.Matrix4()
      .makeTranslation(side * 0.19, 0.976, 0.015)
      .multiply(new THREE.Matrix4().makeRotationZ(side * -0.12));
    parts.push(skinGeometry(flap, () => [['hips', 0.85], ['spine', 0.15]], fm));
    flap.dispose();
  }

  // 3. Cross-body diagonal leather baldric strap conforming closely over chest & back
  const baldricPts = [
    new THREE.Vector3(-0.128, 1.465, -0.02),
    new THREE.Vector3(-0.075, 1.36, -0.138),
    new THREE.Vector3(0.015, 1.21, -0.132),
    new THREE.Vector3(0.11, 1.06, -0.114),
    new THREE.Vector3(0.18, 0.97, 0.005),
    new THREE.Vector3(0.11, 1.07, 0.124),
    new THREE.Vector3(0.0, 1.23, 0.138),
    new THREE.Vector3(-0.085, 1.38, 0.126),
    new THREE.Vector3(-0.128, 1.465, -0.02),
  ];
  const baldricCurve = new THREE.CatmullRomCurve3(baldricPts, true);
  const baldricTube = new THREE.TubeGeometry(baldricCurve, 32, 0.015, 6, true);
  parts.push(
    skinGeometry(baldricTube, (_x, y) => {
      if (y > 1.28) return [['chest', 1]];
      if (y > 1.12) return [['chest', 0.55], ['spine1', 0.45]];
      if (y > 1.02) return [['spine1', 0.5], ['spine', 0.5]];
      return [['spine', 0.5], ['hips', 0.5]];
    }),
  );
  baldricTube.dispose();

  // 4. Right thigh holster / expedition utility strap
  const thighStrapRings: LoftRing[] = [
    { y: 0.70, cx: 0.095, cz: 0.0, rx: 0.089, rz: 0.094, weights: [['rightUpLeg', 1]] },
    { y: 0.735, cx: 0.095, cz: 0.0, rx: 0.091, rz: 0.096, weights: [['rightUpLeg', 1]] },
  ];
  parts.push(createSkinnedLoft(thighStrapRings, 16, false, false));

  // 5. Expedition canvas-and-leather field rucksack on upper back (compact, realistic silhouette!)
  const packBody = new THREE.BoxGeometry(0.24, 0.30, 0.115);
  const packMat = new THREE.Matrix4().makeTranslation(0, 1.255, 0.185);
  parts.push(
    skinGeometry(
      packBody,
      (_x, y) => (y > 1.26 ? [['chest', 0.85], ['spine1', 0.15]] : [['chest', 0.35], ['spine1', 0.65]]),
      packMat,
    ),
  );
  packBody.dispose();

  // Rolled expedition bedroll strapped across top of rucksack
  const bedroll = new THREE.CylinderGeometry(0.044, 0.044, 0.27, 14);
  const brMat = new THREE.Matrix4()
    .makeTranslation(0, 1.425, 0.175)
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  parts.push(skinGeometry(bedroll, () => [['chest', 0.9], ['spine1', 0.1]], brMat));
  bedroll.dispose();

  // Shoulder pack straps conforming cleanly over shoulders
  for (const side of [-1, 1]) {
    const strapPts = [
      new THREE.Vector3(side * 0.105, 1.38, 0.13),
      new THREE.Vector3(side * 0.112, 1.472, 0.015),
      new THREE.Vector3(side * 0.105, 1.35, -0.135),
      new THREE.Vector3(side * 0.132, 1.18, -0.11),
      new THREE.Vector3(side * 0.142, 1.14, 0.13),
    ];
    const sTube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strapPts), 16, 0.012, 6, false);
    parts.push(
      skinGeometry(sTube, (_x, y) => (y > 1.24 ? [['chest', 0.9], ['spine1', 0.1]] : [['spine1', 0.7], ['spine', 0.3]])),
    );
    sTube.dispose();
  }

  // 6. Fingerless climbing gloves + wrist guards
  for (const side of [-1, 1]) {
    const handBone: BoneName = side < 0 ? 'leftHand' : 'rightHand';
    const foreBone: BoneName = side < 0 ? 'leftForeArm' : 'rightForeArm';
    const hx = side * 0.19;
    const gloveRings: LoftRing[] = [
      { y: 0.922, cx: hx, cz: -0.001, rx: 0.032, rz: 0.036, weights: [[foreBone, 0.75], [handBone, 0.25]] },
      { y: 0.885, cx: hx, cz: -0.002, rx: 0.028, rz: 0.033, weights: [[foreBone, 0.3], [handBone, 0.7]] },
      { y: 0.842, cx: hx - side * 0.002, cz: -0.005, rx: 0.024, rz: 0.043, weights: [[handBone, 1]] },
      { y: 0.805, cx: hx - side * 0.005, cz: -0.006, rx: 0.019, rz: 0.042, weights: [[handBone, 1]] },
    ];
    parts.push(createSkinnedLoft(gloveRings, 14, false, false));
  }

  // 7. Detailed Sculpted Leather Hiking Boot Uppers (padded collar -> laced shaft -> contoured vamp -> reinforced toe cap!)
  for (const side of [-1, 1]) {
    const legBone: BoneName = side < 0 ? 'leftLeg' : 'rightLeg';
    const footBone: BoneName = side < 0 ? 'leftFoot' : 'rightFoot';
    const toeBone: BoneName = side < 0 ? 'leftToeBase' : 'rightToeBase';
    const bx = side * 0.095;

    // Boot ankle shaft & padded collar
    const shaftRings: LoftRing[] = [
      { y: 0.055, cx: bx, cz: 0.012, rx: 0.049, rz: 0.064, weights: [[footBone, 1]] },
      { y: 0.11, cx: bx, cz: 0.01, rx: 0.052, rz: 0.062, weights: [[footBone, 0.72], [legBone, 0.28]] },
      { y: 0.165, cx: bx, cz: 0.009, rx: 0.057, rz: 0.066, weights: [[footBone, 0.35], [legBone, 0.65]] },
      { y: 0.185, cx: bx, cz: 0.01, rx: 0.061, rz: 0.069, weights: [[footBone, 0.2], [legBone, 0.8]] }, // padded collar
    ];
    parts.push(createSkinnedLoft(shaftRings, 16, false, true));

    // Contoured forefoot vamp & rounded hiking toe box (smoothly skinned across Foot & ToeBase for toe-roll!)
    const vamp = new THREE.SphereGeometry(0.054, 14, 10);
    vamp.scale(0.94, 0.68, 2.02);
    const vampMat = new THREE.Matrix4().makeTranslation(bx, 0.054, -0.048);
    parts.push(
      skinGeometry(
        vamp,
        (_x, _y, z) => (z < -0.105 ? [[toeBone, 0.78], [footBone, 0.22]] : z < -0.065 ? [[toeBone, 0.35], [footBone, 0.65]] : [[footBone, 1]]),
        vampMat,
      ),
    );
    vamp.dispose();

    // Crossed boot laces up front gusseted tongue
    for (let k = 0; k < 4; k++) {
      const lace = new THREE.BoxGeometry(0.036, 0.007, 0.01);
      const lm = new THREE.Matrix4()
        .makeTranslation(bx, 0.088 + k * 0.022, -0.054 + k * 0.003)
        .multiply(new THREE.Matrix4().makeRotationX(-0.22));
      parts.push(skinGeometry(lace, () => [[footBone, 0.8], [legBone, 0.2]], lm));
      lace.dispose();
    }
  }

  return mergeSkinnedGeometries(parts);
}

/**
 * Builds dark rubber lugged hiking boot outsoles (planted accurately at Y = 0.000!) + reinforced toe bumper.
 */
function buildBootOutsolesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const footBone: BoneName = side < 0 ? 'leftFoot' : 'rightFoot';
    const toeBone: BoneName = side < 0 ? 'leftToeBase' : 'rightToeBase';
    const bx = side * 0.095;

    // Heel lug block (bottom at Y = 0.000)
    const heel = new THREE.BoxGeometry(0.092, 0.032, 0.088);
    parts.push(skinGeometry(heel, () => [[footBone, 1]], new THREE.Matrix4().makeTranslation(bx, 0.016, 0.02)));
    heel.dispose();

    // Arch shank (slightly raised at Y = 0.008 like real hiking boots!)
    const arch = new THREE.BoxGeometry(0.08, 0.024, 0.065);
    parts.push(skinGeometry(arch, () => [[footBone, 0.85], [toeBone, 0.15]], new THREE.Matrix4().makeTranslation(bx, 0.02, -0.045)));
    arch.dispose();

    // Forefoot tread pad (bottom at Y = 0.000, gently curved toe spring)
    const fore = new THREE.CylinderGeometry(0.048, 0.051, 0.026, 12);
    fore.scale(1.0, 1.0, 1.38);
    parts.push(
      skinGeometry(
        fore,
        (_x, _y, z) => (z < -0.105 ? [[toeBone, 0.85], [footBone, 0.15]] : [[toeBone, 0.45], [footBone, 0.55]]),
        new THREE.Matrix4().makeTranslation(bx, 0.013, -0.108),
      ),
    );
    fore.dispose();
  }
  return mergeSkinnedGeometries(parts);
}

/**
 * Builds antique brass/metal expedition hardware: belt buckle, baldric D-ring, boot eyelets, and vest fasteners.
 */
function buildMetalHardwareGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Belt buckle frame + prong
  const buckle = new THREE.TorusGeometry(0.028, 0.006, 6, 12);
  buckle.scale(1.15, 0.82, 0.6);
  parts.push(
    skinGeometry(buckle, () => [['hips', 0.75], ['spine', 0.25]], new THREE.Matrix4().makeTranslation(0, 0.968, -0.132)),
  );
  buckle.dispose();

  // Baldric chest brass ring clasp
  const chestRing = new THREE.TorusGeometry(0.02, 0.0045, 6, 12);
  parts.push(
    skinGeometry(
      chestRing,
      () => [['chest', 0.85], ['spine1', 0.15]],
      new THREE.Matrix4().makeTranslation(-0.048, 1.31, -0.146).multiply(new THREE.Matrix4().makeRotationY(-0.2)),
    ),
  );
  chestRing.dispose();

  // Side hip pouch brass rivets
  for (const side of [-1, 1]) {
    const rivet = new THREE.CylinderGeometry(0.009, 0.009, 0.012, 8);
    const rm = new THREE.Matrix4()
      .makeTranslation(side * 0.219, 0.968, 0.015)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    parts.push(skinGeometry(rivet, () => [['hips', 0.85], ['spine', 0.15]], rm));
    rivet.dispose();
  }

  return mergeSkinnedGeometries(parts);
}

/**
 * Builds the optional flowing expedition scarf/mantle skinned to `capeUpper` & `capeLower`
 * (visible on Rare/Epic/Legendary outfits, draped naturally across shoulders & back without clipping!).
 */
function buildExpeditionScarfCapeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Neck wrap collar ring
  const collar = new THREE.TorusGeometry(0.105, 0.028, 8, 22);
  collar.scale(1.08, 0.95, 0.82);
  parts.push(
    skinGeometry(
      collar,
      () => [['chest', 0.55], ['neck', 0.45]],
      new THREE.Matrix4().makeTranslation(0, 1.485, 0.004).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.1)),
    ),
  );
  collar.dispose();

  // Flowing bifurcated scarf tail draped cleanly behind the rucksack
  const segX = 6;
  const segY = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= segY; iy++) {
    const t = iy / segY;
    const y = THREE.MathUtils.lerp(1.45, 0.86, t);
    const z = 0.145 + Math.sin(t * Math.PI * 0.65) * 0.115 + t * 0.04;
    const halfW = THREE.MathUtils.lerp(0.125, 0.195, t);

    const w: Array<[BoneName, number]> =
      t < 0.2
        ? [['chest', 1 - t * 3.5], ['capeUpper', t * 3.5]]
        : t < 0.62
          ? [['capeUpper', 1 - (t - 0.2) / 0.42], ['capeLower', (t - 0.2) / 0.42]]
          : [['capeUpper', 0.15], ['capeLower', 0.85]];
    const { indices: bi, w: bw } = normalizeWeights(w);

    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX;
      const fx = u * 2 - 1;
      const drapeCurve = Math.cos(fx * 1.1) * 0.025;
      positions.push(fx * halfW, y, z + drapeCurve);
      uvs.push(u, t);
      si.push(bi[0], bi[1], bi[2], bi[3]);
      sw.push(bw[0], bw[1], bw[2], bw[3]);
    }
  }

  const stride = segX + 1;
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = (iy + 1) * stride + ix;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  tail.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  tail.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  tail.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  tail.setIndex(indices);
  tail.computeVertexNormals();
  parts.push(tail);

  return mergeSkinnedGeometries(parts);
}

/**
 * Creates the 26-bone hierarchical human skeleton in exact T/A-ready bind pose matching all sculpted geometries.
 */
function createHumanSkeleton(): { skeleton: THREE.Skeleton; bones: Record<BoneName, THREE.Bone> } {
  const b = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONE_NAMES) {
    const bone = new THREE.Bone();
    bone.name = name;
    b[name] = bone;
  }

  // Pelvis -> Spine -> Chest -> Neck -> Head
  b.hips.position.set(0, 0.94, 0);
  b.spine.position.set(0, 0.11, 0);
  b.spine1.position.set(0, 0.13, 0);
  b.chest.position.set(0, 0.15, 0);
  b.neck.position.set(0, 0.16, -0.005);
  b.head.position.set(0, 0.09, -0.003);
  b.hips.add(b.spine);
  b.spine.add(b.spine1);
  b.spine1.add(b.chest);
  b.chest.add(b.neck);
  b.neck.add(b.head);

  // Dynamic hair tail (ponytail / braid)
  b.hairTailUpper.position.set(0, 0.06, 0.115);
  b.hairTailLower.position.set(0, -0.14, 0.045);
  b.head.add(b.hairTailUpper);
  b.hairTailUpper.add(b.hairTailLower);

  // Dynamic scarf / cape
  b.capeUpper.position.set(0, 0.11, 0.14);
  b.capeLower.position.set(0, -0.28, 0.06);
  b.chest.add(b.capeUpper);
  b.capeUpper.add(b.capeLower);

  // Arms (left = -X, right = +X)
  b.leftShoulder.position.set(-0.06, 0.10, 0.004);
  b.leftArm.position.set(-0.13, -0.015, 0);
  b.leftForeArm.position.set(0, -0.275, 0.008);
  b.leftHand.position.set(0, -0.255, -0.009);
  b.chest.add(b.leftShoulder);
  b.leftShoulder.add(b.leftArm);
  b.leftArm.add(b.leftForeArm);
  b.leftForeArm.add(b.leftHand);

  b.rightShoulder.position.set(0.06, 0.10, 0.004);
  b.rightArm.position.set(0.13, -0.015, 0);
  b.rightForeArm.position.set(0, -0.275, 0.008);
  b.rightHand.position.set(0, -0.255, -0.009);
  b.chest.add(b.rightShoulder);
  b.rightShoulder.add(b.rightArm);
  b.rightArm.add(b.rightForeArm);
  b.rightForeArm.add(b.rightHand);

  // Legs (left = -X, right = +X)
  b.leftUpLeg.position.set(-0.095, -0.03, 0);
  b.leftLeg.position.set(0, -0.42, 0);
  b.leftFoot.position.set(0, -0.41, 0.01);
  b.leftToeBase.position.set(0, -0.055, -0.11);
  b.hips.add(b.leftUpLeg);
  b.leftUpLeg.add(b.leftLeg);
  b.leftLeg.add(b.leftFoot);
  b.leftFoot.add(b.leftToeBase);

  b.rightUpLeg.position.set(0.095, -0.03, 0);
  b.rightLeg.position.set(0, -0.42, 0);
  b.rightFoot.position.set(0, -0.41, 0.01);
  b.rightToeBase.position.set(0, -0.055, -0.11);
  b.hips.add(b.rightUpLeg);
  b.rightUpLeg.add(b.rightLeg);
  b.rightLeg.add(b.rightFoot);
  b.rightFoot.add(b.rightToeBase);

  const boneList = BONE_NAMES.map((n) => b[n]);
  const skeleton = new THREE.Skeleton(boneList);
  return { skeleton, bones: b };
}

// Cache immutable bind-pose geometries so creating rigs in Game + Shop costs <4ms and shares GPU buffers!
interface SharedCharacterGeos {
  skin: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  eyebrows: THREE.BufferGeometry;
  shirt: THREE.BufferGeometry;
  vest: THREE.BufferGeometry;
  trousers: THREE.BufferGeometry;
  leather: THREE.BufferGeometry;
  outsoles: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
  scarfCape: THREE.BufferGeometry;
  hair: Record<'kael' | 'lyra' | 'elena' | 'darius', THREE.BufferGeometry>;
}

let cachedGeos: SharedCharacterGeos | null = null;

function getSharedCharacterGeos(): SharedCharacterGeos {
  if (cachedGeos) return cachedGeos;
  cachedGeos = {
    skin: buildBodySkinGeometry(),
    eyes: buildEyesGeometry(),
    eyebrows: buildEyebrowsGeometry(),
    shirt: buildInnerShirtGeometry(),
    vest: buildOuterVestGeometry(),
    trousers: buildTrousersGeometry(),
    leather: buildLeatherGearGeometry(),
    outsoles: buildBootOutsolesGeometry(),
    metal: buildMetalHardwareGeometry(),
    scarfCape: buildExpeditionScarfCapeGeometry(),
    hair: {
      kael: buildCharacterHairGeometry('kael'),
      lyra: buildCharacterHairGeometry('lyra'),
      elena: buildCharacterHairGeometry('elena'),
      darius: buildCharacterHairGeometry('darius'),
    },
  };
  return cachedGeos;
}

/**
 * Exports immutable bind-pose character geometries for automated integrity & normal-direction QA tests.
 */
export function inspectCharacterGeometries(): SharedCharacterGeos {
  return getSharedCharacterGeos();
}

/**
 * Builds the realistic continuous-skinned adult human adventurer character rig used identically
 * across Gameplay, Title Screen, Character Shop, Outfit Previews, and Unlock/Reward scenes.
 */
export function buildCharacterRig(
  char: CharacterDef,
  outfit: OutfitDef,
  textures: CharacterTexturePack,
): CharacterRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const { skeleton, bones } = createHumanSkeleton();
  bodyPivot.add(bones.hips);
  bodyPivot.updateMatrixWorld(true);
  skeleton.calculateInverses();

  const geos = getSharedCharacterGeos();
  const clothAlbedo = textures.neutralClothMap ?? textures.clothMap;

  // 1. Physically-based Realistic Human Skin (subtle warm subsurface sheen + pore normal + T-zone roughness)
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: outfit.palette.skin,
    map: textures.faceMap,
    normalMap: textures.skinNormal ?? null,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: textures.skinRoughness ?? null,
    roughness: 0.62,
    metalness: 0.0,
    sheen: 0.28,
    sheenRoughness: 0.72,
    sheenColor: new THREE.Color('#d9886c'),
    envMapIntensity: 0.52,
  });

  // 2. Glossy Recessed Human Eyes (clearcoat cornea + realistic iris/sclera texture)
  const eyeMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map: textures.eyeMap ?? null,
    roughness: 0.14,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 0.9,
  });

  // 3. Natural Layered Hair (anisotropic-feel sheen + fine strand normal, DoubleSide for ribbon fullness)
  const hairMat = new THREE.MeshPhysicalMaterial({
    color: outfit.palette.hair,
    map: textures.hairMap,
    normalMap: textures.hairNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughness: 0.56,
    metalness: 0.04,
    sheen: 0.42,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#c8a88a'),
    side: THREE.DoubleSide,
    envMapIntensity: 0.6,
  });

  // 4. Inner Weathered Linen/Cotton Expedition Shirt (matte woven fabric contrast)
  const shirtMat = new THREE.MeshPhysicalMaterial({
    color: outfit.palette.secondary,
    map: clothAlbedo,
    normalMap: textures.clothNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: textures.clothRoughness ?? null,
    roughness: 0.9,
    metalness: 0.02,
    sheen: 0.18,
    sheenRoughness: 0.88,
    sheenColor: new THREE.Color('#d6cfc4'),
    envMapIntensity: 0.35,
  });

  // 5. Outer Tailored Waxed Canvas / Explorer Vest
  const vestMat = new THREE.MeshStandardMaterial({
    color: outfit.palette.primary,
    map: clothAlbedo,
    normalMap: textures.clothNormal,
    normalScale: new THREE.Vector2(1.05, 1.05),
    roughnessMap: textures.clothRoughness ?? null,
    roughness: 0.82,
    metalness: 0.05,
    side: THREE.DoubleSide,
    envMapIntensity: 0.45,
  });

  // 6. Tailored Climbing / Cargo Trousers
  const trouserMat = new THREE.MeshStandardMaterial({
    color: outfit.palette.secondary,
    map: clothAlbedo,
    normalMap: textures.clothNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: textures.clothRoughness ?? null,
    roughness: 0.88,
    metalness: 0.02,
    envMapIntensity: 0.38,
  });

  // 7. Distressed Saddle Leather Gear (belt, pouches, baldric, rucksack, gloves, hiking boots)
  const leatherMat = new THREE.MeshStandardMaterial({
    color: outfit.palette.boots,
    map: textures.leatherMap,
    normalMap: textures.leatherNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: textures.leatherRoughness ?? null,
    roughness: 0.48,
    metalness: 0.06,
    envMapIntensity: 0.72,
  });

  // 8. Dark Lugged Rubber Boot Outsoles
  const outsoleMat = new THREE.MeshStandardMaterial({
    color: '#1b1a19',
    roughness: 0.92,
    metalness: 0.04,
    envMapIntensity: 0.25,
  });

  // 9. Antique Brass / Metallic Hardware & Clasps
  const metalMat = new THREE.MeshStandardMaterial({
    color: outfit.palette.accent,
    roughness: 0.3,
    metalness: 0.86,
    envMapIntensity: 1.2,
  });

  // 10. Flowing Expedition Scarf / Mantle (for Rare, Epic, Legendary outfits or cloak palettes)
  const scarfMat = new THREE.MeshPhysicalMaterial({
    color: outfit.palette.cloak ?? outfit.palette.accent,
    map: clothAlbedo,
    normalMap: textures.clothNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: textures.clothRoughness ?? null,
    roughness: 0.84,
    metalness: 0.06,
    sheen: 0.32,
    sheenRoughness: 0.72,
    side: THREE.DoubleSide,
    envMapIntensity: 0.48,
  });

  const makeSkinned = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.SkinnedMesh => {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.bind(skeleton);
    bodyPivot.add(mesh);
    return mesh;
  };

  makeSkinned(geos.skin, skinMat);
  makeSkinned(geos.eyes, eyeMat);
  makeSkinned(geos.eyebrows, hairMat);
  makeSkinned(geos.shirt, shirtMat);
  makeSkinned(geos.vest, vestMat);
  makeSkinned(geos.trousers, trouserMat);
  makeSkinned(geos.leather, leatherMat);
  makeSkinned(geos.outsoles, outsoleMat);
  makeSkinned(geos.metal, metalMat);
  const scarfMesh = makeSkinned(geos.scarfCape, scarfMat);

  // Pre-bind all 4 bespoke character hairstyles (instant visibility toggle with zero stutter!)
  const hairMeshes: Record<'kael' | 'lyra' | 'elena' | 'darius', THREE.SkinnedMesh> = {
    kael: makeSkinned(geos.hair.kael, hairMat),
    lyra: makeSkinned(geos.hair.lyra, hairMat),
    elena: makeSkinned(geos.hair.elena, hairMat),
    darius: makeSkinned(geos.hair.darius, hairMat),
  };

  // Grounded contact shadow disc
  const shadowGeo = new THREE.PlaneGeometry(1.08, 1.08);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  // Gameplay ability VFX meshes (unchanged functional contracts for engine.ts)
  const shieldGeo = new THREE.IcosahedronGeometry(1.12, 1);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.24,
    wireframe: true,
  });
  const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
  shieldMesh.position.y = 1.05;
  shieldMesh.visible = false;
  root.add(shieldMesh);

  const magnetGeo = new THREE.TorusGeometry(0.95, 0.032, 8, 28);
  const magnetMat = new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, opacity: 0.68 });
  const magnetRing = new THREE.Mesh(magnetGeo, magnetMat);
  magnetRing.rotation.x = Math.PI / 2;
  magnetRing.position.y = 0.95;
  magnetRing.visible = false;
  root.add(magnetRing);

  const rushGeo = new THREE.ConeGeometry(0.88, 2.2, 12, 1, true);
  const rushMat = new THREE.MeshBasicMaterial({
    color: '#f97316',
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const rushCone = new THREE.Mesh(rushGeo, rushMat);
  rushCone.rotation.x = Math.PI / 2;
  rushCone.position.set(0, 1.05, -0.35);
  rushCone.visible = false;
  root.add(rushCone);

  const allOwnedMats: THREE.Material[] = [
    skinMat,
    eyeMat,
    hairMat,
    shirtMat,
    vestMat,
    trouserMat,
    leatherMat,
    outsoleMat,
    metalMat,
    scarfMat,
    shadowMat,
    shieldMat,
    magnetMat,
    rushMat,
  ];
  const allOwnedGeos: THREE.BufferGeometry[] = [shadowGeo, shieldGeo, magnetGeo, rushGeo];

  const applyCharacterAndOutfit = (c: CharacterDef, o: OutfitDef) => {
    const pal = o.palette;
    const isKaelDefault = c.id === 'kael' && o.id === 'kael_default';
    const activeClothMap = isKaelDefault ? textures.clothMap : clothAlbedo;
    vestMat.map = activeClothMap;
    shirtMat.map = clothAlbedo;
    trouserMat.map = clothAlbedo;
    scarfMat.map = clothAlbedo;

    // 1. Skin & warm subsurface sheen calibrated per character palette
    skinMat.color.set(pal.skin);
    const skinTint = new THREE.Color(pal.skin);
    skinMat.sheenColor.copy(skinTint).lerp(new THREE.Color('#c85e44'), 0.45);

    // 2. Hair color & bespoke character hairstyle
    hairMat.color.set(pal.hair).lerp(new THREE.Color('#ffffff'), 0.14);
    const hairTint = new THREE.Color(pal.hair);
    hairMat.sheenColor.copy(hairTint).lerp(new THREE.Color('#f0d8be'), 0.42);
    for (const id of ['kael', 'lyra', 'elena', 'darius'] as const) {
      hairMeshes[id].visible = c.id === id;
    }

    // 3. Layered outfit palette: distinct inner shirt vs outer vest vs weathered trousers vs saddle leather vs brass
    const primary = new THREE.Color(pal.primary);
    const secondary = new THREE.Color(pal.secondary);
    const accent = new THREE.Color(pal.accent);

    if (isKaelDefault) {
      vestMat.color.set('#dce8da'); // lets photorealistic olive waxed canvas shine cleanly!
      shirtMat.color.set('#d9d0be'); // weathered desert khaki Henley shirt
      trouserMat.color.set('#5a4e3f'); // warm rugged expedition cargo trousers
      leatherMat.color.set('#7a5338'); // warm chestnut saddle leather
    } else {
      vestMat.color.copy(primary);
      shirtMat.color.copy(secondary).lerp(new THREE.Color('#ded7cb'), 0.38);
      trouserMat.color.copy(secondary).lerp(new THREE.Color('#1d2023'), 0.34);
      leatherMat.color.set(pal.boots).lerp(new THREE.Color('#8c6344'), 0.28);
    }
    metalMat.color.copy(accent).lerp(new THREE.Color('#d2b06b'), 0.22);

    // Tier-responsive PBR finish (matte cloth vs burnished metal vs legendary metallic sheen)
    const isEpicPlus = o.rarity === 'Epic' || o.rarity === 'Legendary';
    const isRarePlus = o.rarity !== 'Default' && o.rarity !== 'Basic';
    vestMat.roughness = THREE.MathUtils.clamp(pal.roughness, 0.38, 0.9);
    vestMat.metalness = THREE.MathUtils.clamp(pal.metalness * 0.62, 0.04, 0.55);
    metalMat.roughness = o.rarity === 'Legendary' ? 0.2 : 0.32;
    metalMat.emissive.copy(o.rarity === 'Legendary' ? accent : new THREE.Color('#000000'));
    metalMat.emissiveIntensity = o.rarity === 'Legendary' ? 0.14 : 0;

    // Flowing scarf / expedition mantle visible on Rare+, cloak outfits, or Elena/Darius
    scarfMesh.visible = Boolean(pal.cloak) || isRarePlus || c.id === 'elena';
    scarfMat.color.set(pal.cloak ?? pal.accent);
    scarfMat.sheenColor.copy(accent).lerp(new THREE.Color('#ffffff'), 0.25);

    // Subtle non-distorting athletic proportions per character
    bodyPivot.scale.set(c.shoulderScale, c.heightScale, (c.shoulderScale + 1) * 0.5);
  };

  applyCharacterAndOutfit(char, outfit);

  const dispose = () => {
    for (const m of allOwnedMats) m.dispose();
    for (const g of allOwnedGeos) g.dispose();
  };

  return {
    root,
    bodyPivot,
    skeleton,
    bones,
    contactShadow,
    shieldMesh,
    magnetRing,
    rushCone,
    applyCharacterAndOutfit,
    dispose,
  };
}
