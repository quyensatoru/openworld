// Voice, camera and screen sharing relayed through the office WebSocket (Durable Object) instead of
// peer-to-peer WebRTC: works behind any company firewall / Wi-Fi isolation, no TURN, no extra service.
//   voice  : mic → AudioWorklet (48 kHz, 20 ms frames) → Opus (WebCodecs) in 60 ms packets,
//            or 16 kHz µ-law when someone listening can't decode Opus; only while you speak
//            (singers in the karaoke room send continuously, with a cleaner, wider-band mic)
//   camera : 240x180 JPEG, 3 fps, only when someone is close enough to see it
//   screen : ≤1280 px JPEG, ~2 fps, for meeting-room TVs and the zoomable viewer
// Karaoke singers' voices go through MicFxChain (echo, reverb, EQ) on every listener.
import { MEDIA_KIND, inRange, roomVoice, zoneAt, type MediaKind } from '../../shared/map';
import type { MicFx } from '../../shared/karaoke';
import type { MediaState, PlayerState } from '../../shared/protocol';
import { MicFxChain } from '../audio/micfx';

export interface RelayHost {
  myId(): string | null;
  me(): PlayerState | null;
  player(id: string): PlayerState | null;
  playerIds(): string[];
  positionOf(id: string): { x: number; z: number } | null;
  sendBinary(data: Uint8Array): void;
  onPeersChanged(): void;
  onSpeaking(id: string, on: boolean): void;
  onPeerConnected(id: string): void;
  /** Extra volume factor for someone (karaoke: people without a mic are a bit quieter). */
  gainFor?(id: string): number;
}

export interface PeerFrameView {
  id: string;
  state: 'connected';
  cam: string | null; // object URL of the latest JPEG
  screen: string | null;
  speaking: boolean;
}

const RATE = 48000;
const FRAME = 960; // 20 ms at 48 kHz
const MU_RATE = 16000;

// ---- µ-law (G.711) ---------------------------------------------------------
function muEncode(s: number): number {
  const BIAS = 0x84;
  let x = Math.max(-32635, Math.min(32635, Math.round(s * 32767)));
  const sign = x < 0 ? 0x80 : 0;
  if (sign) x = -x;
  x += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (x & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (x >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}
const MU_TABLE = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const sign = u & 0x80;
    const exp = (u >> 4) & 0x07;
    const mant = u & 0x0f;
    let x = ((mant << 3) + 0x84) << exp;
    x -= 0x84;
    t[i] = (sign ? -x : x) / 32768;
  }
  return t;
})();

// ---- mic capture worklet (inline): resample to 48 kHz, post 20 ms frames --------------------
const WORKLET = `
class MicCapture48 extends AudioWorkletProcessor {
  constructor() { super(); this.step = sampleRate / ${RATE}; this.pos = 0; this.prev = 0; this.buf = new Float32Array(${FRAME}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const step = this.step;
    for (let i = 0; i < ch.length; i++) {
      const cur = ch[i];
      // linear interpolation between the previous and the current input sample
      while (this.pos < 1) {
        this.buf[this.n++] = this.prev + (cur - this.prev) * this.pos;
        if (this.n === ${FRAME}) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
        this.pos += step;
      }
      this.pos -= 1;
      this.prev = cur;
    }
    return true;
  }
}
registerProcessor('mic-capture-48', MicCapture48);`;

interface Remote {
  gain: GainNode;
  fx: MicFxChain | null;
  nextTime: number;
  speakingUntil: number;
  speaking: boolean;
  cam: string | null;
  screen: string | null;
  lastSeen: number;
  decoder: AudioDecoder | null;
  ts: number;
}

const hasCodecs = typeof window !== 'undefined' && 'AudioEncoder' in window && 'AudioDecoder' in window;

export class RelayMedia {
  media: MediaState = { mic: false, cam: false, screen: false, opus: false };
  onLocalMedia: ((m: MediaState, cam: MediaStream | null, screen: MediaStream | null) => void) | null = null;
  readonly hasTurn = true; // not needed any more: everything goes over the WebSocket

  private ctx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micNode: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private workletReady: Promise<void> | null = null;
  private hangUntil = 0;
  private localSpeaking = false;
  private camStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private camVideo: HTMLVideoElement | null = null;
  private screenVideo: HTMLVideoElement | null = null;
  private camTimer: number | undefined;
  private screenTimer: number | undefined;
  private remotes = new Map<string, Remote>();
  private audience = new Set<string>();
  private timer: number;
  // ---- encoding
  private encoder: AudioEncoder | null = null;
  private encOk = false;
  private encTs = 0;
  private opusOut: Uint8Array[] = [];
  private muBuf = new Float32Array(FRAME * 3);
  private muN = 0;
  // ---- singing (karaoke)
  private singing = false;
  /** The singer wears headphones: no echo canceller (nothing to cancel, and it would eat the voice). */
  private phones = false;
  private monitorOn = false;
  private monitorFx: MicFxChain | null = null;
  private monitorSrc: MediaStreamAudioSourceNode | null = null;
  private monitorOut: GainNode | null = null;
  private monitorVol = 1;
  private monitorMeter: AnalyserNode | null = null;
  private localFx: MicFx | null = null;
  /** RMS of the last mic frame (VU meter, karaoke scoring). */
  micRms = 0;
  /** Muted locally by the game (Ma Sói at night when nobody can hear you anyway). */
  private hold = false;

  constructor(private host: RelayHost) {
    this.timer = window.setInterval(() => this.housekeeping(), 300);
    if (hasCodecs) {
      AudioDecoder.isConfigSupported({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 })
        .then((r) => {
          if (r.supported) this.media = { ...this.media, opus: true };
          this.emitLocal();
        })
        .catch(() => {});
      this.setupEncoder();
    }
  }

  private audio(): AudioContext {
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // ------------------------------------------------------------------ Opus encoder
  private async setupEncoder() {
    try {
      const cfg: AudioEncoderConfig = { codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: this.singing ? 96000 : 40000 };
      const ok = await AudioEncoder.isConfigSupported(cfg);
      if (!ok.supported) return;
      if (!this.encoder || this.encoder.state === 'closed') {
        this.encoder = new AudioEncoder({
          output: (chunk) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            this.opusOut.push(data);
            if (this.opusOut.length >= 3) this.flushOpus();
          },
          error: (e) => {
            console.warn('[voice] opus encoder', e);
            this.encOk = false;
          },
        });
      }
      this.encoder.configure(cfg);
      this.encOk = true;
    } catch (err) {
      console.warn('[voice] no opus encoder', err);
      this.encOk = false;
    }
  }

  private flushOpus() {
    const frames = this.opusOut.splice(0);
    if (!frames.length) return;
    let size = 2;
    for (const f of frames) size += 2 + f.length;
    const out = new Uint8Array(size);
    out[0] = MEDIA_KIND.opus;
    out[1] = frames.length;
    let o = 2;
    for (const f of frames) {
      out[o] = f.length >> 8;
      out[o + 1] = f.length & 0xff;
      out.set(f, o + 2);
      o += 2 + f.length;
    }
    this.host.sendBinary(out);
    this.stats.sentAudio++;
    this.stats.sentOpus++;
  }

  // ------------------------------------------------------------------ who is in range (client view)
  private me(): (PlayerState & { x: number; z: number }) | null {
    const me = this.host.me();
    const pos = me && this.host.positionOf(me.id);
    return me && pos ? { ...me, x: pos.x, z: pos.z } : null;
  }

  private inRangeOf(id: string, kind: MediaKind): boolean {
    const me = this.me();
    const p = this.host.player(id);
    const pos = this.host.positionOf(id);
    if (!me || !p || !pos) return false;
    return inRange(me, { ...p, x: pos.x, z: pos.z }, kind);
  }

  private hasAudience(kind: MediaKind): boolean {
    return this.host.playerIds().some((id) => this.inRangeOf(id, kind));
  }

  /** Refresh who is around. */
  evaluate(_onlyId?: string) {
    const now = new Set(this.host.playerIds().filter((id) => this.inRangeOf(id, 'audio')));
    let changed = now.size !== this.audience.size;
    for (const id of now) {
      if (!this.audience.has(id)) {
        changed = true;
        this.host.onPeerConnected(id);
      }
    }
    this.audience = now;
    if (changed) this.host.onPeersChanged();
  }

  // ------------------------------------------------------------------ local media
  private micConstraints(): MediaTrackConstraints {
    // singing: keep the voice natural (no noise gate / automatic gain pumping on long notes); with
    // headphones also no echo canceller — it would treat the monitored voice as echo and cut it
    if (!this.singing) return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    return { echoCancellation: !this.phones, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
  }

  private async openMic() {
    const ctx = this.audio();
    this.workletReady ??= ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    const stream = await navigator.mediaDevices.getUserMedia({ audio: this.micConstraints() });
    await this.workletReady;
    this.closeMicNodes();
    this.micStream = stream;
    this.micSource = ctx.createMediaStreamSource(stream);
    this.micNode = new AudioWorkletNode(ctx, 'mic-capture-48');
    this.micNode.port.onmessage = (e) => this.onMicFrame(e.data as Float32Array);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.micSource.connect(this.micNode).connect(sink).connect(ctx.destination);
    this.applyMonitor();
  }

  private closeMicNodes() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micNode?.disconnect();
    this.micSource?.disconnect();
    this.monitorSrc?.disconnect();
    this.monitorSrc = null;
    this.micStream = null;
    this.micNode = null;
    this.micSource = null;
  }

  async setMic(on: boolean): Promise<void> {
    if (on && !this.micStream) await this.openMic();
    else if (!on && this.micStream) {
      this.closeMicNodes();
      this.setLocalSpeaking(false);
      this.micRms = 0;
    }
    this.media = { ...this.media, mic: on };
    this.emitLocal();
  }

  /** Karaoke: cleaner mic + no voice gate + higher bitrate while you hold a mic. */
  async setSinging(on: boolean, phones = this.phones) {
    if (on === this.singing && phones === this.phones) return;
    const reopen = on !== this.singing || (on && phones !== this.phones);
    const bitrate = on !== this.singing;
    this.singing = on;
    this.phones = phones;
    if (this.encOk && bitrate) void this.setupEncoder();
    if (this.micStream && reopen) await this.openMic().catch((err) => console.warn('[voice] reopen mic', err));
    this.applyMonitor();
  }

  /** Hear your own voice with the effects (headphones only, or the speakers feed back). */
  setMonitor(on: boolean, fx: MicFx | null, volume = this.monitorVol) {
    this.monitorOn = on;
    this.localFx = fx;
    this.monitorVol = volume;
    this.applyMonitor();
  }

  /** Level (RMS) coming out of the monitor, for tests / the UI. */
  monitorLevel(): number {
    const an = this.monitorMeter;
    if (!an) return 0;
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }

  private applyMonitor() {
    const want = this.monitorOn && this.singing && !!this.micStream && !!this.localFx;
    if (!want) {
      this.monitorSrc?.disconnect();
      this.monitorSrc = null;
      this.monitorFx?.dispose();
      this.monitorFx = null;
      this.monitorOut?.disconnect();
      this.monitorOut = null;
      this.monitorMeter = null;
      return;
    }
    const ctx = this.audio();
    if (!this.monitorFx) {
      this.monitorFx = new MicFxChain(ctx, this.localFx!);
      this.monitorOut = ctx.createGain();
      this.monitorMeter = ctx.createAnalyser();
      this.monitorMeter.fftSize = 1024;
      this.monitorFx.output.connect(this.monitorOut).connect(ctx.destination);
      this.monitorOut.connect(this.monitorMeter);
    } else this.monitorFx.set(this.localFx!);
    this.monitorOut!.gain.setTargetAtTime(this.monitorVol, ctx.currentTime, 0.05);
    if (!this.monitorSrc && this.micStream) {
      this.monitorSrc = ctx.createMediaStreamSource(this.micStream);
      this.monitorSrc.connect(this.monitorFx.input);
    }
  }

  /** Keep the mic open but send nothing (e.g. asleep in Ma Sói). */
  setHold(on: boolean) {
    this.hold = on;
  }

  private onMicFrame(f: Float32Array) {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    this.micRms = rms;
    const now = performance.now();
    if (rms > 0.012) this.hangUntil = now + (this.singing ? 900 : 450); // voice-activity gate with hang-over
    const talking = now < this.hangUntil;
    this.setLocalSpeaking(talking && rms > 0.02 && !this.hold);
    if (this.hold || (!talking && !this.singing) || !this.hasAudience('audio')) {
      if (this.opusOut.length) this.flushOpus();
      this.muN = 0;
      return;
    }
    if (this.useOpus()) {
      try {
        const data = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: f.length, numberOfChannels: 1, timestamp: this.encTs, data: f as Float32Array<ArrayBuffer> });
        this.encTs += (f.length / RATE) * 1e6;
        this.encoder!.encode(data);
        data.close();
      } catch (err) {
        console.warn('[voice] encode', err);
        this.encOk = false;
      }
      return;
    }
    // µ-law fallback: 3 frames → 60 ms, 48 → 16 kHz (box filter)
    this.muBuf.set(f, this.muN);
    this.muN += f.length;
    if (this.muN < this.muBuf.length) return;
    this.muN = 0;
    const n = this.muBuf.length / 3;
    const out = new Uint8Array(1 + n);
    out[0] = MEDIA_KIND.audio;
    for (let i = 0; i < n; i++) out[i + 1] = muEncode((this.muBuf[i * 3] + this.muBuf[i * 3 + 1] + this.muBuf[i * 3 + 2]) / 3);
    this.host.sendBinary(out);
    this.stats.sentAudio++;
  }

  /** Opus when we can encode it and everyone listening can decode it. */
  private useOpus(): boolean {
    if (!this.encOk || !this.encoder || this.encoder.state !== 'configured') return false;
    for (const id of this.audience) if (!this.host.player(id)?.media.opus) return false;
    return true;
  }

  private setLocalSpeaking(on: boolean) {
    if (on === this.localSpeaking) return;
    this.localSpeaking = on;
    const id = this.host.myId();
    if (id) this.host.onSpeaking(id, on);
  }

  async setCam(on: boolean): Promise<void> {
    if (on && !this.camStream) {
      this.camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } } });
      this.camVideo = hiddenVideo(this.camStream);
      this.camTimer = window.setInterval(() => this.sendFrame('cam'), 333);
    } else if (!on && this.camStream) {
      clearInterval(this.camTimer);
      this.camStream.getTracks().forEach((t) => t.stop());
      this.camStream = null;
      this.camVideo = null;
    }
    this.media = { ...this.media, cam: on };
    this.emitLocal();
  }

  async setScreen(on: boolean): Promise<void> {
    if (on && !this.screenStream) {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5 } }, audio: false });
      this.screenStream.getVideoTracks()[0].onended = () => void this.setScreen(false);
      this.screenVideo = hiddenVideo(this.screenStream);
      this.screenTimer = window.setInterval(() => this.sendFrame('screen'), 500);
    } else if (!on && this.screenStream) {
      clearInterval(this.screenTimer);
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.screenVideo = null;
    }
    this.media = { ...this.media, screen: on };
    this.emitLocal();
  }

  private sending = { cam: false, screen: false };
  private sendFrame(kind: 'cam' | 'screen') {
    const video = kind === 'cam' ? this.camVideo : this.screenVideo;
    if (!video || video.readyState < 2 || this.sending[kind] || !this.hasAudience(kind)) return;
    const maxW = kind === 'cam' ? 240 : 1280;
    const scale = Math.min(1, maxW / (video.videoWidth || maxW));
    const w = Math.max(16, Math.round((video.videoWidth || 320) * scale));
    const h = Math.max(16, Math.round((video.videoHeight || 240) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
    this.sending[kind] = true;
    canvas.toBlob(
      async (blob) => {
        this.sending[kind] = false;
        if (!blob) return;
        const body = new Uint8Array(await blob.arrayBuffer());
        const out = new Uint8Array(1 + body.length);
        out[0] = MEDIA_KIND[kind];
        out.set(body, 1);
        this.host.sendBinary(out);
        this.stats.sentFrames++;
      },
      'image/jpeg',
      kind === 'cam' ? 0.6 : 0.7,
    );
  }

  private emitLocal() {
    this.onLocalMedia?.(this.media, this.camStream, this.screenStream);
  }

  // ------------------------------------------------------------------ remote media
  onBinary(buf: ArrayBuffer) {
    const bytes = new Uint8Array(buf);
    const kind = bytes[0];
    const idLen = bytes[1];
    const id = new TextDecoder().decode(bytes.subarray(2, 2 + idLen));
    const payload = bytes.subarray(2 + idLen);
    const r = this.remote(id);
    r.lastSeen = performance.now();
    if (kind === MEDIA_KIND.audio) this.playMuLaw(id, r, payload);
    else if (kind === MEDIA_KIND.opus) this.playOpus(id, r, payload);
    else if (kind === MEDIA_KIND.cam || kind === MEDIA_KIND.screen) {
      this.stats.recvFrames++;
      const url = URL.createObjectURL(new Blob([payload.slice()], { type: 'image/jpeg' }));
      const key = kind === MEDIA_KIND.cam ? 'cam' : 'screen';
      const old = r[key];
      r[key] = url;
      if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
      this.host.onPeersChanged();
    }
  }

  private remote(id: string): Remote {
    let r = this.remotes.get(id);
    if (!r) {
      const ctx = this.audio();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      r = { gain, fx: null, nextTime: 0, speakingUntil: 0, speaking: false, cam: null, screen: null, lastSeen: performance.now(), decoder: null, ts: 0 };
      this.remotes.set(id, r);
    }
    return r;
  }

  /** Karaoke: run this person's voice through their mic effects (null = plain voice). */
  setFx(id: string, fx: MicFx | null) {
    const r = this.remote(id);
    const ctx = this.audio();
    if (!fx) {
      if (!r.fx) return;
      r.gain.disconnect();
      r.fx.dispose();
      r.fx = null;
      r.gain.connect(ctx.destination);
      return;
    }
    if (r.fx) return r.fx.set(fx);
    r.gain.disconnect();
    r.fx = new MicFxChain(ctx, fx);
    r.gain.connect(r.fx.input);
    r.fx.output.connect(ctx.destination);
  }

  /** Debug counters (visible from the console as game.rtc.stats). */
  stats = { sentAudio: 0, recvAudio: 0, sentOpus: 0, recvOpus: 0, decoded: 0, sentFrames: 0, recvFrames: 0 };

  private schedule(id: string, r: Remote, pcm: Float32Array, rate: number) {
    const ctx = this.audio();
    const buf = ctx.createBuffer(1, pcm.length, rate);
    buf.getChannelData(0).set(pcm);
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    const now = ctx.currentTime;
    // jitter buffer: start ~120 ms behind, never let latency creep above ~450 ms
    if (r.nextTime < now + 0.03 || r.nextTime > now + 0.45) r.nextTime = now + 0.12;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(r.gain);
    src.start(r.nextTime);
    r.nextTime += buf.duration;
    if (Math.sqrt(sum / pcm.length) > 0.025) {
      r.speakingUntil = performance.now() + 350;
      if (!r.speaking) {
        r.speaking = true;
        this.host.onSpeaking(id, true);
      }
    }
  }

  private playMuLaw(id: string, r: Remote, payload: Uint8Array) {
    this.stats.recvAudio++;
    const pcm = new Float32Array(payload.length);
    for (let i = 0; i < payload.length; i++) pcm[i] = MU_TABLE[payload[i]];
    this.schedule(id, r, pcm, MU_RATE);
  }

  private playOpus(id: string, r: Remote, payload: Uint8Array) {
    this.stats.recvAudio++;
    this.stats.recvOpus++;
    if (!hasCodecs) return;
    if (!r.decoder || r.decoder.state === 'closed') {
      try {
        r.decoder = new AudioDecoder({
          output: (data) => {
            const pcm = new Float32Array(data.numberOfFrames);
            try {
              data.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
            } catch {
              data.copyTo(pcm, { planeIndex: 0 });
            }
            const rate = data.sampleRate;
            data.close();
            this.stats.decoded++;
            this.schedule(id, r, pcm, rate);
          },
          error: (e) => {
            console.warn('[voice] opus decoder', e);
            r.decoder = null;
          },
        });
        r.decoder.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 });
      } catch (err) {
        console.warn('[voice] no opus decoder', err);
        return;
      }
    }
    const n = payload[0];
    let o = 1;
    for (let i = 0; i < n && o + 2 <= payload.length; i++) {
      const len = (payload[o] << 8) | payload[o + 1];
      o += 2;
      if (o + len > payload.length) break;
      try {
        r.decoder!.decode(new EncodedAudioChunk({ type: 'key', timestamp: r.ts, data: payload.subarray(o, o + len) }));
      } catch {
        /* corrupt / closed */
      }
      r.ts += 20_000;
      o += len;
    }
  }

  private housekeeping() {
    this.evaluate();
    const me = this.me();
    const now = performance.now();
    const room = me ? roomVoice(zoneAt(me.x, me.z)) : false;
    for (const [id, r] of this.remotes) {
      if (r.speaking && now > r.speakingUntil) {
        r.speaking = false;
        this.host.onSpeaking(id, false);
      }
      // distance volume (full volume inside a meeting room / karaoke / the werewolf village)
      const pos = this.host.positionOf(id);
      if (me && pos && this.ctx) {
        const d = Math.hypot(me.x - pos.x, me.z - pos.z);
        const vol = (room ? 1 : Math.max(0.15, Math.min(1, 1 - (d - 2) / 4.5))) * (this.host.gainFor?.(id) ?? 1);
        r.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
      }
      // drop frames from people who stopped sending (cam/screen off or walked away)
      if (now - r.lastSeen > 4000 && (r.cam || r.screen)) {
        if (r.cam) URL.revokeObjectURL(r.cam);
        if (r.screen) URL.revokeObjectURL(r.screen);
        r.cam = r.screen = null;
        this.host.onPeersChanged();
      }
      if (!this.host.player(id)) this.drop(id);
    }
  }

  private drop(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.gain.disconnect();
    r.fx?.dispose();
    try {
      if (r.decoder && r.decoder.state !== 'closed') r.decoder.close();
    } catch {
      /* ignore */
    }
    this.remotes.delete(id);
    this.host.onPeersChanged();
  }

  peerViews(): PeerFrameView[] {
    const ids = new Set([...this.audience, ...[...this.remotes.entries()].filter(([, r]) => r.cam || r.screen).map(([id]) => id)]);
    return [...ids]
      .filter((id) => this.host.player(id))
      .map((id) => {
        const r = this.remotes.get(id);
        return { id, state: 'connected' as const, cam: r?.cam ?? null, screen: r?.screen ?? null, speaking: r?.speaking ?? false };
      });
  }

  // compatibility no-ops with the old WebRTC module
  onSignal() {}
  onBye() {}
  onPlayerLeft(id: string) {
    this.drop(id);
    this.audience.delete(id);
    this.host.onPeersChanged();
  }
  reset() {}

  dispose() {
    clearInterval(this.timer);
    void this.setMic(false);
    void this.setCam(false);
    void this.setScreen(false);
    try {
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    } catch {
      /* ignore */
    }
    this.ctx?.close().catch(() => {});
  }
}

function hiddenVideo(stream: MediaStream): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  v.play().catch(() => {});
  return v;
}
