import React, { useEffect, useState } from 'react';
import { Card, Table, Segmented, Button, Typography, Empty } from 'antd';
import { api } from '../api';
import { useAppCtx } from '../ctx';
import PlayerAvatar from '../components/PlayerAvatar';

export default function LeaderboardPage() {
  const { user, openProfile } = useAppCtx();
  const [sort, setSort] = useState('rating');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    api(`/leaderboard?sort=${sort}`).then((r) => live && setRows(r.players)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [sort]);
  return (
    <div className="wrap">
      <Card title={<Typography.Title level={3} style={{ margin: 0 }}>Leaderboard</Typography.Title>}
        extra={<Segmented value={sort} onChange={setSort} options={[{ value: 'rating', label: 'Rating' }, { value: 'wins', label: 'Wins' }, { value: 'titles', label: 'Titles' }]} />}>
        {error ? <Typography.Text type="danger">{error}</Typography.Text> : (
          <Table rowKey="id" loading={loading} dataSource={rows} pagination={false} scroll={{ x: 'max-content' }} size="middle"
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No ranked games yet. Be the first on the board!" /> }}
            rowClassName={(r) => (r.id === user.id ? 'row-me' : '')}
            columns={[
              { title: '#', dataIndex: 'rank', width: 56, render: (r) => ['🥇', '🥈', '🥉'][r - 1] || r },
              { title: 'Player', dataIndex: 'username', render: (n, r) => <Button type="link" style={{ padding: 0 }} onClick={() => openProfile(n)}><PlayerAvatar p={r} size={26} /> {n}</Button> },
              { title: 'Rating', dataIndex: 'rating', align: 'right' },
              { title: 'W', dataIndex: 'wins', align: 'right' },
              { title: 'L', dataIndex: 'losses', align: 'right' },
              { title: 'Win %', dataIndex: 'games', align: 'right', responsive: ['md'], render: (g, r) => (g ? `${Math.round((r.wins / g) * 100)}%` : '–') },
              { title: '🏆', dataIndex: 'titles', align: 'right', render: (t) => t || '' },
            ]} />)}
      </Card>
    </div>
  );
}
