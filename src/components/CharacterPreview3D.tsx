import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CharacterAnimator, applySkeletonPoseToRig } from '../game/characterAnimation';
import { CharacterRig, buildCharacterRig } from '../game/models';
import { createCharacterTexturePack } from '../game/textures';
import { CharacterDef, OutfitDef } from '../types/game';

interface CharacterPreview3DProps {
  character: CharacterDef;
  outfit: OutfitDef;
  accentColor?: string;
}

const DEFAULT_YAW = Math.PI - 0.28;

export const CharacterPreview3D: React.FC<CharacterPreview3DProps> = ({
  character,
  outfit,
  accentColor = '#d97706',
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<CharacterRig | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);
  const propsRef = useRef({ character, outfit, accentColor });
  propsRef.current = { character, outfit, accentColor };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
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

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d121a');
    scene.fog = new THREE.FogExp2('#0d121a', 0.045);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    const width = Math.max(240, container.clientWidth);
    const height = Math.max(160, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.15, 40);
    camera.position.set(0, 1.16, 3.68);
    camera.lookAt(0, 0.96, 0);
    renderer.setSize(width, height, false);

    // 3-Point Studio Lighting + gentle facial fill (Warm key + Cool bounce + Face fill + Theme-tinted rim)
    const hemi = new THREE.HemisphereLight('#c8e0ff', '#2b221a', 1.05);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff2da', 2.55);
    keyLight.position.set(2.3, 3.5, 3.3);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 12;
      const d = 1.6;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const faceFill = new THREE.PointLight('#ffebd2', 1.35, 7.0);
    faceFill.position.set(0.28, 1.62, 2.35);
    scene.add(faceFill);

    const rimLight = new THREE.DirectionalLight(propsRef.current.accentColor, 1.45);
    rimLight.position.set(-2.4, 2.3, -2.5);
    scene.add(rimLight);
    rimLightRef.current = rimLight;

    // Carved stone showcase plinth (multi-step bevelled cylinder, never floating!)
    const plinthGroup = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({
      color: '#262930',
      roughness: 0.78,
      metalness: 0.14,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: '#756442',
      roughness: 0.42,
      metalness: 0.58,
    });
    const baseDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.96, 0.14, 28), stoneMat);
    baseDisc.position.y = -0.07;
    baseDisc.receiveShadow = true;
    const upperRing = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.82, 0.04, 28), trimMat);
    upperRing.position.y = 0.01;
    upperRing.receiveShadow = true;
    const brassCollar = new THREE.Mesh(new THREE.TorusGeometry(0.765, 0.014, 8, 32), trimMat);
    brassCollar.rotation.x = Math.PI / 2;
    brassCollar.position.y = 0.025;
    plinthGroup.add(baseDisc, upperRing, brassCollar);
    scene.add(plinthGroup);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const texPack = createCharacterTexturePack(isSoftwareGl ? 256 : 512, isSoftwareGl ? 1 : maxAniso);
    const rig = buildCharacterRig(propsRef.current.character, propsRef.current.outfit, texPack);
    rig.root.position.set(0, 0.02, 0);
    rig.root.rotation.y = DEFAULT_YAW;
    const animator = new CharacterAnimator();
    animator.reset('idle');

    const applyPose = (dt: number) => {
      const c = propsRef.current.character;
      rig.bodyPivot.scale.set(c.shoulderScale, c.heightScale, c.shoulderScale);
      animator.update(dt, {
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
        strideFrequency: c.strideFrequency,
        leanStyle: c.leanStyle,
      });
      applySkeletonPoseToRig(animator.currentPose, rig);
    };
    applyPose(0.016);
    scene.add(rig.root);
    rigRef.current = rig;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let disposed = false;
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let yaw = DEFAULT_YAW;
    let targetYaw = DEFAULT_YAW;
    let dragging = false;
    let dragStartX = 0;
    let dragBaseYaw = DEFAULT_YAW;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 60);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 70);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (isSoftwareGl) {
        if (renderBusy) {
          renderDirty = true;
          return;
        }
        renderBusy = true;
        frameId = requestAnimationFrame(() => {
          if (disposed) return;
          renderDirty = false;
          yaw = targetYaw;
          rig.root.rotation.y = yaw;
          applyPose(0.016);
          renderer.render(scene, camera);
          afterDraw(() => {
            renderBusy = false;
            if (renderDirty && !disposed) requestRender();
          });
        });
      }
    };
    requestRenderRef.current = requestRender;

    // Schedule gentle texture decode refresh + initial draw
    if (isSoftwareGl) {
      requestRender();
      const t1 = window.setTimeout(() => requestRender(), 180);
      const t2 = window.setTimeout(() => requestRender(), 500);
      const clearRefreshTimers = () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
      // Attach to cleanup via closure below
      (container as unknown as { __clearRefresh?: () => void }).__clearRefresh = clearRefreshTimers;
    } else {
      let lastTs = performance.now();
      const tick = (now: number) => {
        if (disposed) return;
        const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
        lastTs = now;
        if (!dragging) {
          targetYaw += dt * 0.22;
        }
        yaw = THREE.MathUtils.damp(yaw, targetYaw, 14, dt);
        rig.root.rotation.y = yaw;
        applyPose(dt);
        renderer.render(scene, camera);
        frameId = requestAnimationFrame(tick);
      };
      frameId = requestAnimationFrame(tick);
    }

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      dragStartX = e.clientX;
      dragBaseYaw = targetYaw;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // ignore if unsupported
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      targetYaw = dragBaseYaw + dx * 0.012;
      if (isSoftwareGl) requestRender();
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    const onDoubleClick = () => {
      targetYaw = DEFAULT_YAW;
      if (isSoftwareGl) requestRender();
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    dom.addEventListener('dblclick', onDoubleClick);

    const resizeObserver = new ResizeObserver(() => {
      const w = Math.max(240, container.clientWidth);
      const h = Math.max(160, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      if (isSoftwareGl) requestRender();
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      requestRenderRef.current = null;
      rigRef.current = null;
      rimLightRef.current = null;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      (container as unknown as { __clearRefresh?: () => void }).__clearRefresh?.();
      resizeObserver.disconnect();
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('dblclick', onDoubleClick);

      rig.dispose();
      plinthGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
        }
      });
      stoneMat.dispose();
      trimMat.dispose();
      texPack.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (dom.parentElement === container) {
        container.removeChild(dom);
      }
    };
  }, []);

  useEffect(() => {
    const rig = rigRef.current;
    if (rig) {
      rig.applyCharacterAndOutfit(character, outfit);
      rig.bodyPivot.scale.set(character.shoulderScale, character.heightScale, character.shoulderScale);
    }
    if (rimLightRef.current) {
      rimLightRef.current.color.set(accentColor);
    }
    requestRenderRef.current?.();
    const timer = window.setTimeout(() => requestRenderRef.current?.(), 160);
    return () => window.clearTimeout(timer);
  }, [character, outfit, accentColor]);

  return (
    <div className="relative w-full h-52 sm:h-56 mt-2.5 rounded-xl overflow-hidden border border-stone-800 bg-[#0d121a]">
      <div
        ref={mountRef}
        data-testid="character-preview-3d"
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />
      <div className="pointer-events-none absolute top-2 left-2.5 px-2 py-0.5 rounded bg-[#0b0e14]/85 border border-stone-700/70 text-[10px] font-bold uppercase tracking-wider text-stone-200">
        {outfit.name}
      </div>
      <div className="pointer-events-none absolute top-2 right-2.5 px-2 py-0.5 rounded bg-[#0b0e14]/85 border border-stone-700/70 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
        {outfit.rarity}
      </div>
      <div className="pointer-events-none absolute bottom-2 right-2.5 px-2 py-0.5 rounded bg-[#0b0e14]/80 text-[10px] font-medium text-stone-400">
        Drag to rotate
      </div>
    </div>
  );
};
