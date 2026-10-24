# Street Pong

Real-time 3D table tennis (Three.js) with accounts, ranked quick-match, CPU practice, knockout competitions and a leaderboard.

    npm install
    npm start          # http://localhost:3000   (PORT, DB_FILE, JWT_SECRET env vars)
    npm test           # physics sim + API/WebSocket end-to-end
    npm run test:ui    # drives the real UI in headless Chrome (needs Google Chrome)
    npm run test:voice # two Chrome instances spectate a game and talk over WebRTC (fake mic)

## How it works
- `server/physics.js` – authoritative simulation (120 Hz) and rules; clients only send paddle position and "serve".
- `server/lobby.js` – WebSocket matchmaking, game sessions, reconnect grace (15 s), forfeits.
- `server/competitions.js` – single-elimination brackets (4/8/16, byes for partial fields), ready-up, 3-minute walkover.
- `server/ratings.js` – Elo (K=32, start 1000) for ranked and competition games; CPU games are unranked.
- Data lives in `data/street.db` (SQLite via `node:sqlite`, Node 22+).

## Audience & voice
- Any live ranked/competition game can be watched from "Live now" on the home page or the bracket's Watch button (max 50 spectators per game).
- Each game has a voice room (max 8) shared by its players and audience: WebRTC mesh, signalling relayed over the game WebSocket. Mic is optional (listen-only otherwise).
- Browsers only allow the microphone on HTTPS (or localhost). For users behind strict NATs set `ICE_SERVERS` to a JSON array that includes a TURN server; the default is Google's public STUN.

## Chat & moderation
- Everyone in a game's room (players + audience) can text chat: Enter opens the chat box, Esc closes it. Messages are plain text, max 200 chars, rate-limited, last 50 kept for late joiners (not stored in the DB).
- In competition games the competition's creator is the host (★). Hosts get a **Mute all** button: chat from everyone else is rejected by the server, and every other client's microphone is switched off and locked. Voice muting is enforced by the clients (voice is peer-to-peer), chat muting by the server. Quick matches have no host.
