import { describe, expect, it } from 'vitest';
import { Room } from '../src/room.js';
import {
  HIDE_SECONDS,
  SEEK_SECONDS,
  STROKE_WINDOW_MAX,
  TAG_HIT_COOLDOWN_MS,
  TAG_MISS_COOLDOWN_MS,
  TAG_RANGE,
  type PaintStroke,
} from '../../shared/src/index.js';
import { MAP } from '../../shared/src/map.js';

const T0 = 1_000_000;
const HIDE_MS = HIDE_SECONDS * 1000;
const SEEK_MS = SEEK_SECONDS * 1000;

const stroke = (over: Partial<PaintStroke> = {}): PaintStroke => ({
  points: [[0.1, 0.1], [0.2, 0.2]],
  color: '#ff0000',
  size: 12,
  ...over,
});

function roomWith(names: string[], rng: () => number = () => 0): Room {
  const room = new Room('TEST', { rng });
  for (const name of names) expect(room.addPlayer(name, name)).toEqual({ ok: true });
  return room;
}

function startedRoom(names = ['ana', 'bob', 'cat', 'dan']) {
  const room = roomWith(names);
  expect(room.start(names[0], T0)).toEqual({ ok: true });
  const seeker = room.seekers()[0];
  const hiders = room.players.filter((p) => p.role === 'hider');
  return { room, seeker, hiders };
}

function toSeeking(room: Room) {
  expect(room.tick(T0 + HIDE_MS)).toBe(true);
  expect(room.phase).toBe('seeking');
}

describe('lobby and roles', () => {
  it('assigns 1 seeker for up to 7 players, 2 for 8-10', () => {
    const { room } = startedRoom(['a', 'b', 'c', 'd', 'e']);
    expect(room.seekers()).toHaveLength(1);
    const big = roomWith(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    big.start('a', T0);
    expect(big.seekers()).toHaveLength(2);
    expect(big.aliveHiders()).toHaveLength(6);
  });

  it('needs the host and 2+ players to start', () => {
    const room = roomWith(['ana']);
    expect(room.start('ana', T0).ok).toBe(false);
    room.addPlayer('bob', 'bob');
    expect(room.start('bob', T0).ok).toBe(false);
    expect(room.start('ana', T0)).toEqual({ ok: true });
    expect(room.phase).toBe('hiding');
    expect(room.phaseEndsAt).toBe(T0 + HIDE_MS);
  });

  it('rejects joins while a round is running', () => {
    const { room } = startedRoom();
    expect(room.addPlayer('eve', 'eve').ok).toBe(false);
  });
});

describe('hiding phase', () => {
  it('lets hiders move but clamps them into the playable volume', () => {
    const { room, hiders } = startedRoom();
    expect(room.moveTo(hiders[0].id, [500, 3, -500], 1)).toEqual({ ok: true });
    expect(hiders[0].pos).toEqual([MAP.bounds.maxX, 0, MAP.bounds.minZ]);
  });

  it('pushes players out of solid props — no hiding inside crates', () => {
    const { room, hiders } = startedRoom();
    const pillar = MAP.pillars[0];
    expect(room.moveTo(hiders[0].id, [pillar.x, 0, pillar.z], 0)).toEqual({ ok: true });
    const [x, , z] = hiders[0].pos;
    const inside =
      x > pillar.x - pillar.w / 2 && x < pillar.x + pillar.w / 2 &&
      z > pillar.z - pillar.w / 2 && z < pillar.z + pillar.w / 2;
    expect(inside).toBe(false);
  });

  it('does not let seekers move during hiding', () => {
    const { room, seeker } = startedRoom();
    expect(room.moveTo(seeker.id, [1, 0, 1], 0).ok).toBe(false);
  });

  it('accepts hider strokes and undo, rejects seeker strokes', () => {
    const { room, seeker, hiders } = startedRoom();
    expect(room.addStroke(hiders[0].id, stroke(), T0)).toEqual({ ok: true });
    expect(room.strokesOf(hiders[0].id)).toHaveLength(1);
    expect(room.addStroke(seeker.id, stroke(), T0).ok).toBe(false);
    expect(room.undoStroke(hiders[0].id)).toEqual({ ok: true });
    expect(room.strokesOf(hiders[0].id)).toHaveLength(0);
  });

  it('sanitizes stroke payloads and rejects garbage', () => {
    const { room, hiders } = startedRoom();
    const id = hiders[0].id;
    expect(room.addStroke(id, stroke({ color: 'red' }), T0).ok).toBe(false);
    expect(room.addStroke(id, stroke({ points: [] }), T0).ok).toBe(false);
    expect(room.addStroke(id, { nope: true } as unknown as PaintStroke, T0).ok).toBe(false);
    expect(room.addStroke(id, stroke({ points: [[-2, 0.5], [3, 0.5]] }), T0)).toEqual({ ok: true });
    expect(room.strokesOf(id)[0].points).toEqual([[0, 0.5], [1, 0.5]]);
  });

  it('rate-limits stroke floods (anti auto-paint)', () => {
    const { room, hiders } = startedRoom();
    const id = hiders[0].id;
    for (let i = 0; i < STROKE_WINDOW_MAX; i++) {
      expect(room.addStroke(id, stroke(), T0 + i)).toEqual({ ok: true });
    }
    expect(room.addStroke(id, stroke(), T0 + STROKE_WINDOW_MAX).ok).toBe(false);
    // ...but painting resumes once the window slides.
    expect(room.addStroke(id, stroke(), T0 + 6000)).toEqual({ ok: true });
  });

  it('locks poses and paint when seeking starts', () => {
    const { room, hiders } = startedRoom();
    expect(room.setPose(hiders[0].id, 'lie')).toEqual({ ok: true });
    toSeeking(room);
    expect(room.setPose(hiders[0].id, 'crouch').ok).toBe(false);
    expect(room.addStroke(hiders[0].id, stroke(), T0 + HIDE_MS).ok).toBe(false);
    expect(room.moveTo(hiders[0].id, [1, 0, 1], 0).ok).toBe(false); // frozen
  });
});

describe('seeking phase', () => {
  it('tags a hider in range and applies the hit cooldown', () => {
    const { room, seeker, hiders } = startedRoom();
    room.moveTo(hiders[0].id, [0, 0, -15], 0); // near seeker spawn
    toSeeking(room);
    const now = T0 + HIDE_MS;
    const res = room.tagAttempt(seeker.id, hiders[0].id, now);
    expect(res).toEqual({ ok: true, hit: true, targetId: hiders[0].id, hidersLeft: 2 });
    expect(hiders[0].alive).toBe(false);
    expect(seeker.nextTagAt).toBe(now + TAG_HIT_COOLDOWN_MS);
  });

  it('rejects tags beyond range and punishes misses with a longer cooldown', () => {
    const { room, seeker, hiders } = startedRoom();
    const far = hiders.find((h) => {
      const [x, , z] = h.pos;
      return Math.hypot(x - MAP.seekerSpawn[0], z - MAP.seekerSpawn[2]) > TAG_RANGE;
    })!;
    toSeeking(room);
    const now = T0 + HIDE_MS;
    const res = room.tagAttempt(seeker.id, far.id, now);
    expect(res).toEqual({ ok: true, hit: false, targetId: null, hidersLeft: 3 });
    expect(far.alive).toBe(true);
    expect(seeker.nextTagAt).toBe(now + TAG_MISS_COOLDOWN_MS);
    // Spam-clicking during cooldown fails.
    expect(room.tagAttempt(seeker.id, far.id, now + 1000).ok).toBe(false);
  });

  it('environment shots (no target) still cost the miss cooldown', () => {
    const { room, seeker } = startedRoom();
    toSeeking(room);
    const now = T0 + HIDE_MS;
    expect(room.tagAttempt(seeker.id, null, now)).toEqual({
      ok: true,
      hit: false,
      targetId: null,
      hidersLeft: 3,
    });
    expect(seeker.nextTagAt).toBe(now + TAG_MISS_COOLDOWN_MS);
  });

  it('seekers win when every hider is found', () => {
    const { room, seeker, hiders } = startedRoom();
    for (const h of hiders) room.moveTo(h.id, [0, 0, -15], 0);
    toSeeking(room);
    let now = T0 + HIDE_MS;
    for (const h of hiders) {
      expect(room.tagAttempt(seeker.id, h.id, now).ok).toBe(true);
      now += TAG_HIT_COOLDOWN_MS;
    }
    expect(room.phase).toBe('roundEnd');
    expect(room.result?.winner).toBe('seekers');
    expect(room.result?.survivors).toEqual([]);
    expect(seeker.score).toBe(3);
  });

  it('hiders win when the timer expires with survivors', () => {
    const { room, seeker, hiders } = startedRoom();
    toSeeking(room);
    expect(room.tick(T0 + HIDE_MS + SEEK_MS)).toBe(true);
    expect(room.phase).toBe('roundEnd');
    expect(room.result?.winner).toBe('hiders');
    expect(room.result?.survivors).toHaveLength(hiders.length);
    expect(seeker.score).toBe(0);
    expect(hiders[0].score).toBe(2);
  });
});

describe('disconnects', () => {
  it('hiders win if all seekers leave mid-round', () => {
    const { room, seeker } = startedRoom();
    toSeeking(room);
    room.removePlayer(seeker.id, T0 + HIDE_MS + 1);
    expect(room.phase).toBe('roundEnd');
    expect(room.result?.winner).toBe('hiders');
  });

  it('seekers win when the last hider disconnects', () => {
    const { room, seeker, hiders } = startedRoom(['ana', 'bob']);
    toSeeking(room);
    let now = T0 + HIDE_MS;
    room.removePlayer(hiders[0].id, now);
    expect(room.phase).toBe('roundEnd');
    expect(room.result?.winner).toBe('seekers');
    expect(seeker.alive).toBe(true);
  });

  it('a disconnect never hangs the round: remaining players continue', () => {
    const { room, hiders } = startedRoom(['a', 'b', 'c', 'd', 'e']);
    room.removePlayer(hiders[0].id, T0 + 1);
    expect(room.phase).toBe('hiding');
    toSeeking(room);
    expect(room.phase).toBe('seeking');
  });

  it('promotes a new host when the host leaves in the lobby', () => {
    const room = roomWith(['ana', 'bob']);
    room.removePlayer('ana', T0);
    expect(room.players[0].isHost).toBe(true);
  });
});

describe('information hiding', () => {
  it('seekers cannot see hider positions or paint during hiding', () => {
    const { room, seeker, hiders } = startedRoom();
    expect(room.canSeePosition(seeker.id, hiders[0].id)).toBe(false);
    expect(room.canSeePaint(seeker.id, hiders[0].id)).toBe(false);
    const state = room.stateFor(seeker.id, T0);
    const hiderView = state.players.find((p) => p.id === hiders[0].id)!;
    expect(hiderView.pos).toBeNull();
  });

  it('hiders see each other during hiding; everyone sees all at round end', () => {
    const { room, seeker, hiders } = startedRoom();
    expect(room.canSeePosition(hiders[0].id, hiders[1].id)).toBe(true);
    toSeeking(room);
    expect(room.canSeePosition(seeker.id, hiders[0].id)).toBe(true);
    room.tick(T0 + HIDE_MS + SEEK_MS);
    expect(room.canSeePosition(seeker.id, hiders[0].id)).toBe(true);
  });

  it('returning to the lobby clears roles and paint', () => {
    const { room, hiders } = startedRoom();
    room.addStroke(hiders[0].id, stroke(), T0);
    toSeeking(room);
    room.tick(T0 + HIDE_MS + SEEK_MS);
    expect(room.backToLobby('ana')).toEqual({ ok: true });
    expect(room.phase).toBe('lobby');
    expect(room.players.every((p) => p.role === null)).toBe(true);
    expect(room.strokesOf(hiders[0].id)).toEqual([]);
  });
});
