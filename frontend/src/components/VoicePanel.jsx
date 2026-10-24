import React, { useEffect, useReducer } from 'react';
import { Button, Space } from 'antd';
import { AudioOutlined, AudioMutedOutlined, PhoneOutlined } from '@ant-design/icons';
import { voice } from '../game/instances';

export default function VoicePanel() {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => voice.subscribe(bump), []);
  if (!voice.active) {
    return <Button icon={<AudioOutlined />} loading={voice.joining} onClick={() => voice.join()} data-testid="voice-join" className="dock-btn">{voice.joining ? 'Connecting…' : 'Join voice chat'}</Button>;
  }
  const others = voice.members();
  return (
    <div className="vbox" data-testid="voice-panel">
      <div><b className="live-dot">● Voice</b> · {others.length ? others.join(', ') : 'just you so far'}</div>
      <Space size={6} style={{ marginTop: 6 }}>
        {!voice.hasMic ? <span className="dim">listen-only</span>
          : voice.forced ? <Button size="small" danger disabled icon={<AudioMutedOutlined />}>Muted by host</Button>
          : <Button size="small" type={voice.muted ? 'default' : 'primary'} danger={voice.muted} icon={voice.muted ? <AudioMutedOutlined /> : <AudioOutlined />} onClick={() => voice.setMuted(!voice.muted)} data-testid="voice-mute">{voice.muted ? 'Unmute' : 'Mute'}</Button>}
        <Button size="small" icon={<PhoneOutlined />} onClick={() => voice.leave(true)}>Leave</Button>
      </Space>
    </div>
  );
}
