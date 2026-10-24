import React from 'react';
import { Avatar } from 'antd';

/** Round emoji avatar on the player's accent colour. */
export default function PlayerAvatar({ p, size = 32 }) {
  return (
    <Avatar size={size} style={{ background: p?.color || '#94a3b8', color: '#111', fontSize: Math.round(size * 0.55), flex: 'none', lineHeight: `${size}px` }}>
      {p?.avatar || '🏓'}
    </Avatar>
  );
}
