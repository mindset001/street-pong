import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, API + websocket calls are proxied to the local backend so VITE_API_URL can stay empty.
const backend = process.env.BACKEND_URL || 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': backend, '/ws': { target: backend, ws: true } } },
  build: { chunkSizeWarningLimit: 1800 },
});
