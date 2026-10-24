import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import App from './App';
import './styles.css';

const themeConfig = {
  algorithm: theme.darkAlgorithm,
  token: { colorPrimary: '#ffa51f', colorInfo: '#38d6ff', colorSuccess: '#3ddc97', colorError: '#ff5d73', colorBgBase: '#0b1020', borderRadius: 12, fontSize: 15 },
  components: {
    Button: { primaryColor: '#1a1200' },
    Card: { colorBgContainer: 'rgba(16, 22, 44, 0.82)' },
    Table: { colorBgContainer: 'transparent' },
    Modal: { contentBg: '#121a33', headerBg: '#121a33' },
  },
};

createRoot(document.getElementById('root')).render(
  <ConfigProvider theme={themeConfig}>
    <AntApp style={{ height: '100%' }}>
      <App />
    </AntApp>
  </ConfigProvider>,
);
