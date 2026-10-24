import React from 'react';
import { Button, Tooltip } from 'antd';
import { SoundOutlined, AudioMutedOutlined, LogoutOutlined } from '@ant-design/icons';
import { useAppCtx } from '../ctx';
import PlayerAvatar from './PlayerAvatar';

const NAV = [['home', '#/', 'Play'], ['competitions', '#/competitions', 'Competitions'], ['leaderboard', '#/leaderboard', 'Leaderboard']];

export default function Shell({ route, children }) {
  const { user, connected, openProfile, logout, soundOff, toggleSound } = useAppCtx();
  const active = route === 'competition' || route === 'join' ? 'competitions' : route;
  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="#/">STREET<b>PONG</b></a>
        <nav>{NAV.map(([k, href, label]) => <a key={k} href={href} className={active === k ? 'on' : ''}>{label}</a>)}</nav>
        <div className="me">
          <Tooltip title={connected ? 'Connected' : 'Connecting…'}><span data-testid="net-dot" className={`dot ${connected ? 'on' : ''}`} /></Tooltip>
          <Button type="text" onClick={() => openProfile(user.username)} className="me-name"><PlayerAvatar p={user} size={24} /> <span>{user.username} · {user.rating}</span></Button>
          <Button type="text" aria-label="Toggle sound" icon={soundOff ? <AudioMutedOutlined /> : <SoundOutlined />} onClick={toggleSound} />
          <Button type="text" icon={<LogoutOutlined />} onClick={logout} data-testid="logout"><span className="hide-xs">Log out</span></Button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
