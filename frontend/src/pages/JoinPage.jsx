import React, { useEffect } from 'react';
import { App as AntApp, Spin, Typography } from 'antd';
import { api } from '../api';

/** Resolves an invite code from a shared link and forwards to that competition. */
export default function JoinPage({ code }) {
  const { message } = AntApp.useApp();
  useEffect(() => {
    let live = true;
    api(`/competitions/code/${encodeURIComponent(code)}`)
      .then(({ id }) => live && location.replace(`#/competition/${id}`))
      .catch((e) => { if (live) { message.error(e.message); location.replace('#/competitions'); } });
    return () => { live = false; };
  }, [code, message]);
  return <div className="modal-center" style={{ padding: 80 }}><Spin size="large" /><Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>Finding competition…</Typography.Paragraph></div>;
}
