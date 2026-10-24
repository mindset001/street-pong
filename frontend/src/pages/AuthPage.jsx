import React, { useEffect, useRef, useState } from 'react';
import { Card, Tabs, Form, Input, Button, Alert, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { api } from '../api';

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = async (values) => {
    setError(''); setLoading(true); setSlow(false);
    timer.current = setTimeout(() => setSlow(true), 3500); // free hosts take a while to wake up
    try {
      const r = await api(`/auth/${mode}`, { body: { username: values.username.trim(), password: values.password } });
      onAuth(r.token, r.user, mode === 'register');
    } catch (e) { setError(e.message); } finally { clearTimeout(timer.current); setLoading(false); setSlow(false); }
  };

  return (
    <div className="page">
      <div className="auth-wrap">
        <Card className="auth-card">
          <div className="logo">STREET<b>PONG</b></div>
          <Typography.Paragraph type="secondary">Real-time 3D table tennis. Climb the ladder, win tournaments.</Typography.Paragraph>
          <Tabs activeKey={mode} onChange={(k) => { setMode(k); setError(''); }} centered items={[{ key: 'login', label: 'Log in' }, { key: 'register', label: 'Create account' }]} />
          <Form name="auth" layout="vertical" onFinish={submit} requiredMark={false} disabled={loading}>
            <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Enter a username' }, ...(mode === 'register' ? [{ pattern: /^[A-Za-z0-9_]{3,16}$/, message: '3–16 letters, numbers or _' }] : [])]}>
              <Input prefix={<UserOutlined />} autoComplete="username" maxLength={16} size="large" />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter a password' }, ...(mode === 'register' ? [{ min: 6, message: 'At least 6 characters' }] : [])]}>
              {/* Input.Password includes the show/hide eye toggle */}
              <Input.Password prefix={<LockOutlined />} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={72} size="large" />
            </Form.Item>
            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
            {slow && <Alert type="info" showIcon message="Waking the server up… this can take up to a minute on the first visit." style={{ marginBottom: 16 }} />}
            <Button type="primary" htmlType="submit" size="large" block loading={loading} data-testid="auth-submit">{mode === 'login' ? 'Log in' : 'Create account'}</Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}
