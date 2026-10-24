import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp, Button, Spin } from 'antd';
import { api, tokenStore, setUnauthorizedHandler } from './api';
import { net } from './net';
import { AppCtx } from './ctx';
import { useHash } from './hooks';
import { scene, voice } from './game/instances';
import { sfx } from './game/audio';
import AuthPage from './pages/AuthPage';
import Shell from './components/Shell';
import HomePage from './pages/HomePage';
import CompetitionsPage from './pages/CompetitionsPage';
import CompetitionPage from './pages/CompetitionPage';
import LeaderboardPage from './pages/LeaderboardPage';
import JoinPage from './pages/JoinPage';
import GameView from './components/GameView';
import { SearchingModal, ResultModal, ProfileModal } from './components/Modals';
import PlayerEditor from './components/PlayerEditor';

export default function App() {
  const { message, notification } = AntApp.useApp();
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(() => !!tokenStore.get());
  const [connected, setConnected] = useState(false);
  const [lobby, setLobby] = useState({ online: 0, playing: 0, queued: 0 });
  const [game, setGame] = useState(null);
  const gameRef = useRef(null);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState(null);
  const [profile, setProfile] = useState(null);
  const [editor, setEditor] = useState(null); // null | 'edit' | 'welcome'
  const [muted, setMutedState] = useState(false);
  const hash = useHash();

  const logout = useCallback(() => {
    tokenStore.set(null); net.close(); voice.leave(false);
    gameRef.current = null; setGame(null); setSearching(false); setResult(null); setUser(null); setConnected(false);
    location.hash = '#/';
  }, []);

  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);

  // Restore the session on page load.
  useEffect(() => {
    if (!tokenStore.get()) return;
    api('/auth/me').then((r) => setUser(r.user)).catch(() => tokenStore.set(null)).finally(() => setBooting(false));
  }, []);

  useEffect(() => { voice.onError = (m) => message.warning(m); }, [message]);

  // Websocket lifecycle + app-level messages.
  useEffect(() => {
    if (!user) return;
    setConnected(net.connected);
    net.connect();
    const onOver = (m) => {
      const g = gameRef.current;
      if (g && m.gid && g.gid !== m.gid) return; // stale
      gameRef.current = null; setGame(null); voice.leave(false); voice.setForced(false);
      setResult({ ...m, players: g?.players || [], level: g?.level });
      if (m.you >= 0) api('/auth/me').then((r) => setUser(r.user)).catch(() => {});
    };
    const offs = [
      net.on('_status', (s) => setConnected(s.connected)),
      net.on('_authfail', logout),
      net.on('hello', (m) => setLobby({ online: m.online, playing: m.playing, queued: m.queued })),
      net.on('lobby', (m) => setLobby({ online: m.online, playing: m.playing, queued: m.queued })),
      net.on('err', (m) => message.error(m.msg)),
      net.on('queued', () => setSearching(true)),
      net.on('unqueued', () => setSearching(false)),
      net.on('start', (m) => { setSearching(false); setResult(null); gameRef.current = m; setGame(m); }),
      net.on('over', onOver),
      net.on('unwatched', () => { gameRef.current = null; setGame(null); }),
      net.on('comp_match', (m) => {
        const key = `match-${m.matchId}`;
        sfx.point(true);
        notification.success({
          key, message: 'Your match is ready!', description: `“${m.name}” — head to the bracket and press Ready.`, duration: 20, placement: 'topRight',
          actions: <Button type="primary" size="small" onClick={() => { location.hash = `#/competition/${m.compId}`; notification.destroy(key); }}>Go to bracket</Button>,
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [user?.id, logout, message, notification]);

  const toggleSound = () => { sfx.enabled = !sfx.enabled; setMutedState(!sfx.enabled); };
  const ctx = useMemo(() => ({ user, setUser, connected, lobby, openProfile: setProfile, openEditor: (mode = 'edit') => setEditor(mode), logout, soundOff: muted, toggleSound }), [user, connected, lobby, logout, muted]);

  if (booting) return <div className="center-fill"><Spin size="large" /></div>;
  if (!user) return <AppCtx.Provider value={ctx}><AuthPage onAuth={(token, u, isNew) => { tokenStore.set(token); setUser(u); if (isNew) setEditor('welcome'); if (!location.hash.startsWith('#/join/')) location.hash = '#/'; }} /></AppCtx.Provider>;

  const [, route, arg] = hash.split('/');
  let page;
  if (route === 'competitions') page = <CompetitionsPage />;
  else if (route === 'competition' && Number(arg)) page = <CompetitionPage key={arg} id={Number(arg)} />;
  else if (route === 'leaderboard') page = <LeaderboardPage />;
  else if (route === 'join' && arg) page = <JoinPage code={arg} />;
  else page = <HomePage />;

  return (
    <AppCtx.Provider value={ctx}>
      {game ? <GameView key={game.gid} game={game} /> : <Shell route={route || 'home'}>{page}</Shell>}
      <SearchingModal open={searching} />
      <ResultModal result={result} onClose={() => setResult(null)} />
      <ProfileModal username={profile} onClose={() => setProfile(null)} />
      {user && <PlayerEditor open={!!editor} welcome={editor === 'welcome'} onClose={() => setEditor(null)} />}
    </AppCtx.Provider>
  );
}
