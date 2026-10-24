import React, { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Card, Button, Tag, Space, Typography, Spin, Result, Alert, Tooltip } from 'antd';
import { CopyOutlined, ShareAltOutlined, EyeOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { api } from '../api';
import { net } from '../net';
import { useAppCtx } from '../ctx';
import PlayerAvatar from '../components/PlayerAvatar';

const roundName = (i, n) => (i === n - 1 ? 'Final' : i === n - 2 ? 'Semi-finals' : i === n - 3 ? 'Quarter-finals' : `Round ${i + 1}`);

function MatchBox({ m, me }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBusy(false); }, [m.status, m.ready.length]);
  const mine = m.p1?.id === me || m.p2?.id === me;
  const row = (p, s) => <div className={`pl ${!p ? 'tbd' : m.winner ? (m.winner === p.id ? 'win' : 'lose') : ''}`}><span>{p ? <><PlayerAvatar p={p} size={20} /> {p.username}</> : m.bye ? 'BYE' : 'TBD'}</span><span>{m.status === 'done' && !m.bye ? s : ''}</span></div>;
  let foot = null;
  if (m.status === 'ready') {
    const iAmReady = m.ready.includes(me);
    foot = (
      <div className="foot"><span className="dim">{m.ready.length}/2 ready</span>
        {mine && (iAmReady
          ? <Button size="small" loading onClick={() => net.send({ t: 'comp_unready', matchId: m.id })}>Waiting… (cancel)</Button>
          : <Button size="small" type="primary" loading={busy} onClick={() => { setBusy(true); net.send({ t: 'comp_ready', matchId: m.id }); }}>Ready — play!</Button>)}
      </div>);
  } else if (m.status === 'playing') {
    foot = (
      <div className="foot"><span style={{ color: '#38d6ff' }}>● Live</span>
        {m.gid && !mine && <Button size="small" icon={<EyeOutlined />} loading={busy} onClick={() => { setBusy(true); net.send({ t: 'watch', gid: m.gid }); }}>Watch</Button>}
      </div>);
  }
  return <div className={`match ${m.status}`}>{row(m.p1, m.s1)}{row(m.p2, m.s2)}{foot}</div>;
}

export default function CompetitionPage({ id }) {
  const { user } = useAppCtx();
  const { message, modal } = AntApp.useApp();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api(`/competitions/${id}`).then(setD).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
    const off = net.on('comp', (m) => m.id === id && load());
    const t = setInterval(load, 20000); // also picks up walkovers
    return () => { off(); clearInterval(t); };
  }, [id, load]);

  const act = async (key, path, method = 'POST', after) => {
    setBusy(key);
    try { const r = await api(`/competitions/${id}${path}`, { method }); if (after) after(); else setD(r); }
    catch (e) { message.error(e.message); } finally { setBusy(''); }
  };

  if (error) return <div className="wrap"><Card><Result status="404" title={error} extra={<Button href="#/competitions">Back</Button>} /></Card></div>;
  if (!d) return <div className="modal-center" style={{ padding: 80 }}><Spin size="large" /></div>;

  const isCreator = d.creatorId === user.id, open = d.status === 'open';
  const link = `${location.origin}${location.pathname}#/join/${d.code}`;
  const share = async () => {
    const data = { title: d.name, text: `Join my table tennis competition “${d.name}” on Street Pong (code ${d.code})`, url: link };
    if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copy(link, 'Invite link copied');
  };
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); message.success(ok); } catch { modal.info({ title: 'Copy this', content: <Typography.Text copyable>{text}</Typography.Text> }); } };
  const n = d.rounds.length;

  return (
    <div className="wrap">
      <Card>
        <Button type="link" icon={<ArrowLeftOutlined />} href="#/competitions" style={{ padding: 0 }}>All competitions</Button>
        <div className="row-between">
          <div>
            <Typography.Title level={2} style={{ margin: '4px 0' }}>{d.name}</Typography.Title>
            <Typography.Text type="secondary">by {d.creator} · {d.players.length}/{d.size} players · </Typography.Text>
            <Tag color={open ? 'green' : d.status === 'finished' ? 'default' : 'gold'}>{d.status === 'starting' ? 'running' : d.status}</Tag>
          </div>
          <Space wrap>
            {open && !d.joined && <Button type="primary" loading={busy === 'join'} onClick={() => act('join', '/join')}>Join</Button>}
            {open && d.joined && !isCreator && <Button loading={busy === 'leave'} onClick={() => act('leave', '/leave')}>Leave</Button>}
            {open && isCreator && <Button type="primary" disabled={d.players.length < 2} loading={busy === 'start'} onClick={() => act('start', '/start')}>Start now</Button>}
            {open && isCreator && <Button danger loading={busy === 'cancel'} onClick={() => modal.confirm({ title: 'Cancel this competition?', content: 'Registered players will be removed. This can’t be undone.', okText: 'Cancel competition', okButtonProps: { danger: true }, cancelText: 'Keep it', onOk: () => act('cancel', '', 'DELETE', () => { location.hash = '#/competitions'; }) })}>Cancel</Button>}
          </Space>
        </div>

        {open && d.code && (
          <div className="invite">
            <Typography.Text type="secondary">Invite code</Typography.Text>
            <b className="code" data-testid="invite-code">{d.code}</b>
            <Space wrap>
              <Button icon={<CopyOutlined />} onClick={() => copy(d.code, 'Code copied')}>Copy code</Button>
              <Button type="primary" ghost icon={<ShareAltOutlined />} onClick={share}>Share invite link</Button>
            </Space>
          </div>)}

        {d.champion && <Typography.Title level={3} style={{ color: '#ffa51f' }}>🏆 Champion: {d.champion.username}</Typography.Title>}

        <Typography.Title level={5} style={{ marginTop: 20 }}>Players</Typography.Title>
        <Space wrap>
          {d.players.map((p) => <Tag key={p.id} color={p.id === user.id ? 'gold' : undefined}>{p.avatar} {p.username} · {p.rating}</Tag>)}
          {Array.from({ length: Math.max(0, d.size - d.players.length) }, (_, i) => <Tag key={`o${i}`} style={{ opacity: 0.5 }}>open slot</Tag>)}
        </Space>

        {n > 0 && <Typography.Title level={5} style={{ marginTop: 20 }}>Bracket</Typography.Title>}
        {n > 0 && <div className="bracket">{d.rounds.map((r, i) => <div className="round" key={i}><h4>{roundName(i, n)}</h4>{r.map((m) => <MatchBox key={m.id} m={m} me={user.id} />)}</div>)}</div>}
        {d.status === 'running' && <Alert type="info" showIcon style={{ marginTop: 8 }} message="When both players press “Ready”, the match starts. If an opponent doesn’t show within 3 minutes, the ready player advances." />}
      </Card>
    </div>
  );
}
