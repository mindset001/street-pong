// Backend base URL. Empty = same origin (dev proxy / backend serving the build). Set VITE_API_URL at build time otherwise.
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
