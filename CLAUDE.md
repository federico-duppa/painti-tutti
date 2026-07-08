# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Painti Tutti is a browser-based **paint-to-camouflage hide & seek** game (multiplayer, 3D, rooms via join link — no downloads, no registration, no database), built for a weekly team-building hour. Each round, players split into **seekers** and **hiders** (~1 seeker per 4 hiders). Hiders spawn as blank white humanoids in a detail-dense courtyard and get a timed hiding phase to walk anywhere, **paint their own body** (brush + eyedropper that samples rendered scene colors), and lock one of five preset poses. Then hiders freeze and seekers hunt in first person, clicking figures to tag them; wrong guesses cost a long cooldown. Seekers win by finding everyone; hiders win if anyone survives the clock.

The design property that matters: a good disguise = paint accuracy × position × pose — the seeker's uncertainty ("is that a crate or a person?") is the product. Never add UI that highlights hiders to seekers.

## Commands

```sh
npm install            # install all workspaces
npm run dev            # dev mode: server on :3001 (tsx watch) + Vite client on :5173
npm test               # run the game-engine tests (Vitest, in server/)
npx vitest run -t "tag" --root server   # run tests matching a name
npm run typecheck      # tsc --noEmit for server and client
npm run build          # build client (Vite) then server (tsc)
npm start              # production: node serves API + built client on :3001
HIDE_SECONDS=15 SEEK_SECONDS=30 npm start   # short rounds (automated playtests)
```

During development open the **Vite** URL (`:5173`); it proxies `/socket.io` to the game server. In production the Express server serves `client/dist` itself, so one process hosts everything.

## Architecture

npm workspaces, TypeScript everywhere, ESM throughout. Both sides import `shared` **by relative path** (not as a built package) — the server's tsconfig sets `rootDir: ".."` and includes `../shared`, so `tsc`, `tsx`, and Vitest all consume the same sources with no build step for `shared`.

- **`shared/src/index.ts`** — the Socket.IO protocol: events, `RoomStateForPlayer`, `PaintStroke`, phases (`lobby → hiding → seeking → roundEnd`), and the gameplay constants (timers, tag range/cooldowns, stroke rate limits).
- **`shared/src/map.ts`** — the hand-authored courtyard as data: playable bounds, spawns, prop footprints (pillars/crates/hedges), plus `resolveXZ` collision used by BOTH server (authoritative) and client (prediction) so nobody can stand or hide inside solid geometry. Also the `seed` for all procedural textures.
- **`server/src/room.ts`** — the whole game engine. `Room` is a server-authoritative state machine with **no I/O and no real clock**: every time-sensitive method takes `now` (ms), and `tick(now)` drives phase timeouts. Methods return `{ok} | {ok:false, error}`. Tests exercise this class directly with a deterministic `rng` and fake timestamps.
- **`server/src/index.ts`** — thin Socket.IO layer. Maps events to `Room` methods, broadcasts per-player-filtered snapshots on success, emits `room:error` to the actor on failure, and runs one `setInterval` that ticks all rooms' phase timers. The socket id doubles as the player id. Rooms live in memory and die with the process (intentional).
- **`client/src/three/GameScene.ts`** — owns the three.js world and ALL pointer/keyboard interaction (orbit-paint mode, first-person seeker mode with pointer lock, spectate). React mounts it once per game and feeds it state; gameplay flows back via callbacks.
- **`client/src/three/humanoid.ts`** — the paintable player model: box rig sharing one 512² canvas-texture atlas (one UV cell per body part), preset pose tables, stroke painting/undo/preview.
- **`client/src/three/map3d.ts`** — builds courtyard visuals from `shared/src/map.ts` with procedural canvas textures seeded by `MAP.seed`, so every client renders pixel-identical surfaces (hiders eyedrop those pixels!). Keep surfaces detail-dense — camouflage needs busy pixels; a flat wall makes every hider findable.
- **`client/src/components/GameView.tsx`** — socket↔scene glue plus all HUD overlays (toolbar, countdowns, seeker blackout during hiding, round-end results).

## Design invariants

- **The server is authoritative; per-player state is filtered server-side.** `Room.stateFor(playerId, now)` + `canSeePosition`/`canSeePaint` decide what each viewer may know: seekers receive NEITHER positions NOR paint of hiders during the hiding phase (`pos: null`), not just a client-side blackout. Never broadcast one state object to the room.
- **Paint exists only as UV-space stroke events** (`paint:stroke`), validated, size-capped and **rate-limited** server-side (`STROKE_WINDOW_*`). There is deliberately no texture-upload path — that's the anti-cheat against auto-painting from screen captures. Keep it that way.
- **Movement is clamped into `MAP.bounds` and pushed out of `PROP_BOXES` on the server** (`resolveXZ`); the client runs the same function for prediction only. Hiders are frozen during seeking (server rejects moves). A hider inside a prop would be untaggable — that's why collision is not optional.
- **Wrong tags must hurt**: misses (including environment clicks) cost `TAG_MISS_COOLDOWN_MS` vs the short hit cooldown, so spray-clicking every wall is not a strategy.
- **Full-snapshot sync, except high-frequency events**: strokes (`paint:stroke`/`paint:all`) and movement (`player:moved`, ~10 Hz, visibility-filtered per viewer) are incremental; everything else re-sends the whole snapshot.
- Timers come from `HIDE_SECONDS`/`SEEK_SECONDS` (env-overridable) — automated playtests rely on short rounds.

## Testing

Engine logic is tested headlessly (`server/test/room.test.ts`): construct `Room` with `{rng, hideSeconds, seekSeconds}`, pass explicit `now` values, drive phases via `tick`. If you change game rules, extend these tests.

For client/gameplay changes, run the real thing: build, start with short timers, and drive 4 browser pages with Playwright (`playwright-core` + the preinstalled Chromium). Gotchas learned the hard way: disable `Element.prototype.requestPointerLock` in automation (otherwise the first click captures the pointer and later synthetic clicks tag at screen center while mouse moves spin the camera); `window.__gameScene` is exposed for test introspection (project a hider's torso to screen pixels to aim tags).
