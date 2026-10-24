# Street Pong

Real-time 3D table tennis (Three.js) with accounts, ranked quick-match, CPU practice, knockout competitions and a leaderboard.

    npm install
    npm start          # http://localhost:3000   (PORT, DB_FILE, JWT_SECRET env vars)
    npm test           # physics sim + API/WebSocket end-to-end
    npm run test:ui    # drives the real UI in headless Chrome (needs Google Chrome)

## How it works
- `server/physics.js` – authoritative simulation (120 Hz) and rules; clients only send paddle position and "serve".
- `server/lobby.js` – WebSocket matchmaking, game sessions, reconnect grace (15 s), forfeits.
- `server/competitions.js` – single-elimination brackets (4/8/16, byes for partial fields), ready-up, 3-minute walkover.
- `server/ratings.js` – Elo (K=32, start 1000) for ranked and competition games; CPU games are unranked.
- Data lives in `data/street.db` (SQLite via `node:sqlite`, Node 22+).
