import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/src';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Same origin: Vite proxies /socket.io to the game server in dev,
// and the game server serves the built client in production.
export const socket: GameSocket = io({ autoConnect: true });
