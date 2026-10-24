let ctx;
const ensure = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
function tone(freq, dur, type = 'sine', gain = 0.15, slide = 0) {
  try {
    const c = ensure(); if (c.state === 'suspended') c.resume();
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  } catch { /* audio is optional */ }
}
export const sfx = {
  enabled: true,
  hit() { this.enabled && tone(900, 0.07, 'triangle', 0.2, 0.6); },
  bounce() { this.enabled && tone(320, 0.06, 'sine', 0.18, 0.7); },
  net() { this.enabled && tone(140, 0.15, 'sawtooth', 0.1, 0.6); },
  point(win) { if (!this.enabled) return; (win ? [523, 659, 784] : [330, 262]).forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.14), i * 110)); },
  unlock() { try { ensure().resume(); } catch { /* ignore */ } },
};
