# Kokkelimonke

A bluffing party game — find the truth, fool your friends. Everyone plays from their own phone, including whoever hosts.

## Run it

```
npm install
npm start
```

Then open `http://localhost:3000` on any phone. Tap "Host a New Game" to get a room code + QR code, or "Join a Game" to enter one someone else made.

## How a game runs

Whoever hosts also plays like everyone else — the only host-only power is tapping "Start Game" once enough people have joined (and "Play Again" on the final screen). After that, every round runs itself: writing → voting → an auto-playing reveal → a scoreboard pause → the next round, all paced server-side with no one needing to click through it.

## Structure

- `server/` — Express + Socket.io backend. All game logic and scoring lives in `server/roomManager.js`; tunable numbers (round count, timers, points) are in `server/config.js`. Room state is persisted to `data/rooms.json` so it survives a restart.
- `server/questions.json` — the question bank. Add more entries in the same `{category, question, answer}` shape.
- `public/` — plain HTML/CSS/JS frontend: one page (`index.html` + `app.js`) for both hosting and playing.

## Adding more questions

For a full game night you'll want 100+ questions so nothing repeats — ask an LLM to generate more in the same JSON shape, and spot-check any it flags as unsure before adding them to `server/questions.json`.
