import * as THREE from 'three';
import { MAP } from '../../../shared/src/map';
import { mulberry32, pick } from './rng';

/**
 * Builds the v1 courtyard. Every texture is procedural but seeded from the
 * shared map seed, so all clients render pixel-identical surfaces — which
 * matters, because hiders eyedrop colors from these very pixels.
 *
 * Design rule: high-frequency visual detail everywhere. A camouflaged
 * humanoid needs busy surfaces to disappear into; flat walls would make
 * every hider trivially findable.
 */

const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#469990', '#9a6324', '#ffd8b1', '#fffac8'];

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function muralTexture(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(1024, (ctx) => {
    ctx.fillStyle = '#f7e8c8';
    ctx.fillRect(0, 0, 1024, 1024);
    // big color fields
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = pick(rng, PALETTE);
      ctx.globalAlpha = 0.85;
      const x = rng() * 1024;
      const y = rng() * 1024;
      const r = 60 + rng() * 200;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // stripes
    for (let i = 0; i < 10; i++) {
      ctx.strokeStyle = pick(rng, PALETTE);
      ctx.lineWidth = 8 + rng() * 30;
      ctx.beginPath();
      ctx.moveTo(rng() * 1024, rng() * 1024);
      ctx.lineTo(rng() * 1024, rng() * 1024);
      ctx.stroke();
    }
    // confetti detail
    ctx.globalAlpha = 1;
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = pick(rng, PALETTE);
      ctx.fillRect(rng() * 1024, rng() * 1024, 6 + rng() * 14, 6 + rng() * 14);
    }
  });
}

function tilesTexture(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(1024, (ctx) => {
    const tile = 64;
    for (let y = 0; y < 1024; y += tile) {
      for (let x = 0; x < 1024; x += tile) {
        ctx.fillStyle = pick(rng, ['#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#264653', '#8ab17d']);
        ctx.fillRect(x, y, tile, tile);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
        if (rng() < 0.25) {
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.beginPath();
          ctx.arc(x + tile / 2, y + tile / 2, tile / 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
}

function crateWallTexture(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(1024, (ctx) => {
    ctx.fillStyle = '#b08d57';
    ctx.fillRect(0, 0, 1024, 1024);
    // horizontal planks
    for (let y = 0; y < 1024; y += 86) {
      ctx.fillStyle = `hsl(${28 + rng() * 12}, ${35 + rng() * 20}%, ${42 + rng() * 16}%)`;
      ctx.fillRect(0, y, 1024, 80);
    }
    // painted warning stripes + stencils for detail
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = pick(rng, ['#d62828', '#003049', '#f77f00', '#606c38']);
      ctx.fillRect(rng() * 900, rng() * 900, 40 + rng() * 120, 40 + rng() * 120);
    }
  });
}

function hedgeTexture(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(512, (ctx) => {
    ctx.fillStyle = '#2f6b2f';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `hsl(${100 + rng() * 40}, ${40 + rng() * 35}%, ${20 + rng() * 30}%)`;
      ctx.beginPath();
      ctx.arc(rng() * 512, rng() * 512, 3 + rng() * 8, 0, Math.PI * 2);
      ctx.fill();
    }
    // flowers
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = pick(rng, ['#ff5d8f', '#ffd60a', '#ffffff', '#c77dff']);
      ctx.beginPath();
      ctx.arc(rng() * 512, rng() * 512, 4 + rng() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function floorTexture(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(2048, (ctx) => {
    ctx.fillStyle = '#9c9588';
    ctx.fillRect(0, 0, 2048, 2048);
    // concrete noise
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `rgba(${60 + rng() * 60}, ${60 + rng() * 55}, ${55 + rng() * 50}, 0.25)`;
      ctx.fillRect(rng() * 2048, rng() * 2048, 2 + rng() * 8, 2 + rng() * 8);
    }
    // mosaic corner (maps to the tiled-wall side of the courtyard)
    const tile = 84;
    for (let y = 0; y < 900; y += tile) {
      for (let x = 1100; x < 2048; x += tile) {
        ctx.fillStyle = pick(rng, ['#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#8ab17d']);
        ctx.globalAlpha = 0.9;
        ctx.fillRect(x, y, tile - 4, tile - 4);
      }
    }
    ctx.globalAlpha = 1;
    // painted playground shapes elsewhere
    for (let i = 0; i < 12; i++) {
      ctx.strokeStyle = pick(rng, PALETTE);
      ctx.lineWidth = 14 + rng() * 22;
      ctx.beginPath();
      ctx.arc(rng() * 2048, rng() * 2048, 80 + rng() * 280, rng() * Math.PI * 2, rng() * Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = pick(rng, PALETTE);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(rng() * 1800, rng() * 1800, 120 + rng() * 260, 120 + rng() * 260);
    }
  });
}

function stripedTexture(rng: () => number): THREE.CanvasTexture {
  return canvasTexture(256, (ctx) => {
    for (let y = 0; y < 256; y += 32) {
      ctx.fillStyle = pick(rng, PALETTE);
      ctx.fillRect(0, y, 256, 32);
    }
  });
}

export function buildMap(): THREE.Group {
  const rng = mulberry32(MAP.seed);
  const group = new THREE.Group();
  const S = MAP.size;
  const H = MAP.wallHeight;
  const mat = (map: THREE.CanvasTexture) => new THREE.MeshLambertMaterial({ map });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), mat(floorTexture(rng)));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const wallSpecs: { tex: THREE.CanvasTexture; pos: [number, number, number]; rotY: number }[] = [
    { tex: muralTexture(rng), pos: [0, H / 2, -S / 2], rotY: 0 }, // north: mural
    { tex: tilesTexture(rng), pos: [S / 2, H / 2, 0], rotY: -Math.PI / 2 }, // east: tiles
    { tex: crateWallTexture(rng), pos: [0, H / 2, S / 2], rotY: Math.PI }, // south: crates
    { tex: hedgeTexture(rng), pos: [-S / 2, H / 2, 0], rotY: Math.PI / 2 }, // west: garden
  ];
  for (const spec of wallSpecs) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(S, H), mat(spec.tex));
    wall.position.set(...spec.pos);
    wall.rotation.y = spec.rotY;
    group.add(wall);
  }

  for (const p of MAP.pillars) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.w), mat(stripedTexture(rng)));
    pillar.position.set(p.x, p.h / 2, p.z);
    group.add(pillar);
  }

  const crateTex = crateWallTexture(rng);
  for (const c of MAP.crates) {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(c.w, c.h, c.w),
      new THREE.MeshLambertMaterial({
        map: crateTex,
        color: new THREE.Color(`hsl(${rng() * 360}, 35%, 75%)`),
      })
    );
    // No big rotation: the crate must match its collision footprint.
    crate.position.set(c.x, c.h / 2, c.z);
    crate.rotation.y = (rng() - 0.5) * 0.1;
    group.add(crate);
  }

  const hedgeTex = hedgeTexture(rng);
  for (const h of MAP.hedges) {
    const hedge = new THREE.Mesh(
      new THREE.BoxGeometry(h.w, h.h, h.d),
      new THREE.MeshLambertMaterial({ map: hedgeTex })
    );
    hedge.position.set(h.x, h.h / 2, h.z);
    group.add(hedge);
  }

  return group;
}
