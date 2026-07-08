import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  STROKES_PER_PLAYER,
  type Phase,
  type PublicPlayer,
  type RevealInfo,
  type RoomStateForPlayer,
  type Stroke,
} from '../../shared/src/index.js';
import { randomWordCard, type WordCard } from './words.js';

interface Player {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  score: number;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

/**
 * Server-authoritative state machine for one room. Pure logic, no I/O:
 * the socket layer calls methods and broadcasts snapshots after any
 * method returns ok.
 */
export class Room {
  readonly code: string;
  phase: Phase = 'lobby';
  players: Player[] = [];
  strokes: Stroke[] = [];

  private card: WordCard | null = null;
  private impostorId: string | null = null;
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private votes = new Map<string, string>();
  private reveal: RevealInfo | null = null;
  private rng: () => number;

  constructor(code: string, rng: () => number = Math.random) {
    this.code = code;
    this.rng = rng;
  }

  addPlayer(id: string, name: string): ActionResult {
    if (this.phase !== 'lobby') return fail('Game already in progress');
    if (this.players.length >= MAX_PLAYERS) return fail('Room is full');
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) return fail('Name is required');
    if (this.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return fail('That name is taken in this room');
    }
    const usedColors = new Set(this.players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];
    this.players.push({
      id,
      name: trimmed,
      color,
      isHost: this.players.length === 0,
      connected: true,
      score: 0,
    });
    return ok;
  }

  removePlayer(id: string): void {
    const player = this.players.find((p) => p.id === id);
    if (!player) return;
    this.players = this.players.filter((p) => p.id !== id);
    if (player.isHost && this.players.length > 0) this.players[0].isHost = true;
    if (this.phase === 'lobby' || this.phase === 'reveal') return;

    if (this.players.length < MIN_PLAYERS) {
      this.abortRound('Not enough players left — round cancelled');
      return;
    }
    if (id === this.impostorId) {
      this.finishRound(null, null, 'painters', 'The impostor left the game');
      return;
    }
    if (this.phase === 'painting') {
      const removedBeforeCurrent = this.turnOrder
        .slice(0, this.turnIndex)
        .filter((pid) => pid === id).length;
      this.turnOrder = this.turnOrder.filter((pid) => pid !== id);
      this.turnIndex -= removedBeforeCurrent;
      if (this.turnIndex >= this.turnOrder.length) this.startVoting();
    } else if (this.phase === 'voting') {
      this.votes.delete(id);
      // Votes for the departed player are void — those voters vote again.
      for (const [voter, target] of this.votes) {
        if (target === id) this.votes.delete(voter);
      }
      this.maybeFinishVoting();
    } else if (this.phase === 'guessing') {
      // Guesser was not the impostor (handled above) — nothing to do.
    }
  }

  start(byId: string): ActionResult {
    const player = this.players.find((p) => p.id === byId);
    if (!player?.isHost) return fail('Only the host can start the game');
    if (this.phase !== 'lobby' && this.phase !== 'reveal') return fail('Game already in progress');
    if (this.players.length < MIN_PLAYERS) return fail(`Need at least ${MIN_PLAYERS} players`);

    this.card = randomWordCard(this.rng);
    this.impostorId = this.players[Math.floor(this.rng() * this.players.length)].id;
    const ids = this.players.map((p) => p.id);
    const shuffled = shuffle(ids, this.rng);
    this.turnOrder = [];
    for (let round = 0; round < STROKES_PER_PLAYER; round++) this.turnOrder.push(...shuffled);
    this.turnIndex = 0;
    this.strokes = [];
    this.votes.clear();
    this.reveal = null;
    this.phase = 'painting';
    return ok;
  }

  backToLobby(byId: string): ActionResult {
    const player = this.players.find((p) => p.id === byId);
    if (!player?.isHost) return fail('Only the host can do that');
    if (this.phase !== 'reveal') return fail('Round is not over yet');
    this.phase = 'lobby';
    this.strokes = [];
    this.card = null;
    this.impostorId = null;
    this.reveal = null;
    return ok;
  }

  currentPainterId(): string | null {
    if (this.phase !== 'painting') return null;
    return this.turnOrder[this.turnIndex] ?? null;
  }

  addStroke(playerId: string, points: [number, number][]): ActionResult {
    if (this.phase !== 'painting') return fail('Not in the painting phase');
    if (this.currentPainterId() !== playerId) return fail('Not your turn');
    const clean = sanitizePoints(points);
    if (clean.length < 2) return fail('Stroke is too short');
    const player = this.players.find((p) => p.id === playerId)!;
    this.strokes.push({ playerId, color: player.color, points: clean });
    this.advanceTurn();
    return ok;
  }

  skipTurn(byId: string): ActionResult {
    const player = this.players.find((p) => p.id === byId);
    if (!player?.isHost) return fail('Only the host can skip a turn');
    if (this.phase !== 'painting') return fail('Not in the painting phase');
    this.advanceTurn();
    return ok;
  }

  castVote(voterId: string, targetId: string): ActionResult {
    if (this.phase !== 'voting') return fail('Not in the voting phase');
    if (!this.players.some((p) => p.id === voterId)) return fail('You are not in this game');
    if (!this.players.some((p) => p.id === targetId)) return fail('Unknown player');
    if (voterId === targetId) return fail('You cannot vote for yourself');
    this.votes.set(voterId, targetId);
    this.maybeFinishVoting();
    return ok;
  }

  submitGuess(playerId: string, word: string): ActionResult {
    if (this.phase !== 'guessing') return fail('Not in the guessing phase');
    if (playerId !== this.impostorId) return fail('Only the impostor can guess');
    const guess = word.trim();
    if (!guess) return fail('Guess is required');
    const correct = guess.toLowerCase() === this.card!.word.toLowerCase();
    if (correct) {
      this.finishRound(this.impostorId, guess, 'impostor', 'Caught, but guessed the word!');
    } else {
      this.finishRound(this.impostorId, guess, 'painters', 'Caught, and the guess was wrong');
    }
    return ok;
  }

  /** Build the state snapshot as seen by one player. */
  stateFor(playerId: string): RoomStateForPlayer {
    const isImpostor = playerId === this.impostorId;
    const inRound = this.phase !== 'lobby';
    return {
      code: this.code,
      phase: this.phase,
      players: this.players.map((p): PublicPlayer => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isHost: p.isHost,
        connected: p.connected,
        score: p.score,
        hasVoted: this.votes.has(p.id),
      })),
      you: {
        id: playerId,
        isImpostor: inRound && isImpostor,
        category: inRound ? this.card?.category ?? null : null,
        word: inRound && !isImpostor ? this.card?.word ?? null : null,
      },
      currentPainterId: this.currentPainterId(),
      turnNumber: this.phase === 'painting' ? this.turnIndex + 1 : null,
      totalTurns: this.phase === 'painting' ? this.turnOrder.length : null,
      reveal: this.reveal,
    };
  }

  private advanceTurn(): void {
    this.turnIndex++;
    if (this.turnIndex >= this.turnOrder.length) this.startVoting();
  }

  private startVoting(): void {
    this.phase = 'voting';
    this.votes.clear();
  }

  private maybeFinishVoting(): void {
    if (this.phase !== 'voting') return;
    if (this.votes.size < this.players.length) return;

    const tally = new Map<string, number>();
    for (const target of this.votes.values()) {
      tally.set(target, (tally.get(target) ?? 0) + 1);
    }
    let top: string[] = [];
    let max = 0;
    for (const [target, count] of tally) {
      if (count > max) {
        max = count;
        top = [target];
      } else if (count === max) {
        top.push(target);
      }
    }
    const accused = top.length === 1 ? top[0] : null;
    if (accused === this.impostorId) {
      // Caught — but the impostor gets one shot at guessing the word.
      this.phase = 'guessing';
    } else if (accused === null) {
      this.finishRound(null, null, 'impostor', 'The vote was tied — the impostor slipped away');
    } else {
      this.finishRound(accused, null, 'impostor', 'The painters accused an innocent artist');
    }
  }

  private finishRound(
    accusedId: string | null,
    impostorGuess: string | null,
    winner: 'painters' | 'impostor',
    reason: string
  ): void {
    this.reveal = {
      impostorId: this.impostorId!,
      word: this.card!.word,
      category: this.card!.category,
      accusedId,
      impostorGuess,
      winner,
      reason,
    };
    for (const p of this.players) {
      if (winner === 'impostor' && p.id === this.impostorId) p.score += 2;
      if (winner === 'painters' && p.id !== this.impostorId) p.score += 1;
    }
    this.phase = 'reveal';
    this.votes.clear();
  }

  private abortRound(reason: string): void {
    if (this.card) {
      this.reveal = {
        impostorId: this.impostorId ?? '',
        word: this.card.word,
        category: this.card.category,
        accusedId: null,
        impostorGuess: null,
        winner: 'painters',
        reason,
      };
    }
    this.phase = 'reveal';
    this.votes.clear();
  }
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sanitizePoints(points: unknown): [number, number][] {
  if (!Array.isArray(points)) return [];
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return points
    .slice(0, 2000)
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' &&
        Number.isFinite(p[0]) && Number.isFinite(p[1])
    )
    .map(([x, y]) => [clamp(x), clamp(y)] as [number, number]);
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  private rooms = new Map<string, Room>();

  create(): Room {
    let code: string;
    do {
      code = Array.from(
        { length: 4 },
        () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]
      ).join('');
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  removeIfEmpty(room: Room): void {
    if (room.players.length === 0) this.rooms.delete(room.code);
  }
}
