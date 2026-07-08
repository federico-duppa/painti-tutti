import { useEffect, useState } from 'react';
import type { RoomStateForPlayer, Stroke } from '../../shared/src';
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
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    socket.on('room:state', setRoom);
    socket.on('strokes:all', setStrokes);
    socket.on('stroke:added', (stroke) => setStrokes((prev) => [...prev, stroke]));
    socket.on('room:error', setError);
    socket.on('disconnect', () => {
      setRoom(null);
      setStrokes([]);
      setError('Connection lost — refresh to rejoin.');
    });
    return () => {
      socket.off('room:state', setRoom);
      socket.off('strokes:all', setStrokes);
      socket.removeAllListeners('stroke:added');
      socket.off('room:error', setError);
      socket.removeAllListeners('disconnect');
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  // Strokes reset when a new round starts.
  useEffect(() => {
    if (room?.phase === 'painting' && room.turnNumber === 1) setStrokes([]);
  }, [room?.phase, room?.turnNumber]);

  const onJoined = (code: string) => {
    window.history.pushState({}, '', `/room/${code}`);
  };

  let screen;
  if (!room) {
    screen = <Home urlCode={codeFromUrl()} onJoined={onJoined} onError={setError} />;
  } else if (room.phase === 'lobby') {
    screen = <Lobby room={room} />;
  } else {
    screen = <GameView room={room} strokes={strokes} />;
  }

  return (
    <div className="app">
      <header>
        <h1>🎨 Painti Tutti</h1>
        {room && <span className="room-code">Room {room.code}</span>}
      </header>
      {error && <div className="toast">{error}</div>}
      {screen}
    </div>
  );
}
