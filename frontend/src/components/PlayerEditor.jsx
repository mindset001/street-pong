import React, { useEffect, useState } from 'react';
import { App as AntApp, Modal, Button, Spin, Typography, Space, Tabs, Segmented } from 'antd';
import { api } from '../api';
import { useAppCtx } from '../ctx';
import PlayerAvatar from './PlayerAvatar';
import CharacterPreview from './CharacterPreview';

const Swatch = ({ color, on, onClick, label }) => (
  <button type="button" aria-label={label} aria-pressed={on} className={`swatch ${on ? 'on' : ''}`} style={{ background: color }} onClick={onClick} />
);

/** "Set up your player": avatar, accent colour and paddle colour. */
export default function PlayerEditor({ open, onClose, welcome }) {
  const { user, setUser } = useAppCtx();
  const { message } = AntApp.useApp();
  const [opts, setOpts] = useState(null);
  const [look, setLook] = useState({ avatar: user.avatar, color: user.color, paddle: user.paddle, char: user.char });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setLook({ avatar: user.avatar, color: user.color, paddle: user.paddle, char: user.char }); }, [open, user.avatar, user.color, user.paddle, user.char]);
  useEffect(() => { if (open && !opts) api('/auth/player-options').then(setOpts).catch((e) => message.error(e.message)); }, [open, opts, message]);

  const save = async () => {
    setSaving(true);
    try { const r = await api('/auth/player', { method: 'PUT', body: look }); setUser((u) => ({ ...u, ...r.user })); message.success('Player saved'); onClose(); }
    catch (e) { message.error(e.message); } finally { setSaving(false); }
  };

  const setChar = (k, v) => setLook((l) => ({ ...l, char: { ...l.char, [k]: v } }));
  const label = (v) => v[0].toUpperCase() + v.slice(1);
  const swatches = (key, list) => <div className="pick-grid">{list.map((c) => <Swatch key={c} color={c} label={`${key} ${c}`} on={look.char[key] === c} onClick={() => setChar(key, c)} />)}</div>;

  const characterTab = opts && (
    <div>
      <Typography.Text type="secondary">Skin</Typography.Text>{swatches('skin', opts.char.skin)}
      <Typography.Text type="secondary">Hair style</Typography.Text>
      <div className="pick-grid"><Segmented value={look.char.hairStyle} onChange={(v) => setChar('hairStyle', v)} options={opts.char.hairStyle.map((v) => ({ value: v, label: label(v) }))} /></div>
      <Typography.Text type="secondary">Hair colour</Typography.Text>{swatches('hair', opts.char.hair)}
      <Typography.Text type="secondary">Shirt</Typography.Text>{swatches('shirt', opts.char.shirt)}
      <Typography.Text type="secondary">Shorts</Typography.Text>{swatches('shorts', opts.char.shorts)}
      <Typography.Text type="secondary">Accessory</Typography.Text>
      <div className="pick-grid"><Segmented value={look.char.accessory} onChange={(v) => setChar('accessory', v)} options={opts.char.accessory.map((v) => ({ value: v, label: label(v) }))} /></div>
    </div>);

  const avatarTab = opts && (
    <div>
      <Typography.Text type="secondary">Avatar</Typography.Text>
      <div className="pick-grid">{opts.avatars.map((a) => <button type="button" key={a} className={`emoji ${look.avatar === a ? 'on' : ''}`} aria-pressed={look.avatar === a} onClick={() => setLook({ ...look, avatar: a })}>{a}</button>)}</div>
      <Space size={24} wrap align="start">
        <div><Typography.Text type="secondary">Colour</Typography.Text><div className="pick-grid">{opts.colors.map((c) => <Swatch key={c} color={c} label={`Colour ${c}`} on={look.color === c} onClick={() => setLook({ ...look, color: c })} />)}</div></div>
        <div><Typography.Text type="secondary">Paddle</Typography.Text><div className="pick-grid">{opts.paddles.map((c) => <Swatch key={c} color={c} label={`Paddle ${c}`} on={look.paddle === c} onClick={() => setLook({ ...look, paddle: c })} />)}</div></div>
      </Space>
    </div>);

  return (
    <Modal open={open} onCancel={onClose} centered width={520} styles={{ body: { paddingTop: 8 } }} title={welcome ? 'Set up your player' : 'Edit your player'} destroyOnHidden
      footer={[<Button key="c" onClick={onClose}>{welcome ? 'Later' : 'Cancel'}</Button>, <Button key="s" type="primary" loading={saving} onClick={save} data-testid="player-save">Save</Button>]}>
      <div data-testid="player-editor" className="editor-scroll">
        <div className="preview-wrap">
          <CharacterPreview char={look.char} paddle={look.paddle} />
          <div className="preview-badge"><PlayerAvatar p={look} size={40} /><b>{user.username}</b></div>
        </div>
        {!opts ? <div className="modal-center" style={{ padding: 32 }}><Spin size="large" /></div>
          : <Tabs defaultActiveKey="char" items={[{ key: 'char', label: 'Character', children: characterTab }, { key: 'look', label: 'Avatar & paddle', children: avatarTab }]} />}
      </div>
    </Modal>
  );
}
