# Street Pong

Real-time 3D table tennis with accounts, ranked quick-match, CPU practice, knockout competitions with invite codes, a leaderboard, live spectating, text chat and voice rooms.

    backend/    Express + WebSocket + MongoDB game server (deploy this)
    frontend/   static site: HTML/CSS/ES modules + vendored Three.js (no build step)

## Run locally
    cd backend
    npm install
    cp .env.example .env     # set MONGODB_URI (and JWT_SECRET)
    npm start                # http://localhost:3000 — the backend also serves ../frontend in dev

Tests (from `backend/`): `npm test` (physics sim + API/WebSocket e2e), `npm run test:ui` and `npm run test:voice` (headless Chrome; need Google Chrome). Each run uses a throw-away MongoDB database (`MONGODB_TEST_URL` to change the server).

## Deploy
**Backend** (any Node ≥ 22 host with WebSocket support — Render, Railway, Fly, a VPS; `render.yaml` and `backend/Dockerfile` are included):
1. Create a MongoDB (e.g. Atlas) and set `MONGODB_URI`.
2. Set `JWT_SECRET` (long random string), `TRUST_PROXY=1`, and `CORS_ORIGIN` = your frontend's origin if it's hosted separately.
3. Start command `npm start` (or `node src/index.js`), health check `GET /health`.

**Frontend**: upload the `frontend/` folder to any static host, after setting the backend URL in `frontend/js/config.js`:

    export const API_URL = 'https://your-backend.example.com';

Or skip the separate host: copy `frontend/` next to `backend/` (as in this repo) and the backend serves it from the same origin, leaving `API_URL` empty.

Voice chat needs HTTPS (browser microphone rule). For players behind strict NATs add a TURN server via `ICE_SERVERS`.

## How it works
- `backend/src/physics.js` – authoritative simulation (120 Hz) and rules; clients only send paddle position and "serve".
- `backend/src/lobby.js` – WebSocket matchmaking, game sessions, spectators, chat, voice signalling, reconnect grace (15 s), forfeits.
- `backend/src/competitions.js` – single-elimination brackets (4/8/16, byes for partial fields), invite codes, ready-up, 3-minute walkover.
- `backend/src/ratings.js` – Elo (K=32, start 1000) for ranked and competition games; CPU games are unranked.
- MongoDB collections: `users`, `matches`, `competitions` (players embedded), `competition_matches`, `counters`. Ids stay numeric (atomic counter). No replica set needed: state transitions are single-document atomic updates.
- Audience & voice: any live ranked/competition game can be watched (max 50); each game has a voice room (max 8, WebRTC mesh, signalling over the game socket). Mic optional.
- Chat & moderation: players + audience can text chat (200 chars, rate-limited). In competition games the competition creator is the host (★) and can **Mute all**: chat is blocked server-side, microphones are switched off and locked client-side.
