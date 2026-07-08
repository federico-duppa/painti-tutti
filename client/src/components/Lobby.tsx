import { useState } from 'react';
import { MIN_PLAYERS, type RoomStateForPlayer } from '../../../shared/src';
import { socket } from '../socket';
import { PlayerList } from './PlayerList';

export function Lobby({ room }: { room: RoomStateForPlayer }) {
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === room.you.id);
  const shareUrl = `${window.location.origin}/room/${room.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard can be unavailable (http, permissions) — the URL is shown as text anyway.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="lobby">
      <section className="share">
        <p>Invite your team — share this link:</p>
        <div className="share-row">
          <code>{shareUrl}</code>
          <button onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
        </div>
      </section>

      <PlayerList room={room} />

      {me?.isHost ? (
        <button
          className="primary"
          disabled={room.players.length < MIN_PLAYERS}
          onClick={() => socket.emit('game:start')}
        >
          {room.players.length < MIN_PLAYERS
            ? `Waiting for players (${room.players.length}/${MIN_PLAYERS} minimum)`
            : 'Start game'}
        </button>
      ) : (
        <p className="hint">Waiting for the host to start the game…</p>
      )}

      <details className="rules">
        <summary>How to play</summary>
        <ol>
          <li>Everyone secretly receives the same word — except one <strong>impostor</strong>, who only sees the category.</li>
          <li>In turns, each player adds <strong>one brush stroke</strong> to the shared canvas (two turns each).</li>
          <li>Paint enough to prove you know the word, but not so much that the impostor figures it out!</li>
          <li>After painting, everyone votes on who the impostor is. Talk it out on your call!</li>
          <li>If caught, the impostor can still steal the win by guessing the word.</li>
        </ol>
      </details>
    </main>
  );
}
