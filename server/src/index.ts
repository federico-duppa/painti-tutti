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
  // Stroke bursts are small; default limits are fine. Textures can never be
  // uploaded — the protocol simply has no event for them.
});

// In production the server serves the built client so one process hosts everything.
const clientDist = path.resolve(__dirname, '../../../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run `npm run build` or use `npm run dev`.');
  });
});

// Env overrides make automated playtests practical (short rounds).
const rooms = new RoomManager({
  hideSeconds: process.env.HIDE_SECONDS ? Number(process.env.HIDE_SECONDS) : undefined,
  seekSeconds: process.env.SEEK_SECONDS ? Number(process.env.SEEK_SECONDS) : undefined,
});

interface SocketData {
  room: Room | null;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function socketOf(playerId: string) {
  return io.sockets.sockets.get(playerId);
}

function broadcastState(room: Room) {
  const now = Date.now();
  for (const player of room.players) {
    socketOf(player.id)?.emit('room:state', room.stateFor(player.id, now));
  }
}

/** Send every paint job `viewer` is allowed to see (used on phase changes). */
function sendVisiblePaint(room: Room, viewerId: string) {
  const payload = room.players
    .filter((p) => p.role === 'hider' && room.canSeePaint(viewerId, p.id))
    .map((p) => ({ playerId: p.id, strokes: room.strokesOf(p.id) }));
  socketOf(viewerId)?.emit('paint:all', payload);
}

function act(socket: GameSocket, room: Room | null, action: () => ActionResult) {
  if (!room) {
    socket.emit('room:error', 'You are not in a room');
    return false;
  }
  const res = action();
  if (!res.ok) {
    socket.emit('room:error', res.error);
    return false;
  }
  return true;
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
    broadcastState(room);
  });

  socket.on('room:join', ({ code, name }, ack) => {
    if (socket.data.room) return ack({ ok: false, error: 'Already in a room' });
    const room = rooms.get(String(code ?? ''));
    if (!room) return ack({ ok: false, error: 'Room not found' });
    const res = room.addPlayer(socket.id, String(name ?? ''));
    if (!res.ok) return ack(res);
    socket.data.room = room;
    ack({ ok: true });
    broadcastState(room);
  });

  socket.on('game:start', () => {
    const room = socket.data.room;
    if (act(socket, room, () => room!.start(socket.id, Date.now()))) {
      broadcastState(room!);
      for (const p of room!.players) sendVisiblePaint(room!, p.id);
    }
  });

  socket.on('game:again', () => {
    const room = socket.data.room;
    if (act(socket, room, () => room!.backToLobby(socket.id))) broadcastState(room!);
  });

  socket.on('move:update', ({ pos, yaw }) => {
    const room = socket.data.room;
    if (!room) return;
    const res = room.moveTo(socket.id, pos, Number(yaw));
    if (!res.ok) return; // movement is high-frequency; drop silently
    const me = room.players.find((p) => p.id === socket.id)!;
    for (const p of room.players) {
      if (p.id !== socket.id && room.canSeePosition(p.id, socket.id)) {
        socketOf(p.id)?.emit('player:moved', { id: me.id, pos: me.pos, yaw: me.yaw, pose: me.pose });
      }
    }
  });

  socket.on('pose:set', ({ pose }) => {
    const room = socket.data.room;
    if (act(socket, room, () => room!.setPose(socket.id, pose))) {
      const me = room!.players.find((p) => p.id === socket.id)!;
      for (const p of room!.players) {
        if (room!.canSeePosition(p.id, socket.id)) {
          socketOf(p.id)?.emit('player:moved', { id: me.id, pos: me.pos, yaw: me.yaw, pose: me.pose });
        }
      }
    }
  });

  socket.on('paint:stroke', ({ stroke }) => {
    const room = socket.data.room;
    if (!room) return socket.emit('room:error', 'You are not in a room');
    const res = room.addStroke(socket.id, stroke, Date.now());
    if (!res.ok) return socket.emit('room:error', res.error);
    const stored = room.strokesOf(socket.id).at(-1)!;
    for (const p of room.players) {
      if (room.canSeePaint(p.id, socket.id)) {
        socketOf(p.id)?.emit('paint:stroke', { playerId: socket.id, stroke: stored });
      }
    }
  });

  socket.on('paint:undo', () => {
    const room = socket.data.room;
    if (act(socket, room, () => room!.undoStroke(socket.id))) {
      for (const p of room!.players) {
        if (room!.canSeePaint(p.id, socket.id)) {
          socketOf(p.id)?.emit('paint:undo', { playerId: socket.id });
        }
      }
    }
  });

  socket.on('tag:attempt', ({ targetId }) => {
    const room = socket.data.room;
    if (!room) return socket.emit('room:error', 'You are not in a room');
    const res = room.tagAttempt(socket.id, targetId ? String(targetId) : null, Date.now());
    if (!res.ok) return socket.emit('room:error', res.error);
    for (const p of room.players) {
      socketOf(p.id)?.emit('tag:result', {
        seekerId: socket.id,
        targetId: res.targetId,
        hit: res.hit,
        hidersLeft: res.hidersLeft,
      });
    }
    broadcastState(room); // cooldowns, eliminations, possible round end
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;
    room.removePlayer(socket.id, Date.now());
    rooms.removeIfEmpty(room);
    broadcastState(room);
  });
});

// Drive phase timers: hiding → seeking → (timeout) hiders win.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.all()) {
    if (room.tick(now)) {
      broadcastState(room);
      // Entering `seeking` reveals hider paint/positions to seekers.
      if (room.phase === 'seeking') {
        for (const p of room.players) sendVisiblePaint(room, p.id);
      }
    }
  }
}, 300);

httpServer.listen(PORT, () => {
  console.log(`painti-tutti server listening on http://localhost:${PORT}`);
});
