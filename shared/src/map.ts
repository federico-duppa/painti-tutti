import type { Vec3 } from './index.js';

/**
 * The one hand-authored v1 map: a walled courtyard with distinct
 * detail-dense visual zones. Geometry/props are data here so the server
 * knows the playable volume and spawn points, while the client builds the
 * visuals — both from the same definition. All procedural textures derive
 * from `seed`, so every client renders an identical map.
 */
export const MAP = {
  seed: 20260708,
  /** courtyard is size x size meters, walls around it */
  size: 40,
  wallHeight: 5,
  /** playable volume (server clamps every position into this box) */
  bounds: { minX: -19.2, maxX: 19.2, minZ: -19.2, maxZ: 19.2 },
  seekerSpawn: [0, 0, -18] as Vec3,
  /** hiders spawn scattered in the middle */
  hiderSpawnRadius: 10,

  /** striped pillars in the open — painted well, you can BE one */
  pillars: [
    { x: -8, z: -4, w: 1.2, h: 5 },
    { x: 7, z: 2, w: 1.2, h: 5 },
    { x: -2, z: 9, w: 1.6, h: 4 },
  ],

  /** crate clutter zone along the south wall */
  crates: [
    { x: -6, z: 17, w: 1.6, h: 1.6 },
    { x: -4.2, z: 17.4, w: 1.2, h: 1.2 },
    { x: -5.4, z: 16, w: 1.0, h: 1.0 },
    { x: 3, z: 17, w: 2.0, h: 2.0 },
    { x: 5.2, z: 17.4, w: 1.4, h: 1.4 },
    { x: 4.4, z: 15.8, w: 1.0, h: 1.0 },
    { x: 12, z: 16.5, w: 1.8, h: 1.4 },
  ],

  /** hedge blocks along the west wall — the "garden" */
  hedges: [
    { x: -17.5, z: -10, w: 2.5, d: 6, h: 2.2 },
    { x: -17.5, z: 0, w: 2.5, d: 5, h: 1.8 },
    { x: -17.5, z: 8, w: 2.5, d: 7, h: 2.4 },
    { x: -14, z: -14, w: 2, d: 2, h: 1.6 },
  ],
};

export type MapDef = typeof MAP;

export interface PropBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** XZ footprints of solid props — players cannot stand inside them. */
export const PROP_BOXES: PropBox[] = [
  ...MAP.pillars.map((p) => ({
    minX: p.x - p.w / 2,
    maxX: p.x + p.w / 2,
    minZ: p.z - p.w / 2,
    maxZ: p.z + p.w / 2,
  })),
  ...MAP.crates.map((c) => ({
    minX: c.x - c.w / 2,
    maxX: c.x + c.w / 2,
    minZ: c.z - c.w / 2,
    maxZ: c.z + c.w / 2,
  })),
  ...MAP.hedges.map((h) => ({
    minX: h.x - h.w / 2,
    maxX: h.x + h.w / 2,
    minZ: h.z - h.d / 2,
    maxZ: h.z + h.d / 2,
  })),
];

export const PLAYER_RADIUS = 0.45;

/**
 * Push a player position out of any prop footprint (2D circle-vs-AABB,
 * shortest axis). Used by the server (authoritative) and by the client
 * (prediction) so nobody can stand — or hide — inside solid geometry.
 */
export function resolveXZ(x: number, z: number, radius = PLAYER_RADIUS): [number, number] {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of PROP_BOXES) {
      if (
        x > b.minX - radius && x < b.maxX + radius &&
        z > b.minZ - radius && z < b.maxZ + radius
      ) {
        const pushLeft = x - (b.minX - radius);
        const pushRight = b.maxX + radius - x;
        const pushNear = z - (b.minZ - radius);
        const pushFar = b.maxZ + radius - z;
        const min = Math.min(pushLeft, pushRight, pushNear, pushFar);
        if (min === pushLeft) x = b.minX - radius;
        else if (min === pushRight) x = b.maxX + radius;
        else if (min === pushNear) z = b.minZ - radius;
        else z = b.maxZ + radius;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [x, z];
}
