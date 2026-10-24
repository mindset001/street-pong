// Mesh WebRTC voice chat. Signalling goes over the game WebSocket (server relays `rtc` messages).
// Whoever joins creates the offers to the people already in the room. Mic is optional: without
// one you join listen-only.
export class Voice {
  constructor(send) {
    this.send = send; this.listeners = new Set(); this.onError = () => {};
    this.peers = new Map(); this.names = new Map(); this.stream = null; this.active = false; this.muted = false; this.forced = false; this.ice = [];
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onChange() { this.listeners.forEach((fn) => fn()); }

  async join() {
    if (this.active || this.joining) return;
    this.joining = true; this.onChange();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      this.stream = null;
      this.onError('No microphone access — joining listen-only');
    }
    this.send({ t: 'voice_join' });
  }

  leave(notify = true) {
    if (notify && (this.active || this.joining)) this.send({ t: 'voice_leave' });
    for (const uid of [...this.peers.keys()]) this.drop(uid);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null; this.active = false; this.joining = false; this.muted = false; this.names.clear();
    this.onChange();
  }

  apply() { this.stream?.getAudioTracks().forEach((t) => { t.enabled = !(this.muted || this.forced); }); }
  setMuted(m) { this.muted = m; this.apply(); this.onChange(); }
  /** Host "mute all": the mic is switched off locally and can't be re-enabled until the host lifts it. */
  setForced(f) { this.forced = f; this.apply(); this.onChange(); }
  get hasMic() { return !!this.stream; }
  members() { return [...this.names.values()]; }

  handle(m) {
    switch (m.t) {
      case 'voice_peers':
        this.joining = false; this.active = true; this.ice = m.ice || []; this.apply();
        for (const p of m.peers) { this.names.set(p.uid, p.username); this.connect(p.uid, true); }
        this.onChange(); break;
      case 'voice_joined': this.names.set(m.uid, m.username); this.onChange(); break;
      case 'voice_left': this.drop(m.uid); this.names.delete(m.uid); this.onChange(); break;
      case 'voice_closed': this.leave(false); break;
      case 'rtc': this.signal(m.from, m.data); break;
    }
  }

  connect(uid, offerer) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const audio = new Audio(); audio.autoplay = true;
    const peer = { pc, audio, queue: [] };
    this.peers.set(uid, peer);
    if (this.stream) this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => e.candidate && this.send({ t: 'rtc', to: uid, data: { c: e.candidate.toJSON() } });
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.drop(uid); };
    if (offerer) {
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => this.send({ t: 'rtc', to: uid, data: { sdp: pc.localDescription.toJSON() } })).catch(() => this.drop(uid));
    }
    return peer;
  }

  async signal(uid, d) {
    if (!this.active) return;
    const peer = this.peers.get(uid) || this.connect(uid, false);
    const { pc } = peer;
    try {
      if (d.sdp) {
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); this.send({ t: 'rtc', to: uid, data: { sdp: pc.localDescription.toJSON() } }); }
        for (const c of peer.queue.splice(0)) await pc.addIceCandidate(c);
      } else if (d.c) {
        pc.remoteDescription ? await pc.addIceCandidate(d.c) : peer.queue.push(d.c);
      }
    } catch { /* a bad signal from one peer must not break the others */ }
  }

  drop(uid) {
    const p = this.peers.get(uid); if (!p) return;
    p.pc.close(); p.audio.srcObject = null; this.peers.delete(uid);
  }
}
