// Office ambience synthesised with WebAudio (no sound files): air-conditioning hum, keyboards of
// people typing near you (panned left/right), footsteps, the coffee machine, the lift chime and the
// bar's techno track (drum machine + bass + chord stabs, locked to the shared server clock so
// everyone in the bar hears the same beat).

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
    this.hum.gain.value = 0.22;
    src.connect(lp).connect(this.hum).connect(this.master);
    src.start();
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
    if (this.hum && this.ctx) this.hum.gain.setTargetAtTime(q ? 0.06 : 0.22, this.ctx.currentTime, 0.8);
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

  // ------------------------------------------------------------------ game sounds (karaoke, Ma Sói)
  /** Short synthesized effects; all go through the master volume. */
  sfx(kind: 'howl' | 'dawn' | 'gavel' | 'death' | 'win' | 'lose' | 'applause' | 'drumroll' | 'flip' | 'tick' | 'siren' | 'powerdown' | 'task' | 'meeting' | 'stab' | 'body' | 'report' | 'eject' | 'type' | 'shh' | 'reveal') {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out || ctx.state !== 'running') return;
    const t = ctx.currentTime;
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
    const noise = (t0: number, dur: number, peak: number, type: BiquadFilterType, f: number, q = 1) => {
      if (!this.noise) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = type;
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp).connect(g).connect(out);
      src.start(t0, Math.random() * 1.5, dur + 0.05);
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
      case 'win':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => osc('triangle', f, t + i * 0.13, t + i * 0.13 + 0.35, 0.09));
        [523.25, 659.25, 783.99, 1046.5].forEach((f) => osc('sine', f, t + 0.6, t + 2.0, 0.05));
        return;
      case 'lose':
        [392, 349.23, 311.13, 261.63].forEach((f, i) => osc('triangle', f, t + i * 0.22, t + i * 0.22 + 0.45, 0.08));
        return;
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
      case 'siren':
        for (let i = 0; i < 4; i++) {
          const o = osc('sawtooth', 600, t + i * 0.7, t + i * 0.7 + 0.65, 0.04);
          o.frequency.linearRampToValueAtTime(950, t + i * 0.7 + 0.35);
          o.frequency.linearRampToValueAtTime(600, t + i * 0.7 + 0.65);
        }
        return;
      case 'powerdown': {
        const o = osc('sawtooth', 420, t, t + 1.1, 0.06);
        o.frequency.exponentialRampToValueAtTime(45, t + 1.0);
        noise(t, 0.15, 0.2, 'lowpass', 600);
        return;
      }
      case 'task':
        [659.25, 987.77].forEach((f, i) => osc('sine', f, t + i * 0.09, t + i * 0.09 + 0.35, 0.07));
        return;
      case 'meeting':
        [784, 622.25, 784, 622.25].forEach((f, i) => osc('square', f, t + i * 0.22, t + i * 0.22 + 0.2, 0.045));
        return;
      case 'stab': {
        // a sharp swipe + a dull hit
        noise(t, 0.12, 0.45, 'highpass', 3000);
        const o = osc('sine', 160, t + 0.06, t + 0.5, 0.4);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.45);
        noise(t + 0.06, 0.2, 0.3, 'lowpass', 500);
        return;
      }
      case 'body': {
        // the "something is wrong" sting: a low cluster swelling up
        for (const f of [73.4, 77.8, 110, 116.5]) {
          const o = osc('sawtooth', f, t, t + 1.6, 0.035);
          o.detune.value = Math.random() * 10;
        }
        osc('sine', 880, t + 0.05, t + 1.2, 0.03);
        noise(t, 0.4, 0.15, 'lowpass', 300);
        return;
      }
      case 'report':
        for (let i = 0; i < 3; i++) {
          const o = osc('square', 880, t + i * 0.32, t + i * 0.32 + 0.28, 0.05);
          o.frequency.setValueAtTime(660, t + i * 0.32 + 0.14);
        }
        noise(t, 0.25, 0.2, 'bandpass', 1200, 0.8);
        return;
      case 'eject': {
        const o = osc('sawtooth', 300, t, t + 2.2, 0.04);
        o.frequency.exponentialRampToValueAtTime(60, t + 2.1);
        noise(t, 1.8, 0.12, 'lowpass', 900);
        return;
      }
      case 'type':
        noise(t, 0.025, 0.12, 'bandpass', 3000, 2);
        return;
      case 'shh':
        noise(t, 1.0, 0.18, 'highpass', 3500);
        return;
      case 'reveal':
        osc('sine', 110, t, t + 2.2, 0.2);
        [220, 261.63, 329.63].forEach((f, i) => osc('triangle', f, t + 0.1 + i * 0.12, t + 2.4, 0.04));
        return;
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
  }
}
