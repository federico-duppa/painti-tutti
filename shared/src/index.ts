export type Phase = 'lobby' | 'hiding' | 'seeking' | 'roundEnd';
export type Role = 'seeker' | 'hider';
export type PoseId = 'stand' | 'crouch' | 'sit' | 'lie' | 'armsUp';

export const POSES: PoseId[] = ['stand', 'crouch', 'sit', 'lie', 'armsUp'];

export type Vec3 = [number, number, number];

/**
 * One brush stroke on a hider's own body, in the UV space (0..1) of their
 * 512x512 body texture atlas. Paint exists ONLY as stroke events — there is
 * deliberately no way to upload a texture, so disguises must be hand-made
 * in-session.
 */
export interface PaintStroke {
  points: [number, number][];
  /** #rrggbb */
  color: string;
  /** brush diameter in texels */
  size: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  score: number;
  /** null while in the lobby (roles are assigned at round start) */
  role: Role | null;
  alive: boolean;
  /** null when this viewer is not allowed to see the player's position */
  pos: Vec3 | null;
  yaw: number;
  pose: PoseId;
}

export interface RoundResult {
  winner: 'seekers' | 'hiders';
  reason: string;
  /** ids of hiders still alive at round end */
  survivors: string[];
}

/** Snapshot of a room as seen by one specific player. */
export interface RoomStateForPlayer {
  code: string;
  phase: Phase;
  round: number;
  players: PublicPlayer[];
  you: {
    id: string;
    role: Role | null;
    alive: boolean;
    /** server timestamp (ms) before which this seeker cannot tag again */
    nextTagAt: number;
  };
  /** server timestamp (ms) when the current phase ends, if timed */
  phaseEndsAt: number | null;
  /** server clock at snapshot time, for client countdown offset */
  serverNow: number;
  result: RoundResult | null;
}

export interface ClientToServerEvents {
  'room:create': (
    payload: { name: string },
    ack: (res: { ok: true; code: string } | { ok: false; error: string }) => void
  ) => void;
  'room:join': (
    payload: { code: string; name: string },
    ack: (res: { ok: true } | { ok: false; error: string }) => void
  ) => void;
  'game:start': () => void;
  'game:again': () => void;
  'move:update': (payload: { pos: Vec3; yaw: number }) => void;
  'pose:set': (payload: { pose: PoseId }) => void;
  'paint:stroke': (payload: { stroke: PaintStroke }) => void;
  'paint:undo': () => void;
  /** targetId null = shot into the environment (still costs cooldown) */
  'tag:attempt': (payload: { targetId: string | null }) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomStateForPlayer) => void;
  'player:moved': (payload: { id: string; pos: Vec3; yaw: number; pose: PoseId }) => void;
  'paint:stroke': (payload: { playerId: string; stroke: PaintStroke }) => void;
  'paint:undo': (payload: { playerId: string }) => void;
  'paint:all': (payload: { playerId: string; strokes: PaintStroke[] }[]) => void;
  'tag:result': (payload: {
    seekerId: string;
    targetId: string | null;
    hit: boolean;
    hidersLeft: number;
  }) => void;
  'room:error': (message: string) => void;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

/** Phase durations (seconds). The server can override via env for testing. */
export const HIDE_SECONDS = 75;
export const SEEK_SECONDS = 240;

export const TEXTURE_SIZE = 512;
export const MAX_STROKE_POINTS = 300;
export const MAX_STROKES_PER_PLAYER = 1500;
/** stroke-event rate limit: at most this many strokes per rolling window */
export const STROKE_WINDOW_MS = 5000;
export const STROKE_WINDOW_MAX = 60;

export const TAG_RANGE = 9;
export const TAG_HIT_COOLDOWN_MS = 1200;
/** wrong guesses hurt: spamming clicks at every wall must not be optimal */
export const TAG_MISS_COOLDOWN_MS = 4000;

export const MAX_NAME_LENGTH = 20;
