import { useEffect, useState } from 'react';
import type { RoomStateForPlayer } from '../../shared/src';
import { socket } from './socket';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { GameView } from './components/GameView';

function codeFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})/);
  return match ? match[1].toUpperCase() : null;
}

export function App() {
  const [room, setRoom] = useState<RoomStateForPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onDisconnect = () => {
      setRoom(null);
      setError('Connection lost — refresh to rejoin.');
    };
    socket.on('room:state', setRoom);
    socket.on('room:error', setError);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('room:state', setRoom);
      socket.off('room:error', setError);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const onJoined = (code: string) => {
    window.history.pushState({}, '', `/room/${code}`);
  };

  const inGame = room && room.phase !== 'lobby';

  return (
    <div className={inGame ? 'app app-game' : 'app'}>
      <header>
        <h1>🎨 Painti Tutti</h1>
        {room && <span className="room-code">Room {room.code}</span>}
      </header>
      {error && <div className="toast">{error}</div>}
      {!room && <Home urlCode={codeFromUrl()} onJoined={onJoined} onError={setError} />}
      {room && room.phase === 'lobby' && <Lobby room={room} />}
      {inGame && <GameView room={room} />}
    </div>
  );
}
