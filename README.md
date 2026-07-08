# 🎨 Painti Tutti

A browser-based **paint hide & seek** party game for teams — play together in a
weekly fun hour, straight from the browser. No downloads, no registration.

## How it works

1. Someone creates a room and shares the link (`/room/CODE`) — teammates join
   with just a name, or enter the code on the home page.
2. Everyone secretly receives the same word… except one **impostor**, who only
   sees the category.
3. In turns, each player adds **one brush stroke** to the shared canvas
   (two turns each). Paint enough to prove you know the word — but not so much
   that the impostor figures it out!
4. Everyone votes on who the impostor is (talk it out on your team call).
5. If caught, the impostor gets one chance to steal the win by guessing the word.

3–12 players per room.

## Running it

```sh
npm install
npm run dev      # development: open http://localhost:5173
```

```sh
npm run build
npm start        # production: one server on http://localhost:3001
```

Rooms live in memory — restarting the server clears them.

## Development

See [CLAUDE.md](./CLAUDE.md) for architecture notes. Tests: `npm test`.
