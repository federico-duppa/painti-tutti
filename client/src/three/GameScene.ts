import * as THREE from 'three';
import type { PaintStroke, PoseId, PublicPlayer, Vec3 } from '../../../shared/src';
import { MAP, resolveXZ } from '../../../shared/src/map';
import { buildMap } from './map3d';
import { Humanoid } from './humanoid';

export type SceneMode = 'idle' | 'hiderPaint' | 'hiderFrozen' | 'seeker' | 'spectate';
export type PaintTool = 'brush' | 'eyedropper';

export interface SceneCallbacks {
  onMove: (pos: Vec3, yaw: number) => void;
  onStroke: (stroke: PaintStroke) => void;
  onColorSampled: (color: string) => void;
  onTag: (targetId: string | null) => void;
}

const WALK_SPEED = 5.5;
const MOVE_EMIT_MS = 100;

/**
 * Owns the three.js world and all pointer/keyboard interaction. React only
 * mounts it and feeds it state; gameplay callbacks flow back out through
 * SceneCallbacks. One instance per GameView mount.
 */
export class GameScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private cb: SceneCallbacks;
  private container: HTMLElement;
  private players = new Map<string, Humanoid>();
  /** Strokes survive model create/destroy (state snapshots and paint events
   * race — a stroke may arrive before syncPlayers builds the model). */
  private strokesById = new Map<string, PaintStroke[]>();
  private selfId = '';
  private mode: SceneMode = 'idle';

  // paint tool state (driven by the React toolbar)
  tool: PaintTool = 'brush';
  color = '#3cb44b';
  brushSize = 14;

  // self movement/orbit state
  private selfPos: Vec3 = [0, 0, 0];
  private selfYaw = 0;
  private yawAdopted = false;
  private selfPose: PoseId = 'stand';
  private orbit = { theta: 0, phi: 1.15, radius: 4 };
  private fpPitch = 0;
  private keys = new Set<string>();
  private lastEmit = 0;
  private emitDirty = false;

  private painting: PaintStroke | null = null;
  private orbiting = false;
  private lastPointer = { x: 0, y: 0 };
  private raycaster = new THREE.Raycaster();
  private raf = 0;
  private lastFrame = 0;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(container: HTMLElement, cb: SceneCallbacks) {
    this.container = container;
    this.cb = cb;
    // Debug/testing handle (the client is untrusted anyway — the server
    // validates everything that matters).
    (window as { __gameScene?: GameScene }).__gameScene = this;
    // preserveDrawingBuffer lets the eyedropper read rendered pixels —
    // sampling includes lighting, exactly what a camouflage needs to match.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);

    this.scene.background = new THREE.Color('#bfe3ff');
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(12, 30, 8);
    this.scene.add(sun);
    this.scene.add(buildMap());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('mousemove', this.onLockedMouseMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.lastFrame = performance.now();
    this.loop(this.lastFrame);
  }

  // ---------- public API ----------

  setSelf(id: string) {
    this.selfId = id;
  }

  setMode(mode: SceneMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode !== 'seeker' && document.pointerLockElement) document.exitPointerLock();
    if (mode === 'seeker') {
      this.fpPitch = 0;
    }
    const self = this.players.get(this.selfId);
    if (self) self.group.visible = mode !== 'seeker';
  }

  getMode(): SceneMode {
    return this.mode;
  }

  /** Reconcile the roster: create/remove/update player models. */
  syncPlayers(players: PublicPlayer[]) {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.pos === null) {
        // not visible to us right now
        const existing = this.players.get(p.id);
        if (existing) existing.group.visible = false;
        seen.add(p.id);
        continue;
      }
      seen.add(p.id);
      let model = this.players.get(p.id);
      if (!model) {
        model = new Humanoid(p.role === 'seeker' ? '#41424d' : '#f2f2f2');
        for (const mesh of model.meshes) mesh.userData.playerId = p.id;
        model.setStrokes(this.strokesById.get(p.id) ?? []);
        this.players.set(p.id, model);
        this.scene.add(model.group);
      }
      model.group.visible = !(p.id === this.selfId && this.mode === 'seeker') && p.alive;
      if (p.id === this.selfId) {
        // Trust our local prediction for our own transform, but adopt the
        // server's spawn orientation once (seekers spawn facing the yard).
        if (!this.yawAdopted) {
          this.selfYaw = p.yaw;
          this.orbit.theta = p.yaw;
          this.yawAdopted = true;
        }
        this.selfPos = [p.pos[0], 0, p.pos[2]];
        this.selfPose = p.pose;
        model.setTransform(this.selfPos, this.selfYaw, p.pose);
      } else {
        model.setTransform(p.pos, p.yaw, p.pose);
      }
    }
    for (const [id, model] of this.players) {
      if (!seen.has(id)) {
        this.scene.remove(model.group);
        model.dispose();
        this.players.delete(id);
      }
    }
  }

  playerMoved(id: string, pos: Vec3, yaw: number, pose: PoseId) {
    if (id === this.selfId) return; // our own echo; local prediction wins
    const model = this.players.get(id);
    if (!model) return;
    model.group.visible = true;
    model.setTransform(pos, yaw, pose);
  }

  setSelfPose(pose: PoseId) {
    this.selfPose = pose;
    this.players.get(this.selfId)?.setTransform(this.selfPos, this.selfYaw, pose);
  }

  setStrokes(playerId: string, strokes: PaintStroke[]) {
    this.strokesById.set(playerId, [...strokes]);
    this.players.get(playerId)?.setStrokes(strokes);
  }

  addStroke(playerId: string, stroke: PaintStroke) {
    const cache = this.strokesById.get(playerId) ?? [];
    cache.push(stroke);
    this.strokesById.set(playerId, cache);
    this.players.get(playerId)?.addStroke(stroke);
  }

  undoStroke(playerId: string) {
    this.strokesById.get(playerId)?.pop();
    this.players.get(playerId)?.undoStroke();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('mousemove', this.onLockedMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (document.pointerLockElement === el) document.exitPointerLock();
    for (const model of this.players.values()) model.dispose();
    this.renderer.dispose();
    el.remove();
  }

  // ---------- input ----------

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private pointerNdc(e: PointerEvent | MouseEvent): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  private onPointerDown = (e: PointerEvent) => {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.mode === 'hiderPaint') {
      if (this.tool === 'eyedropper') {
        this.samplePixel(e);
        return;
      }
      const uv = this.raycastSelfUV(e);
      if (uv) {
        this.painting = { points: [uv], color: this.color, size: this.brushSize };
        this.players.get(this.selfId)?.previewStroke(this.painting);
      } else {
        this.orbiting = true;
      }
    } else if (this.mode === 'hiderFrozen' || this.mode === 'spectate') {
      this.orbiting = true;
    } else if (this.mode === 'seeker') {
      if (document.pointerLockElement === this.renderer.domElement) {
        this.tagAt(new THREE.Vector2(0, 0));
      } else {
        // Without pointer lock, a click both aims and tags (also keeps the
        // game testable in automation, where pointer lock is unavailable).
        this.tagAt(this.pointerNdc(e));
        this.renderer.domElement.requestPointerLock?.();
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.painting) {
      const uv = this.raycastSelfUV(e);
      if (uv) {
        this.painting.points.push(uv);
        this.players.get(this.selfId)?.previewStroke(this.painting);
      }
    } else if (this.orbiting) {
      this.orbit.theta -= dx * 0.008;
      this.orbit.phi = clamp(this.orbit.phi - dy * 0.006, 0.15, Math.PI / 2 + 0.3);
    }
  };

  private onPointerUp = () => {
    if (this.painting) {
      const stroke = this.painting;
      this.painting = null;
      if (stroke.points.length > 0) {
        this.addStroke(this.selfId, stroke); // local echo; server rebroadcasts to others
        this.cb.onStroke(stroke);
      }
    }
    this.orbiting = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (this.mode === 'hiderPaint' || this.mode === 'hiderFrozen' || this.mode === 'spectate') {
      this.orbit.radius = clamp(this.orbit.radius + e.deltaY * 0.004, 1.4, 24);
    }
  };

  private onLockedMouseMove = (e: MouseEvent) => {
    if (this.mode !== 'seeker') return;
    if (document.pointerLockElement !== this.renderer.domElement) return;
    this.selfYaw -= e.movementX * 0.0022;
    this.fpPitch = clamp(this.fpPitch - e.movementY * 0.0022, -1.4, 1.4);
    this.emitDirty = true;
  };

  // ---------- painting helpers ----------

  private raycastSelfUV(e: PointerEvent): [number, number] | null {
    const self = this.players.get(this.selfId);
    if (!self) return null;
    this.raycaster.setFromCamera(this.pointerNdc(e), this.camera);
    const hit = this.raycaster.intersectObjects(self.meshes, false)[0];
    if (!hit?.uv) return null;
    return [hit.uv.x, hit.uv.y];
  }

  private samplePixel(e: PointerEvent) {
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const gl = this.renderer.getContext();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * gl.drawingBufferWidth);
    const y = Math.floor((1 - (e.clientY - rect.top) / rect.height) * gl.drawingBufferHeight);
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const hex = `#${[pixel[0], pixel[1], pixel[2]]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')}`;
    this.color = hex;
    this.cb.onColorSampled(hex);
  }

  // ---------- tagging ----------

  private tagAt(ndc: THREE.Vector2) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const [id, model] of this.players) {
      if (id !== this.selfId && model.group.visible) targets.push(...model.meshes);
    }
    const sceneHits = this.raycaster.intersectObjects(this.scene.children, true);
    const isShown = (o: THREE.Object3D | null): boolean =>
      o === null ? true : o.visible && isShown(o.parent);
    const first = sceneHits.find((h) => isShown(h.object));
    const playerId =
      first && targets.includes(first.object as THREE.Mesh)
        ? ((first.object.userData.playerId as string) ?? null)
        : null;
    this.cb.onTag(playerId);
  }

  // ---------- frame loop ----------

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min((t - this.lastFrame) / 1000, 0.1);
    this.lastFrame = t;
    this.step(dt, t);
    this.renderer.render(this.scene, this.camera);
  };

  private step(dt: number, t: number) {
    const canWalk = this.mode === 'hiderPaint' || this.mode === 'seeker';
    if (canWalk) {
      let fwd = 0;
      let strafe = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1;
      if (fwd || strafe) {
        // Move relative to where the camera looks.
        const yaw = this.mode === 'seeker' ? this.selfYaw : this.orbit.theta;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const dx = (-sin * fwd + cos * strafe) * WALK_SPEED * dt;
        const dz = (-cos * fwd - sin * strafe) * WALK_SPEED * dt;
        const b = MAP.bounds;
        const [x, z] = resolveXZ(
          clamp(this.selfPos[0] + dx, b.minX, b.maxX),
          clamp(this.selfPos[2] + dz, b.minZ, b.maxZ)
        );
        this.selfPos = [clamp(x, b.minX, b.maxX), 0, clamp(z, b.minZ, b.maxZ)];
        if (this.mode === 'hiderPaint') this.selfYaw = this.orbit.theta;
        this.players.get(this.selfId)?.setTransform(this.selfPos, this.selfYaw, this.selfPose);
        this.emitDirty = true;
      }
    }
    if (this.emitDirty && t - this.lastEmit > MOVE_EMIT_MS) {
      this.lastEmit = t;
      this.emitDirty = false;
      this.cb.onMove([...this.selfPos], this.selfYaw);
    }
    this.updateCamera();
  }

  private updateCamera() {
    if (this.mode === 'seeker') {
      this.camera.position.set(this.selfPos[0], 1.62, this.selfPos[2]);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.fpPitch, this.selfYaw, 0);
      return;
    }
    let target = new THREE.Vector3(this.selfPos[0], 1.0, this.selfPos[2]);
    if (this.mode === 'spectate') target = new THREE.Vector3(0, 1, 0);
    const { theta, phi, radius } = this.orbit;
    const r = this.mode === 'spectate' ? Math.max(radius, 10) : radius;
    this.camera.position.set(
      target.x + r * Math.sin(phi) * Math.sin(theta),
      target.y + r * Math.cos(phi),
      target.z + r * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.lookAt(target);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
