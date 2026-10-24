import { Scene } from './scene';
import { Voice } from './voice';
import { net } from '../net';

// Singletons: one WebGL scene bound to the static <canvas id="gl">, one voice-chat client.
export const scene = new Scene(document.getElementById('gl'));
export const voice = new Voice(net.send);
net.on('*', (m) => { if (m.t === 'rtc' || m.t.startsWith('voice_')) voice.handle(m); });
