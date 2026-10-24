import React, { useCallback, useEffect, useState } from 'react';
import { Card, Statistic, Button, Select, Space, Typography, List, Spin, Row, Col, Empty, Collapse } from 'antd';
import { ThunderboltOutlined, RobotOutlined, TrophyOutlined, BarChartOutlined, EyeOutlined } from '@ant-design/icons';
import { api } from '../api';
import { net } from '../net';
import { useAppCtx } from '../ctx';
import PlayerAvatar from '../components/PlayerAvatar';
import { usePending } from '../hooks';

function LiveGames() {
  const { lobby } = useAppCtx();
  const [games, setGames] = useState(null);
  const [watching, startWatching] = usePending();
  const load = useCallback(() => api('/live').then((r) => setGames(r.games)).catch(() => setGames((g) => g ?? [])), []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useEffect(() => { load(); }, [lobby.playing, load]);
  return (
    <Card title="Live now" data-testid="live-list">
      {games === null ? <div className="modal-center" style={{ padding: 16 }}><Spin /></div>
        : !games.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No games in progress right now" />
        : <List dataSource={games} rowKey="gid" renderItem={(g) => (
          <List.Item actions={[<Button key="w" type="primary" ghost icon={<EyeOutlined />} loading={watching} data-testid="watch-btn" onClick={() => { startWatching(); net.send({ t: 'watch', gid: g.gid }); }}>Watch</Button>]}>
            <List.Item.Meta
              avatar={<Space.Compact><PlayerAvatar p={{ avatar: g.avatars?.[0], color: '#94a3b8' }} size={28} /><PlayerAvatar p={{ avatar: g.avatars?.[1], color: '#64748b' }} size={28} /></Space.Compact>}
              title={<span>{g.players[0]} vs {g.players[1]} <b className="score">{g.score[0]}–{g.score[1]}</b></span>}
              description={`${g.competition ? `🏆 ${g.competition} · ` : 'Ranked · '}${g.spectators} watching${g.voice ? ` · 🎙 ${g.voice} in voice` : ''}`} />
          </List.Item>)} />}
    </Card>
  );
}

export default function HomePage() {
  const { user, lobby, connected, openEditor } = useAppCtx();
  const [level, setLevel] = useState('medium');
  const [finding, startFinding] = usePending();
  const [starting, startCpu] = usePending();
  return (
    <div className="wrap">
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]} align="middle" justify="space-between">
          <Col xs={24} md={12}>
            <Space size={14} align="center">
              <PlayerAvatar p={user} size={56} />
              <div>
                <Typography.Title level={2} style={{ margin: 0 }}>Welcome, {user.username}</Typography.Title>
                <Typography.Text type="secondary">{connected ? `${lobby.online} online · ${lobby.playing} games live · ${lobby.queued} searching` : 'Connecting to the game server…'}</Typography.Text>
                <div><Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEditor('edit')}>Edit player</Button></div>
              </div>
            </Space>
          </Col>
          <Col xs={24} md={12}>
            <Space size={32} wrap><Statistic title="Rating" value={user.rating} /><Statistic title="W–L" value={`${user.wins}–${user.losses}`} /><Statistic title="Titles" value={user.titles} /></Space>
          </Col>
        </Row>
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title={<><ThunderboltOutlined /> Quick match</>} style={{ height: '100%' }}>
            <Typography.Paragraph type="secondary">Ranked game against another player. Winner takes rating points.</Typography.Paragraph>
            <Button type="primary" loading={finding} disabled={!connected} onClick={() => { startFinding(); net.send({ t: 'queue' }); }}>Find opponent</Button>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title={<><RobotOutlined /> Practice vs CPU</>} style={{ height: '100%' }}>
            <Typography.Paragraph type="secondary">Warm up against the machine. Unranked.</Typography.Paragraph>
            <Space.Compact>
              <Select value={level} onChange={setLevel} style={{ width: 120 }} options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
              <Button type="primary" ghost loading={starting} disabled={!connected} data-testid="play-cpu" onClick={() => { startCpu(); net.send({ t: 'ai', level }); }}>Play</Button>
            </Space.Compact>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title={<><TrophyOutlined /> Competitions</>} style={{ height: '100%' }}>
            <Typography.Paragraph type="secondary">Create or join a knockout bracket and fight for the title.</Typography.Paragraph>
            <Button href="#/competitions">Browse</Button>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title={<><BarChartOutlined /> Leaderboard</>} style={{ height: '100%' }}>
            <Typography.Paragraph type="secondary">See who rules the table.</Typography.Paragraph>
            <Button href="#/leaderboard">Rankings</Button>
          </Card>
        </Col>
        <Col xs={24}><LiveGames /></Col>
        <Col xs={24}>
          <Collapse items={[{ key: 'how', label: 'How to play', children: (
            <Typography.Paragraph style={{ margin: 0 }}>Move the mouse (or drag a finger) to steer your paddle. Click or press Space to serve. Let the ball bounce on your side, then meet it with the paddle: a quick swing hits harder and deeper but is less accurate; where the ball meets the paddle steers it left or right. Don’t clip the net, and don’t let it bounce twice. First to 11, win by 2. Press Enter to chat.</Typography.Paragraph>) }]} />
        </Col>
      </Row>
    </div>
  );
}
