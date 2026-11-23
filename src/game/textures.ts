import * as THREE from 'three';
import stoneFlagstoneUrl from '../assets/images/stone_flagstone_albedo_1795269631932.jpg';
import templeCarvingUrl from '../assets/images/temple_carving_albedo_1795269632460.jpg';
import mossyStoneTrimUrl from '../assets/images/mossy_stone_trim_1795273689868.jpg';
import jungleBarkUrl from '../assets/images/jungle_bark_albedo_1795269632400.jpg';
import tropicalFoliageUrl from '../assets/images/tropical_foliage_cluster_1795269630781.jpg';
import junglePalmCanopyUrl from '../assets/images/jungle_palm_canopy_1795273688247.jpg';
import jungleCliffUrl from '../assets/images/jungle_cliff_albedo_1795269632904.jpg';
import jungleVistaUrl from '../assets/images/jungle_vista_panorama_1795269633076.jpg';
import explorerFabricUrl from '../assets/images/explorer_fabric_albedo_1795273689913.jpg';
import { ArchitectureStyle } from '../types/game';

export interface ProceduralTextureSet {
  pathMap: THREE.CanvasTexture;
  pathNormal: THREE.CanvasTexture;
  pathRoughness: THREE.CanvasTexture;
  stoneMap: THREE.CanvasTexture;
  stoneNormal: THREE.CanvasTexture;
  stoneRoughness: THREE.CanvasTexture;
  trimMap: THREE.CanvasTexture;
  trimNormal: THREE.CanvasTexture;
  trimRoughness: THREE.CanvasTexture;
  barkMap: THREE.CanvasTexture;
  barkNormal: THREE.CanvasTexture;
  barkRoughness: THREE.CanvasTexture;
  terrainMap: THREE.CanvasTexture;
  terrainNormal: THREE.CanvasTexture;
  terrainRoughness: THREE.CanvasTexture;
  foliageMap: THREE.CanvasTexture;
  foliageNormal: THREE.CanvasTexture;
  canopyMap: THREE.CanvasTexture;
  canopyNormal: THREE.CanvasTexture;
  vineMap: THREE.CanvasTexture;
  vistaMap: THREE.CanvasTexture;
  explorerClothMap: THREE.CanvasTexture;
  explorerNeutralClothMap: THREE.CanvasTexture;
  explorerClothNormal: THREE.CanvasTexture;
  explorerClothRoughness: THREE.CanvasTexture;
  explorerLeatherMap: THREE.CanvasTexture;
  explorerLeatherNormal: THREE.CanvasTexture;
  explorerLeatherRoughness: THREE.CanvasTexture;
  hairMap: THREE.CanvasTexture;
  hairNormal: THREE.CanvasTexture;
  faceMap: THREE.CanvasTexture;
  skinNormal: THREE.CanvasTexture;
  skinRoughness: THREE.CanvasTexture;
  eyeMap: THREE.CanvasTexture;
  flameMap: THREE.CanvasTexture;
  mistMap: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dispose: () => void;
}

interface DecodedImageCache {
  flagstone?: HTMLImageElement;
  carving?: HTMLImageElement;
  trim?: HTMLImageElement;
  bark?: HTMLImageElement;
  foliage?: HTMLImageElement;
  canopy?: HTMLImageElement;
  cliff?: HTMLImageElement;
  vista?: HTMLImageElement;
  explorerFabric?: HTMLImageElement;
}

const imageCache: DecodedImageCache = {};
const imagePromises: Partial<Record<keyof DecodedImageCache, Promise<HTMLImageElement>>> = {};

function loadImageCached(key: keyof DecodedImageCache, url: string): Promise<HTMLImageElement> {
  if (imageCache[key]) return Promise.resolve(imageCache[key]!);
  if (!imagePromises[key]) {
    imagePromises[key] = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        imageCache[key] = img;
        resolve(img);
      };
      img.onerror = (err) => reject(err);
      img.src = url;
    });
  }
  return imagePromises[key]!;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function configureTexture(
  tex: THREE.CanvasTexture,
  repeatX: number,
  repeatY: number,
  isColor: boolean,
  maxAnisotropy: number,
  wrapMode: THREE.Wrapping = THREE.RepeatWrapping,
): THREE.CanvasTexture {
  tex.wrapS = wrapMode;
  tex.wrapT = wrapMode;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates real tangent-space Normal Maps and calibrated Roughness Maps directly
 * from photorealistic albedo pixel data using a 3x3 Sobel filter.
 */
function buildNormalAndRoughnessFromCanvas(
  srcCanvas: HTMLCanvasElement,
  normalCanvas: HTMLCanvasElement,
  roughCanvas: HTMLCanvasElement | null,
  normalStrength: number,
  baseRoughness: number,
  roughnessSpread: number,
  wrapSeamless = true,
  dampPockets = false,
): void {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = srcData[i * 4];
    const g = srcData[i * 4 + 1];
    const b = srcData[i * 4 + 2];
    lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  const nCtx = normalCanvas.getContext('2d')!;
  const nImg = nCtx.createImageData(w, h);
  const nOut = nImg.data;

  const rCtx = roughCanvas ? roughCanvas.getContext('2d')! : null;
  const rImg = rCtx ? rCtx.createImageData(w, h) : null;
  const rOut = rImg ? rImg.data : null;

  const sample = (x: number, y: number): number => {
    const sx = wrapSeamless ? (x + w) % w : Math.max(0, Math.min(w - 1, x));
    const sy = wrapSeamless ? (y + h) % h : Math.max(0, Math.min(h - 1, y));
    return lum[sy * w + sx];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const c = lum[idx];
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * normalStrength;
      let ny = -dy * normalStrength;
      const nz = 1.0;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      const nnz = nz * invLen;

      const p = idx * 4;
      nOut[p] = Math.round((nx * 0.5 + 0.5) * 255);
      nOut[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nOut[p + 2] = Math.round((nnz * 0.5 + 0.5) * 255);
      nOut[p + 3] = 255;

      if (rOut) {
        const red = srcData[p];
        const grn = srcData[p + 1];
        const blu = srcData[p + 2];
        const isMoss = grn > red * 1.12 && grn > blu * 1.12 ? 0.14 : 0;
        let roughVal = baseRoughness + (0.5 - c) * roughnessSpread + isMoss;
        // Subtle damp rainforest sheen in worn stone pockets for believable sunlight specular glints
        if (dampPockets && isMoss === 0) {
          const dampWave = Math.sin(x * 0.045) * Math.cos(y * 0.038) + Math.sin((x + y) * 0.025);
          if (dampWave > 0.72 && c > 0.36) {
            roughVal = Math.min(roughVal, 0.34);
          }
        }
        const rv = Math.round(Math.max(0.26, Math.min(0.98, roughVal)) * 255);
        rOut[p] = rv;
        rOut[p + 1] = rv;
        rOut[p + 2] = rv;
        rOut[p + 3] = 255;
      }
    }
  }

  nCtx.putImageData(nImg, 0, 0);
  if (rCtx && rImg) rCtx.putImageData(rImg, 0, 0);
}

function paintBiomeGradedPhoto(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  tintHex: string,
  tintStrength: number,
  isLushNatural: boolean,
  addLaneTracks = false,
): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  if (!isLushNatural && tintStrength > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = tintStrength;
    ctx.fillStyle = tintHex;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = tintStrength * 0.3;
    ctx.fillStyle = tintHex;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (addLaneTracks) {
    // Subtle dark worn stone guide seams + soft ambient occlusion shadow along outer curb borders
    const laneXs = [w * 0.333, w * 0.666];
    for (const lx of laneXs) {
      const grad = ctx.createLinearGradient(lx - w * 0.022, 0, lx + w * 0.022, 0);
      grad.addColorStop(0, 'rgba(14, 18, 12, 0)');
      grad.addColorStop(0.5, 'rgba(14, 20, 12, 0.36)');
      grad.addColorStop(1, 'rgba(14, 18, 12, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(lx - w * 0.022, 0, w * 0.044, h);
    }
    const edgeL = ctx.createLinearGradient(0, 0, w * 0.11, 0);
    edgeL.addColorStop(0, 'rgba(8, 12, 7, 0.68)');
    edgeL.addColorStop(1, 'rgba(8, 12, 7, 0)');
    ctx.fillStyle = edgeL;
    ctx.fillRect(0, 0, w * 0.11, h);

    const edgeR = ctx.createLinearGradient(w * 0.89, 0, w, 0);
    edgeR.addColorStop(0, 'rgba(8, 12, 7, 0)');
    edgeR.addColorStop(1, 'rgba(8, 12, 7, 0.68)');
    ctx.fillStyle = edgeR;
    ctx.fillRect(w * 0.89, 0, w * 0.11, h);
  }
}

function paintBiomeSurfaceDetails(
  canvas: HTMLCanvasElement,
  style: ArchitectureStyle,
  accentHex: string,
): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const isIce = style === 'ice_spires' || style === 'crystal_caverns';
  const isVolcanic =
    style === 'volcanic_obelisks' ||
    style === 'infernal_fortress' ||
    style === 'hollow_ribs' ||
    style === 'shattered_realm';
  const isDesert = style === 'desert_pylons' || style === 'canyon_bridges' || style === 'lost_ziggurat';
  const isImperial =
    style === 'golden_aqueduct' ||
    style === 'sky_colonnade' ||
    style === 'last_sanctuary' ||
    style === 'colossus_sanctuary' ||
    style === 'drowned_arches';
  const isIndustrial = style === 'iron_mines' || style === 'storm_monoliths' || style === 'nightfall_city';

  if (isIce) {
    // Frost drift bands & sharp crystalline fracture veins
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const frost = ctx.createLinearGradient(0, 0, w, h);
    frost.addColorStop(0, 'rgba(215, 240, 255, 0.22)');
    frost.addColorStop(0.5, 'rgba(180, 224, 250, 0.08)');
    frost.addColorStop(1, 'rgba(225, 245, 255, 0.24)');
    ctx.fillStyle = frost;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(225, 248, 255, 0.34)';
    ctx.lineWidth = Math.max(1, w * 0.004);
    for (let i = 0; i < 12; i++) {
      const y0 = (i / 12) * h;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(w * 0.38, y0 + ((i % 3) - 1) * h * 0.08);
      ctx.lineTo(w * 0.72, y0 - ((i % 2) * 2 - 1) * h * 0.06);
      ctx.lineTo(w, y0);
      ctx.stroke();
    }
    ctx.restore();
  } else if (isVolcanic) {
    // Scorched basalt ash darkening + faint glowing magma hairline fissures
    ctx.save();
    ctx.fillStyle = 'rgba(12, 8, 9, 0.32)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accentHex;
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = Math.max(1.2, w * 0.005);
    for (let i = 0; i < 8; i++) {
      const x0 = ((i * 73) % 100) * 0.01 * w;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + Math.sin(i * 2.1) * w * 0.14, h * 0.45);
      ctx.lineTo(x0 - Math.cos(i * 1.7) * w * 0.1, h);
      ctx.stroke();
    }
    ctx.restore();
  } else if (isDesert) {
    // Wind-carved sandstone strata ripples
    ctx.save();
    ctx.fillStyle = 'rgba(228, 186, 128, 0.16)';
    for (let i = 0; i < 16; i++) {
      const y = (i / 16) * h;
      ctx.fillRect(0, y, w, Math.max(1, h * 0.012));
    }
    ctx.restore();
  } else if (isImperial) {
    // Polished marble & inlaid golden masonry trim seams
    ctx.save();
    ctx.strokeStyle = accentHex;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = Math.max(1.5, w * 0.006);
    ctx.strokeRect(w * 0.08, h * 0.04, w * 0.84, h * 0.92);
    ctx.restore();
  } else if (isIndustrial) {
    // Wet slate darken + iron grate seam plates
    ctx.save();
    ctx.fillStyle = 'rgba(14, 18, 26, 0.22)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(180, 198, 220, 0.18)';
    ctx.lineWidth = Math.max(1, w * 0.004);
    for (let y = h * 0.125; y < h; y += h * 0.25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Extracts razor-sharp halo-free alpha transparency from pure white #FFFFFF botanical or
 * ornithological studio sprites, then runs 4-pass RGB color dilation into transparent pixels.
 */
function extractStudioWhiteSprite(
  targetCanvas: HTMLCanvasElement,
  normalCanvas: HTMLCanvasElement | null,
  img: HTMLImageElement,
  options: {
    mode: 'foliage' | 'feather';
    tintHex?: string;
    isLushNatural?: boolean;
  },
): void {
  const w = targetCanvas.width;
  const h = targetCanvas.height;
  const ctx = targetCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  const tintCol = options.tintHex ? new THREE.Color(options.tintHex) : null;

  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    const lum = (r + g + b) / 3;

    if (options.mode === 'foliage') {
      const greenExcess = g - Math.max(r, b);
      // Strict studio-paper & soft-shadow removal (kills ALL pale white/grey gaps inside palm & fern fronds!)
      if (
        minC > 138 ||
        (lum > 164 && sat < 0.28 && greenExcess < 20) ||
        (lum > 192 && sat < 0.42)
      ) {
        d[p + 3] = 0;
      } else if (minC > 112 || (lum > 144 && sat < 0.34 && greenExcess < 24)) {
        const t = 1 - Math.min(1, Math.max(0, Math.max((minC - 112) / 26, (lum - 144) / 24)));
        d[p + 3] = Math.round(t * 255);
        d[p] = Math.round(r * 0.38);
        d[p + 1] = Math.round(g * 0.56);
        d[p + 2] = Math.round(b * 0.32);
      } else {
        d[p + 3] = 255;
        if (tintCol && !options.isLushNatural) {
          const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
          const mixAmt = 0.52;
          d[p] = Math.min(255, Math.round(r * (1 - mixAmt) + l * tintCol.r * 255 * 1.35 * mixAmt));
          d[p + 1] = Math.min(255, Math.round(g * (1 - mixAmt) + l * tintCol.g * 255 * 1.35 * mixAmt));
          d[p + 2] = Math.min(255, Math.round(b * (1 - mixAmt) + l * tintCol.b * 255 * 1.35 * mixAmt));
        }
      }
    } else {
      // Eagle feather mode: preserve golden/cream feather tips while cleanly removing pure studio white
      if (lum > 228 && sat < 0.14) {
        d[p + 3] = 0;
      } else if (lum > 200 && sat < 0.2) {
        const t = 1 - Math.min(1, Math.max(0, (lum - 200) / 28));
        d[p + 3] = Math.round(t * 255);
        d[p] = Math.round(r * 0.72);
        d[p + 1] = Math.round(g * 0.65);
        d[p + 2] = Math.round(b * 0.56);
      } else {
        d[p + 3] = 255;
      }
    }
  }

  // 5-pass RGB color bleed dilation into transparent border pixels (eliminates ALL mipmap fringes!)
  const fallbackR = options.mode === 'foliage' ? 22 : 58;
  const fallbackG = options.mode === 'foliage' ? 48 : 38;
  const fallbackB = options.mode === 'foliage' ? 18 : 24;

  const copy = new Uint8ClampedArray(d.length);
  for (let pass = 0; pass < 5; pass++) {
    copy.set(d);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = (y * w + x) * 4;
        if (copy[p + 3] > 24) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const np = ((y + oy) * w + (x + ox)) * 4;
            if (copy[np + 3] > 90) {
              sr += copy[np];
              sg += copy[np + 1];
              sb += copy[np + 2];
              count++;
            }
          }
        }
        if (count > 0) {
          d[p] = Math.round(sr / count);
          d[p + 1] = Math.round(sg / count);
          d[p + 2] = Math.round(sb / count);
        } else {
          d[p] = fallbackR;
          d[p + 1] = fallbackG;
          d[p + 2] = fallbackB;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  if (normalCanvas) {
    buildNormalAndRoughnessFromCanvas(
      targetCanvas,
      normalCanvas,
      null,
      options.mode === 'foliage' ? 2.3 : 2.6,
      0.55,
      0.2,
      false,
    );
  }
}

/**
 * Synthesizes an organic, tapered hanging jungle vine curtain with ZERO flat top edge:
 * top 12% has irregular tapered woody stems & scattered organic leaf clusters safely inside borders.
 */
function buildOrganicVineCurtain(
  vineCanvas: HTMLCanvasElement,
  foliageCanvas: HTMLCanvasElement,
  canopyCanvas: HTMLCanvasElement | null,
): void {
  const vw = vineCanvas.width;
  const vh = vineCanvas.height;
  const vCtx = vineCanvas.getContext('2d')!;
  vCtx.clearRect(0, 0, vw, vh);

  const strandSpecs = [
    { x: 0.22, startY: 0.08, len: 0.62, phase: 0.4, swayAmp: 0.05 },
    { x: 0.44, startY: 0.04, len: 0.88, phase: 1.9, swayAmp: 0.06 },
    { x: 0.65, startY: 0.1, len: 0.72, phase: 3.3, swayAmp: 0.05 },
    { x: 0.8, startY: 0.14, len: 0.56, phase: 4.8, swayAmp: 0.04 },
  ];

  for (let s = 0; s < strandSpecs.length; s++) {
    const st = strandSpecs[s];
    const sx = st.x * vw;
    const y0 = st.startY * vh;
    const strandLen = vh * st.len;

    // Winding dark woody vine stem
    vCtx.strokeStyle = 'rgba(34, 46, 20, 0.92)';
    vCtx.lineWidth = Math.max(2, vw * 0.012);
    vCtx.beginPath();
    vCtx.moveTo(sx, y0);
    for (let y = y0; y <= y0 + strandLen; y += vh * 0.06) {
      const sway = Math.sin(y * 0.022 + st.phase) * vw * st.swayAmp;
      vCtx.lineTo(sx + sway, y);
    }
    vCtx.stroke();

    // Cascading varied real photographic leaves along each vine, staying cleanly inside horizontal/top edges
    const leafSteps = 7;
    for (let k = 0; k < leafSteps; k++) {
      const frac = k / leafSteps;
      const ly = y0 + frac * strandLen * 0.9 + vh * 0.04;
      const sway = Math.sin(ly * 0.022 + st.phase) * vw * st.swayAmp;
      const envelope = Math.sin(Math.min(1, frac * 0.85 + 0.15) * Math.PI);
      const leafScale = (0.16 + envelope * 0.16) * vw;
      const src = canopyCanvas && (k + s) % 3 === 0 ? canopyCanvas : foliageCanvas;
      vCtx.save();
      vCtx.translate(sx + sway + (k % 2 === 0 ? -leafScale * 0.15 : leafScale * 0.15), ly);
      vCtx.rotate((k % 2 === 0 ? 1 : -1) * (0.45 + frac * 0.3) + s * 0.14);
      vCtx.drawImage(src, -leafScale * 0.52, -leafScale * 0.52, leafScale * 1.04, leafScale * 1.04);
      vCtx.restore();
    }
  }
}

/**
 * Splits our photorealistic explorer_fabric_albedo texture cleanly into two dedicated
 * seamless PBR materials: weathered olive waxed expedition canvas + distressed stitched saddle leather.
 */
function buildExplorerCharacterMaterials(
  img: HTMLImageElement,
  clothC: HTMLCanvasElement,
  clothN: HTMLCanvasElement,
  clothR: HTMLCanvasElement,
  leatherC: HTMLCanvasElement,
  leatherN: HTMLCanvasElement,
  leatherR: HTMLCanvasElement,
  neutralClothC?: HTMLCanvasElement,
): void {
  const sw = img.width;
  const sh = img.height;

  // Left 46% of image is pure weathered olive waxed expedition canvas with realistic folds & stitching
  const cw = clothC.width;
  const ch = clothC.height;
  const cCtx = clothC.getContext('2d', { willReadFrequently: true })!;
  cCtx.drawImage(img, 0, 0, sw * 0.46, sh, 0, 0, cw * 0.5, ch);
  cCtx.save();
  cCtx.translate(cw, 0);
  cCtx.scale(-1, 1);
  cCtx.drawImage(img, 0, 0, sw * 0.46, sh, 0, 0, cw * 0.5, ch);
  cCtx.restore();
  buildNormalAndRoughnessFromCanvas(clothC, clothN, clothR, 2.7, 0.86, 0.14, true);

  // Neutral luminance-normalized woven fabric albedo (preserves crisp textile weave, folds & stitching for EVERY outfit color!)
  if (neutralClothC) {
    const nCtx = neutralClothC.getContext('2d', { willReadFrequently: true })!;
    nCtx.drawImage(clothC, 0, 0, neutralClothC.width, neutralClothC.height);
    const id = nCtx.getImageData(0, 0, neutralClothC.width, neutralClothC.height);
    const px = id.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      const v = Math.max(172, Math.min(252, Math.round(196 + (lum - 0.34) * 180)));
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
    }
    nCtx.putImageData(id, 0, 0);
  }

  // Center-right 52%..84% of image is distressed double-stitched dark brown saddle leather
  const lw = leatherC.width;
  const lh = leatherC.height;
  const lCtx = leatherC.getContext('2d', { willReadFrequently: true })!;
  lCtx.drawImage(img, sw * 0.53, 0, sw * 0.3, sh, 0, 0, lw * 0.5, lh);
  lCtx.save();
  lCtx.translate(lw, 0);
  lCtx.scale(-1, 1);
  lCtx.drawImage(img, sw * 0.53, 0, sw * 0.3, sh, 0, 0, lw * 0.5, lh);
  lCtx.restore();
  buildNormalAndRoughnessFromCanvas(leatherC, leatherN, leatherR, 3.0, 0.46, 0.22, true);
}

/**
 * Synthesizes high-detail layered human hair strand albedo + normal map,
 * neutral tint-friendly realistic human skin/face albedo + pore normal + T-zone roughness maps,
 * and an anatomically shaded human eye sclera/iris/pupil map.
 */
function buildHairAndFaceTextures(
  hairC: HTMLCanvasElement,
  hairN: HTMLCanvasElement,
  faceC: HTMLCanvasElement,
  skinN: HTMLCanvasElement,
  skinR: HTMLCanvasElement,
  eyeC: HTMLCanvasElement,
): void {
  const hw = hairC.width;
  const hh = hairC.height;
  const hCtx = hairC.getContext('2d', { willReadFrequently: true })!;
  // Luminance-balanced hair strand texture so tinting by character hairColor stays rich for black, brunette, auburn, and copper hair
  hCtx.fillStyle = '#8b837b';
  hCtx.fillRect(0, 0, hw, hh);

  let seed = 8821;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Multi-layer fine flowing hair strands with realistic root darkening & anisotropic mid-shaft highlight
  for (let i = 0; i < 720; i++) {
    const x = rand() * hw;
    const tone = rand();
    const v = Math.round(92 + tone * 145);
    const warm = Math.round(tone * 14);
    hCtx.strokeStyle = `rgba(${Math.min(255, v + warm)},${v},${Math.max(0, v - warm)},${0.35 + rand() * 0.55})`;
    hCtx.lineWidth = 0.8 + rand() * 1.9;
    hCtx.beginPath();
    hCtx.moveTo(x, 0);
    const sway = (rand() - 0.5) * (hw * 0.06);
    hCtx.bezierCurveTo(x + sway, hh * 0.32, x - sway * 0.65, hh * 0.68, x + sway * 0.25, hh);
    hCtx.stroke();
  }
  const rootGrad = hCtx.createLinearGradient(0, 0, 0, hh);
  rootGrad.addColorStop(0, 'rgba(38, 30, 26, 0.42)');
  rootGrad.addColorStop(0.24, 'rgba(255, 245, 232, 0.14)');
  rootGrad.addColorStop(0.48, 'rgba(255, 248, 236, 0.22)');
  rootGrad.addColorStop(0.85, 'rgba(55, 44, 38, 0.12)');
  rootGrad.addColorStop(1, 'rgba(32, 24, 20, 0.28)');
  hCtx.fillStyle = rootGrad;
  hCtx.fillRect(0, 0, hw, hh);
  buildNormalAndRoughnessFromCanvas(hairC, hairN, null, 2.8, 0.46, 0.16, true);

  // Realistic human head/skin base map (neutral high-luminance so material.color applies exact skinTone for all 4 characters!)
  // UV layout for our sculpted head mesh: u = 0.5 is center front (+Z), v = 0 top crown, v = 1 chin/neck
  const fw = faceC.width;
  const fh = faceC.height;
  const fCtx = faceC.getContext('2d', { willReadFrequently: true })!;
  fCtx.fillStyle = '#f8f2ec';
  fCtx.fillRect(0, 0, fw, fh);

  // Subtle organic skin micro-variation (prevents uniform wax/plastic look)
  for (let i = 0; i < 1600; i++) {
    const px = rand() * fw;
    const py = rand() * fh;
    const warm = rand() > 0.48;
    fCtx.fillStyle = warm ? 'rgba(196, 134, 112, 0.048)' : 'rgba(255, 244, 234, 0.048)';
    fCtx.fillRect(px, py, 1.2 + rand() * 2.1, 1.2 + rand() * 2.1);
  }

  // Hairline / temple soft ambient occlusion
  const browGrad = fCtx.createLinearGradient(0, 0, 0, fh * 0.34);
  browGrad.addColorStop(0, 'rgba(128, 86, 68, 0.22)');
  browGrad.addColorStop(1, 'rgba(128, 86, 68, 0)');
  fCtx.fillStyle = browGrad;
  fCtx.fillRect(0, 0, fw, fh * 0.34);

  // Under-jaw & neck ambient occlusion
  const jawGrad = fCtx.createLinearGradient(0, fh * 0.72, 0, fh);
  jawGrad.addColorStop(0, 'rgba(116, 72, 54, 0)');
  jawGrad.addColorStop(1, 'rgba(92, 52, 38, 0.26)');
  fCtx.fillStyle = jawGrad;
  fCtx.fillRect(0, fh * 0.72, fw, fh * 0.28);

  const cx = fw * 0.5;
  const eyeY = fh * 0.47;
  const eyeSpread = fw * 0.072;

  // Orbital socket AO, subtle upper lash line, warm cheekbone & nose subsurface blush
  for (const s of [-1, 1]) {
    const ex = cx + s * eyeSpread;
    const sock = fCtx.createRadialGradient(ex, eyeY, fw * 0.008, ex, eyeY, fw * 0.056);
    sock.addColorStop(0, 'rgba(104, 64, 48, 0.24)');
    sock.addColorStop(0.6, 'rgba(126, 78, 60, 0.11)');
    sock.addColorStop(1, 'rgba(126, 78, 60, 0)');
    fCtx.fillStyle = sock;
    fCtx.fillRect(ex - fw * 0.065, eyeY - fh * 0.06, fw * 0.13, fh * 0.12);

    // Subtle cheek warmth (subsurface hemoglobin scatter)
    const cheek = fCtx.createRadialGradient(
      ex + s * fw * 0.022,
      eyeY + fh * 0.105,
      fw * 0.008,
      ex + s * fw * 0.022,
      eyeY + fh * 0.105,
      fw * 0.075,
    );
    cheek.addColorStop(0, 'rgba(222, 126, 108, 0.17)');
    cheek.addColorStop(1, 'rgba(222, 126, 108, 0)');
    fCtx.fillStyle = cheek;
    fCtx.fillRect(ex - fw * 0.06, eyeY + fh * 0.02, fw * 0.16, fh * 0.18);
  }

  // Warm nose tip & bridge highlight + subtle nostril underside shadow
  const noseTip = fCtx.createRadialGradient(cx, fh * 0.57, fw * 0.006, cx, fh * 0.57, fw * 0.042);
  noseTip.addColorStop(0, 'rgba(225, 134, 114, 0.16)');
  noseTip.addColorStop(1, 'rgba(225, 134, 114, 0)');
  fCtx.fillStyle = noseTip;
  fCtx.fillRect(cx - fw * 0.05, fh * 0.52, fw * 0.1, fh * 0.1);

  // Subtle natural vermilion lip tone (blends softly with sculpted 3D lip geometry)
  const lipGrad = fCtx.createRadialGradient(cx, fh * 0.68, fw * 0.005, cx, fh * 0.68, fw * 0.048);
  lipGrad.addColorStop(0, 'rgba(182, 92, 86, 0.34)');
  lipGrad.addColorStop(0.55, 'rgba(188, 104, 96, 0.18)');
  lipGrad.addColorStop(1, 'rgba(188, 104, 96, 0)');
  fCtx.fillStyle = lipGrad;
  fCtx.fillRect(cx - fw * 0.06, fh * 0.64, fw * 0.12, fh * 0.08);

  // Skin micro-pore height field -> normal map + T-zone organic roughness map
  const sw = skinN.width;
  const sh = skinN.height;
  const [poreC, poreCtx] = makeCanvas(sw, sh);
  poreCtx.fillStyle = '#808080';
  poreCtx.fillRect(0, 0, sw, sh);
  for (let i = 0; i < 4200; i++) {
    const px = rand() * sw;
    const py = rand() * sh;
    const v = Math.round(112 + rand() * 32);
    poreCtx.fillStyle = `rgb(${v},${v},${v})`;
    poreCtx.fillRect(px, py, 1.4, 1.4);
  }
  buildNormalAndRoughnessFromCanvas(poreC, skinN, null, 1.15, 0.58, 0.08, true);

  const srCtx = skinR.getContext('2d')!;
  srCtx.fillStyle = 'rgb(162,162,162)'; // ~0.63 base matte skin roughness
  srCtx.fillRect(0, 0, skinR.width, skinR.height);
  // Subtle lower roughness (~0.46) across forehead, nose bridge, cheekbones & lips
  const tZone = srCtx.createRadialGradient(
    skinR.width * 0.5,
    skinR.height * 0.48,
    skinR.width * 0.02,
    skinR.width * 0.5,
    skinR.height * 0.5,
    skinR.width * 0.24,
  );
  tZone.addColorStop(0, 'rgba(116,116,116,0.75)');
  tZone.addColorStop(1, 'rgba(162,162,162,0)');
  srCtx.fillStyle = tZone;
  srCtx.fillRect(0, 0, skinR.width, skinR.height);
  for (let i = 0; i < 1400; i++) {
    const px = rand() * skinR.width;
    const py = rand() * skinR.height;
    const v = Math.round(138 + rand() * 36);
    srCtx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    srCtx.fillRect(px, py, 2, 2);
  }

  // Anatomically realistic human eye texture (equirectangular-style centered at u=0.5, v=0.5 for front-facing pole)
  const ew = eyeC.width;
  const eh = eyeC.height;
  const eCtx = eyeC.getContext('2d')!;
  // Warm realistic off-white sclera (never glowing pure #ffffff!)
  const scleraGrad = eCtx.createRadialGradient(ew * 0.5, eh * 0.5, ew * 0.08, ew * 0.5, eh * 0.5, ew * 0.52);
  scleraGrad.addColorStop(0, '#ebe6df');
  scleraGrad.addColorStop(0.55, '#dcd2c8');
  scleraGrad.addColorStop(1, '#bfa49a');
  eCtx.fillStyle = scleraGrad;
  eCtx.fillRect(0, 0, ew, eh);

  // Subtle sclera ambient shadow around outer perimeter
  const irisR = ew * 0.21;
  // Dark limbal ring
  const limbal = eCtx.createRadialGradient(ew * 0.5, eh * 0.5, irisR * 0.72, ew * 0.5, eh * 0.5, irisR * 1.04);
  limbal.addColorStop(0, '#5a3a22');
  limbal.addColorStop(0.75, '#3b2415');
  limbal.addColorStop(0.94, '#1b110c');
  limbal.addColorStop(1, 'rgba(27,17,12,0)');
  eCtx.fillStyle = limbal;
  eCtx.beginPath();
  eCtx.arc(ew * 0.5, eh * 0.5, irisR * 1.05, 0, Math.PI * 2);
  eCtx.fill();

  // Warm hazel-amber striated iris fibers
  for (let i = 0; i < 96; i++) {
    const ang = (i / 96) * Math.PI * 2 + (rand() - 0.5) * 0.04;
    const inner = irisR * (0.38 + rand() * 0.08);
    const outer = irisR * (0.86 + rand() * 0.08);
    eCtx.strokeStyle =
      i % 3 === 0 ? 'rgba(182, 134, 72, 0.52)' : i % 2 === 0 ? 'rgba(118, 78, 42, 0.55)' : 'rgba(64, 42, 24, 0.5)';
    eCtx.lineWidth = 1.1 + rand() * 1.1;
    eCtx.beginPath();
    eCtx.moveTo(ew * 0.5 + Math.cos(ang) * inner, eh * 0.5 + Math.sin(ang) * inner);
    eCtx.lineTo(ew * 0.5 + Math.cos(ang) * outer, eh * 0.5 + Math.sin(ang) * outer);
    eCtx.stroke();
  }

  // Deep crisp pupil + subtle upper eyelid shadow + tiny natural specular catchlight
  eCtx.fillStyle = '#090707';
  eCtx.beginPath();
  eCtx.arc(ew * 0.5, eh * 0.5, irisR * 0.42, 0, Math.PI * 2);
  eCtx.fill();

  eCtx.fillStyle = 'rgba(255, 250, 242, 0.82)';
  eCtx.beginPath();
  eCtx.arc(ew * 0.5 - irisR * 0.28, eh * 0.5 - irisR * 0.26, irisR * 0.13, 0, Math.PI * 2);
  eCtx.fill();
}

function paintFlameSprite(canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const outer = ctx.createRadialGradient(w * 0.5, h * 0.66, w * 0.04, w * 0.5, h * 0.55, w * 0.44);
  outer.addColorStop(0, 'rgba(255, 245, 200, 1.0)');
  outer.addColorStop(0.28, 'rgba(255, 180, 50, 0.92)');
  outer.addColorStop(0.62, 'rgba(235, 82, 16, 0.46)');
  outer.addColorStop(1, 'rgba(180, 30, 0, 0.0)');
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.62, w * 0.36, h * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  const drawTongue = (cx: number, topY: number, width: number, alpha: number) => {
    const g = ctx.createLinearGradient(cx, h * 0.85, cx, topY);
    g.addColorStop(0, `rgba(255, 252, 224, ${alpha})`);
    g.addColorStop(0.35, `rgba(255, 194, 62, ${alpha * 0.9})`);
    g.addColorStop(0.75, `rgba(238, 92, 18, ${alpha * 0.52})`);
    g.addColorStop(1, 'rgba(200, 40, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - width, h * 0.78);
    ctx.quadraticCurveTo(cx - width * 0.8, h * 0.42, cx, topY);
    ctx.quadraticCurveTo(cx + width * 0.8, h * 0.42, cx + width, h * 0.78);
    ctx.closePath();
    ctx.fill();
  };
  drawTongue(w * 0.5, h * 0.08, w * 0.22, 0.95);
  drawTongue(w * 0.4, h * 0.24, w * 0.14, 0.72);
  drawTongue(w * 0.61, h * 0.22, w * 0.14, 0.72);
}

function paintSoftMist(canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const blobs = [
    { x: 0.5, y: 0.54, r: 0.44, a: 0.5 },
    { x: 0.3, y: 0.58, r: 0.34, a: 0.4 },
    { x: 0.72, y: 0.56, r: 0.35, a: 0.42 },
    { x: 0.48, y: 0.42, r: 0.3, a: 0.35 },
  ];
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * w);
    g.addColorStop(0, `rgba(255,255,255,${b.a})`);
    g.addColorStop(0.55, `rgba(240,250,245,${b.a * 0.42})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function paintContactShadow(canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.05, w * 0.5, h * 0.5, w * 0.48);
  grad.addColorStop(0, 'rgba(0,0,0,0.72)');
  grad.addColorStop(0.52, 'rgba(0,0,0,0.34)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Generates a realistic outdoor sunlight + sky + warm horizon + forest canopy bounce
 * PMREM Image-Based Lighting environment map.
 */
export function createOutdoorEnvironmentTexture(
  renderer: THREE.WebGLRenderer,
  skyTopHex: string,
  skyHorizonHex: string,
  sunHex: string,
  groundHex: string,
): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(40, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: new THREE.Color(skyTopHex) },
        uHorizon: { value: new THREE.Color(skyHorizonHex) },
        uGround: { value: new THREE.Color(groundHex).multiplyScalar(0.52) },
        uSun: { value: new THREE.Color(sunHex) },
        uSunDir: { value: new THREE.Vector3(0.45, 0.55, -0.7).normalize() },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = d.y >= 0.0
            ? mix(uHorizon, uTop, pow(clamp(d.y, 0.0, 1.0), 0.6))
            : mix(uHorizon * 0.62, uGround, pow(clamp(-d.y, 0.0, 1.0), 0.5));
          float sunDot = max(dot(d, uSunDir), 0.0);
          col += uSun * pow(sunDot, 14.0) * 1.45;
          col += uSun * smoothstep(0.985, 0.996, sunDot) * 4.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  envScene.add(skyDome);

  const rt = pmrem.fromScene(envScene, 0.024);
  skyDome.geometry.dispose();
  (skyDome.material as THREE.Material).dispose();
  pmrem.dispose();
  return rt;
}

export function createCharacterTexturePack(resolution = 512, maxAnisotropy = 4) {
  const charSize = Math.min(512, Math.max(256, resolution));
  const [clothC, clothCtx] = makeCanvas(charSize, charSize);
  const [neutralClothC, neutralClothCtx] = makeCanvas(charSize, charSize);
  const [clothN] = makeCanvas(charSize, charSize);
  const [clothR] = makeCanvas(charSize, charSize);
  const [leatherC, leatherCtx] = makeCanvas(charSize, charSize);
  const [leatherN] = makeCanvas(charSize, charSize);
  const [leatherR] = makeCanvas(charSize, charSize);
  const [hairC] = makeCanvas(charSize, charSize);
  const [hairN] = makeCanvas(charSize, charSize);
  const [faceC] = makeCanvas(charSize, charSize);
  const [skinN] = makeCanvas(256, 256);
  const [skinR] = makeCanvas(256, 256);
  const [eyeC] = makeCanvas(256, 256);
  const [shadowC] = makeCanvas(128, 128);

  clothCtx.fillStyle = '#3b5241';
  clothCtx.fillRect(0, 0, charSize, charSize);
  neutralClothCtx.fillStyle = '#dad8d4';
  neutralClothCtx.fillRect(0, 0, charSize, charSize);
  leatherCtx.fillStyle = '#4e3523';
  leatherCtx.fillRect(0, 0, charSize, charSize);
  for (const nc of [clothN, leatherN]) {
    const nctx = nc.getContext('2d')!;
    nctx.fillStyle = 'rgb(128,128,255)';
    nctx.fillRect(0, 0, nc.width, nc.height);
  }
  clothR.getContext('2d')!.fillStyle = 'rgb(220,220,220)';
  clothR.getContext('2d')!.fillRect(0, 0, charSize, charSize);
  leatherR.getContext('2d')!.fillStyle = 'rgb(124,124,124)';
  leatherR.getContext('2d')!.fillRect(0, 0, charSize, charSize);

  buildHairAndFaceTextures(hairC, hairN, faceC, skinN, skinR, eyeC);
  paintContactShadow(shadowC);

  const clothMap = configureTexture(new THREE.CanvasTexture(clothC), 1.5, 1.5, true, maxAnisotropy);
  const neutralClothMap = configureTexture(new THREE.CanvasTexture(neutralClothC), 1.5, 1.5, true, maxAnisotropy);
  const clothNormal = configureTexture(new THREE.CanvasTexture(clothN), 1.5, 1.5, false, maxAnisotropy);
  const clothRoughness = configureTexture(new THREE.CanvasTexture(clothR), 1.5, 1.5, false, maxAnisotropy);
  const leatherMap = configureTexture(new THREE.CanvasTexture(leatherC), 1.2, 1.2, true, maxAnisotropy);
  const leatherNormal = configureTexture(new THREE.CanvasTexture(leatherN), 1.2, 1.2, false, maxAnisotropy);
  const leatherRoughness = configureTexture(new THREE.CanvasTexture(leatherR), 1.2, 1.2, false, maxAnisotropy);
  const hairMap = configureTexture(new THREE.CanvasTexture(hairC), 1.8, 1.0, true, maxAnisotropy);
  const hairNormal = configureTexture(new THREE.CanvasTexture(hairN), 1.8, 1.0, false, maxAnisotropy);
  const faceMap = configureTexture(new THREE.CanvasTexture(faceC), 1, 1, true, maxAnisotropy, THREE.ClampToEdgeWrapping);
  const skinNormal = configureTexture(new THREE.CanvasTexture(skinN), 2.5, 2.5, false, maxAnisotropy);
  const skinRoughness = configureTexture(new THREE.CanvasTexture(skinR), 1, 1, false, maxAnisotropy, THREE.ClampToEdgeWrapping);
  const eyeMap = configureTexture(new THREE.CanvasTexture(eyeC), 1, 1, true, maxAnisotropy, THREE.ClampToEdgeWrapping);
  const contactShadow = new THREE.CanvasTexture(shadowC);
  contactShadow.needsUpdate = true;

  let disposed = false;
  loadImageCached('explorerFabric', explorerFabricUrl)
    .then((img) => {
      if (disposed) return;
      buildExplorerCharacterMaterials(img, clothC, clothN, clothR, leatherC, leatherN, leatherR, neutralClothC);
      clothMap.needsUpdate = true;
      neutralClothMap.needsUpdate = true;
      clothNormal.needsUpdate = true;
      clothRoughness.needsUpdate = true;
      leatherMap.needsUpdate = true;
      leatherNormal.needsUpdate = true;
      leatherRoughness.needsUpdate = true;
    })
    .catch(() => {});

  return {
    contactShadow,
    clothMap,
    neutralClothMap,
    clothNormal,
    clothRoughness,
    leatherMap,
    leatherNormal,
    leatherRoughness,
    hairMap,
    hairNormal,
    faceMap,
    skinNormal,
    skinRoughness,
    eyeMap,
    dispose: () => {
      disposed = true;
      contactShadow.dispose();
      clothMap.dispose();
      neutralClothMap.dispose();
      clothNormal.dispose();
      clothRoughness.dispose();
      leatherMap.dispose();
      leatherNormal.dispose();
      leatherRoughness.dispose();
      hairMap.dispose();
      hairNormal.dispose();
      faceMap.dispose();
      skinNormal.dispose();
      skinRoughness.dispose();
      eyeMap.dispose();
    },
  };
}

export function createEnvironmentTextures(
  pathHex: string,
  trimHex: string,
  terrainHex: string,
  stoneHex: string,
  foliageHex: string,
  resolution = 512,
  maxAnisotropy = 4,
  architectureStyle: ArchitectureStyle = 'jungle_temple',
): ProceduralTextureSet {
  const size = Math.max(256, Math.min(1024, resolution));
  const charSize = Math.min(512, Math.max(256, size));
  const isLushNatural =
    architectureStyle === 'jungle_temple' ||
    architectureStyle === 'giant_canopy' ||
    architectureStyle === 'whispering_woods' ||
    architectureStyle === 'drowned_arches';

  const [pathC, pathCtx] = makeCanvas(size, size);
  const [pathN] = makeCanvas(size, size);
  const [pathR] = makeCanvas(size, size);

  const [stoneC, stoneCtx] = makeCanvas(size, size);
  const [stoneN] = makeCanvas(size, size);
  const [stoneR] = makeCanvas(size, size);

  const [trimC, trimCtx] = makeCanvas(size, size);
  const [trimN] = makeCanvas(size, size);
  const [trimR] = makeCanvas(size, size);

  const [barkC, barkCtx] = makeCanvas(size, size);
  const [barkN] = makeCanvas(size, size);
  const [barkR] = makeCanvas(size, size);

  const [terrainC, terrainCtx] = makeCanvas(size, size);
  const [terrainN] = makeCanvas(size, size);
  const [terrainR] = makeCanvas(size, size);

  const [foliageC, foliageCtx] = makeCanvas(size, size);
  const [foliageN] = makeCanvas(size, size);
  const [canopyC, canopyCtx] = makeCanvas(size, size);
  const [canopyN] = makeCanvas(size, size);
  const [vineC] = makeCanvas(Math.max(256, size >> 1), size);

  const [vistaC, vistaCtx] = makeCanvas(Math.min(1536, size * 2), Math.min(864, Math.round(size * 1.125)));

  const [clothC, clothCtx] = makeCanvas(charSize, charSize);
  const [neutralClothC, neutralClothCtx] = makeCanvas(charSize, charSize);
  const [clothN] = makeCanvas(charSize, charSize);
  const [clothR] = makeCanvas(charSize, charSize);
  const [leatherC, leatherCtx] = makeCanvas(charSize, charSize);
  const [leatherN] = makeCanvas(charSize, charSize);
  const [leatherR] = makeCanvas(charSize, charSize);

  const [hairC] = makeCanvas(charSize, charSize);
  const [hairN] = makeCanvas(charSize, charSize);
  const [faceC] = makeCanvas(charSize, charSize);
  const [skinN] = makeCanvas(256, 256);
  const [skinR] = makeCanvas(256, 256);
  const [eyeC] = makeCanvas(256, 256);
  buildHairAndFaceTextures(hairC, hairN, faceC, skinN, skinR, eyeC);

  const [flameC] = makeCanvas(128, 192);
  paintFlameSprite(flameC);

  const [mistC] = makeCanvas(256, 128);
  paintSoftMist(mistC);

  const [shadowC] = makeCanvas(128, 128);
  paintContactShadow(shadowC);

  // Instant tasteful fills before async image decoding completes (~15-30ms)
  pathCtx.fillStyle = pathHex;
  pathCtx.fillRect(0, 0, size, size);
  stoneCtx.fillStyle = stoneHex;
  stoneCtx.fillRect(0, 0, size, size);
  trimCtx.fillStyle = stoneHex;
  trimCtx.fillRect(0, 0, size, size);
  barkCtx.fillStyle = '#433528';
  barkCtx.fillRect(0, 0, size, size);
  terrainCtx.fillStyle = terrainHex;
  terrainCtx.fillRect(0, 0, size, size);
  clothCtx.fillStyle = '#334d39';
  clothCtx.fillRect(0, 0, charSize, charSize);
  neutralClothCtx.fillStyle = '#dad8d4';
  neutralClothCtx.fillRect(0, 0, charSize, charSize);
  leatherCtx.fillStyle = '#473020';
  leatherCtx.fillRect(0, 0, charSize, charSize);
  foliageCtx.clearRect(0, 0, size, size);
  canopyCtx.clearRect(0, 0, size, size);
  vistaCtx.fillStyle = '#1d3225';
  vistaCtx.fillRect(0, 0, vistaC.width, vistaC.height);

  for (const nc of [pathN, stoneN, trimN, barkN, terrainN, foliageN, canopyN, clothN, leatherN]) {
    const nctx = nc.getContext('2d')!;
    nctx.fillStyle = 'rgb(128,128,255)';
    nctx.fillRect(0, 0, nc.width, nc.height);
  }
  for (const rc of [pathR, stoneR, trimR, barkR, terrainR, clothR]) {
    const rctx = rc.getContext('2d')!;
    rctx.fillStyle = 'rgb(218,218,218)';
    rctx.fillRect(0, 0, rc.width, rc.height);
  }
  leatherR.getContext('2d')!.fillStyle = 'rgb(124,124,124)';
  leatherR.getContext('2d')!.fillRect(0, 0, leatherR.width, leatherR.height);

  const pathMap = configureTexture(new THREE.CanvasTexture(pathC), 1.65, 5.2, true, maxAnisotropy);
  const pathNormal = configureTexture(new THREE.CanvasTexture(pathN), 1.65, 5.2, false, maxAnisotropy);
  const pathRoughness = configureTexture(new THREE.CanvasTexture(pathR), 1.65, 5.2, false, maxAnisotropy);

  const stoneMap = configureTexture(new THREE.CanvasTexture(stoneC), 1.25, 1.25, true, maxAnisotropy);
  const stoneNormal = configureTexture(new THREE.CanvasTexture(stoneN), 1.25, 1.25, false, maxAnisotropy);
  const stoneRoughness = configureTexture(new THREE.CanvasTexture(stoneR), 1.25, 1.25, false, maxAnisotropy);

  const trimMap = configureTexture(new THREE.CanvasTexture(trimC), 2.4, 1.0, true, maxAnisotropy);
  const trimNormal = configureTexture(new THREE.CanvasTexture(trimN), 2.4, 1.0, false, maxAnisotropy);
  const trimRoughness = configureTexture(new THREE.CanvasTexture(trimR), 2.4, 1.0, false, maxAnisotropy);

  const barkMap = configureTexture(new THREE.CanvasTexture(barkC), 1.5, 3.2, true, maxAnisotropy);
  const barkNormal = configureTexture(new THREE.CanvasTexture(barkN), 1.5, 3.2, false, maxAnisotropy);
  const barkRoughness = configureTexture(new THREE.CanvasTexture(barkR), 1.5, 3.2, false, maxAnisotropy);

  const terrainMap = configureTexture(new THREE.CanvasTexture(terrainC), 9, 20, true, maxAnisotropy);
  const terrainNormal = configureTexture(new THREE.CanvasTexture(terrainN), 9, 20, false, maxAnisotropy);
  const terrainRoughness = configureTexture(new THREE.CanvasTexture(terrainR), 9, 20, false, maxAnisotropy);

  const foliageMap = configureTexture(new THREE.CanvasTexture(foliageC), 1, 1, true, maxAnisotropy, THREE.ClampToEdgeWrapping);
  const foliageNormal = configureTexture(new THREE.CanvasTexture(foliageN), 1, 1, false, maxAnisotropy, THREE.ClampToEdgeWrapping);

  const canopyMap = configureTexture(new THREE.CanvasTexture(canopyC), 1, 1, true, maxAnisotropy, THREE.ClampToEdgeWrapping);
  const canopyNormal = configureTexture(new THREE.CanvasTexture(canopyN), 1, 1, false, maxAnisotropy, THREE.ClampToEdgeWrapping);

  const vineMap = configureTexture(new THREE.CanvasTexture(vineC), 1, 1, true, maxAnisotropy, THREE.ClampToEdgeWrapping);
  const vistaMap = configureTexture(new THREE.CanvasTexture(vistaC), 1, 1, true, maxAnisotropy, THREE.ClampToEdgeWrapping);

  const explorerClothMap = configureTexture(new THREE.CanvasTexture(clothC), 1.5, 1.5, true, maxAnisotropy);
  const explorerNeutralClothMap = configureTexture(new THREE.CanvasTexture(neutralClothC), 1.5, 1.5, true, maxAnisotropy);
  const explorerClothNormal = configureTexture(new THREE.CanvasTexture(clothN), 1.5, 1.5, false, maxAnisotropy);
  const explorerClothRoughness = configureTexture(new THREE.CanvasTexture(clothR), 1.5, 1.5, false, maxAnisotropy);
  const explorerLeatherMap = configureTexture(new THREE.CanvasTexture(leatherC), 1.2, 1.2, true, maxAnisotropy);
  const explorerLeatherNormal = configureTexture(new THREE.CanvasTexture(leatherN), 1.2, 1.2, false, maxAnisotropy);
  const explorerLeatherRoughness = configureTexture(new THREE.CanvasTexture(leatherR), 1.2, 1.2, false, maxAnisotropy);

  const hairMap = configureTexture(new THREE.CanvasTexture(hairC), 1.8, 1.0, true, maxAnisotropy);
  const hairNormal = configureTexture(new THREE.CanvasTexture(hairN), 1.8, 1.0, false, maxAnisotropy);
  const faceMap = configureTexture(new THREE.CanvasTexture(faceC), 1, 1, true, maxAnisotropy, THREE.ClampToEdgeWrapping);
  const skinNormal = configureTexture(new THREE.CanvasTexture(skinN), 2.5, 2.5, false, maxAnisotropy);
  const skinRoughness = configureTexture(new THREE.CanvasTexture(skinR), 1, 1, false, maxAnisotropy, THREE.ClampToEdgeWrapping);
  const eyeMap = configureTexture(new THREE.CanvasTexture(eyeC), 1, 1, true, maxAnisotropy, THREE.ClampToEdgeWrapping);

  const flameMap = new THREE.CanvasTexture(flameC);
  flameMap.colorSpace = THREE.SRGBColorSpace;
  flameMap.needsUpdate = true;

  const mistMap = new THREE.CanvasTexture(mistC);
  mistMap.colorSpace = THREE.SRGBColorSpace;
  mistMap.needsUpdate = true;

  const contactShadow = new THREE.CanvasTexture(shadowC);
  contactShadow.needsUpdate = true;

  let disposed = false;
  let foliageLoaded = false;
  let canopyLoaded = false;

  const rebuildVinesIfReady = () => {
    if (disposed || !foliageLoaded) return;
    buildOrganicVineCurtain(vineC, foliageC, canopyLoaded ? canopyC : null);
    vineMap.needsUpdate = true;
  };

  const isIceOrWet =
    architectureStyle === 'ice_spires' ||
    architectureStyle === 'crystal_caverns' ||
    architectureStyle === 'drowned_arches';

  loadImageCached('flagstone', stoneFlagstoneUrl).then((img) => {
    if (disposed) return;
    paintBiomeGradedPhoto(pathC, img, pathHex, isLushNatural ? 0.24 : 0.72, isLushNatural, true);
    paintBiomeSurfaceDetails(pathC, architectureStyle, trimHex);
    buildNormalAndRoughnessFromCanvas(pathC, pathN, pathR, 3.4, isIceOrWet ? 0.42 : 0.74, 0.34, true, isLushNatural || isIceOrWet);
    pathMap.needsUpdate = true;
    pathNormal.needsUpdate = true;
    pathRoughness.needsUpdate = true;
  }).catch(() => {});

  loadImageCached('carving', templeCarvingUrl).then((img) => {
    if (disposed) return;
    paintBiomeGradedPhoto(stoneC, img, stoneHex, isLushNatural ? 0.22 : 0.68, isLushNatural, false);
    paintBiomeSurfaceDetails(stoneC, architectureStyle, trimHex);
    buildNormalAndRoughnessFromCanvas(stoneC, stoneN, stoneR, 3.8, isIceOrWet ? 0.46 : 0.78, 0.32, true);
    stoneMap.needsUpdate = true;
    stoneNormal.needsUpdate = true;
    stoneRoughness.needsUpdate = true;
  }).catch(() => {});

  loadImageCached('trim', mossyStoneTrimUrl).then((img) => {
    if (disposed) return;
    paintBiomeGradedPhoto(trimC, img, stoneHex, isLushNatural ? 0.2 : 0.66, isLushNatural, false);
    paintBiomeSurfaceDetails(trimC, architectureStyle, trimHex);
    buildNormalAndRoughnessFromCanvas(trimC, trimN, trimR, 3.8, 0.72, 0.3, true);
    trimMap.needsUpdate = true;
    trimNormal.needsUpdate = true;
    trimRoughness.needsUpdate = true;
  }).catch(() => {});

  loadImageCached('bark', jungleBarkUrl).then((img) => {
    if (disposed) return;
    paintBiomeGradedPhoto(barkC, img, stoneHex, 0.34, isLushNatural, false);
    buildNormalAndRoughnessFromCanvas(barkC, barkN, barkR, 4.1, 0.88, 0.22, true);
    barkMap.needsUpdate = true;
    barkNormal.needsUpdate = true;
    barkRoughness.needsUpdate = true;
  }).catch(() => {});

  loadImageCached('cliff', jungleCliffUrl).then((img) => {
    if (disposed) return;
    paintBiomeGradedPhoto(terrainC, img, terrainHex, isLushNatural ? 0.28 : 0.74, isLushNatural, false);
    paintBiomeSurfaceDetails(terrainC, architectureStyle, trimHex);
    buildNormalAndRoughnessFromCanvas(terrainC, terrainN, terrainR, 3.6, isIceOrWet ? 0.56 : 0.84, 0.28, true, isLushNatural);
    terrainMap.needsUpdate = true;
    terrainNormal.needsUpdate = true;
    terrainRoughness.needsUpdate = true;
  }).catch(() => {});

  loadImageCached('foliage', tropicalFoliageUrl).then((img) => {
    if (disposed) return;
    extractStudioWhiteSprite(foliageC, foliageN, img, { mode: 'foliage', tintHex: foliageHex, isLushNatural });
    foliageLoaded = true;
    foliageMap.needsUpdate = true;
    foliageNormal.needsUpdate = true;
    rebuildVinesIfReady();
  }).catch(() => {});

  loadImageCached('canopy', junglePalmCanopyUrl).then((img) => {
    if (disposed) return;
    extractStudioWhiteSprite(canopyC, canopyN, img, { mode: 'foliage', tintHex: foliageHex, isLushNatural });
    canopyLoaded = true;
    canopyMap.needsUpdate = true;
    canopyNormal.needsUpdate = true;
    rebuildVinesIfReady();
  }).catch(() => {});

  loadImageCached('vista', jungleVistaUrl).then((img) => {
    if (disposed) return;
    paintBiomeGradedPhoto(vistaC, img, terrainHex, 0.52, isLushNatural, false);
    vistaMap.needsUpdate = true;
  }).catch(() => {});

  loadImageCached('explorerFabric', explorerFabricUrl).then((img) => {
    if (disposed) return;
    buildExplorerCharacterMaterials(img, clothC, clothN, clothR, leatherC, leatherN, leatherR, neutralClothC);
    explorerClothMap.needsUpdate = true;
    explorerNeutralClothMap.needsUpdate = true;
    explorerClothNormal.needsUpdate = true;
    explorerClothRoughness.needsUpdate = true;
    explorerLeatherMap.needsUpdate = true;
    explorerLeatherNormal.needsUpdate = true;
    explorerLeatherRoughness.needsUpdate = true;
  }).catch(() => {});

  return {
    pathMap,
    pathNormal,
    pathRoughness,
    stoneMap,
    stoneNormal,
    stoneRoughness,
    trimMap,
    trimNormal,
    trimRoughness,
    barkMap,
    barkNormal,
    barkRoughness,
    terrainMap,
    terrainNormal,
    terrainRoughness,
    foliageMap,
    foliageNormal,
    canopyMap,
    canopyNormal,
    vineMap,
    vistaMap,
    explorerClothMap,
    explorerNeutralClothMap,
    explorerClothNormal,
    explorerClothRoughness,
    explorerLeatherMap,
    explorerLeatherNormal,
    explorerLeatherRoughness,
    hairMap,
    hairNormal,
    faceMap,
    skinNormal,
    skinRoughness,
    eyeMap,
    flameMap,
    mistMap,
    contactShadow,
    dispose: () => {
      disposed = true;
      pathMap.dispose();
      pathNormal.dispose();
      pathRoughness.dispose();
      stoneMap.dispose();
      stoneNormal.dispose();
      stoneRoughness.dispose();
      trimMap.dispose();
      trimNormal.dispose();
      trimRoughness.dispose();
      barkMap.dispose();
      barkNormal.dispose();
      barkRoughness.dispose();
      terrainMap.dispose();
      terrainNormal.dispose();
      terrainRoughness.dispose();
      foliageMap.dispose();
      foliageNormal.dispose();
      canopyMap.dispose();
      canopyNormal.dispose();
      vineMap.dispose();
      vistaMap.dispose();
      explorerClothMap.dispose();
      explorerNeutralClothMap.dispose();
      explorerClothNormal.dispose();
      explorerClothRoughness.dispose();
      explorerLeatherMap.dispose();
      explorerLeatherNormal.dispose();
      explorerLeatherRoughness.dispose();
      hairMap.dispose();
      hairNormal.dispose();
      faceMap.dispose();
      skinNormal.dispose();
      skinRoughness.dispose();
      eyeMap.dispose();
      flameMap.dispose();
      mistMap.dispose();
      contactShadow.dispose();
    },
  };
}
