import React, { useEffect, useState } from 'react';
import { Modal, Button, Spin, Statistic, Table, Tag, Typography, Space, Result } from 'antd';
import { api } from '../api';
import { net } from '../net';
import { useAppCtx } from '../ctx';
import PlayerAvatar from './PlayerAvatar';

export function SearchingModal({ open }) {
  return (
    <Modal open={open} closable={false} maskClosable={false} keyboard={false} centered footer={null} width={380} destroyOnHidden>
      <div className="modal-center" data-testid="searching">
        <Spin size="large" />
        <Typography.Title level={4} style={{ margin: '16px 0 4px' }}>Searching for an opponent…</Typography.Title>
        <Typography.Paragraph type="secondary">You’ll be matched with the next player in the queue.</Typography.Paragraph>
        <Button onClick={() => net.send({ t: 'unqueue' })}>Cancel</Button>
      </div>
    </Modal>
  );
}

export function ResultModal({ result, onClose }) {
  const { user } = useAppCtx();
  if (!result) return null;
  const m = result, spectator = m.you < 0, won = m.winner === m.you;
  const names = m.players.map((p) => p.username);
  const back = () => { onClose(); location.hash = m.comp ? `#/competition/${m.comp.id}` : '#/'; };
  const again = m.kind === 'ai'
    ? () => { onClose(); net.send({ t: 'ai', level: m.level || 'medium' }); }
    : m.kind === 'ranked' && !spectator ? () => { onClose(); net.send({ t: 'queue' }); } : null;
  return (
    <Modal open centered footer={null} onCancel={back} width={420}>
      <div className="modal-center">
        {spectator ? <Typography.Title level={3} data-testid="result-title">Game over</Typography.Title>
          : <Typography.Title level={2} data-testid="result-title" style={{ color: won ? '#3ddc97' : '#ff5d73', letterSpacing: '.08em' }}>{won ? 'VICTORY' : 'DEFEAT'}</Typography.Title>}
        <Typography.Title level={3} style={{ marginTop: 0 }}>{m.score[0]} – {m.score[1]}</Typography.Title>
        {spectator && <Typography.Paragraph><b>{names[m.winner]}</b> wins{m.forfeit ? ' (forfeit)' : ''}.</Typography.Paragraph>}
        {!spectator && m.forfeit && <Typography.Paragraph type="secondary">{won ? 'Your opponent left the game.' : 'Game forfeited.'}</Typography.Paragraph>}
        {!spectator && m.kind !== 'ai' && (
          <Typography.Paragraph>Rating <b>{m.rating ?? user.rating}</b>{' '}
            {m.delta ? <Typography.Text type={m.delta > 0 ? 'success' : 'danger'}>({m.delta > 0 ? '+' : ''}{m.delta})</Typography.Text> : null}</Typography.Paragraph>)}
        {!spectator && m.kind === 'competition' && <Typography.Paragraph type="secondary">{won ? 'You advance to the next round!' : 'You’ve been knocked out of the bracket.'}</Typography.Paragraph>}
        <Space wrap style={{ justifyContent: 'center' }}>
          {again && <Button type="primary" onClick={again}>{m.kind === 'ranked' ? 'Find another match' : 'Play again'}</Button>}
          <Button onClick={back} data-testid="result-menu">{m.comp ? 'Back to bracket' : spectator ? 'Back to lobby' : 'Menu'}</Button>
        </Space>
      </div>
    </Modal>
  );
}

export function ProfileModal({ username, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!username) return;
    let live = true;
    setData(null); setError(null);
    api(`/users/${encodeURIComponent(username)}`).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [username]);
  const u = data?.user;
  const { user, openEditor } = useAppCtx();
  const self = u && u.id === user.id;
  return (
    <Modal open={!!username} onCancel={onClose} footer={null} centered width={520} destroyOnHidden
      title={u ? <Space><PlayerAvatar p={self ? user : u} size={36} />{u.username}{self && <Button size="small" onClick={() => { onClose(); openEditor('edit'); }} data-testid="edit-player">Edit player</Button>}</Space> : username}>
      {error ? <Result status="warning" title={error} /> : !data ? <div className="modal-center" style={{ padding: 32 }}><Spin size="large" /></div> : (
        <>
          <Space size={32} wrap style={{ marginBottom: 16 }}>
            <Statistic title="Rating" value={u.rating} />
            <Statistic title="Rank" value={data.rank ? `#${data.rank}` : '–'} />
            <Statistic title="W–L" value={`${u.wins}–${u.losses}`} />
            <Statistic title="Titles" value={u.titles} />
          </Space>
          <Typography.Title level={5}>Recent matches</Typography.Title>
          <Table size="small" pagination={false} rowKey="id" dataSource={data.recent} locale={{ emptyText: 'No matches yet' }} columns={[
            { title: '', dataIndex: 'won', width: 40, render: (w) => <Tag color={w ? 'success' : 'error'}>{w ? 'W' : 'L'}</Tag> },
            { title: 'Opponent', dataIndex: 'opponent' },
            { title: 'Score', dataIndex: 'score', align: 'right', render: (s) => `${s[0]}–${s[1]}` },
            { title: 'Rating', dataIndex: 'delta', align: 'right', render: (d, r) => (d ? <Typography.Text type={d > 0 ? 'success' : 'danger'}>{d > 0 ? '+' : ''}{d}</Typography.Text> : <Typography.Text type="secondary">{r.kind === 'ai' ? 'CPU' : ''}</Typography.Text>) },
            { title: '', dataIndex: 'at', align: 'right', render: (t) => <Typography.Text type="secondary">{new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Typography.Text> },
          ]} />
        </>
      )}
    </Modal>
  );
}
