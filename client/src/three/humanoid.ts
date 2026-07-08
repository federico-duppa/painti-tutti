import * as THREE from 'three';
import { TEXTURE_SIZE, type PaintStroke, type PoseId } from '../../../shared/src';

/**
 * The paintable player model: a featureless humanoid built from boxes that
 * all share one 512x512 canvas texture atlas. Each body part owns a region
 * of the atlas, so a raycast hit's UV can be painted straight onto the
 * canvas and every client renders the identical disguise from the same
 * stroke list.
 */

interface AtlasCell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

// 4x2 grid: head, torso, armL, armR / legL, legR, (2 spare cells)
const CELLS: Record<string, AtlasCell> = {
  head: { u0: 0.0, v0: 0.5, u1: 0.25, v1: 1.0 },
  torso: { u0: 0.25, v0: 0.5, u1: 0.5, v1: 1.0 },
  armL: { u0: 0.5, v0: 0.5, u1: 0.75, v1: 1.0 },
  armR: { u0: 0.75, v0: 0.5, u1: 1.0, v1: 1.0 },
  legL: { u0: 0.0, v0: 0.0, u1: 0.25, v1: 0.5 },
  legR: { u0: 0.25, v0: 0.0, u1: 0.5, v1: 0.5 },
};

interface PartSpec {
  cell: AtlasCell;
  size: [number, number, number];
  /** pivot position (shoulder/hip for limbs, center for head/torso) */
  pivot: [number, number, number];
  /** mesh offset inside the pivot group */
  offset: [number, number, number];
}

const PARTS: Record<string, PartSpec> = {
  head: { cell: CELLS.head, size: [0.34, 0.34, 0.34], pivot: [0, 1.57, 0], offset: [0, 0, 0] },
  torso: { cell: CELLS.torso, size: [0.5, 0.7, 0.26], pivot: [0, 1.05, 0], offset: [0, 0, 0] },
  armL: { cell: CELLS.armL, size: [0.14, 0.62, 0.14], pivot: [-0.34, 1.36, 0], offset: [0, -0.28, 0] },
  armR: { cell: CELLS.armR, size: [0.14, 0.62, 0.14], pivot: [0.34, 1.36, 0], offset: [0, -0.28, 0] },
  legL: { cell: CELLS.legL, size: [0.17, 0.72, 0.17], pivot: [-0.13, 0.72, 0], offset: [0, -0.36, 0] },
  legR: { cell: CELLS.legR, size: [0.17, 0.72, 0.17], pivot: [0.13, 0.72, 0], offset: [0, -0.36, 0] },
};

interface PoseSpec {
  rootY?: number;
  rootRotX?: number;
  parts?: Record<string, { rotX?: number; rotZ?: number }>;
}

const POSE_SPECS: Record<PoseId, PoseSpec> = {
  stand: {},
  armsUp: { parts: { armL: { rotZ: -2.9 }, armR: { rotZ: 2.9 } } },
  crouch: {
    rootY: -0.52,
    parts: { legL: { rotX: -1.5 }, legR: { rotX: -1.5 }, armL: { rotX: -0.5 }, armR: { rotX: -0.5 } },
  },
  sit: {
    rootY: -0.72,
    parts: { legL: { rotX: -1.57 }, legR: { rotX: -1.57 } },
  },
  // lying flat on the back: rotate the whole rig and rest it near the floor
  lie: { rootY: 0.2, rootRotX: -Math.PI / 2 },
};

function remapUVs(geometry: THREE.BoxGeometry, cell: AtlasCell) {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      cell.u0 + uv.getX(i) * (cell.u1 - cell.u0),
      cell.v0 + uv.getY(i) * (cell.v1 - cell.v0)
    );
  }
  uv.needsUpdate = true;
}

export class Humanoid {
  readonly group: THREE.Group;
  /** raycast targets; each mesh has `userData.playerId` set by the scene */
  readonly meshes: THREE.Mesh[] = [];

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshLambertMaterial;
  private pivots: Record<string, THREE.Group> = {};
  private strokes: PaintStroke[] = [];
  private baseColor: string;

  constructor(baseColor = '#f2f2f2') {
    this.baseColor = baseColor;
    this.canvas = document.createElement('canvas');
    this.canvas.width = TEXTURE_SIZE;
    this.canvas.height = TEXTURE_SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshLambertMaterial({ map: this.texture });
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';

    for (const [name, spec] of Object.entries(PARTS)) {
      const geometry = new THREE.BoxGeometry(...spec.size);
      remapUVs(geometry, spec.cell);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.set(...spec.offset);
      const pivot = new THREE.Group();
      pivot.position.set(...spec.pivot);
      pivot.add(mesh);
      this.group.add(pivot);
      this.pivots[name] = pivot;
      this.meshes.push(mesh);
    }
    this.repaint();
  }

  setPose(pose: PoseId) {
    const spec = POSE_SPECS[pose] ?? POSE_SPECS.stand;
    for (const [name, partSpec] of Object.entries(PARTS)) {
      const pivot = this.pivots[name];
      pivot.position.set(...partSpec.pivot);
      pivot.rotation.set(0, 0, 0);
      const rot = spec.parts?.[name];
      if (rot) {
        if (rot.rotX) pivot.rotation.x = rot.rotX;
        if (rot.rotZ) pivot.rotation.z = rot.rotZ;
      }
    }
    this.group.rotation.x = spec.rootRotX ?? 0;
    this.group.position.y = spec.rootY ?? 0;
  }

  setTransform(pos: [number, number, number], yaw: number, pose: PoseId) {
    this.setPose(pose);
    this.group.position.x = pos[0];
    this.group.position.z = pos[2];
    this.group.position.y += pos[1];
    this.group.rotation.y = yaw;
  }

  // ---------- painting ----------

  setStrokes(strokes: PaintStroke[]) {
    this.strokes = [...strokes];
    this.repaint();
  }

  addStroke(stroke: PaintStroke) {
    this.strokes.push(stroke);
    this.drawStroke(stroke);
    this.texture.needsUpdate = true;
  }

  undoStroke() {
    this.strokes.pop();
    this.repaint();
  }

  /** Draw a stroke that is still being dragged (not yet committed). */
  previewStroke(stroke: PaintStroke) {
    this.repaint();
    this.drawStroke(stroke);
    this.texture.needsUpdate = true;
  }

  private repaint() {
    this.ctx.fillStyle = this.baseColor;
    this.ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    for (const s of this.strokes) this.drawStroke(s);
    this.texture.needsUpdate = true;
  }

  private drawStroke(stroke: PaintStroke) {
    const ctx = this.ctx;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const px = (p: [number, number]): [number, number] => [
      p[0] * TEXTURE_SIZE,
      (1 - p[1]) * TEXTURE_SIZE,
    ];
    if (stroke.points.length === 1) {
      const [x, y] = px(stroke.points[0]);
      ctx.beginPath();
      ctx.arc(x, y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    const [x0, y0] = px(stroke.points[0]);
    ctx.moveTo(x0, y0);
    for (const p of stroke.points.slice(1)) {
      const [x, y] = px(p);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
