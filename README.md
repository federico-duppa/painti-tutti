# 🎨 Painti Tutti

A browser-based **paint-to-camouflage hide & seek** game for teams — play
together in a weekly fun hour, straight from the browser. No downloads, no
registration.

## How it works

1. Someone creates a room and shares the link (`/room/CODE`) — teammates join
   with just a name, or enter the code on the home page. 2–10 players.
2. Each round splits players into **seekers** 🔍 and **hiders** 🫥
   (about 1 seeker per 4 hiders).
3. **Hiding phase (~75s):** hiders spawn as blank white figures in a colorful
   courtyard. Walk anywhere, then **paint your own body** to match your
   surroundings — brush, adjustable size, undo, and an eyedropper that samples
   any color you see in the scene. Lock one of five poses (stand, crouch, sit,
   lie flat, arms up). Seekers can't watch.
4. **Seeking phase (~4min):** hiders freeze; seekers hunt in first person and
   click a figure to tag it. Wrong guesses cost a long cooldown — don't
   spray-click the walls.
5. Seekers win by finding everyone. Hiders win if **anyone** survives the clock.

A good disguise is paint × position × pose: a perfect paint job in the open
still gets found, and a lazy one pressed against a busy mural might just work.

## Running it

```sh
npm install
npm run dev      # development: open http://localhost:5173
```

```sh
npm run build
npm start        # production: one server on http://localhost:3001
```

Rooms live in memory — restarting the server clears them. Round lengths can be
tuned with `HIDE_SECONDS` / `SEEK_SECONDS` env vars.

## Development

See [CLAUDE.md](./CLAUDE.md) for architecture notes. Engine tests: `npm test`.
