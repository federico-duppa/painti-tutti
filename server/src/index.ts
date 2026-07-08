import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/src/index.js';
import { Room, RoomManager, type ActionResult } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  // Same-origin in production; the Vite dev server proxies /socket.io in dev.
  cors: { origin: true },
});

// In production the server serves the built client so one process hosts everything.
const clientDist = path.resolve(__dirname, '../../../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run `npm run build` or use `npm run dev`.');
  });
});

const rooms = new RoomManager();

interface SocketData {
  room: Room | null;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function broadcast(room: Room) {
  for (const player of room.players) {
    io.sockets.sockets.get(player.id)?.emit('room:state', room.stateFor(player.id));
  }
}

/** Run a game action; on success broadcast the new state, on failure tell only the actor. */
function act(socket: GameSocket, room: Room | null, result: () => ActionResult) {
  if (!room) {
    socket.emit('room:error', 'You are not in a room');
    return;
  }
  const res = result();
  if (res.ok) broadcast(room);
  else socket.emit('room:error', res.error);
}

io.on('connection', (socket: GameSocket) => {
  socket.data.room = null;

  socket.on('room:create', ({ name }, ack) => {
    if (socket.data.room) return ack({ ok: false, error: 'Already in a room' });
    const room = rooms.create();
    const res = room.addPlayer(socket.id, String(name ?? ''));
    if (!res.ok) {
      rooms.removeIfEmpty(room);
      return ack(res);
    }
    socket.data.room = room;
    ack({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('room:join', ({ code, name }, ack) => {
    if (socket.data.room) return ack({ ok: false, error: 'Already in a room' });
    const room = rooms.get(String(code ?? ''));
    if (!room) return ack({ ok: false, error: 'Room not found' });
    const res = room.addPlayer(socket.id, String(name ?? ''));
    if (!res.ok) return ack(res);
    socket.data.room = room;
    ack({ ok: true });
    socket.emit('strokes:all', room.strokes);
    broadcast(room);
  });

  socket.on('game:start', () => {
    const room = socket.data.room;
    act(socket, room, () => room!.start(socket.id));
    if (room?.phase === 'painting') io.to([...room.players.map((p) => p.id)]).emit('strokes:all', []);
  });

  socket.on('game:again', () => {
    act(socket, socket.data.room, () => socket.data.room!.backToLobby(socket.id));
  });

  socket.on('stroke:add', ({ points }) => {
    const room = socket.data.room;
    if (!room) return socket.emit('room:error', 'You are not in a room');
    const res = room.addStroke(socket.id, points);
    if (!res.ok) return socket.emit('room:error', res.error);
    const stroke = room.strokes[room.strokes.length - 1];
    for (const player of room.players) {
      io.sockets.sockets.get(player.id)?.emit('stroke:added', stroke);
    }
    broadcast(room);
  });

  socket.on('turn:skip', () => {
    act(socket, socket.data.room, () => socket.data.room!.skipTurn(socket.id));
  });

  socket.on('vote:cast', ({ targetId }) => {
    act(socket, socket.data.room, () => socket.data.room!.castVote(socket.id, String(targetId ?? '')));
  });

  socket.on('guess:submit', ({ word }) => {
    act(socket, socket.data.room, () => socket.data.room!.submitGuess(socket.id, String(word ?? '')));
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;
    room.removePlayer(socket.id);
    rooms.removeIfEmpty(room);
    broadcast(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`painti-tutti server listening on http://localhost:${PORT}`);
});
