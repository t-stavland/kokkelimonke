# Kokkelimonke

A bluffing party game — find the truth, fool your friends.

## Run it

```
npm install
npm start
```

Then open:
- `http://localhost:3000/host` on the TV/laptop everyone can see
- `http://localhost:3000/play` on each player's phone (or scan the QR code shown on the host screen)

## Structure

- `server/` — Express + Socket.io backend. All game logic and scoring lives in `server/roomManager.js`; tunable numbers (round count, timers, points) are in `server/config.js`. Room state is persisted to `data/rooms.json` so it survives a restart.
- `server/questions.json` — the question bank. Add more entries in the same `{category, question, answer}` shape.
- `public/` — plain HTML/CSS/JS frontend: `host/` (TV screen) and `play/` (player phones).

## Adding more questions

The starter bank has ~30 questions. For a full game night you'll want 100+ so nothing repeats — ask an LLM to generate more in the same JSON shape, and spot-check any it flags as unsure before adding them to `server/questions.json`.
