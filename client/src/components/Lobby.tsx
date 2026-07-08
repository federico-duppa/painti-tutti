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
            : 'Start round'}
        </button>
      ) : (
        <p className="hint">Waiting for the host to start the round…</p>
      )}

      <details className="rules">
        <summary>How to play</summary>
        <ol>
          <li>Players are split into <strong>seekers</strong> 🔍 and <strong>hiders</strong> 🫥 (about 1 seeker per 4 hiders).</li>
          <li>Hiders spawn as blank white figures in a colorful courtyard. During the hiding phase, walk anywhere, <strong>paint your own body</strong> to match your surroundings (the eyedropper samples any color in the scene), and lock a pose.</li>
          <li>Seekers can't watch the hiding phase. When it ends, hiders freeze and seekers hunt in first person.</li>
          <li>Seekers click a figure to tag it — but wrong guesses cost a long cooldown, so don't spray-click the walls.</li>
          <li>Seekers win by finding everyone; hiders win if <strong>anyone</strong> survives the clock.</li>
        </ol>
      </details>
    </main>
  );
}
