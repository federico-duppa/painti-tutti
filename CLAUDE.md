# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Painti Tutti is a browser-based "paint hide & seek" party game (in the spirit of *A Fake Artist Goes to New York* / Mecha Chameleon), built for a weekly team-building hour. Players create a room and invite coworkers by sharing a link — no downloads, no registration, no database. Everyone secretly gets the same word except one **impostor** (who only sees the category). Players take turns adding one brush stroke each to a shared canvas (2 turns per player), then vote on who the impostor is. If caught, the impostor can steal the win by guessing the word.

## Commands

```sh
npm install            # install all workspaces
npm run dev            # dev mode: server on :3001 (tsx watch) + Vite client on :5173
npm test               # run the game-engine tests (Vitest, in server/)
npm run test:watch -w server            # watch mode
npx vitest run -t "tied vote" --root server   # run a single test by name
npm run typecheck      # tsc --noEmit for server and client
npm run build          # build client (Vite) then server (tsc)
npm start              # production: node serves API + built client on :3001
```

During development open the **Vite** URL (`:5173`); it proxies `/socket.io` to the game server. In production the Express server serves `client/dist` itself, so one process hosts everything.

## Architecture

npm workspaces, TypeScript everywhere, ESM throughout:

- **`shared/src/index.ts`** — the single source of truth for the Socket.IO protocol: `ClientToServerEvents`, `ServerToClientEvents`, `RoomStateForPlayer`, `Stroke`, phases, and game constants (`MIN_PLAYERS`, `STROKES_PER_PLAYER`, player colors). Both sides import it **by relative path** (not as a built package) — the server's tsconfig sets `rootDir: ".."` and includes `../shared` so `tsc`, `tsx`, and Vitest all consume the same sources with no build step for `shared`.
- **`server/src/room.ts`** — the whole game is here. `Room` is a server-authoritative state machine (`lobby → painting → voting → guessing → reveal`) with **no I/O**: methods take a player id and return `{ok} | {ok:false, error}`. This is what the tests in `server/test/room.test.ts` exercise directly. `RoomManager` holds rooms in memory (rooms die with the process — intentional, sessions are ephemeral).
- **`server/src/index.ts`** — thin Socket.IO layer. Maps events to `Room` methods; on success re-broadcasts state, on failure emits `room:error` to the actor only. The socket id doubles as the player id.
- **`server/src/words.ts`** — the word list. Server-only on purpose: shipping it to the browser would let the impostor shortlist words in devtools.
- **`client/src/App.tsx`** — holds the two pieces of client state (latest `RoomStateForPlayer` snapshot, accumulated strokes) and picks the screen from `phase`. Routing is just `location.pathname`: `/room/CODE` prefills the join screen for shared invite links; there is no router library.

## Design invariants

- **The server is authoritative and per-player state is filtered server-side.** Clients never receive secrets they shouldn't render: `Room.stateFor(playerId)` builds a personalized snapshot (impostor gets `word: null`), and the socket layer emits it per socket — never broadcast one state object to the room.
- **Full-snapshot sync, except strokes.** Every accepted action re-sends the whole `RoomStateForPlayer` (small, simple, no diffing). Strokes are the exception: appended via `stroke:added` events and re-sent in full via `strokes:all` on join, because they grow.
- **Canvas coordinates are normalized 0..1** (square canvas), so every screen size renders identical paintings. The server clamps/sanitizes incoming points (`sanitizePoints`) — never trust raw stroke payloads.
- **Turn order** is one shuffle repeated `STROKES_PER_PLAYER` times. Mid-game disconnects rewrite `turnOrder` and adjust `turnIndex` by the removed player's already-played turns — see `Room.removePlayer`, which also handles impostor-left and not-enough-players endings.
- The client locks the canvas immediately after sending a stroke (`sentAtTurn` in `GameView`) rather than waiting for the server round-trip.

## Testing

Engine logic is tested headlessly by constructing `Room` with a deterministic `rng` (constructor parameter) — no sockets involved. If you change game rules, extend `server/test/room.test.ts`. For UI changes, verify with a real multi-page browser run (Playwright with three pages covering create → join-via-link → paint → vote → guess → reveal); there is no committed e2e suite yet.
