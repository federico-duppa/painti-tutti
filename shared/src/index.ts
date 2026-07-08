export type Phase = 'lobby' | 'painting' | 'voting' | 'guessing' | 'reveal';

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  score: number;
  hasVoted: boolean;
}

/** A single continuous brush stroke. Coordinates are normalized to 0..1. */
export interface Stroke {
  playerId: string;
  color: string;
  /** [x, y] pairs, 0..1 relative to the square canvas. */
  points: [number, number][];
}

export interface RevealInfo {
  impostorId: string;
  word: string;
  category: string;
  accusedId: string | null;
  impostorGuess: string | null;
  winner: 'painters' | 'impostor';
  reason: string;
}

/** Snapshot of a room as seen by one specific player. */
export interface RoomStateForPlayer {
  code: string;
  phase: Phase;
  players: PublicPlayer[];
  you: {
    id: string;
    isImpostor: boolean;
    /** Everyone sees the category. */
    category: string | null;
    /** null for the impostor until reveal. */
    word: string | null;
  };
  /** Player whose turn it is to paint, when phase === 'painting'. */
  currentPainterId: string | null;
  /** 1-based stroke turn counter, e.g. turn 3 of 8. */
  turnNumber: number | null;
  totalTurns: number | null;
  reveal: RevealInfo | null;
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
  'stroke:add': (payload: { points: [number, number][] }) => void;
  'turn:skip': () => void;
  'vote:cast': (payload: { targetId: string }) => void;
  'guess:submit': (payload: { word: string }) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomStateForPlayer) => void;
  'stroke:added': (stroke: Stroke) => void;
  'strokes:all': (strokes: Stroke[]) => void;
  'room:error': (message: string) => void;
}

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
export const STROKES_PER_PLAYER = 2;
export const MAX_NAME_LENGTH = 20;

export const PLAYER_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#bcf60c',
  '#008080',
  '#9a6324',
  '#800000',
  '#000075',
];
