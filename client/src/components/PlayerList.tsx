import type { RoomStateForPlayer } from '../../../shared/src';

interface Props {
  room: RoomStateForPlayer;
  onVote?: (targetId: string) => void;
  myVote?: string | null;
}

export function PlayerList({ room, onVote, myVote }: Props) {
  return (
    <ul className="players">
      {room.players.map((p) => (
        <li key={p.id} className={p.id === room.currentPainterId ? 'painting-now' : ''}>
          <span className="swatch" style={{ background: p.color }} />
          <span className="name">
            {p.name}
            {p.id === room.you.id && ' (you)'}
            {p.isHost && ' 👑'}
          </span>
          <span className="meta">
            {room.phase === 'voting' && p.hasVoted && '🗳️ '}
            {p.score > 0 && `${p.score} pts`}
          </span>
          {onVote && p.id !== room.you.id && (
            <button
              className={myVote === p.id ? 'vote voted' : 'vote'}
              onClick={() => onVote(p.id)}
            >
              {myVote === p.id ? 'Voted' : 'Vote'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
