import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Badge, Space } from 'antd';
import { MessageOutlined, SoundOutlined, AudioMutedOutlined } from '@ant-design/icons';
import { net } from '../net';
import { voice } from '../game/instances';
import { useAppCtx } from '../ctx';

const FADE_MS = 7000;

export default function Chat({ game }) {
  const { user } = useAppCtx();
  const [lines, setLines] = useState(() => (game.chat || []).map((m) => ({ ...m, born: 0 })));
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [muted, setMuted] = useState(!!game.muted);
  const [host, setHost] = useState(!!game.host);
  const [text, setText] = useState('');
  const [, tick] = useState(0);
  const logRef = useRef(), inputRef = useRef(), openRef = useRef(false);
  openRef.current = open;

  useEffect(() => {
    const offChat = net.on('chat', (m) => {
      setLines((l) => [...l.slice(-59), { ...m, born: Date.now() }]);
      if (!openRef.current && m.uid !== user.id) setUnread((n) => n + 1);
    });
    const offMuted = net.on('muted', (m) => {
      setMuted(m.on); if (m.host) setHost(true);
      if (!m.host) voice.setForced(m.on);
      setLines((l) => [...l.slice(-59), { sys: true, text: `${m.by} ${m.on ? 'muted' : 'unmuted'} everyone`, born: Date.now() }]);
    });
    const openIt = () => { setOpen(true); setUnread(0); setTimeout(() => inputRef.current?.focus(), 0); };
    window.addEventListener('chat:open', openIt);
    return () => { offChat(); offMuted(); window.removeEventListener('chat:open', openIt); };
  }, [user.id]);

  // Re-render while recent lines are fading out (closed state only).
  useEffect(() => { if (open) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [open]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [lines, open]);

  const blocked = muted && !host;
  const send = () => { const t = text.trim(); if (t) net.send({ t: 'chat', text: t }); setText(''); };
  const now = Date.now();
  const visible = open ? lines : lines.filter((l) => now - l.born < FADE_MS);

  return (
    <div className={`chat ${open ? 'open' : ''}`}>
      {visible.length > 0 && (
        <div className="log" ref={logRef} data-testid="chat-log">
          {visible.map((m, i) => (
            <div key={i} className={`line ${m.sys ? 'sys' : ''} ${m.host ? 'host' : ''}`}>
              {m.sys ? m.text : <><b>{m.name}{m.host ? ' ★' : ''}: </b>{m.text}</>}
            </div>))}
        </div>)}
      {open && (
        <div className="chat-input">
          <Input ref={inputRef} id="chat-input" value={text} onChange={(e) => setText(e.target.value)} onPressEnter={send} maxLength={200} autoComplete="off"
            disabled={blocked} placeholder={blocked ? 'Chat muted by the host' : 'Say something…'}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.target.blur(); setOpen(false); } }}
            suffix={<Button type="primary" size="small" onClick={send} disabled={blocked}>Send</Button>} />
        </div>)}
      <Space size={6} wrap>
        <Badge count={unread} size="small" offset={[-4, 4]}>
          <Button icon={<MessageOutlined />} onClick={() => { setOpen(!open); setUnread(0); }} data-testid="chat-toggle" className="dock-btn">Chat</Button>
        </Badge>
        {game.hasHost && host && (
          <Button className="dock-btn" danger={muted} icon={muted ? <SoundOutlined /> : <AudioMutedOutlined />} data-testid="mute-all" onClick={() => net.send({ t: 'mute_all', on: !muted })}>{muted ? 'Unmute all' : 'Mute all'}</Button>)}
      </Space>
    </div>
  );
}
