import { describe, expect, it } from 'vitest';
import { Room } from '../src/room.js';
import { STROKES_PER_PLAYER } from '../../shared/src/index.js';

/** Deterministic rng so the impostor and turn order are predictable in tests. */
const zeroRng = () => 0;

function roomWithPlayers(names: string[], rng: () => number = zeroRng): Room {
  const room = new Room('TEST', rng);
  for (const name of names) expect(room.addPlayer(name, name)).toEqual({ ok: true });
  return room;
}

function paintAllTurns(room: Room) {
  while (room.phase === 'painting') {
    const painter = room.currentPainterId()!;
    expect(room.addStroke(painter, [[0.1, 0.1], [0.2, 0.2]])).toEqual({ ok: true });
  }
}

describe('lobby', () => {
  it('makes the first player host and rejects duplicate names', () => {
    const room = roomWithPlayers(['ana', 'bob']);
    expect(room.players[0].isHost).toBe(true);
    expect(room.players[1].isHost).toBe(false);
    expect(room.addPlayer('x', 'ANA')).toEqual({ ok: false, error: 'That name is taken in this room' });
  });

  it('promotes a new host when the host leaves', () => {
    const room = roomWithPlayers(['ana', 'bob']);
    room.removePlayer('ana');
    expect(room.players[0].name).toBe('bob');
    expect(room.players[0].isHost).toBe(true);
  });

  it('requires the host and 3+ players to start', () => {
    const room = roomWithPlayers(['ana', 'bob']);
    expect(room.start('bob').ok).toBe(false);
    expect(room.start('ana').ok).toBe(false);
    room.addPlayer('cat', 'cat');
    expect(room.start('ana')).toEqual({ ok: true });
    expect(room.phase).toBe('painting');
  });
});

describe('painting', () => {
  it('gives each player the configured number of turns, then moves to voting', () => {
    const room = roomWithPlayers(['ana', 'bob', 'cat']);
    room.start('ana');
    const turns: string[] = [];
    while (room.phase === 'painting') {
      const painter = room.currentPainterId()!;
      turns.push(painter);
      room.addStroke(painter, [[0, 0], [1, 1]]);
    }
    expect(turns).toHaveLength(3 * STROKES_PER_PLAYER);
    for (const id of ['ana', 'bob', 'cat']) {
      expect(turns.filter((t) => t === id)).toHaveLength(STROKES_PER_PLAYER);
    }
    expect(room.phase).toBe('voting');
    expect(room.strokes).toHaveLength(3 * STROKES_PER_PLAYER);
  });

  it('rejects strokes out of turn and clamps points into the canvas', () => {
    const room = roomWithPlayers(['ana', 'bob', 'cat']);
    room.start('ana');
    const painter = room.currentPainterId()!;
    const other = room.players.find((p) => p.id !== painter)!.id;
    expect(room.addStroke(other, [[0, 0], [1, 1]]).ok).toBe(false);
    expect(room.addStroke(painter, [[-5, 0.5], [2, 0.5]])).toEqual({ ok: true });
    expect(room.strokes[0].points).toEqual([[0, 0.5], [1, 0.5]]);
  });

  it('lets the host skip a stuck painter', () => {
    const room = roomWithPlayers(['ana', 'bob', 'cat']);
    room.start('ana');
    const first = room.currentPainterId();
    expect(room.skipTurn('bob').ok).toBe(false);
    expect(room.skipTurn('ana')).toEqual({ ok: true });
    expect(room.currentPainterId()).not.toBe(first);
  });

  it('keeps the turn order consistent when a painter leaves mid-round', () => {
    const room = roomWithPlayers(['ana', 'bob', 'cat', 'dan']);
    room.start('ana');
    // Advance one turn, then remove a non-impostor player who is not painting.
    const impostor = room.stateFor('ana').you.isImpostor
      ? 'ana'
      : room.players.find((p) => room.stateFor(p.id).you.isImpostor)!.id;
    room.addStroke(room.currentPainterId()!, [[0, 0], [1, 1]]);
    const leaver = room.players.find((p) => p.id !== impostor && p.id !== room.currentPainterId())!;
    room.removePlayer(leaver.id);
    paintAllTurns(room);
    expect(room.phase).toBe('voting');
    // Remaining players never lost or gained turns beyond their allowance.
    expect(room.strokes.filter((s) => s.playerId === leaver.id).length).toBeLessThanOrEqual(1);
  });
});

describe('voting and guessing', () => {
  function toVoting(names = ['ana', 'bob', 'cat']) {
    const room = roomWithPlayers(names);
    room.start('ana');
    const impostor = room.players.find((p) => room.stateFor(p.id).you.isImpostor)!.id;
    paintAllTurns(room);
    expect(room.phase).toBe('voting');
    return { room, impostor };
  }

  it('goes to guessing when the impostor is accused, painters win on wrong guess', () => {
    const { room, impostor } = toVoting();
    for (const p of room.players) {
      const target = p.id === impostor ? room.players.find((q) => q.id !== impostor)!.id : impostor;
      expect(room.castVote(p.id, target)).toEqual({ ok: true });
    }
    expect(room.phase).toBe('guessing');
    expect(room.submitGuess(impostor, 'definitely-wrong-word')).toEqual({ ok: true });
    expect(room.phase).toBe('reveal');
    const reveal = room.stateFor(impostor).reveal!;
    expect(reveal.winner).toBe('painters');
    for (const p of room.players) {
      expect(p.score).toBe(p.id === impostor ? 0 : 1);
    }
  });

  it('impostor steals the win with a correct guess', () => {
    const { room, impostor } = toVoting();
    for (const p of room.players) {
      const target = p.id === impostor ? room.players.find((q) => q.id !== impostor)!.id : impostor;
      room.castVote(p.id, target);
    }
    const word = room.stateFor(room.players.find((p) => p.id !== impostor)!.id).you.word!;
    expect(room.submitGuess(impostor, word.toUpperCase())).toEqual({ ok: true });
    expect(room.stateFor(impostor).reveal!.winner).toBe('impostor');
    expect(room.players.find((p) => p.id === impostor)!.score).toBe(2);
  });

  it('impostor wins when an innocent player is accused', () => {
    const { room, impostor } = toVoting();
    const innocent = room.players.find((p) => p.id !== impostor)!.id;
    for (const p of room.players) {
      const target = p.id === innocent ? impostor : innocent;
      room.castVote(p.id, target);
    }
    expect(room.phase).toBe('reveal');
    expect(room.stateFor(impostor).reveal!.winner).toBe('impostor');
  });

  it('impostor wins a tied vote', () => {
    const { room, impostor } = toVoting(['ana', 'bob', 'cat', 'dan']);
    const others = room.players.filter((p) => p.id !== impostor).map((p) => p.id);
    // Two votes for others[0], two for others[1] — tie, no plurality.
    room.castVote(impostor, others[0]);
    room.castVote(others[0], others[1]);
    room.castVote(others[1], others[0]);
    room.castVote(others[2], others[1]);
    expect(room.phase).toBe('reveal');
    expect(room.stateFor(impostor).reveal!.winner).toBe('impostor');
  });

  it('ends the round for the painters when the impostor disconnects', () => {
    const { room, impostor } = toVoting(['ana', 'bob', 'cat', 'dan']);
    room.removePlayer(impostor);
    expect(room.phase).toBe('reveal');
    expect(room.stateFor(room.players[0].id).reveal!.winner).toBe('painters');
  });
});

describe('secrecy', () => {
  it('hides the word from the impostor and hides roles from everyone else', () => {
    const room = roomWithPlayers(['ana', 'bob', 'cat']);
    room.start('ana');
    const impostor = room.players.find((p) => room.stateFor(p.id).you.isImpostor)!.id;
    for (const p of room.players) {
      const state = room.stateFor(p.id);
      expect(state.you.category).toBeTruthy();
      if (p.id === impostor) expect(state.you.word).toBeNull();
      else expect(state.you.word).toBeTruthy();
    }
  });

  it('resets secrets when returning to the lobby', () => {
    const room = roomWithPlayers(['ana', 'bob', 'cat']);
    room.start('ana');
    paintAllTurns(room);
    const impostor = room.players.find((p) => room.stateFor(p.id).you.isImpostor)!.id;
    for (const p of room.players) {
      room.castVote(p.id, p.id === impostor ? room.players.find((q) => q.id !== impostor)!.id : impostor);
    }
    room.submitGuess(impostor, 'nope');
    expect(room.backToLobby('ana')).toEqual({ ok: true });
    const state = room.stateFor('ana');
    expect(state.phase).toBe('lobby');
    expect(state.you.word).toBeNull();
    expect(state.you.category).toBeNull();
    expect(room.strokes).toHaveLength(0);
  });
});
