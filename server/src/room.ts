import {
  HIDE_SECONDS,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_STROKES_PER_PLAYER,
  MAX_STROKE_POINTS,
  MIN_PLAYERS,
  SEEK_SECONDS,
  STROKE_WINDOW_MAX,
  STROKE_WINDOW_MS,
  TAG_HIT_COOLDOWN_MS,
  TAG_MISS_COOLDOWN_MS,
  TAG_RANGE,
  TEXTURE_SIZE,
  type PaintStroke,
  type Phase,
  type PoseId,
  type PublicPlayer,
  type Role,
  type RoomStateForPlayer,
  type RoundResult,
  type Vec3,
} from '../../shared/src/index.js';
import { MAP, resolveXZ } from '../../shared/src/map.js';
import { POSES } from '../../shared/src/index.js';

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  score: number;
  role: Role | null;
  alive: boolean;
  pos: Vec3;
  yaw: number;
  pose: PoseId;
  strokes: PaintStroke[];
  nextTagAt: number;
  /** timestamps of recent stroke events, for rate limiting */
  strokeTimes: number[];
}

export type ActionResult = { ok: true } | { ok: false; error: string };
export type TagResult =
  | { ok: true; hit: boolean; targetId: string | null; hidersLeft: number }
  | { ok: false; error: string };

const ok: ActionResult = { ok: true };
const fail = (error: string) => ({ ok: false as const, error });

export interface RoomOptions {
  rng?: () => number;
  hideSeconds?: number;
  seekSeconds?: number;
}

/**
 * Server-authoritative state machine for one room:
 * lobby → hiding → seeking → roundEnd (→ lobby).
 * Pure logic, no I/O and no real clock: callers pass `now` (ms) into every
 * time-sensitive method and drive phase timeouts via tick(now).
 */
export class Room {
  readonly code: string;
  phase: Phase = 'lobby';
  round = 0;
  players: Player[] = [];
  phaseEndsAt: number | null = null;
  result: RoundResult | null = null;

  private rng: () => number;
  private hideMs: number;
  private seekMs: number;

  constructor(code: string, opts: RoomOptions = {}) {
    this.code = code;
    this.rng = opts.rng ?? Math.random;
    this.hideMs = (opts.hideSeconds ?? HIDE_SECONDS) * 1000;
    this.seekMs = (opts.seekSeconds ?? SEEK_SECONDS) * 1000;
  }

  // ---------- lobby ----------

  addPlayer(id: string, name: string): ActionResult {
    if (this.phase !== 'lobby') return fail('Round in progress — try again shortly');
    if (this.players.length >= MAX_PLAYERS) return fail('Room is full');
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!trimmed) return fail('Name is required');
    if (this.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return fail('That name is taken in this room');
    }
    this.players.push({
      id,
      name: trimmed,
      isHost: this.players.length === 0,
      connected: true,
      score: 0,
      role: null,
      alive: false,
      pos: [0, 0, 0],
      yaw: 0,
      pose: 'stand',
      strokes: [],
      nextTagAt: 0,
      strokeTimes: [],
    });
    return ok;
  }

  removePlayer(id: string, now: number): void {
    const player = this.players.find((p) => p.id === id);
    if (!player) return;
    this.players = this.players.filter((p) => p.id !== id);
    if (player.isHost && this.players.length > 0) this.players[0].isHost = true;
    if (this.phase === 'lobby' || this.phase === 'roundEnd') return;

    if (this.seekers().length === 0) {
      this.endRound('hiders', 'All seekers left the game', now);
    } else if (this.aliveHiders().length === 0) {
      this.endRound('seekers', 'Every hider was found or left', now);
    }
  }

  start(byId: string, now: number): ActionResult {
    const player = this.players.find((p) => p.id === byId);
    if (!player?.isHost) return fail('Only the host can start the round');
    if (this.phase !== 'lobby') return fail('Round already in progress');
    if (this.players.length < MIN_PLAYERS) return fail(`Need at least ${MIN_PLAYERS} players`);

    // Roughly 1 seeker per 4 hiders: 2-7 players → 1 seeker, 8-10 → 2.
    const seekerCount = Math.max(1, Math.round(this.players.length / 5));
    const shuffled = shuffle(this.players, this.rng);
    shuffled.forEach((p, i) => {
      p.role = i < seekerCount ? 'seeker' : 'hider';
      p.alive = true;
      p.strokes = [];
      p.strokeTimes = [];
      p.nextTagAt = 0;
      p.pose = 'stand';
      p.yaw = 0;
      if (p.role === 'seeker') {
        p.pos = [...MAP.seekerSpawn];
        // Spawn near the wall looking INTO the courtyard.
        p.yaw = Math.PI;
      } else {
        const angle = this.rng() * Math.PI * 2;
        const radius = this.rng() * MAP.hiderSpawnRadius;
        const [x, z] = resolveXZ(Math.cos(angle) * radius, Math.sin(angle) * radius);
        p.pos = [x, 0, z];
      }
    });
    this.round++;
    this.result = null;
    this.phase = 'hiding';
    this.phaseEndsAt = now + this.hideMs;
    return ok;
  }

  backToLobby(byId: string): ActionResult {
    const player = this.players.find((p) => p.id === byId);
    if (!player?.isHost) return fail('Only the host can do that');
    if (this.phase !== 'roundEnd') return fail('Round is not over yet');
    this.phase = 'lobby';
    this.phaseEndsAt = null;
    this.result = null;
    for (const p of this.players) {
      p.role = null;
      p.alive = false;
      p.strokes = [];
    }
    return ok;
  }

  // ---------- clock ----------

  /** Advance timed phases. Returns true if the phase changed. */
  tick(now: number): boolean {
    if (this.phaseEndsAt === null || now < this.phaseEndsAt) return false;
    if (this.phase === 'hiding') {
      this.phase = 'seeking';
      this.phaseEndsAt = now + this.seekMs;
      return true;
    }
    if (this.phase === 'seeking') {
      // Timer expired with hiders still standing — hiders win.
      this.endRound('hiders', 'Time ran out — someone stayed hidden!', now);
      return true;
    }
    return false;
  }

  // ---------- hiding phase ----------

  moveTo(id: string, pos: Vec3, yaw: number): ActionResult {
    const player = this.players.find((p) => p.id === id);
    if (!player || !player.alive) return fail('Not in this round');
    const mayMove =
      (this.phase === 'hiding' && player.role === 'hider') ||
      (this.phase === 'seeking' && player.role === 'seeker');
    // Hiders are frozen during seeking; seekers wait out the hiding phase.
    if (!mayMove) return fail('You cannot move right now');
    if (!Array.isArray(pos) || pos.length !== 3 || pos.some((n) => !Number.isFinite(n))) {
      return fail('Bad position');
    }
    // Out-of-bounds hiding is not a strategy: clamp into the playable
    // volume, and push out of solid props (nobody hides inside a crate).
    const b = MAP.bounds;
    const [x, z] = resolveXZ(clamp(pos[0], b.minX, b.maxX), clamp(pos[2], b.minZ, b.maxZ));
    player.pos = [clamp(x, b.minX, b.maxX), 0, clamp(z, b.minZ, b.maxZ)];
    player.yaw = Number.isFinite(yaw) ? yaw : 0;
    return ok;
  }

  setPose(id: string, pose: PoseId): ActionResult {
    const player = this.players.find((p) => p.id === id);
    if (!player || !player.alive || player.role !== 'hider') return fail('Not a hider');
    if (this.phase !== 'hiding') return fail('Poses lock when seeking starts');
    if (!POSES.includes(pose)) return fail('Unknown pose');
    player.pose = pose;
    return ok;
  }

  addStroke(id: string, stroke: PaintStroke, now: number): ActionResult {
    const player = this.players.find((p) => p.id === id);
    if (!player || !player.alive || player.role !== 'hider') return fail('Only hiders paint');
    if (this.phase !== 'hiding') return fail('Painting is over');
    if (player.strokes.length >= MAX_STROKES_PER_PLAYER) return fail('Stroke limit reached');

    // Rate limit: hand-painting is bursty but bounded; a bot streaming a
    // screen-capture conversion is not.
    player.strokeTimes = player.strokeTimes.filter((t) => now - t < STROKE_WINDOW_MS);
    if (player.strokeTimes.length >= STROKE_WINDOW_MAX) return fail('Painting too fast');

    const clean = sanitizeStroke(stroke);
    if (!clean) return fail('Bad stroke');
    player.strokes.push(clean);
    player.strokeTimes.push(now);
    return ok;
  }

  undoStroke(id: string): ActionResult {
    const player = this.players.find((p) => p.id === id);
    if (!player || player.role !== 'hider') return fail('Only hiders paint');
    if (this.phase !== 'hiding') return fail('Painting is over');
    if (player.strokes.length === 0) return fail('Nothing to undo');
    player.strokes.pop();
    return ok;
  }

  // ---------- seeking phase ----------

  tagAttempt(seekerId: string, targetId: string | null, now: number): TagResult {
    const seeker = this.players.find((p) => p.id === seekerId);
    if (!seeker || seeker.role !== 'seeker' || !seeker.alive) return fail('Only seekers tag');
    if (this.phase !== 'seeking') return fail('Not in the seeking phase');
    if (now < seeker.nextTagAt) return fail('Tag on cooldown');

    let hit = false;
    if (targetId) {
      const target = this.players.find((p) => p.id === targetId);
      if (target && target.role === 'hider' && target.alive) {
        hit = distance(seeker.pos, target.pos) <= TAG_RANGE;
        if (hit) target.alive = false;
      }
    }
    seeker.nextTagAt = now + (hit ? TAG_HIT_COOLDOWN_MS : TAG_MISS_COOLDOWN_MS);

    const hidersLeft = this.aliveHiders().length;
    if (hidersLeft === 0) this.endRound('seekers', 'Every hider was found', now);
    return { ok: true, hit, targetId: hit ? targetId : null, hidersLeft };
  }

  // ---------- snapshots ----------

  /** May `viewer` see `subject`'s live position/pose right now? */
  canSeePosition(viewerId: string, subjectId: string): boolean {
    if (this.phase === 'lobby') return false;
    if (viewerId === subjectId || this.phase === 'roundEnd') return true;
    const viewer = this.players.find((p) => p.id === viewerId);
    const subject = this.players.find((p) => p.id === subjectId);
    if (!viewer || !subject) return false;
    // Seekers never see the hiding phase: no map, no hiders painting.
    if (this.phase === 'hiding' && viewer.role === 'seeker' && subject.role === 'hider') {
      return false;
    }
    return true;
  }

  /** May `viewer` see `subject`'s paint strokes right now? */
  canSeePaint(viewerId: string, subjectId: string): boolean {
    return this.canSeePosition(viewerId, subjectId);
  }

  strokesOf(id: string): PaintStroke[] {
    return this.players.find((p) => p.id === id)?.strokes ?? [];
  }

  stateFor(playerId: string, now: number): RoomStateForPlayer {
    const me = this.players.find((p) => p.id === playerId);
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      players: this.players.map(
        (p): PublicPlayer => ({
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          score: p.score,
          role: this.phase === 'lobby' ? null : p.role,
          alive: p.alive,
          pos: this.canSeePosition(playerId, p.id) ? p.pos : null,
          yaw: p.yaw,
          pose: p.pose,
        })
      ),
      you: {
        id: playerId,
        role: me?.role ?? null,
        alive: me?.alive ?? false,
        nextTagAt: me?.nextTagAt ?? 0,
      },
      phaseEndsAt: this.phaseEndsAt,
      serverNow: now,
      result: this.result,
    };
  }

  // ---------- internals ----------

  seekers(): Player[] {
    return this.players.filter((p) => p.role === 'seeker');
  }

  aliveHiders(): Player[] {
    return this.players.filter((p) => p.role === 'hider' && p.alive);
  }

  private endRound(winner: 'seekers' | 'hiders', reason: string, _now: number): void {
    this.result = {
      winner,
      reason,
      survivors: this.aliveHiders().map((p) => p.id),
    };
    for (const p of this.players) {
      if (winner === 'seekers' && p.role === 'seeker') p.score += 3;
      if (winner === 'hiders' && p.role === 'hider' && p.alive) p.score += 2;
    }
    this.phase = 'roundEnd';
    this.phaseEndsAt = null;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sanitizeStroke(stroke: unknown): PaintStroke | null {
  if (typeof stroke !== 'object' || stroke === null) return null;
  const s = stroke as Record<string, unknown>;
  if (!Array.isArray(s.points) || s.points.length === 0) return null;
  if (typeof s.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.color)) return null;
  if (typeof s.size !== 'number' || !Number.isFinite(s.size)) return null;
  const points = s.points
    .slice(0, MAX_STROKE_POINTS)
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' &&
        Number.isFinite(p[0]) && Number.isFinite(p[1])
    )
    .map(([u, v]) => [clamp(u, 0, 1), clamp(v, 0, 1)] as [number, number]);
  if (points.length === 0) return null;
  return {
    points,
    color: s.color.toLowerCase(),
    size: clamp(s.size, 1, TEXTURE_SIZE / 4),
  };
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private opts: RoomOptions;

  constructor(opts: RoomOptions = {}) {
    this.opts = opts;
  }

  create(): Room {
    let code: string;
    do {
      code = Array.from(
        { length: 4 },
        () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]
      ).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this.opts);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  removeIfEmpty(room: Room): void {
    if (room.players.length === 0) this.rooms.delete(room.code);
  }
}
