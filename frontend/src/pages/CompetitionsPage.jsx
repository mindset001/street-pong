import React, { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Card, Form, Input, Select, Button, Tag, Row, Col, Typography, Spin, Empty, Space } from 'antd';
import { api } from '../api';
import { net } from '../net';

const STATUS = { open: ['green', 'Open'], running: ['gold', 'In progress'], finished: ['default', 'Finished'] };

export default function CompetitionsPage() {
  const { message } = AntApp.useApp();
  const [list, setList] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const load = useCallback(() => api('/competitions').then((r) => setList(r.competitions)).catch((e) => { setList((l) => l ?? []); message.error(e.message); }), [message]);
  useEffect(() => { load(); return net.on('comp', load); }, [load]);

  const create = async ({ name, size }) => {
    setCreating(true);
    try { const c = await api('/competitions', { body: { name, size } }); message.success('Competition created'); location.hash = `#/competition/${c.id}`; }
    catch (e) { message.error(e.message); } finally { setCreating(false); }
  };

  return (
    <div className="wrap">
      <Card style={{ marginBottom: 16 }}>
        <Typography.Title level={2} style={{ marginTop: 0 }}>Competitions</Typography.Title>
        <Typography.Paragraph type="secondary">Single-elimination brackets. Starts automatically when full, or the creator can start it early (byes fill the gaps).</Typography.Paragraph>
        <Row gutter={[24, 8]}>
          <Col xs={24} lg={14}>
            <Form form={form} layout="vertical" onFinish={create} initialValues={{ size: 8 }} disabled={creating}>
              <Row gutter={12}>
                <Col xs={24} sm={14}><Form.Item name="name" label="Name" rules={[{ required: true, min: 3, max: 40, message: '3–40 characters' }]}><Input id="create_name" maxLength={40} placeholder="e.g. Friday Night Showdown" /></Form.Item></Col>
                <Col xs={12} sm={5}><Form.Item name="size" label="Size"><Select options={[4, 8, 16].map((n) => ({ value: n, label: `${n} players` }))} /></Form.Item></Col>
                <Col xs={12} sm={5}><Form.Item label=" "><Button type="primary" htmlType="submit" loading={creating} block data-testid="create-comp">Create</Button></Form.Item></Col>
              </Row>
            </Form>
          </Col>
          <Col xs={24} lg={10}>
            <Form layout="vertical" onFinish={({ code }) => { location.hash = `#/join/${code.trim()}`; }}>
              <Form.Item label="Have an invite code?" name="code" rules={[{ required: true, message: 'Enter the 6-character code' }]}>
                <Space.Compact block><Input maxLength={6} placeholder="ABC123" style={{ textTransform: 'uppercase', letterSpacing: '.2em' }} /><Button htmlType="submit">Find</Button></Space.Compact>
              </Form.Item>
            </Form>
          </Col>
        </Row>
      </Card>
      {list === null ? <div className="modal-center" style={{ padding: 48 }}><Spin size="large" /></div>
        : !list.length ? <Card><Empty description="No competitions yet — create the first one!" /></Card>
        : <Row gutter={[16, 16]}>{list.map((c) => (
          <Col xs={24} md={12} key={c.id}>
            <Card title={c.name} extra={<Tag color={STATUS[c.status]?.[0]}>{STATUS[c.status]?.[1] ?? c.status}</Tag>} style={{ height: '100%' }}>
              <Typography.Paragraph type="secondary">by {c.creator} · {c.players}/{c.size} players{c.champion ? ` · 🏆 ${c.champion}` : ''}</Typography.Paragraph>
              <Button type={c.status === 'open' ? 'primary' : 'default'} href={`#/competition/${c.id}`}>{c.status === 'open' ? 'View & join' : 'View bracket'}</Button>
            </Card>
          </Col>))}</Row>}
    </div>
  );
}
