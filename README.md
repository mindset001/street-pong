# Street Pong

Real-time 3D table tennis with accounts, ranked quick-match, CPU practice, knockout competitions with invite codes, a leaderboard, live spectating, text chat and voice rooms.

    backend/    Express + WebSocket + MongoDB game server (deploy this)
    frontend/   React + Ant Design + Three.js, built with Vite (static output in frontend/dist)

## Run locally
    # terminal 1 – backend
    cd backend && npm install && cp .env.example .env    # set MONGODB_URI (and JWT_SECRET)
    npm start                                             # http://localhost:3000

    # terminal 2 – frontend (hot reload; /api and /ws are proxied to the backend)
    cd frontend && npm install && npm run dev             # http://localhost:5173

Or build once and let the backend serve it: `cd frontend && npm run build:local`, then open http://localhost:3000.

Tests (from `backend/`, after `npm run build:local` in `frontend/`): `npm test` (physics sim + API/WebSocket e2e), `npm run test:ui` and `npm run test:voice` (headless Chrome; need Google Chrome). Each run uses a throw-away MongoDB database (`MONGODB_TEST_URL` to change the server).

## Deploy
**Backend** (any Node ≥ 22 host with WebSocket support — Render, Railway, Fly, a VPS; `render.yaml` and `backend/Dockerfile` are included):
1. Create a MongoDB (e.g. Atlas) and set `MONGODB_URI`.
2. Set `JWT_SECRET` (long random string), `TRUST_PROXY=1`, and `CORS_ORIGIN` = your frontend's origin(s), comma-separated.
3. Start command `npm start` (or `node src/index.js`), health check `GET /health`.

**Frontend** (Vercel/Netlify/Cloudflare Pages): root directory `frontend`, build command `npm run build`, output directory `dist`. The backend URL is baked in at build time from `VITE_API_URL` (`frontend/.env.production` is committed with the current one; override it in the host's env settings if the backend moves). Routing is hash-based, so no rewrite rules are needed.

Voice chat needs HTTPS (browser microphone rule). For players behind strict NATs add a TURN server via `ICE_SERVERS`.

## How it works
- `backend/src/physics.js` – authoritative simulation (120 Hz) and rules; clients only send paddle position and "serve".
- `backend/src/lobby.js` – WebSocket matchmaking, game sessions, spectators, chat, voice signalling, reconnect grace (15 s), forfeits.
- `backend/src/competitions.js` – single-elimination brackets (4/8/16, byes for partial fields), invite codes, ready-up, 3-minute walkover.
- `backend/src/ratings.js` – Elo (K=32, start 1000) for ranked and competition games; CPU games are unranked.
- MongoDB collections: `users`, `matches`, `competitions` (players embedded), `competition_matches`, `counters`. Ids stay numeric (atomic counter). No replica set needed: state transitions are single-document atomic updates.
- Audience & voice: any live ranked/competition game can be watched (max 50); each game has a voice room (max 8, WebRTC mesh, signalling over the game socket). Mic optional.
- UI: Ant Design (dark theme) — modals/confirm dialogs/notifications for pop-ups, `Spin`/button `loading` states while data or the game server is loading, `Input.Password` (eye toggle) for passwords. The 3D scene, audio and voice code are plain modules in `frontend/src/game/`.
- Players: each account has an avatar emoji, accent colour and paddle colour (whitelisted on the server, `PUT /api/auth/player`); new accounts are prompted to set them up. Both players are shown in a "VS" intro, on the scoreboard, in the bracket/leaderboard, and the paddle colours are used in the 3D scene. Each player also has a customisable 3D character (skin, hair style/colour, shirt, shorts, accessory; `frontend/src/game/character.js`, procedural low-poly, no asset files) that holds the paddle in matches — the arm follows the paddle with a 2-bone IK — with a rotating live preview in the editor. CPU opponents have names: Pixel (easy), Rally (medium), Titan (hard).
- Chat & moderation: players + audience can text chat (200 chars, rate-limited). In competition games the competition creator is the host (★) and can **Mute all**: chat is blocked server-side, microphones are switched off and locked client-side.
