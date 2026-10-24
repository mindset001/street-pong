import { useEffect, useRef, useState } from 'react';

export function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

/** Button loading flag for fire-and-forget websocket requests: true for up to `ms` or until reset(). */
export function usePending(ms = 4000) {
  const [pending, setPending] = useState(false);
  const t = useRef();
  useEffect(() => () => clearTimeout(t.current), []);
  return [pending, () => { setPending(true); clearTimeout(t.current); t.current = setTimeout(() => setPending(false), ms); }, () => { clearTimeout(t.current); setPending(false); }];
}
