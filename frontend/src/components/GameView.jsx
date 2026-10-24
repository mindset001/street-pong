import React, { useEffect, useRef, useState } from 'react';
import { App as AntApp, Button, Spin } from 'antd';
import { net } from '../net';
import { scene, voice } from '../game/instances';
import { sfx } from '../game/audio';
import Chat from './Chat';
import VoicePanel from './VoicePanel';
import PlayerAvatar from './PlayerAvatar';

export default function GameView({ game }) {
  const { modal } = AntApp.useApp();
  const you = game.you, spectator = you < 0;
  const names = game.players.map((p) => p.username);
  const [score, setScore] = useState(game.score || [0, 0]);
  const [serving, setServing] = useState(-1);
  const [msg, setMsg] = useState({ text: spectator ? `Watching ${names[0]} vs ${names[1]}` : 'Get ready…', sub: '' });
  const [live, setLive] = useState(false); // false until the first snapshot arrives -> loader
  const [intro, setIntro] = useState(!game.resume); // "who's playing" splash

  useEffect(() => {
    scene.setMode(spectator ? 'watch' : 'game', you); scene.reset();
    scene.setPaddleColors(game.players.map((p) => p.paddle));
    scene.setCharacters(game.players.map((p) => p.char));
    const introTimer = setTimeout(() => setIntro(false), 2800);
    document.body.classList.add('playing'); sfx.unlock();
    if (!game.resume) voice.leave(true);
    voice.forced = !!game.muted && !game.host;

    const seen = { sc: '', sv: -2, st: '' };
    const offSnap = net.on('s', (s) => {
      scene.applySnapshot(s);
      setLive(true);
      const sc = s.sc.join(',');
      if (sc !== seen.sc) { seen.sc = sc; setScore(s.sc); }
      if (s.sv !== seen.sv) { seen.sv = s.sv; setServing(s.sv); }
      for (const e of s.ev || []) {
        if (e.e === 'hit') sfx.hit(); else if (e.e === 'bounce') sfx.bounce(); else if (e.e === 'net') sfx.net();
        else if (e.e === 'point') {
          sfx.point(spectator || e.p === you);
          setMsg({ text: spectator ? `Point: ${names[e.p]}` : e.p === you ? 'Point!' : 'Point to opponent', sub: '' });
        }
      }
      if (s.st !== seen.st) {
        seen.st = s.st;
        if (s.st === 'serve') setMsg(spectator ? { text: `${names[s.sv]} serving`, sub: '' } : s.sv === you ? { text: 'Your serve', sub: 'Click or press Space' } : { text: 'Opponent serving', sub: '' });
        else if (s.st === 'rally') setMsg({ text: '', sub: '' });
      }
    });

    // Input (players only): the paddle follows the pointer; send changes at ~60 Hz.
    const canvas = document.getElementById('gl');
    let latest = null, lastSent = '';
    const onMove = (e) => {
      if (spectator) return;
      const p = scene.pointerToPaddle(e.clientX, e.clientY - (e.pointerType === 'touch' ? 80 : 0)); // keep the paddle above a fingertip
      if (p) latest = p;
    };
    const onDown = (e) => { if (spectator) return; onMove(e); sfx.unlock(); net.send({ t: 'serve' }); };
    const onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'Enter') { e.preventDefault(); window.dispatchEvent(new Event('chat:open')); }
      else if (e.code === 'Space' && !spectator && !/BUTTON/.test(e.target.tagName)) { e.preventDefault(); net.send({ t: 'serve' }); }
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey);
    const timer = setInterval(() => {
      if (spectator || !latest) return;
      const k = `${latest.x.toFixed(3)},${latest.y.toFixed(3)}`;
      if (k !== lastSent) { lastSent = k; net.send({ t: 'p', x: latest.x, y: latest.y }); }
    }, 16);

    return () => {
      offSnap(); clearInterval(timer); clearTimeout(introTimer);
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); removeEventListener('keydown', onKey);
      document.body.classList.remove('playing'); scene.setMode('menu'); scene.setCharacters([null, null]); voice.setForced(false);
    };
  }, [game.gid]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    if (spectator) return net.send({ t: 'unwatch' });
    modal.confirm({
      title: game.kind === 'ai' ? 'Quit this game?' : 'Forfeit this game?', content: game.kind === 'ai' ? undefined : 'It counts as a loss.',
      okText: game.kind === 'ai' ? 'Quit' : 'Forfeit', okButtonProps: { danger: true }, cancelText: 'Keep playing', centered: true,
      onOk: () => net.send({ t: 'leave' }),
    });
  };

  return (
    <div className="hud" data-testid="hud">
      <div className="scoreboard">
        <div className={`side ${serving === 0 ? 'serving' : ''} ${you === 0 ? 'me' : ''}`}><PlayerAvatar p={game.players[0]} size={30} /><span className="name">{names[0]}{you === 0 ? ' (you)' : ''}</span><span className="pts">{score[0]}</span></div>
        <div className="mid">first to {game.target}</div>
        <div className={`side ${serving === 1 ? 'serving' : ''} ${you === 1 ? 'me' : ''}`}><span className="pts">{score[1]}</span><span className="name">{names[1]}{you === 1 ? ' (you)' : ''}</span><PlayerAvatar p={game.players[1]} size={30} /></div>
      </div>
      {intro && (
        <div className="vs-intro" data-testid="vs-intro">
          {[0, 1].map((i) => {
            const p = game.players[i];
            return (
              <React.Fragment key={i}>
                {i === 1 && <div className="vs">VS</div>}
                <div className={`vs-card ${i === 0 ? 'left' : 'right'}`} style={{ borderColor: p.color }}>
                  <PlayerAvatar p={p} size={72} />
                  <div className="vs-name">{p.username}{i === you ? ' (you)' : ''}</div>
                  <div className="vs-sub">{p.cpu ? `CPU · ${p.level}` : `Rating ${p.rating}`}</div>
                </div>
              </React.Fragment>);
          })}
        </div>)}
      {!live && <div className="hud-loader"><Spin size="large" /><div>Connecting to match…</div></div>}
      <div id="hud-msg" data-testid="hud-msg">{live && msg.text}{live && msg.sub && <small>{msg.sub}</small>}</div>
      <div className="dock">
        <Chat game={game} />
        <VoicePanel />
      </div>
      <Button className="hud-leave" onClick={leave} data-testid="hud-leave">{spectator ? 'Stop watching' : game.kind === 'ai' ? 'Quit' : 'Forfeit'}</Button>
    </div>
  );
}
