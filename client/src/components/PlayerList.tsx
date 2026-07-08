import type { RoomStateForPlayer } from '../../../shared/src';

export function PlayerList({ room }: { room: RoomStateForPlayer }) {
  const inRound = room.phase !== 'lobby';
  return (
    <ul className="players">
      {room.players.map((p) => (
        <li key={p.id}>
          <span className="name">
            {p.name}
            {p.id === room.you.id && ' (you)'}
            {p.isHost && ' 👑'}
          </span>
          <span className="meta">
            {inRound && p.role === 'seeker' && '🔍 seeker'}
            {inRound && p.role === 'hider' && (p.alive ? '🫥 hiding' : '❌ found')}
            {p.score > 0 && ` · ${p.score} pts`}
          </span>
        </li>
      ))}
    </ul>
  );
}
