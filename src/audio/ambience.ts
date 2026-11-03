// Office ambience synthesised with WebAudio (no sound files): air-conditioning hum, keyboards of
// people typing near you (panned left/right), footsteps, the coffee machine, the lift chime and the
// bar's techno track (drum machine + bass + chord stabs, locked to the shared server clock so
// everyone in the bar hears the same beat). Also the mini-games' one-shot stings (sfx), the Nội Gián
// tension bed (drone + heartbeat) and the floor-5 facility hum — all synthesised live, no samples.

export const MUSIC_BPM = 124;
const STEP = 60 / MUSIC_BPM / 4; // a 16th note
/** 4-bar loop: Am7 · Fmaj7 · C · G (bass root + chord tones). */
const PROG = [
  { root: 55.0, chord: [220.0, 261.63, 329.63, 392.0] },
  { root: 43.65, chord: [174.61, 220.0, 261.63, 329.63] },
  { root: 65.41, chord: [196.0, 261.63, 329.63, 392.0] },
  { root: 49.0, chord: [196.0, 246.94, 293.66, 392.0] },
];

interface MusicBus {
  bus: GainNode;
  filter: BiquadFilterNode;
  send: GainNode;
  nextStep: number;
  nextTime: number;
}

export interface Listener {
  x: number;
  z: number;
  yaw: number; // camera yaw (forward = (-sin, -cos))
}

export interface Typist {
  id: string;
  x: number;
  z: number;
}

interface TypistState {
  next: number;
  burstLeft: number;
}

/** Every synthesized one-shot that `Ambience.sfx()` can play. */
export type SfxKind =
  | 'howl' | 'dawn' | 'gavel' | 'death' | 'win' | 'lose' | 'applause' | 'drumroll' | 'flip' | 'tick'
  | 'siren' | 'powerdown' | 'task' | 'meeting' | 'stab' | 'body' | 'report' | 'eject' | 'type' | 'shh' | 'reveal'
  | 'door' | 'doorLock' | 'vent' | 'ventMove' | 'kill';

/** Where every sfx goes: a soft clipper into the master, plus a send into a shared synthetic room reverb. */
interface SfxBus {
  input: GainNode;
  verb: GainNode;
}

/** The floor-5 facility bed (ventilation + engine room) and the sources to stop when it fades out. */
interface FacilityHum {
  gain: GainNode;
  srcs: AudioScheduledSourceNode[];
}

/** Waveshaper curve: transparent below ±0.6, then rounds smoothly towards ±1 so stacked stings never clip.
 *  The shaper is fed the signal ×0.5 (domain −2..2) and its output is doubled again. */
function softClipCurve() {
  const n = 4097;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * 4 - 2;
    const a = Math.abs(s);
    c[i] = (Math.sign(s) * (a <= 0.6 ? a : 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4))) / 2;
  }
  return c;
}

/** A synthetic stereo room impulse (decorrelated noise, darker as it decays, −60 dB at the end). */
function roomImpulse(ctx: BaseAudioContext, seconds: number) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  const pre = Math.floor(rate * 0.012);
  const fade = rate * 0.004;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = i / len;
      lp += (0.7 - 0.6 * x) * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-6.9 * x) * Math.min(1, (i - pre) / fade);
    }
  }
  return buf;
}

/** Brown-ish noise whose end is tilted to meet its start, so it loops without a thump. */
function brownNoise(ctx: BaseAudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  const tilt = (d[d.length - 1] - d[0]) / (d.length - 1);
  for (let i = 0; i < d.length; i++) d[i] -= tilt * i;
  return buf;
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private typists = new Map<string, TypistState>();
  private enabled = true;
  private volume = 0.6;
  private quietZone = false;
  private music: MusicBus | null = null;
  private musicLevel = 0;
  private musicCutoff = 18000;
  /** Shared clock in seconds (server time), so the beat is the same for everyone. */
  clock: () => number = () => Date.now() / 1000;

  constructor(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = volume;
  }

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.enabled && !document.hidden) this.ctx.resume().catch(() => {});
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);

    // 2 s of white noise reused by every effect
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // HVAC: brown-ish noise, low-passed, very quiet
    const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = brown;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    this.hum = ctx.createGain();
    this.hum.gain.value = this.roomTone();
    src.connect(lp).connect(this.hum).connect(this.master);
    src.start();
    if (this.facilityOn) this.applyHum(); // setHum(true) arrived before the first user gesture
    if (document.hidden) ctx.suspend().catch(() => {});
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.2);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  /** Quieter room tone in the cinema / library. */
  setQuietZone(q: boolean) {
    this.quietZone = q;
    if (this.hum && this.ctx) this.hum.gain.setTargetAtTime(this.roomTone(), this.ctx.currentTime, 0.8);
  }

  /** Office HVAC level: quiet zones are hushed, and it ducks under the floor-5 facility hum. */
  private roomTone() {
    return this.quietZone ? 0.06 : this.facilityOn ? 0.12 : 0.22;
  }

  setVisible(visible: boolean) {
    if (!this.ctx) return;
    if (visible) this.ctx.resume().catch(() => {});
    else this.ctx.suspend().catch(() => {});
  }

  private burst(opts: { gain: number; pan: number; freq: number; q: number; dur: number; type?: BiquadFilterType; at?: number; to?: AudioNode }) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || ctx.state !== 'running') return;
    const t = opts.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan));
    src.connect(f).connect(g).connect(p).connect(opts.to ?? this.master);
    src.start(t, Math.random() * 1.5, opts.dur + 0.05);
  }

  private spatial(l: Listener, x: number, z: number): { gain: number; pan: number } {
    const dx = x - l.x;
    const dz = z - l.z;
    const d = Math.hypot(dx, dz);
    // listener's right-hand vector for forward (-sin yaw, -cos yaw) is (cos yaw, -sin yaw)
    const pan = d < 0.01 ? 0 : ((dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw)) / d) * 0.8;
    return { gain: 1 / (1 + (d * d) / 6), pan };
  }

  /** Called ~20 times per second with the people currently typing at desks. */
  tick(l: Listener, typists: Typist[]) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.enabled || this.quietZone) return;
    const now = ctx.currentTime;
    const seen = new Set<string>();
    for (const t of typists) {
      const { gain, pan } = this.spatial(l, t.x, t.z);
      if (gain < 0.06) continue;
      seen.add(t.id);
      let st = this.typists.get(t.id);
      if (!st) this.typists.set(t.id, (st = { next: now + Math.random() * 2, burstLeft: 0 }));
      while (st.next < now + 0.06) {
        if (st.burstLeft <= 0) {
          st.burstLeft = 4 + Math.floor(Math.random() * 14);
          st.next += 0.6 + Math.random() * 2.8; // think pause between bursts
          continue;
        }
        st.burstLeft--;
        const space = Math.random() < 0.12;
        this.burst({ gain: 0.09 * gain * (space ? 1.3 : 1), pan, freq: space ? 1400 : 2600 + Math.random() * 1800, q: 1.4, dur: space ? 0.05 : 0.028, at: Math.max(now, st.next) });
        st.next += 0.07 + Math.random() * 0.12;
      }
    }
    for (const id of this.typists.keys()) if (!seen.has(id)) this.typists.delete(id);
  }

  step(l: Listener, x: number, z: number, run: boolean, self: boolean) {
    const { gain, pan } = self ? { gain: 1, pan: 0 } : this.spatial(l, x, z);
    if (gain < 0.05) return;
    const g = (self ? 0.14 : 0.1) * gain * (run ? 1.3 : 1);
    this.burst({ gain: g, pan, freq: 180 + Math.random() * 60, q: 0.9, dur: 0.11, type: 'lowpass' });
    this.burst({ gain: g * 0.35, pan, freq: 2200, q: 2, dur: 0.03 });
  }

  coffee() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 26; i++) this.burst({ gain: 0.05, pan: 0.2, freq: 900 + Math.random() * 400, q: 3, dur: 0.09, at: t + i * 0.07 }); // grinder
    for (let i = 0; i < 12; i++) this.burst({ gain: 0.035, pan: 0.2, freq: 5200, q: 0.6, dur: 0.25, type: 'highpass', at: t + 2 + i * 0.2 }); // steam
  }

  /** Glasses clinking. */
  clink() {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    for (const [f, d, g] of [[2637, 0.9, 0.08], [3951, 0.6, 0.05], [2793, 0.8, 0.06]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(g, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(gn).connect(this.master);
      o.start(t);
      o.stop(t + d + 0.02);
    }
  }

  /** Camera shutter. */
  shutter() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.burst({ gain: 0.18, pan: 0, freq: 3000, q: 0.8, dur: 0.05, type: 'highpass', at: t });
    this.burst({ gain: 0.12, pan: 0, freq: 1800, q: 1, dur: 0.07, at: t + 0.09 });
  }

  /** One click of the lucky wheel. */
  wheelTick() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.burst({ gain: 0.07, pan: -0.2, freq: 2400, q: 3, dur: 0.025 });
  }

  /** Two-tone lift chime. */
  ding() {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [988, 784].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t0 = t + i * 0.32;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + 0.95);
    });
  }

  // ------------------------------------------------------------------ game sounds (karaoke, Ma Sói, Nội Gián)
  private sfxBus: SfxBus | null = null;

  /** Soft clipper → master, plus a shared synthetic room reverb (one convolver for every sfx). */
  private ensureSfxBus(ctx: AudioContext, master: GainNode): SfxBus {
    if (this.sfxBus) return this.sfxBus;
    const input = ctx.createGain();
    input.gain.value = 0.5; // the clip curve's domain is ±2
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    const post = ctx.createGain();
    post.gain.value = 2;
    input.connect(clip).connect(post).connect(master);
    const verb = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = roomImpulse(ctx, 2.2);
    const ret = ctx.createGain();
    ret.gain.value = 0.8;
    verb.connect(conv).connect(ret).connect(input);
    return (this.sfxBus = { input, verb });
  }

  /** Short synthesized effects; all go through the master volume. */
  sfx(kind: SfxKind) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running') return;
    const { input: out, verb } = this.ensureSfxBus(ctx, master);
    const t = ctx.currentTime + 0.01; // a hair of lookahead so the sharp attacks land intact

    // ---- building blocks
    const osc = (type: OscillatorType, f: number, t0: number, t1: number, peak: number, to: AudioNode = out) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, (t1 - t0) / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      o.connect(g).connect(to);
      o.start(t0);
      o.stop(t1 + 0.05);
      return o;
    };
    /** Filtered noise with a fast (or given) attack and an exponential decay; returns the filter so it can sweep. */
    const noise = (t0: number, dur: number, peak: number, type: BiquadFilterType, f: number, q = 1, to: AudioNode = out, attack = 0.005) => {
      if (!this.noise) return null;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true; // long sweeps would otherwise run off the end of the 2 s buffer
      const bp = ctx.createBiquadFilter();
      bp.type = type;
      bp.frequency.setValueAtTime(f, t0);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp).connect(g).connect(to);
      src.start(t0, Math.random() * 1.5, dur + 0.05);
      return bp;
    };
    const filter = (type: BiquadFilterType, f: number, q: number, to: AudioNode) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      b.connect(to);
      return b;
    };
    /** A sub-mix: dry to the output plus an optional send into the room reverb. */
    const group = (level: number, wet = 0, to: AudioNode = out) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(to);
      if (wet > 0) {
        const s = ctx.createGain();
        s.gain.value = wet;
        g.connect(s).connect(verb);
      }
      return g;
    };
    const panner = (from: number, toPan: number, t0: number, t1: number, to: AudioNode) => {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(from, t0);
      p.pan.linearRampToValueAtTime(toPan, t1);
      p.connect(to);
      return p;
    };
    /** A gated tone (fast attack, held, short release) — alarms and klaxons. */
    const tone = (type: OscillatorType, f: number, t0: number, t1: number, peak: number, to: AudioNode = out, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t0);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
      g.gain.setValueAtTime(peak, t1 - 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      o.connect(g).connect(to);
      o.start(t0);
      o.stop(t1 + 0.03);
      return o;
    };
    /** A pitched-down body hit; `grit` adds a low-passed saw copy so the punch survives laptop speakers. */
    const thud = (t0: number, f0: number, f1: number, dur: number, peak: number, to: AudioNode = out, grit = 0) => {
      const voice = (type: OscillatorType, p: number, dest: AudioNode) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t0);
        o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.6);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(p, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(dest);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
      };
      voice('sine', peak, to);
      if (grit > 0) {
        const lp = filter('lowpass', f0 * 5, 0.7, to);
        lp.frequency.setValueAtTime(f0 * 5, t0);
        lp.frequency.exponentialRampToValueAtTime(Math.max(f1 * 3, 90), t0 + dur * 0.5);
        voice('sawtooth', peak * grit, lp);
      }
    };
    /** Two-operator FM strike: a non-integer ratio + a decaying index = clanging metal, integer = glassy pluck. */
    const fm = (t0: number, f: number, ratio: number, index: number, dur: number, peak: number, to: AudioNode = out) => {
      const c = ctx.createOscillator();
      c.frequency.value = f;
      const m = ctx.createOscillator();
      m.frequency.value = f * ratio;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(index * f * ratio, t0);
      depth.gain.exponentialRampToValueAtTime(index * f * ratio * 0.04, t0 + dur * 0.7);
      m.connect(depth).connect(c.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      c.connect(g).connect(to);
      c.start(t0);
      m.start(t0);
      c.stop(t0 + dur + 0.05);
      m.stop(t0 + dur + 0.05);
    };
    /** Brassy synth voice: two detuned saws, a filter that snaps open then closes, decay to `sus`, sag, release. */
    const brass = (f: number, t0: number, t1: number, peak: number, to: AudioNode = out, bright = 2600, sus = 0.6, bend = 0) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(Math.min(f * 1.5, bright), t0);
      lp.frequency.exponentialRampToValueAtTime(bright, t0 + 0.04);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, bright * 0.35), t1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.025);
      if (t1 - t0 > 0.55) {
        const rel = Math.min(0.5, (t1 - t0) * 0.4);
        g.gain.exponentialRampToValueAtTime(peak * sus, t0 + 0.25);
        g.gain.exponentialRampToValueAtTime(peak * sus * 0.5, t1 - rel);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      lp.connect(g).connect(to);
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t0);
        if (bend) o.frequency.exponentialRampToValueAtTime(bend, t1);
        o.detune.value = det;
        o.connect(lp);
        o.start(t0);
        o.stop(t1 + 0.05);
      }
    };
    /** Slow swell up (35 %) and back down: pads and drones. */
    const pad = (type: OscillatorType, f: number, t0: number, t1: number, peak: number, to: AudioNode = out) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + (t1 - t0) * 0.35);
      g.gain.linearRampToValueAtTime(0, t1);
      o.connect(g).connect(to);
      o.start(t0);
      o.stop(t1 + 0.05);
      return o;
    };
    /** A short damped feedback comb: whatever goes in sounds like it is inside a metal tube.
     *  The loop is cut after `life` seconds so the nodes can be collected. */
    const hollow = (delay: number, feedback: number, life: number, to: AudioNode) => {
      const inp = ctx.createGain();
      const d = ctx.createDelay(0.05);
      d.delayTime.value = delay;
      const damp = filter('lowpass', 2600, 0.5, to);
      const fb = ctx.createGain();
      fb.gain.value = feedback;
      inp.connect(to);
      inp.connect(d).connect(damp);
      damp.connect(fb).connect(d);
      window.setTimeout(() => fb.disconnect(), (life + 0.5) * 1000);
      return inp;
    };

    switch (kind) {
      case 'howl': {
        // a distant wolf: gliding, vibrato'd voice through a formant band, with an echo
        const bus = ctx.createGain();
        bus.gain.value = 0.9;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1100;
        bp.Q.value = 0.9;
        const echo = ctx.createDelay(1);
        echo.delayTime.value = 0.32;
        const fb = ctx.createGain();
        fb.gain.value = 0.32;
        bus.connect(bp).connect(out);
        bp.connect(echo).connect(fb).connect(echo);
        fb.connect(out);
        for (const [type, mul, peak] of [['sawtooth', 1, 0.05], ['sine', 1, 0.09], ['sine', 2, 0.02]] as const) {
          const o = ctx.createOscillator();
          o.type = type;
          const f = o.frequency;
          f.setValueAtTime(330 * mul, t);
          f.exponentialRampToValueAtTime(610 * mul, t + 0.7);
          f.setValueAtTime(610 * mul, t + 0.7);
          f.exponentialRampToValueAtTime(560 * mul, t + 2.0);
          f.exponentialRampToValueAtTime(300 * mul, t + 2.9);
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 5.2;
          const lg = ctx.createGain();
          lg.gain.value = 9 * mul;
          lfo.connect(lg).connect(f);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(peak, t + 0.45);
          g.gain.setValueAtTime(peak, t + 2.1);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
          o.connect(g).connect(bus);
          o.start(t);
          lfo.start(t);
          o.stop(t + 3.1);
          lfo.stop(t + 3.1);
        }
        window.setTimeout(() => fb.disconnect(), 6000); // let the echo die, then break its loop
        return;
      }
      case 'dawn': {
        // birds + a warm bell chord
        for (let i = 0; i < 7; i++) {
          const t0 = t + 0.15 + i * 0.13 + (i > 3 ? 0.35 : 0);
          const o = osc('sine', 2600 + Math.random() * 600, t0, t0 + 0.09, 0.05);
          o.frequency.exponentialRampToValueAtTime(4000 + Math.random() * 600, t0 + 0.08);
        }
        [523.25, 659.25, 783.99].forEach((f, i) => osc('sine', f, t + i * 0.05, t + 2.2, 0.06));
        return;
      }
      case 'gavel':
        noise(t, 0.09, 0.5, 'lowpass', 900);
        osc('sine', 170, t, t + 0.18, 0.25);
        noise(t + 0.22, 0.08, 0.35, 'lowpass', 900);
        osc('sine', 160, t + 0.22, t + 0.4, 0.2);
        return;
      case 'death': {
        const o = osc('sine', 95, t, t + 0.9, 0.35);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.85);
        noise(t, 0.25, 0.18, 'lowpass', 400);
        [220, 261.63, 311.13].forEach((f) => osc('triangle', f, t + 0.1, t + 1.8, 0.025));
        return;
      }
      case 'win': {
        // victory fanfare: three brass pickups into a big C-major chord, timpani + cymbal, a sub and sparkles
        const fan = group(1, 0.3);
        [392, 523.25, 659.25].forEach((f, i) => brass(f, t + i * 0.11, t + i * 0.11 + 0.16, 0.04, fan, 3000, 0.8));
        const h = t + 0.36;
        for (const f of [261.63, 329.63, 392, 523.25, 659.25]) brass(f, h, h + 2.3, 0.024, fan, 3000, 0.6);
        thud(h, 98, 70, 0.9, 0.3, out, 0.25);
        noise(h, 1.6, 0.1, 'highpass', 5000, 0.7, group(1, 0.4));
        osc('sine', 65.41, h, h + 2.0, 0.12);
        [2093, 2637.02, 3135.96, 4186.01].forEach((f, i) => osc('sine', f, h + 0.05 + i * 0.07, h + 0.5 + i * 0.07, 0.014, fan));
        return;
      }
      case 'lose': {
        // defeat: a falling minor brass line whose last note sags flat, a heavy low boom, a dark diminished drone
        const line = group(1, 0.35);
        brass(392, t, t + 0.3, 0.035, line, 2200, 0.8);
        brass(311.13, t + 0.28, t + 0.58, 0.035, line, 2000, 0.8);
        brass(261.63, t + 0.56, t + 2.4, 0.035, line, 1800, 0.6, 246.94);
        thud(t + 0.56, 70, 32, 1.4, 0.34, out, 0.3);
        const dark = filter('lowpass', 420, 0.7, group(1, 0.4));
        for (const f of [65.41, 77.78, 92.5]) pad('sawtooth', f, t + 0.56, t + 2.9, 0.03, dark);
        return;
      }
      case 'applause':
        for (let i = 0; i < 70; i++) noise(t + Math.random() * 1.8 * (i / 70 + 0.3), 0.03 + Math.random() * 0.03, 0.06 + Math.random() * 0.08, 'bandpass', 1400 + Math.random() * 2200, 1.2);
        return;
      case 'drumroll':
        for (let i = 0; i < 28; i++) noise(t + i * 0.045, 0.05, 0.05 + (i / 28) * 0.12, 'bandpass', 900, 0.8);
        osc('sine', 110, t + 1.3, t + 1.8, 0.3);
        noise(t + 1.3, 0.6, 0.25, 'highpass', 5000);
        [523.25, 659.25, 783.99, 1046.5].forEach((f) => osc('triangle', f, t + 1.3, t + 2.6, 0.05));
        return;
      case 'flip':
        noise(t, 0.12, 0.2, 'bandpass', 2500, 0.7);
        osc('sine', 880, t + 0.08, t + 0.4, 0.04);
        return;
      case 'tick':
        osc('square', 1400, t, t + 0.03, 0.03);
        return;
      case 'siren': {
        // critical-sabotage klaxon: a gritty saw+square whoop (rise · hold · sag) ×4 through a horn
        // resonance, each cycle kicked by a low pulse
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.connect(filter('bandpass', 1100, 0.9, filter('lowpass', 3600, 0.7, group(1, 0.25))));
        const oscs = (['sawtooth', 'square'] as const).map((type, k) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.detune.value = k ? 8 : -8;
          o.connect(g);
          o.start(t);
          o.stop(t + 2.85);
          return o;
        });
        for (let i = 0; i < 4; i++) {
          const c = t + i * 0.7;
          for (const o of oscs) {
            o.frequency.setValueAtTime(380, c);
            o.frequency.exponentialRampToValueAtTime(780, c + 0.3);
            o.frequency.setValueAtTime(780, c + 0.48);
            o.frequency.linearRampToValueAtTime(620, c + 0.66);
          }
          g.gain.setValueAtTime(0.0001, c);
          g.gain.exponentialRampToValueAtTime(0.07, c + 0.03);
          g.gain.setValueAtTime(0.07, c + 0.6);
          g.gain.exponentialRampToValueAtTime(0.0001, c + 0.67);
          thud(c, 70, 45, 0.25, 0.14);
        }
        return;
      }
      case 'powerdown': {
        // the breaker trips (clunk), then everything spins down
        thud(t, 140, 60, 0.12, 0.22);
        noise(t, 0.03, 0.15, 'bandpass', 2500, 2);
        const o = osc('sawtooth', 420, t + 0.04, t + 1.14, 0.06);
        o.frequency.exponentialRampToValueAtTime(45, t + 1.04);
        noise(t, 0.15, 0.2, 'lowpass', 600);
        return;
      }
      case 'task': {
        // task done: a crisp UI click, a quick bright rising A-major arpeggio of glassy FM plucks, a sparkle
        noise(t, 0.018, 0.09, 'bandpass', 4200, 1.2);
        const chime = group(1, 0.25);
        [880, 1108.73, 1318.51].forEach((f, i) => {
          const t0 = t + 0.02 + i * 0.075;
          const last = i === 2;
          fm(t0, f, 2, 1.1, last ? 0.65 : 0.2, 0.07, chime);
          osc('sine', f, t0, t0 + (last ? 0.8 : 0.3), 0.03, chime);
        });
        osc('sine', 2637.02, t + 0.2, t + 0.55, 0.012, chime);
        osc('sine', 3520, t + 0.24, t + 0.5, 0.008, chime);
        return;
      }
      case 'meeting': {
        // emergency meeting: a hit + crash, a rapid "brrrring" alarm bell and a brass call that climbs a semitone
        thud(t, 110, 42, 0.6, 0.32, out, 0.3);
        noise(t, 0.7, 0.1, 'highpass', 4000, 0.7, group(1, 0.4));
        // the bell: inharmonic partials gated by a 16 Hz down-ramp, so every period is a fresh clapper strike
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(1, t + 0.01);
        env.gain.setValueAtTime(1, t + 1.0);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        env.connect(group(1, 0.3));
        const strike = ctx.createGain();
        strike.gain.value = 0.5;
        strike.connect(env);
        const clapper = ctx.createOscillator();
        clapper.type = 'sawtooth';
        clapper.frequency.value = 16;
        const depth = ctx.createGain();
        depth.gain.value = -0.5;
        clapper.connect(depth).connect(strike.gain);
        clapper.start(t);
        clapper.stop(t + 1.65);
        for (const [mul, a] of [[1, 0.055], [2.32, 0.025], [3.86, 0.012], [5.13, 0.006]] as const) tone('sine', 1046.5 * mul, t, t + 1.62, a, strike);
        const call = group(1, 0.45);
        for (const f of [146.83, 220, 293.66]) brass(f, t + 0.04, t + 0.3, 0.022, call, 2800, 0.8);
        for (const f of [155.56, 233.08, 311.13]) brass(f, t + 0.32, t + 1.5, 0.022, call, 3000, 0.55);
        return;
      }
      case 'stab': // the original name: same sting
      case 'kill': {
        // 1 · the slash: a fast down-swept noise "shhk" whipping right→left, with a thin blade glint
        noise(t, 0.14, 0.42, 'bandpass', 6500, 1.4, panner(0.5, -0.5, t, t + 0.12, out))?.frequency.exponentialRampToValueAtTime(1500, t + 0.1);
        fm(t + 0.004, 3150, 1.41, 1.2, 0.22, 0.022);
        // 2 · the hit: a deep gritty pitched-down boom, a body punch and a short wet squelch
        const h = t + 0.045;
        thud(h, 150, 38, 0.6, 0.42, out, 0.45);
        noise(h, 0.16, 0.3, 'lowpass', 900);
        noise(h, 0.12, 0.15, 'bandpass', 1300, 4)?.frequency.exponentialRampToValueAtTime(300, h + 0.09);
        // 3 · the stab: a dissonant brass cluster (A · E♭ · B♭ · E) slamming into the room, a thin screech on top
        const st = group(1, 0.45);
        for (const f of [110, 155.56, 233.08, 329.63]) brass(f, h, h + 1.1, 0.026, st, 3600, 0.35);
        const scr = filter('lowpass', 5000, 0.5, st);
        for (const f of [1661.22, 1760]) osc('sawtooth', f, h, h + 0.75, 0.008, scr);
        return;
      }
      case 'body': {
        // "I just found a body": a gut-punch boom + crack, a screeching string cluster (C · C♯ · F♯) with a
        // nervous vibrato, and a low semitone cluster swelling up underneath
        thud(t, 100, 34, 1.0, 0.36, out, 0.35);
        noise(t, 0.4, 0.2, 'lowpass', 300);
        noise(t, 0.05, 0.18, 'bandpass', 2200, 1.2);
        const strings = filter('lowpass', 4200, 0.7, group(1, 0.6));
        const vib = ctx.createOscillator();
        vib.frequency.value = 6.3;
        const vibDepth = ctx.createGain();
        vibDepth.gain.value = 14; // cents
        vib.connect(vibDepth);
        vib.start(t);
        vib.stop(t + 1.8);
        for (const f of [1046.5, 1108.73, 1479.98]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = (Math.random() - 0.5) * 8;
          vibDepth.connect(o.detune);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.02, t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.009, t + 0.25);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
          o.connect(g).connect(strings);
          o.start(t);
          o.stop(t + 1.75);
        }
        const low = filter('lowpass', 480, 0.7, group(1, 0.3));
        for (const f of [73.42, 77.78, 110, 116.54]) pad('sawtooth', f, t, t + 2.1, 0.03, low);
        return;
      }
      case 'report': {
        // body reported: a big hit (gritty boom + crash), a tritone brass stab and three hi-lo megaphone blasts
        thud(t, 130, 40, 0.7, 0.36, out, 0.35);
        noise(t, 0.22, 0.28, 'lowpass', 700);
        noise(t, 1.1, 0.11, 'highpass', 3500, 0.7, group(1, 0.5));
        const stab = group(1, 0.5);
        for (const f of [146.83, 207.65, 293.66, 311.13]) brass(f, t, t + 0.9, 0.024, stab, 3200, 0.3);
        const horn = filter('bandpass', 1400, 1.1, group(1.4, 0.35));
        for (let i = 0; i < 3; i++) {
          const t0 = t + 0.14 + i * 0.3;
          for (const det of [-9, 9]) tone('square', 932.33, t0, t0 + 0.26, 0.045, horn, det).frequency.setValueAtTime(698.46, t0 + 0.13);
        }
        return;
      }
      case 'eject': {
        // airlock: a heavy release clunk, a pressure blast, a long whoosh flying past left→right, a tone
        // falling away into space and a cold, lonely pad
        fm(t, 160, 1.41, 3, 0.5, 0.09, group(1, 0.3));
        thud(t, 90, 40, 0.5, 0.3, out, 0.3);
        noise(t, 0.2, 0.22, 'lowpass', 500);
        noise(t + 0.05, 0.5, 0.12, 'highpass', 2500);
        const whoosh = noise(t + 0.05, 2.45, 0.22, 'bandpass', 250, 0.8, panner(-0.7, 0.7, t + 0.05, t + 2.4, group(1, 0.35)), 0.3);
        whoosh?.frequency.exponentialRampToValueAtTime(2600, t + 0.6);
        whoosh?.frequency.exponentialRampToValueAtTime(400, t + 2.4);
        const fall = filter('lowpass', 1200, 0.7, group(1, 0.4));
        osc('sawtooth', 520, t + 0.15, t + 2.6, 0.035, fall).frequency.exponentialRampToValueAtTime(70, t + 2.5);
        osc('sine', 260, t + 0.15, t + 2.6, 0.08).frequency.exponentialRampToValueAtTime(35, t + 2.5);
        const space = group(1, 0.6);
        for (const f of [220, 261.63, 329.63]) pad('triangle', f, t + 0.6, t + 3.4, 0.022, space);
        pad('sine', 440, t + 0.9, t + 3.4, 0.014, space);
        return;
      }
      case 'type':
        noise(t, 0.025, 0.12, 'bandpass', 3000, 2);
        return;
      case 'shh':
        noise(t, 1.0, 0.18, 'highpass', 3500);
        return;
      case 'reveal': {
        // secret-role reveal: a half-second riser sucked into a huge boom, a dark A-minor(♭6) chord blooming
        // open, a sub pedal and an eerie high minor-second shimmer
        noise(t, 0.6, 0.13, 'bandpass', 300, 2, out, 0.55)?.frequency.exponentialRampToValueAtTime(5000, t + 0.55);
        const b = t + 0.55;
        thud(b, 80, 30, 1.8, 0.34, out, 0.35);
        noise(b, 0.8, 0.26, 'lowpass', 350);
        noise(b, 1.5, 0.09, 'highpass', 3000, 0.7, group(1, 0.5));
        const chord = group(1, 0.5);
        for (const f of [110, 164.81, 220, 261.63, 349.23]) brass(f, b, b + 2.6, 0.015, chord, 1800, 0.55);
        osc('sine', 55, b, b + 2.4, 0.12);
        const air = group(1, 0.7);
        pad('sine', 1760, b + 0.2, b + 2.6, 0.009, air);
        pad('sine', 1864.66, b + 0.3, b + 2.6, 0.007, air);
        return;
      }
      case 'door': {
        // pneumatic sliding door (~0.4 s): a valve "psst", an air whoosh as it slides, a soft rubber-sealed thunk
        noise(t, 0.08, 0.06, 'highpass', 4500);
        const w = noise(t, 0.32, 0.13, 'bandpass', 700, 1.2, out, 0.06);
        w?.frequency.exponentialRampToValueAtTime(2200, t + 0.15);
        w?.frequency.exponentialRampToValueAtTime(900, t + 0.3);
        const k = t + 0.3;
        thud(k, 120, 60, 0.14, 0.2);
        noise(k, 0.07, 0.14, 'lowpass', 500);
        noise(k, 0.03, 0.04, 'bandpass', 1500, 2);
        return;
      }
      case 'doorLock': {
        // security shutter slamming down: a short metal scrape + roll, then a clang, a low slam and a
        // chopped electric buzz with a few sparks
        noise(t, 0.13, 0.08, 'bandpass', 2800, 5, out, 0.03)?.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
        noise(t, 0.13, 0.1, 'lowpass', 300, 0.7, out, 0.05);
        const s = t + 0.12;
        thud(s, 95, 36, 0.45, 0.4, out, 0.4);
        noise(s, 0.12, 0.32, 'lowpass', 1200);
        const metal = group(1, 0.35);
        fm(s, 196, 2.76, 4, 1.0, 0.09, metal);
        fm(s, 523.25, 1.41, 2.5, 0.6, 0.05, metal);
        const z = s + 0.1;
        const chop = ctx.createGain();
        chop.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 23;
        const lg = ctx.createGain();
        lg.gain.value = 0.5;
        lfo.connect(lg).connect(chop.gain);
        chop.connect(filter('bandpass', 1300, 0.6, out));
        tone('sawtooth', 98, z, z + 0.3, 0.12, chop);
        tone('square', 147, z, z + 0.3, 0.05, chop);
        lfo.start(z);
        lfo.stop(z + 0.35);
        for (let i = 0; i < 5; i++) noise(z + Math.random() * 0.25, 0.015, 0.05 + Math.random() * 0.05, 'highpass', 6000);
        return;
      }
      case 'vent': {
        // a floor hatch popping: a sharp click, a tube-resonant metal clank, the grate rattling as it settles
        const tube = hollow(0.0065, 0.55, 0.6, group(0.8, 0.2));
        noise(t, 0.02, 0.28, 'bandpass', 3800, 1);
        fm(t, 380, 1.47, 3.2, 0.32, 0.1, tube);
        fm(t, 910, 1.73, 1.5, 0.18, 0.04, tube);
        thud(t, 170, 80, 0.12, 0.2);
        [0.07, 0.12, 0.16, 0.19, 0.212, 0.23].forEach((dt, i) => {
          const p = 0.25 * (1 - i / 7);
          noise(t + dt, 0.03, p, 'bandpass', 1700 + Math.random() * 900, 2.5, tube);
          fm(t + dt, 600 + Math.random() * 200, 1.41, 1.5, 0.06, p * 0.16, tube);
        });
        return;
      }
      case 'ventMove': {
        // crawling through a duct (~0.6 s): muffled, hollow scrambling on sheet metal moving across,
        // a breath of air and a flexing panel
        const duct = hollow(0.0105, 0.6, 0.8, filter('lowpass', 1300, 0.7, panner(-0.6, 0.6, t, t + 0.62, group(1.6, 0.15))));
        noise(t, 0.6, 0.08, 'bandpass', 450, 0.8, duct, 0.15);
        for (let i = 0; i < 9; i++) {
          const ti = t + 0.02 + i * 0.062 + (Math.random() - 0.5) * 0.024;
          const v = 0.7 + Math.random() * 0.3;
          fm(ti, 260 + Math.random() * 220, 1.41, 2.2, 0.09, 0.05 * v, duct);
          noise(ti, 0.035, 0.16 * v, 'bandpass', 900 + Math.random() * 600, 2.5, duct);
        }
        osc('sine', 190, t + 0.25, t + 0.37, 0.06, duct).frequency.exponentialRampToValueAtTime(120, t + 0.35);
        return;
      }
    }
  }

  // ------------------------------------------------------------------ tension (Nội Gián)
  private tension = 0;
  private tensionBus: { gain: GainNode; filter: BiquadFilterNode; oscs: OscillatorNode[] } | null = null;
  private nextBeat = 0;

  /** 0 off · 1 playing (low drone + slow heartbeat) · 2 emergency (faster, brighter). */
  setTension(level: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || level === this.tension) return;
    this.tension = level;
    if (!this.tensionBus && level > 0) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.connect(gain).connect(this.master);
      const oscs = [55, 55.7, 82.4].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(filter);
        o.start();
        return o;
      });
      this.tensionBus = { gain, filter, oscs };
    }
    const b = this.tensionBus;
    if (!b) return;
    b.gain.gain.setTargetAtTime(level ? (level > 1 ? 0.07 : 0.045) : 0, ctx.currentTime, 0.8);
    b.filter.frequency.setTargetAtTime(level > 1 ? 520 : 220, ctx.currentTime, 0.5);
  }

  /** Keep the heartbeat going (call ~16×/s). */
  tickTension() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.tension) return;
    const period = this.tension > 1 ? 0.62 : 1.15;
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + 0.25) {
      for (const [dt, v] of [[0, 0.32], [0.17, 0.22]] as const) {
        const t = this.nextBeat + dt;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(70, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v * (this.tension > 1 ? 1.2 : 0.8), t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.22);
      }
      this.nextBeat += period;
    }
  }

  // ------------------------------------------------------------------ floor-5 facility hum (Nội Gián)
  private facilityOn = false;
  private facility: FacilityHum | null = null;
  private facilityNoise: AudioBuffer | null = null;

  /** Low, continuous facility bed for floor 5 (ventilation air + an engine-room drone with slow drift).
   *  Fades in / out over ~1 s, sits quietly under voice chat and alongside setTension()'s drone + heartbeat.
   *  Safe to call every frame (only a change does anything) and before start(). */
  setHum(on: boolean) {
    if (on === this.facilityOn) return;
    this.facilityOn = on;
    this.applyHum();
  }

  private applyHum() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    if (this.facilityOn && !this.facility) this.facility = this.buildHum(ctx, this.master);
    else if (!this.facilityOn && this.facility) {
      // fade out and stop; a quick on-again builds a fresh bed that cross-fades over this one
      const { gain, srcs } = this.facility;
      this.facility = null;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 1);
      for (const s of srcs) s.stop(now + 1.05);
    }
    this.hum?.gain.setTargetAtTime(this.roomTone(), now, 0.35);
  }

  private buildHum(ctx: AudioContext, dest: AudioNode): FacilityHum {
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 1);
    gain.connect(dest);
    const srcs: AudioScheduledSourceNode[] = [];
    /** Slow sine modulation added onto a parameter (never onto `gain`, so the fades stay exact). */
    const lfo = (rate: number, depth: number, param: AudioParam) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start(t);
      srcs.push(o);
    };
    // engine room: two sawtooth E1s a hair apart (a slow, wandering throb) under a breathing low-pass.
    // E sits beneath the tension drone's A/E, so the two beds never fight.
    const engLp = ctx.createBiquadFilter();
    engLp.type = 'lowpass';
    engLp.frequency.value = 150;
    engLp.Q.value = 0.7;
    const engine = ctx.createGain();
    engine.gain.value = 0.02;
    engLp.connect(engine).connect(gain);
    const motors = [41.2, 41.5].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(engLp);
      o.start(t);
      srcs.push(o);
      return o;
    });
    lfo(0.023, 0.2, motors[1].frequency); // the beat drifts between ~0.1 and 0.5 Hz
    lfo(0.041, 30, engLp.frequency);
    lfo(0.067, 0.005, engine.gain);
    // ventilation: looped brown noise as air rushing through ducts, its band drifting and its level breathing
    const buf = this.facilityNoise ?? (this.facilityNoise = brownNoise(ctx, 6));
    const airSrc = ctx.createBufferSource();
    airSrc.buffer = buf;
    airSrc.loop = true;
    const airBp = ctx.createBiquadFilter();
    airBp.type = 'bandpass';
    airBp.frequency.value = 380;
    airBp.Q.value = 0.6;
    const air = ctx.createGain();
    air.gain.value = 0.14;
    airSrc.connect(airBp).connect(air).connect(gain);
    airSrc.start(t);
    srcs.push(airSrc);
    lfo(0.029, 110, airBp.frequency);
    lfo(0.083, 0.03, air.gain);
    // a distant extractor fan: a higher band of the same air, fluttering faintly at blade rate
    const fanSrc = ctx.createBufferSource();
    fanSrc.buffer = buf;
    fanSrc.loop = true;
    const fanBp = ctx.createBiquadFilter();
    fanBp.type = 'bandpass';
    fanBp.frequency.value = 1500;
    fanBp.Q.value = 1.4;
    const fan = ctx.createGain();
    fan.gain.value = 0.1;
    fanSrc.connect(fanBp).connect(fan).connect(gain);
    fanSrc.start(t, 3.1);
    srcs.push(fanSrc);
    lfo(5.3, 0.025, fan.gain);
    return { gain, srcs };
  }

  // ------------------------------------------------------------------ bar music
  /** level 0..1 (0 = silent, stops scheduling); cutoff = low-pass Hz (muffled through walls). */
  setMusic(level: number, cutoff: number) {
    if (Math.abs(level - this.musicLevel) < 0.01 && Math.abs(cutoff - this.musicCutoff) < 20) return;
    this.musicLevel = level;
    this.musicCutoff = cutoff;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const m = this.ensureMusic();
    m.bus.gain.setTargetAtTime(level * 0.5, ctx.currentTime, 0.35);
    m.filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.25);
  }

  private ensureMusic(): MusicBus {
    if (this.music) return this.music;
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.value = this.musicLevel * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.musicCutoff;
    filter.Q.value = 0.5;
    bus.connect(filter).connect(this.master!);
    // a dotted-8th echo for the chords
    const send = ctx.createGain();
    send.gain.value = 0.28;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    send.connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(bus);
    this.music = { bus, filter, send, nextStep: 0, nextTime: 0 };
    return this.music;
  }

  /** Called ~16 times per second: schedules the next ~250 ms of notes. */
  tickMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.enabled || this.musicLevel <= 0.001) {
      if (this.music) this.music.nextTime = 0;
      return;
    }
    const m = this.ensureMusic();
    const now = ctx.currentTime;
    if (!m.nextTime || m.nextTime < now - 0.05) {
      // (re)align to the shared clock
      const wall = this.clock();
      const idx = Math.ceil(wall / STEP);
      m.nextStep = idx;
      m.nextTime = now + (idx * STEP - wall);
    }
    while (m.nextTime < now + 0.25) {
      this.playStep(m, m.nextStep, m.nextTime);
      m.nextStep++;
      m.nextTime += STEP;
    }
  }

  private playStep(m: MusicBus, step: number, t: number) {
    const s16 = ((step % 16) + 16) % 16;
    const bar = Math.floor(step / 16);
    const ch = PROG[((bar % 4) + 4) % 4];
    const section = ((Math.floor(bar / 8) % 4) + 4) % 4; // 0 groove · 1 + clap/chords · 2 full · 3 breakdown → full
    const breakdown = section === 3 && ((bar % 8) + 8) % 8 < 2;
    if (s16 % 4 === 0 && !breakdown) this.kick(m, t, 0.85);
    if ((s16 === 4 || s16 === 12) && section >= 1) this.clap(m, t, 0.28);
    if (s16 % 4 === 2) this.hat(m, t, section >= 2 ? 0.11 : 0.085, section >= 2);
    else if (s16 % 2 === 1 && section > 0) this.hat(m, t, 0.03, false);
    if (!breakdown && s16 % 4 >= 2) this.bass(m, t, ch.root * (s16 === 6 || s16 === 14 ? 2 : 1), STEP * 0.92, s16 % 4 === 2 ? 0.42 : 0.3);
    if (section >= 1 && (s16 === 6 || s16 === 14 || (section === 2 && s16 === 11))) this.stab(m, t, ch.chord, 0.085);
    if (breakdown && s16 === 0) this.pad(m, t, ch.chord, STEP * 16);
  }

  private kick(m: MusicBus, t: number, v: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(m.bus);
    o.start(t);
    o.stop(t + 0.45);
    this.burst({ gain: v * 0.12, pan: 0, freq: 3500, q: 0.7, dur: 0.012, type: 'highpass', at: t, to: m.bus });
  }

  private clap(m: MusicBus, t: number, v: number) {
    for (let i = 0; i < 3; i++) this.burst({ gain: v, pan: 0.05, freq: 1300, q: 1.1, dur: 0.028, at: t + i * 0.011, to: m.bus });
    this.burst({ gain: v * 0.6, pan: 0.05, freq: 1200, q: 0.9, dur: 0.2, at: t + 0.034, to: m.bus });
  }

  private hat(m: MusicBus, t: number, v: number, open: boolean) {
    this.burst({ gain: v, pan: open ? -0.15 : 0.2, freq: 7600, q: 0.7, dur: open ? 0.2 : 0.035, type: 'highpass', at: t, to: m.bus });
  }

  private bass(m: MusicBus, t: number, f: number, dur: number, v: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 7;
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(170, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const sg = ctx.createGain();
    sg.gain.value = 0.6;
    o.connect(lp).connect(g);
    sub.connect(sg).connect(g);
    g.connect(m.bus);
    o.start(t);
    sub.start(t);
    o.stop(t + dur + 0.02);
    sub.stop(t + dur + 0.02);
  }

  private stab(m: MusicBus, t: number, chord: number[], v: number) {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    lp.connect(g);
    g.connect(m.bus);
    g.connect(m.send);
    for (const f of chord) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + 0.3);
      }
    }
  }

  private pad(m: MusicBus, t: number, chord: number[], dur: number) {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    g.connect(m.bus);
    g.connect(m.send);
    for (const f of chord) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f / 2;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  dispose() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.music = null;
    // nodes below belonged to the closed context
    this.sfxBus = null;
    this.facility = null;
    this.tensionBus = null;
    this.tension = 0;
  }
}
