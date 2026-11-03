// Proximity voice/video: a WebRTC mesh where peers connect when they are close (or in the same
// meeting room) and disconnect when they walk away. Signaling goes through the office WebSocket.
//
// Every connection is created with three fixed transceivers [audio, camera, screen] so turning the
// mic/cam/screen on or off is just `replaceTrack` — no renegotiation, no glare.
import { voiceMode, zoneAt } from '../../shared/map';
import type { MediaState, PlayerState } from '../../shared/protocol';

export interface RtcHost {
  myId(): string | null;
  me(): PlayerState | null;
  player(id: string): PlayerState | null;
  playerIds(): string[];
  positionOf(id: string): { x: number; z: number } | null;
  signal(to: string, data: unknown): void;
  bye(to: string): void;
  onPeersChanged(): void;
  onSpeaking(id: string, on: boolean): void; // id may be the local player
  onPeerConnected(id: string): void;
  onPeerFailed(id: string): void;
}

type Slot = 0 | 1 | 2; // audio, camera, screen
type Signal = { type: 'offer' | 'answer'; sdp: string } | { type: 'ice'; candidate: RTCIceCandidateInit } | { type: 'restart' };

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  initiator: boolean;
  pendingIce: RTCIceCandidateInit[];
  remoteSet: boolean;
  audioEl: HTMLAudioElement;
  streams: [MediaStream, MediaStream, MediaStream];
  analyser: AnalyserNode | null;
  speaking: boolean;
  connectedOnce: boolean;
  failTimer: number | undefined;
}

export const VOICE_NEAR = 4.5;
const NEAR = VOICE_NEAR;
const FAR = 6.0;

export class ProximityRTC {
  private peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  private mic: MediaStreamTrack | null = null;
  private cam: MediaStreamTrack | null = null;
  private screen: MediaStreamTrack | null = null;
  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localSpeaking = false;
  private timer: number;
  private meterTimer: number;
  private lastEval = 0;
  media: MediaState = { mic: false, cam: false, screen: false };
  onLocalMedia: ((m: MediaState, cam: MediaStream | null, screen: MediaStream | null) => void) | null = null;

  private iceTimer: number;
  hasTurn = false;

  constructor(private host: RtcHost) {
    this.timer = window.setInterval(() => this.evaluate(), 1000);
    this.meterTimer = window.setInterval(() => this.meter(), 120);
    this.loadIce();
    this.iceTimer = window.setInterval(() => this.loadIce(), 4 * 3600_000); // TURN credentials expire
  }

  private loadIce() {
    fetch('/api/ice')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.iceServers?.length) {
          this.iceServers = j.iceServers;
          this.hasTurn = JSON.stringify(j.iceServers).includes('turn:');
        }
      })
      .catch(() => {});
  }

  // ------------------------------------------------------------------ connection rules
  private want(id: string): boolean {
    const me = this.host.me();
    const other = this.host.player(id);
    if (!me || !other) return false;
    const a = this.host.positionOf(me.id);
    const b = this.host.positionOf(id);
    if (!a || !b) return false;
    const za = zoneAt(a.x, a.z);
    const zb = zoneAt(b.x, b.z);
    if (za.kind === 'meeting' || zb.kind === 'meeting') return za.id === zb.id;
    if (voiceMode(za) === 'none' || voiceMode(zb) === 'none') return false;
    if (me.status === 'focus' || other.status === 'focus' || me.status === 'away' || other.status === 'away') return false;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    return d < (this.peers.has(id) ? FAR : NEAR);
  }

  /** Re-check who we should be connected to. Cheap; called on every movement message. */
  evaluate(onlyId?: string) {
    const myId = this.host.myId();
    if (!myId) return;
    const now = performance.now();
    if (!onlyId) this.lastEval = now;
    const ids = onlyId ? [onlyId] : this.host.playerIds();
    for (const id of ids) {
      if (id === myId) continue;
      const want = this.want(id);
      const peer = this.peers.get(id);
      // Only the initiator (smaller id) opens or closes connections; the other side follows.
      const iAmInitiator = myId < id;
      if (want && !peer && iAmInitiator) this.open(id, true);
      else if (!want && peer && peer.initiator) this.close(id, true);
    }
    for (const id of this.peers.keys()) if (!this.host.player(id)) this.close(id, false);
    this.updateVolumes();
  }

  // ------------------------------------------------------------------ peers
  private open(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audioEl = new Audio();
    audioEl.autoplay = true;
    const peer: Peer = {
      id,
      pc,
      initiator,
      pendingIce: [],
      remoteSet: false,
      audioEl,
      streams: [new MediaStream(), new MediaStream(), new MediaStream()],
      analyser: null,
      speaking: false,
      connectedOnce: false,
      failTimer: undefined,
    };
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.host.signal(id, { type: 'ice', candidate: e.candidate.toJSON() } satisfies Signal);
    };
    pc.ontrack = (e) => {
      const idx = pc.getTransceivers().indexOf(e.transceiver) as Slot;
      const stream = peer.streams[idx] ?? peer.streams[0];
      for (const t of stream.getTracks()) stream.removeTrack(t);
      stream.addTrack(e.track);
      if (idx === 0) {
        audioEl.srcObject = stream;
        audioEl.play().catch(() => {});
        this.attachAnalyser(peer, stream);
      }
      this.host.onPeersChanged();
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected' && !peer.connectedOnce) {
        peer.connectedOnce = true;
        this.host.onPeerConnected(id);
      }
      if (st === 'failed') this.host.onPeerFailed(id);
      if (st === 'failed' && peer.initiator) {
        clearTimeout(peer.failTimer);
        peer.failTimer = window.setTimeout(() => {
          if (this.peers.get(id) === peer && pc.connectionState === 'failed') {
            this.close(id, true);
            this.evaluate(id);
          }
        }, 1500);
      }
      this.host.onPeersChanged();
    };

    if (initiator) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      this.attachLocalTracks(peer);
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.host.signal(id, { type: 'offer', sdp: pc.localDescription!.sdp } satisfies Signal))
        .catch((err) => console.warn('[rtc] offer failed', err));
    }
    this.host.onPeersChanged();
    return peer;
  }

  private attachLocalTracks(peer: Peer) {
    const tr = peer.pc.getTransceivers();
    const tracks = [this.mic, this.cam, this.screen];
    tr.slice(0, 3).forEach((t, i) => {
      t.direction = 'sendrecv';
      t.sender.replaceTrack(tracks[i]).catch(() => {});
    });
  }

  private close(id: string, notify: boolean) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    clearTimeout(peer.failTimer);
    try {
      peer.pc.close();
    } catch {
      /* ignore */
    }
    peer.audioEl.srcObject = null;
    peer.analyser?.disconnect();
    if (peer.speaking) this.host.onSpeaking(id, false);
    if (notify) this.host.bye(id);
    this.host.onPeersChanged();
  }

  async onSignal(from: string, data: Signal) {
    try {
      if (data.type === 'offer') {
        const old = this.peers.get(from);
        if (old) this.close(from, false);
        const peer = this.open(from, false);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        peer.remoteSet = true;
        this.attachLocalTracks(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.host.signal(from, { type: 'answer', sdp: peer.pc.localDescription!.sdp } satisfies Signal);
        await this.flushIce(peer);
      } else if (data.type === 'answer') {
        const peer = this.peers.get(from);
        if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        peer.remoteSet = true;
        await this.flushIce(peer);
      } else if (data.type === 'ice') {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.remoteSet) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pendingIce.push(data.candidate);
      }
    } catch (err) {
      console.warn('[rtc] signal failed', err);
    }
  }

  private async flushIce(peer: Peer) {
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  onBye(from: string) {
    this.close(from, false);
  }

  onPlayerLeft(id: string) {
    this.close(id, false);
  }

  // ------------------------------------------------------------------ local media
  async setMic(on: boolean): Promise<void> {
    if (on && !this.mic) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.mic = s.getAudioTracks()[0];
      this.localAnalyser = this.makeAnalyser(new MediaStream([this.mic]));
    } else if (!on && this.mic) {
      this.mic.stop();
      this.mic = null;
      this.localAnalyser?.disconnect();
      this.localAnalyser = null;
      if (this.localSpeaking) {
        this.localSpeaking = false;
        const id = this.host.myId();
        if (id) this.host.onSpeaking(id, false);
      }
    }
    this.media = { ...this.media, mic: on };
    this.pushTracks(0, this.mic);
    this.emitLocal();
  }

  async setCam(on: boolean): Promise<void> {
    if (on && !this.cam) {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } });
      this.cam = s.getVideoTracks()[0];
    } else if (!on && this.cam) {
      this.cam.stop();
      this.cam = null;
    }
    this.media = { ...this.media, cam: on };
    this.pushTracks(1, this.cam);
    this.emitLocal();
  }

  async setScreen(on: boolean): Promise<void> {
    if (on && !this.screen) {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
      this.screen = s.getVideoTracks()[0];
      this.screen.contentHint = 'detail';
      this.screen.onended = () => void this.setScreen(false);
    } else if (!on && this.screen) {
      this.screen.stop();
      this.screen = null;
    }
    this.media = { ...this.media, screen: on };
    this.pushTracks(2, this.screen);
    this.emitLocal();
  }

  private pushTracks(slot: Slot, track: MediaStreamTrack | null) {
    for (const p of this.peers.values()) {
      const t = p.pc.getTransceivers()[slot];
      if (t) t.sender.replaceTrack(track).catch(() => {});
    }
  }

  private emitLocal() {
    this.onLocalMedia?.(this.media, this.cam ? new MediaStream([this.cam]) : null, this.screen ? new MediaStream([this.screen]) : null);
  }

  // ------------------------------------------------------------------ audio levels & volume
  private ctx(): AudioContext {
    this.audioCtx ??= new AudioContext();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
    return this.audioCtx;
  }

  private makeAnalyser(stream: MediaStream): AnalyserNode | null {
    try {
      const ctx = this.ctx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      return an;
    } catch {
      return null;
    }
  }

  private attachAnalyser(peer: Peer, stream: MediaStream) {
    peer.analyser?.disconnect();
    peer.analyser = this.makeAnalyser(stream);
  }

  private level(an: AnalyserNode): number {
    const buf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    return Math.sqrt(sum / buf.length);
  }

  private meter() {
    for (const p of this.peers.values()) {
      if (!p.analyser) continue;
      const on = this.level(p.analyser) > 0.035 && this.host.player(p.id)?.media.mic === true;
      if (on !== p.speaking) {
        p.speaking = on;
        this.host.onSpeaking(p.id, on);
      }
    }
    if (this.localAnalyser) {
      const on = this.level(this.localAnalyser) > 0.04;
      if (on !== this.localSpeaking) {
        this.localSpeaking = on;
        const id = this.host.myId();
        if (id) this.host.onSpeaking(id, on);
      }
    }
    // Volume follows distance between evaluations so walking away fades smoothly.
    if (performance.now() - this.lastEval > 250) this.updateVolumes();
  }

  private updateVolumes() {
    const myId = this.host.myId();
    if (!myId) return;
    const a = this.host.positionOf(myId);
    if (!a) return;
    const za = zoneAt(a.x, a.z);
    for (const p of this.peers.values()) {
      const b = this.host.positionOf(p.id);
      if (!b) continue;
      let vol = 1;
      if (za.kind !== 'meeting') {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        vol = Math.max(0.15, Math.min(1, 1 - (d - 2) / 4.5));
      }
      p.audioEl.volume = vol;
    }
  }

  // ------------------------------------------------------------------ views for the UI
  peerViews() {
    return [...this.peers.values()].map((p) => ({
      id: p.id,
      state: p.pc.connectionState,
      cam: p.streams[1].getVideoTracks().length ? p.streams[1] : null,
      screen: p.streams[2].getVideoTracks().length ? p.streams[2] : null,
      speaking: p.speaking,
    }));
  }

  get localStreams() {
    return { cam: this.cam ? new MediaStream([this.cam]) : null, screen: this.screen ? new MediaStream([this.screen]) : null };
  }

  /** Called when our own socket reconnects: everything restarts from scratch. */
  reset() {
    for (const id of [...this.peers.keys()]) this.close(id, false);
  }

  dispose() {
    clearInterval(this.timer);
    clearInterval(this.meterTimer);
    clearInterval(this.iceTimer);
    this.reset();
    this.mic?.stop();
    this.cam?.stop();
    this.screen?.stop();
    this.audioCtx?.close().catch(() => {});
  }
}
