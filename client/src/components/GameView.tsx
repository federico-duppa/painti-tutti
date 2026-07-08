import { useEffect, useState, type FormEvent } from 'react';
import type { RoomStateForPlayer, Stroke } from '../../../shared/src';
import { socket } from '../socket';
import { Canvas } from './Canvas';
import { PlayerList } from './PlayerList';

export function GameView({ room, strokes }: { room: RoomStateForPlayer; strokes: Stroke[] }) {
  const me = room.players.find((p) => p.id === room.you.id);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [guess, setGuess] = useState('');
  // Lock the canvas as soon as a stroke is sent, until the server advances
  // the turn — otherwise a quick second stroke would be rejected noisily.
  const [sentAtTurn, setSentAtTurn] = useState<number | null>(null);

  useEffect(() => {
    if (room.phase !== 'voting') setMyVote(null);
  }, [room.phase]);

  const isMyTurn =
    room.phase === 'painting' &&
    room.currentPainterId === room.you.id &&
    sentAtTurn !== room.turnNumber;
  const painter = room.players.find((p) => p.id === room.currentPainterId);

  const vote = (targetId: string) => {
    setMyVote(targetId);
    socket.emit('vote:cast', { targetId });
  };

  const submitGuess = (e: FormEvent) => {
    e.preventDefault();
    if (guess.trim()) socket.emit('guess:submit', { word: guess });
  };

  return (
    <main className="game">
      <div className="word-banner">
        {room.you.isImpostor ? (
          <>🕵️ You are the <strong>impostor</strong>! Category: <strong>{room.you.category}</strong>. Blend in…</>
        ) : (
          <>Category: <strong>{room.you.category}</strong> — word: <strong>{room.you.word}</strong> 🤫</>
        )}
      </div>

      {room.phase === 'painting' && (
        <div className="status">
          {isMyTurn ? (
            <strong>Your turn — draw ONE stroke!</strong>
          ) : (
            <>🖌️ {painter?.name ?? '…'} is painting</>
          )}
          <span className="turn-count">
            turn {room.turnNumber}/{room.totalTurns}
          </span>
          {me?.isHost && !isMyTurn && (
            <button className="small" onClick={() => socket.emit('turn:skip')}>
              Skip turn
            </button>
          )}
        </div>
      )}

      {room.phase === 'voting' && (
        <div className="status">
          <strong>🗳️ Who is the impostor?</strong> Discuss, then vote below.
        </div>
      )}

      {room.phase === 'guessing' && (
        <div className="status">
          {room.you.isImpostor ? (
            <form onSubmit={submitGuess} className="entry-row">
              <strong>You've been caught! Guess the word to steal the win:</strong>
              <input value={guess} autoFocus onChange={(e) => setGuess(e.target.value)} />
              <button type="submit">Guess</button>
            </form>
          ) : (
            <>😱 The impostor was caught — but they get one guess at the word…</>
          )}
        </div>
      )}

      {room.phase === 'reveal' && room.reveal && (
        <div className="reveal">
          <h2>{room.reveal.winner === 'painters' ? '🎨 Painters win!' : '🕵️ The impostor wins!'}</h2>
          <p>
            <strong>{room.players.find((p) => p.id === room.reveal!.impostorId)?.name ?? 'The impostor'}</strong>{' '}
            was the impostor. The word was <strong>{room.reveal.word}</strong> ({room.reveal.category}).
          </p>
          {room.reveal.impostorGuess && <p>Their guess: “{room.reveal.impostorGuess}”</p>}
          <p className="hint">{room.reveal.reason}</p>
          {me?.isHost ? (
            <button className="primary" onClick={() => socket.emit('game:again')}>
              Back to lobby
            </button>
          ) : (
            <p className="hint">Waiting for the host to start the next round…</p>
          )}
        </div>
      )}

      <Canvas
        strokes={strokes}
        canDraw={isMyTurn}
        myColor={me?.color ?? '#000'}
        onStroke={(points) => {
          setSentAtTurn(room.turnNumber);
          socket.emit('stroke:add', { points });
        }}
      />

      <PlayerList
        room={room}
        onVote={room.phase === 'voting' ? vote : undefined}
        myVote={myVote}
      />
    </main>
  );
}
