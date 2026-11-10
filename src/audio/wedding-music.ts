// Floor 7's wedding music and sound effects, synthesised live with WebAudio (no samples).
// Five looping tracks — the reception lounge, the Bridal Chorus for the walk down the aisle (Wagner,
// 1850, public domain; the arrangement is ours), the tender bed under the vows, an original waltz
// for the first dance and an original dance-pop track for the party — all positioned by the shared
// server clock, so everyone in the ballroom hears the same bar at the same moment, late joiners
// included. Plus one-shot effects (poppers, cheers, clinks, the bouquet fanfare…).
//
// Cost: notes are scheduled ~300 ms ahead from tick() (≈16 Hz); nothing is scheduled while the
// level is ~0, each note uses at most three oscillators and every node is stopped when its
// envelope ends, so a phone only pays for what it can hear.
import type { WedTrack } from '../../shared/wedding';

export type WedSfx = 'pop' | 'cheer' | 'chime' | 'sparkle' | 'whoosh' | 'kiss' | 'clink' | 'envelope' | 'tick' | 'catch' | 'cannon' | 'fizz' | 'drumroll' | 'chant' | 'dzo' | 'grab';

/** How far ahead notes are put on the audio clock. */
const LOOKAHEAD = 0.3;
/** Crossfade between tracks, seconds. */
const XFADE = 1.2;

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C4' → 60, 'F#3' → 54, 'Bb2' → 46. */
function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const f = (name: string) => hz(midi(name));
const up = (name: string, semis: number) => hz(midi(name) + semis);

/** A synthetic stereo hall impulse (decorrelated noise, darker as it decays, −60 dB at the end). */
function hallImpulse(ctx: BaseAudioContext, seconds: number) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  const pre = Math.floor(rate * 0.02);
  const fade = rate * 0.006;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = i / len;
      lp += (0.6 - 0.5 * x) * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-6.9 * x) * Math.min(1, (i - pre) / fade);
    }
  }
  return buf;
}

/** A note event: `t` audio time, `spb` seconds per beat, `out` the playing track's bus. */
type Ev = (t: number, spb: number, out: AudioNode) => void;

/** A loop on a 16th-note grid (events bucketed by 16th so the scheduler is a plain array walk). */
class Score {
  readonly steps: Ev[][];
  constructor(
    readonly bpm: number,
    readonly beats: number,
    /** Reverb send for this track (the party stays drier so the drums don't wash out). */
    readonly send: number,
  ) {
    this.steps = Array.from({ length: Math.round(beats * 4) }, () => []);
  }
  at(beat: number, ev: Ev) {
    const i = Math.round(beat * 4);
    if (i >= 0 && i < this.steps.length) this.steps[i].push(ev);
  }
}

interface Playing {
  name: WedTrack;
  startAt: number;
  score: Score;
  gain: GainNode;
  nextStep: number;
  nextTime: number;
}

export class WeddingMusic {
  private noise: AudioBuffer;
  private organWave: PeriodicWave;
  /** Track buses → level → low-pass → compressor → out, with a post-filter send into the hall. */
  private level: GainNode;
  private filter: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private send: GainNode;
  private verb: ConvolverNode;
  private sfxBus: GainNode;
  private sfxSend: GainNode;
  private verbOut: GainNode;
  private tracks: Record<WedTrack, Score>;
  private cur: Playing | null = null;
  private want: { track: WedTrack | null; startAt: number } = { track: null, startAt: 0 };
  private levelV = 0;
  private cutoff = 18000;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    private clock: () => number,
  ) {
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    // drawbar-ish pipe organ in a single oscillator: 8' 4' 2⅔' 2' 1⅓' 1'
    const real = new Float32Array(9);
    const imag = new Float32Array([0, 1, 0.55, 0.28, 0.32, 0, 0.14, 0, 0.16]);
    this.organWave = ctx.createPeriodicWave(real, imag);

    this.verb = ctx.createConvolver();
    this.verb.buffer = hallImpulse(ctx, 2.5);
    this.verbOut = ctx.createGain();
    this.verbOut.gain.value = 0.9;
    this.verb.connect(this.verbOut).connect(out);

    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = this.cutoff;
    this.filter.Q.value = 0.5;
    // the party stacks drums on chords: a gentle compressor keeps it from clipping the master
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.2;
    this.level.connect(this.filter).connect(this.comp).connect(out);
    this.send = ctx.createGain();
    this.send.gain.value = 0.3;
    this.comp.connect(this.send).connect(this.verb);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(out);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.22;
    this.sfxBus.connect(this.sfxSend).connect(this.verb);

    this.tracks = {
      lounge: this.buildLounge(),
      march: this.buildMarch(),
      vows: this.buildVows(),
      waltz: this.buildWaltz(),
      party: this.buildParty(),
    };
  }

  // ------------------------------------------------------------------ control
  setTrack(track: WedTrack | null, startAt: number) {
    if (this.disposed) return;
    if (this.want.track === track && (track === null || this.want.startAt === startAt)) return;
    this.want = { track, startAt };
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const old = this.cur;
    if (old) {
      // the old voices just fade on their own bus; anything already scheduled stops by itself
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0.0001, now + XFADE);
      this.later(() => old.gain.disconnect(), (XFADE + 4) * 1000);
    }
    this.cur = null;
    if (!track) return;
    const score = this.tracks[track];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + (old ? XFADE : 0.4));
    gain.connect(this.level);
    this.send.gain.setTargetAtTime(score.send, now, 0.5);
    this.cur = { name: track, startAt, score, gain, nextStep: 0, nextTime: 0 };
  }

  setLevel(level: number, cutoff: number) {
    if (this.disposed) return;
    if (Math.abs(level - this.levelV) < 0.01 && Math.abs(cutoff - this.cutoff) < 20) return;
    this.levelV = level;
    this.cutoff = cutoff;
    const now = this.ctx.currentTime;
    this.level.gain.setTargetAtTime(level * 0.95, now, 0.35);
    this.filter.frequency.setTargetAtTime(cutoff, now, 0.25);
  }

  tick() {
    const ctx = this.ctx;
    const p = this.cur;
    if (this.disposed || !p) return;
    if (ctx.state !== 'running' || this.levelV <= 0.001) {
      p.nextTime = 0; // realign when we can be heard again
      return;
    }
    const sub = 60 / p.score.bpm / 4;
    const now = ctx.currentTime;
    const wall = this.clock();
    // (re)align to the shared clock: first time, after a stall, or if the server offset moved
    const drift = p.nextTime ? Math.abs(wall + (p.nextTime - now) - p.startAt - p.nextStep * sub) : 0;
    if (!p.nextTime || p.nextTime < now - 0.05 || drift > 0.12) {
      const pos = wall - p.startAt;
      const idx = Math.ceil(pos / sub - 1e-6);
      p.nextStep = idx;
      p.nextTime = now + (idx * sub - pos);
    }
    const len = p.score.steps.length;
    while (p.nextTime < now + LOOKAHEAD) {
      if (p.nextStep >= 0) {
        for (const ev of p.score.steps[p.nextStep % len]) ev(p.nextTime, sub * 4, p.gain);
      }
      p.nextStep++;
      p.nextTime += sub;
    }
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.cur?.gain.disconnect();
    this.cur = null;
    for (const n of [this.level, this.filter, this.comp, this.send, this.verb, this.verbOut, this.sfxBus, this.sfxSend]) n.disconnect();
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // ------------------------------------------------------------------ instruments
  private osc(type: OscillatorType, freq: number, t: number, stop: number, dest: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(stop);
    return o;
  }

  /** Attack → (optional decay) → release envelope; returns the gain node to feed. */
  private envGain(dest: AudioNode, t: number, peak: number, attack: number, hold: number, release: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(dest);
    return g;
  }

  /** Felt / electric piano: triangle body + a fast-fading sine octave for the hammer. */
  private piano(out: AudioNode, t: number, freq: number, dur: number, v: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const end = t + Math.min(3.2, dur + 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.setTargetAtTime(v * 0.45, t + 0.01, 0.35); // the strike settles
    g.gain.setTargetAtTime(0.0001, t + dur, 0.16); // key up
    g.connect(out);
    this.osc('triangle', freq, t, end, g);
    const h = ctx.createGain();
    h.gain.setValueAtTime(0.32, t);
    h.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    h.connect(g);
    this.osc('sine', freq * 2, t, t + 0.4, h, 3);
  }

  /** Strings pad: one detuned saw per note through a shared soft low-pass, slow bow. */
  private strings(out: AudioNode, t: number, freqs: number[], dur: number, v: number, cutoff = 1300) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.3;
    const atk = Math.min(0.7, dur * 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + atk);
    g.gain.setValueAtTime(v, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    lp.connect(g).connect(out);
    freqs.forEach((fr, i) => this.osc('sawtooth', fr, t, t + dur + 0.65, lp, i % 2 ? 7 : -7));
  }

  /** Pipe organ: one PeriodicWave oscillator per note. */
  private organ(out: AudioNode, t: number, freq: number, dur: number, v: number) {
    const g = this.envGain(out, t, v, 0.05, Math.max(0.01, dur - 0.05), 0.18);
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(this.organWave);
    o.frequency.value = freq;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.25);
  }

  /** Warm brass lead: two detuned saws, the filter opens as the note speaks. */
  private brass(out: AudioNode, t: number, freq: number, dur: number, v: number) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(450, t);
    lp.frequency.exponentialRampToValueAtTime(2300, t + 0.09);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 0.4);
    const g = this.envGain(out, t, v, 0.05, Math.max(0.02, dur - 0.1), 0.2);
    lp.connect(g);
    this.osc('sawtooth', freq, t, t + dur + 0.25, lp, -6);
    this.osc('sawtooth', freq, t, t + dur + 0.25, lp, 6);
  }

  /** Singing lead (strings / voice-ish): saw + triangle, a slow vibrato. */
  private lead(out: AudioNode, t: number, freq: number, dur: number, v: number) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2100;
    lp.Q.value = 0.6;
    const g = this.envGain(out, t, v, Math.min(0.12, dur * 0.3), Math.max(0.02, dur - 0.15), 0.3);
    lp.connect(g);
    const a = this.osc('sawtooth', freq, t, t + dur + 0.35, lp);
    const b = this.osc('triangle', freq * 2, t, t + dur + 0.35, lp);
    // vibrato that only blooms on longer notes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(dur > 0.8 ? 9 : 3, t + Math.min(0.6, dur));
    lfo.connect(depth);
    depth.connect(a.detune);
    depth.connect(b.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.35);
  }

  /** Bell: fundamental + two inharmonic partials that die faster. */
  private bell(out: AudioNode, t: number, freq: number, v: number, decay = 1.4) {
    const parts: [number, number, number][] = [
      [1, 1, decay],
      [2.76, 0.35, decay * 0.45],
      [5.4, 0.14, decay * 0.22],
    ];
    for (const [mul, amp, dec] of parts) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v * amp, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      g.connect(out);
      this.osc('sine', freq * mul, t, t + dec + 0.02, g);
    }
  }

  /** Bright pluck for the party hook: a square with a fast closing filter + a sine an octave up. */
  private pluck(out: AudioNode, t: number, freq: number, v: number) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    const g = this.envGain(out, t, v, 0.003, 0.02, 0.26);
    lp.connect(g);
    this.osc('square', freq, t, t + 0.32, lp);
    this.osc('sine', freq * 2, t, t + 0.32, g);
  }

  /** Bass: sine + triangle (soft); `bright` swaps the triangle for a filtered saw (party). */
  private bass(out: AudioNode, t: number, freq: number, dur: number, v: number, bright = false) {
    const ctx = this.ctx;
    const g = this.envGain(out, t, v, 0.008, Math.max(0.01, dur * 0.6), dur * 0.5 + 0.05);
    this.osc('sine', freq, t, t + dur + 0.1, g);
    if (bright) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 4;
      lp.frequency.setValueAtTime(1100, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + dur);
      const s = ctx.createGain();
      s.gain.value = 0.55;
      lp.connect(s).connect(g);
      this.osc('sawtooth', freq, t, t + dur + 0.1, lp);
    } else {
      const s = ctx.createGain();
      s.gain.value = 0.4;
      s.connect(g);
      this.osc('triangle', freq * 2, t, t + dur + 0.1, s);
    }
  }

  /** Filtered white-noise burst (drums, paper, fizz). */
  private burst(out: AudioNode, t: number, o: { gain: number; freq: number; q?: number; dur: number; type?: BiquadFilterType; attack?: number }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true; // the buffer is 1 s; longer swells (fizz, crash, cheer) wrap round
    const bp = ctx.createBiquadFilter();
    bp.type = o.type ?? 'bandpass';
    bp.frequency.value = o.freq;
    bp.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    const atk = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + o.dur);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + atk + o.dur + 0.02);
    return { src, bp, g };
  }

  private kick(out: AudioNode, t: number, v: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    g.connect(out);
    const o = this.osc('sine', 140, t, t + 0.4, g);
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    this.burst(out, t, { gain: v * 0.1, freq: 3200, dur: 0.012, type: 'highpass' });
  }

  private clap(out: AudioNode, t: number, v: number) {
    for (let i = 0; i < 3; i++) this.burst(out, t + i * 0.011, { gain: v, freq: 1400, q: 1.1, dur: 0.026 });
    this.burst(out, t + 0.034, { gain: v * 0.6, freq: 1250, q: 0.9, dur: 0.18 });
  }

  private hat(out: AudioNode, t: number, v: number, open: boolean) {
    this.burst(out, t, { gain: v, freq: 8000, q: 0.7, dur: open ? 0.16 : 0.03, type: 'highpass' });
  }

  private crash(out: AudioNode, t: number, v: number) {
    this.burst(out, t, { gain: v, freq: 5200, q: 0.5, dur: 1.3, type: 'highpass' });
  }

  // ------------------------------------------------------------------ tracks
  /** Reception / feast background: felt piano chords and arpeggios over a quiet string bed, 72 bpm. */
  private buildLounge(): Score {
    const s = new Score(72, 32, 0.36);
    // [start beat, length, bass, chord tones]
    const prog: [number, number, string, string[]][] = [
      [0, 4, 'F2', ['F3', 'A3', 'C4', 'E4']],
      [4, 2, 'E2', ['E3', 'G3', 'B3', 'D4']],
      [6, 2, 'A2', ['A3', 'C#4', 'E4', 'G4']],
      [8, 4, 'D2', ['D3', 'F3', 'A3', 'C4', 'E4']],
      [12, 2, 'G2', ['G3', 'Bb3', 'D4', 'F4']],
      [14, 2, 'C2', ['C3', 'E3', 'G3', 'Bb3']],
      [16, 4, 'F2', ['F3', 'A3', 'C4', 'E4']],
      [20, 4, 'Bb1', ['Bb2', 'D3', 'F3', 'A3']],
      [24, 2, 'A2', ['A3', 'C4', 'E4', 'G4']],
      [26, 2, 'D2', ['D3', 'F#3', 'A3', 'C4']],
      [28, 2, 'G2', ['G3', 'Bb3', 'D4', 'F4']],
      [30, 2, 'C2', ['Bb3', 'D4', 'F4', 'G4']],
    ];
    for (const [b, len, root, tones] of prog) {
      const pad = tones.slice(-4).map(f);
      s.at(b, (t, spb, out) => this.strings(out, t, pad, len * spb, 0.018));
      s.at(b, (t, spb, out) => this.bass(out, t, f(root), len * spb * 0.85, 0.13));
      if (len === 4) s.at(b + 2.5, (t, spb, out) => this.bass(out, t, up(root, 7), spb * 1.2, 0.07));
      // a soft spread chord on the downbeat, then a lazy arpeggio up an octave
      tones.forEach((n, i) => s.at(b, (t, spb, out) => this.piano(out, t + i * 0.025, up(n, 12), spb * 1.6, 0.032)));
      const arp = tones.map((n) => up(n, 12));
      const order = [1, 2, 3, 2, 1, 2];
      for (let k = 1; k < len * 2; k++) {
        const fr = arp[order[(k - 1) % order.length] % arp.length];
        s.at(b + k * 0.5, (t, spb, out) => this.piano(out, t, fr, spb * 0.9, k % 2 ? 0.022 : 0.028));
      }
    }
    // a bell on the top of the phrase every four bars
    s.at(0, (t, _spb, out) => this.bell(out, t, f('E6'), 0.02, 2));
    s.at(16, (t, _spb, out) => this.bell(out, t, f('C6'), 0.02, 2));
    return s;
  }

  /** The Bridal Chorus ("Here comes the bride"): organ, strings, brass lead; a bell-and-strings second pass. */
  private buildMarch(): Score {
    const s = new Score(68, 128, 0.4);
    // melody, beats from the pickup: [beat, note, length]
    const mel: [number, string, number][] = [
      [0, 'G4', 1], [1, 'C5', 1.5], [2.5, 'C5', 0.5], [3, 'C5', 3],
      [6, 'G4', 1], [7, 'D5', 1.5], [8.5, 'B4', 0.5], [9, 'C5', 3],
      [12, 'G4', 1], [13, 'C5', 1.5], [14.5, 'F5', 0.5], [15, 'F5', 1], [16, 'E5', 1], [17, 'D5', 1.5], [18.5, 'C5', 0.5], [19, 'B4', 1], [20, 'C5', 1], [21, 'D5', 3],
      [24, 'G4', 1], [25, 'C5', 1.5], [26.5, 'C5', 0.5], [27, 'C5', 3],
      [30, 'G4', 1], [31, 'D5', 1.5], [32.5, 'B4', 0.5], [33, 'C5', 3],
      [36, 'G4', 1], [37, 'C5', 1.5], [38.5, 'F5', 0.5], [39, 'F5', 1], [40, 'E5', 1], [41, 'D5', 1.5], [42.5, 'C5', 0.5], [43, 'B4', 1], [44, 'A4', 1], [45, 'B4', 1], [46, 'C5', 4],
    ];
    // harmony under it, same beats: [beat, length, pedal, chord]
    const C = ['E3', 'G3', 'C4', 'E4'];
    const F = ['F3', 'A3', 'C4', 'F4'];
    const G = ['D3', 'G3', 'B3', 'D4'];
    const G7 = ['D3', 'F3', 'B3', 'D4'];
    const CE = ['E3', 'G3', 'C4', 'G4'];
    const Am = ['E3', 'A3', 'C4', 'E4'];
    const Em = ['E3', 'G3', 'B3', 'E4'];
    const harm: [number, number, string, string[]][] = [
      [1, 6, 'C2', C], [7, 2, 'G1', G7], [9, 4, 'C2', C],
      [13, 2, 'F2', F], [15, 1, 'F2', F], [16, 1, 'E2', CE], [17, 2, 'G2', G], [19, 1, 'G1', G7], [20, 1, 'C2', C], [21, 4, 'G1', G],
      [25, 6, 'C2', C], [31, 2, 'G1', G7], [33, 4, 'C2', C],
      [37, 2, 'F2', F], [39, 1, 'F2', F], [40, 1, 'E2', CE], [41, 2, 'G2', G], [43, 1, 'G1', G7], [44, 1, 'A1', Am], [45, 1, 'G1', G7], [46, 4, 'C2', C],
      // interlude after each pass (beats 50..64): F · G · Em · Am · G7 → back to the pickup
      [50, 4, 'F2', F], [54, 4, 'G1', G], [58, 2, 'E2', Em], [60, 2, 'A1', Am], [62, 2, 'G1', G7],
    ];
    const pass = (off: number, second: boolean) => {
      // (the second pass ends on the closing chord below instead of the interlude)
      for (const [b, n, len] of mel) {
        const fr = f(n);
        if (second) {
          // second time round the strings sing it with a bell an octave up
          s.at(off + b, (t, spb, out) => this.lead(out, t, fr, len * spb * 0.95, 0.05));
          if (len >= 1) s.at(off + b, (t, _spb, out) => this.bell(out, t, fr * 2, 0.022, 1.6));
        } else {
          s.at(off + b, (t, spb, out) => this.brass(out, t, fr, len * spb * 0.92, 0.075));
          s.at(off + b, (t, spb, out) => this.organ(out, t, fr, len * spb * 0.95, 0.03));
        }
      }
      for (const [b, len, ped, ch] of harm) {
        if (second && b >= 50) continue;
        const tones = ch.map(f);
        s.at(off + b, (t, spb, out) => {
          for (const fr of tones) this.organ(out, t, fr, len * spb * 0.98, 0.022);
          this.organ(out, t, f(ped), len * spb * 0.98, 0.05);
        });
        s.at(off + b, (t, spb, out) => this.strings(out, t, tones.slice(1).map((x) => x * 2), len * spb, second ? 0.022 : 0.014, 1600));
      }
    };
    // intro fanfare (beats 0..4): a C chord, a rising call, then the pickup arrives with the melody
    s.at(0, (t, spb, out) => {
      for (const n of ['C4', 'E4', 'G4']) this.brass(out, t, f(n), spb * 0.9, 0.05);
      for (const n of ['C2', 'G3', 'C4', 'E4']) this.organ(out, t, f(n), spb * 3.9, 0.03);
    });
    s.at(1, (t, spb, out) => this.brass(out, t, f('G4'), spb * 0.45, 0.06));
    s.at(1.5, (t, spb, out) => this.brass(out, t, f('C5'), spb * 0.45, 0.06));
    s.at(2, (t, spb, out) => this.brass(out, t, f('E5'), spb * 0.95, 0.065));
    pass(3, false);
    pass(67, true);
    // the last bar (beats 117..128) settles on C before looping to the fanfare
    s.at(117, (t, spb, out) => this.strings(out, t, ['G3', 'C4', 'E4', 'G4'].map(f), spb * 10, 0.02, 1600));
    s.at(117, (t, spb, out) => this.organ(out, t, f('C2'), spb * 10, 0.05));
    return s;
  }

  /** Under the vows: slow piano arpeggios and strings in D, a string melody in the second half. 60 bpm. */
  private buildVows(): Score {
    const s = new Score(60, 64, 0.45);
    const bars: [string, string[]][] = [
      ['D2', ['D3', 'F#3', 'A3']],
      ['C#2', ['A2', 'C#3', 'E3']],
      ['B1', ['B2', 'D3', 'F#3']],
      ['G1', ['G2', 'B2', 'D3']],
      ['F#2', ['D3', 'F#3', 'A3']],
      ['E2', ['E3', 'G3', 'B3']],
      ['A1', ['A2', 'D3', 'E3']],
      ['A1', ['A2', 'C#3', 'E3']],
      ['G1', ['G2', 'B2', 'D3']],
      ['A1', ['A2', 'C#3', 'E3']],
      ['F#2', ['F#2', 'A2', 'C#3']],
      ['B1', ['B2', 'D3', 'F#3']],
      ['E2', ['E3', 'G3', 'B3']],
      ['A1', ['A2', 'C#3', 'G3']],
      ['D2', ['D3', 'F#3', 'A3']],
      ['D2', ['D3', 'E3', 'A3']],
    ];
    bars.forEach(([root, tones], i) => {
      const b = i * 4;
      const tf = tones.map((n) => up(n, 12));
      s.at(b, (t, spb, out) => this.piano(out, t, f(root) * 2, spb * 3.6, 0.05));
      // up and back down: 3 chord tones, the octave of the first, back
      const arp = [tf[0], tf[1], tf[2], tf[0] * 2, tf[2], tf[1], tf[0]];
      arp.forEach((fr, k) => s.at(b + 0.5 + k * 0.5, (t, spb, out) => this.piano(out, t, fr, spb * 1.2, k === 3 ? 0.034 : 0.026)));
      s.at(b, (t, spb, out) => this.strings(out, t, tf.map((x) => x / 2), spb * 4, 0.016, 1100));
      if (i < 8 && i % 2 === 0) s.at(b, (t, _spb, out) => this.bell(out, t, tf[2] * 2, 0.014, 2.2));
    });
    const mel: [number, string, number][] = [
      [32, 'B4', 2], [34, 'A4', 1], [35, 'G4', 1],
      [36, 'A4', 3], [39, 'C#5', 1],
      [40, 'C#5', 2], [42, 'E5', 2],
      [44, 'D5', 4],
      [48, 'B4', 2], [50, 'G4', 2],
      [52, 'E5', 2], [54, 'C#5', 1], [55, 'A4', 1],
      [56, 'D5', 4],
      [60, 'F#4', 2], [62, 'A4', 2],
    ];
    for (const [b, n, len] of mel) s.at(b, (t, spb, out) => this.lead(out, t, f(n), len * spb * 0.97, 0.034));
    return s;
  }

  /** First dance: an original waltz in F, oom-pah-pah piano, a singing lead, bells on top. 88 bpm, 3/4. */
  private buildWaltz(): Score {
    const s = new Score(88, 48, 0.42);
    const bars: [string, string, string[]][] = [
      ['F2', 'C3', ['A3', 'C4', 'F4']],
      ['F2', 'C3', ['A3', 'C4', 'F4']],
      ['D2', 'A2', ['A3', 'D4', 'F4']],
      ['D2', 'A2', ['A3', 'D4', 'F4']],
      ['Bb1', 'F2', ['Bb3', 'D4', 'F4']],
      ['C2', 'G2', ['G3', 'C4', 'E4']],
      ['F2', 'C3', ['A3', 'C4', 'F4']],
      ['C2', 'G2', ['G3', 'Bb3', 'E4']],
      ['F2', 'C3', ['A3', 'C4', 'F4']],
      ['A1', 'E2', ['G3', 'C#4', 'E4']],
      ['D2', 'A2', ['A3', 'D4', 'F4']],
      ['Bb1', 'F2', ['Bb3', 'D4', 'F4']],
      ['G1', 'D2', ['G3', 'Bb3', 'D4']],
      ['C2', 'G2', ['G3', 'Bb3', 'E4']],
      ['F2', 'C3', ['A3', 'C4', 'F4']],
      ['C2', 'G2', ['G3', 'Bb3', 'E4']],
    ];
    bars.forEach(([root, fifth, tones], i) => {
      const b = i * 3;
      const bassNote = i % 2 ? fifth : root;
      s.at(b, (t, spb, out) => this.bass(out, t, f(bassNote), spb * 0.9, 0.12));
      for (const beat of [1, 2]) s.at(b + beat, (t, spb, out) => tones.forEach((n) => this.piano(out, t, f(n), spb * 0.45, 0.022)));
      s.at(b, (t, spb, out) => this.strings(out, t, tones.map(f), spb * 3, 0.012, 1200));
    });
    const mel: [number, string, number][][] = [
      [[0, 'C5', 1], [1, 'A4', 1], [2, 'C5', 1]],
      [[0, 'F5', 2], [2, 'E5', 1]],
      [[0, 'D5', 2], [2, 'C5', 1]],
      [[0, 'A4', 3]],
      [[0, 'Bb4', 1], [1, 'D5', 1], [2, 'F5', 1]],
      [[0, 'E5', 2], [2, 'D5', 1]],
      [[0, 'C5', 3]],
      [[0, 'G4', 2], [2, 'Bb4', 1]],
      [[0, 'A4', 1], [1, 'C5', 1], [2, 'F5', 1]],
      [[0, 'E5', 2], [2, 'C#5', 1]],
      [[0, 'D5', 2], [2, 'F5', 1]],
      [[0, 'D5', 2], [2, 'Bb4', 1]],
      [[0, 'G4', 1], [1, 'Bb4', 1], [2, 'D5', 1]],
      [[0, 'C5', 2], [2, 'E5', 1]],
      [[0, 'F5', 3]],
      [[0, 'G4', 1], [1, 'Bb4', 1], [2, 'E5', 1]],
    ];
    mel.forEach((bar, i) => {
      for (const [beat, n, len] of bar) {
        s.at(i * 3 + beat, (t, spb, out) => this.lead(out, t, f(n), len * spb * 0.95, 0.04));
        if (beat === 0 && i % 2 === 0) s.at(i * 3, (t, _spb, out) => this.bell(out, t, f(n) * 2, 0.02, 1.8));
      }
    });
    return s;
  }

  /** Party: original dance-pop in C (I–V–vi–IV), 120 bpm, 16 bars with a pluck hook. */
  private buildParty(): Score {
    const s = new Score(120, 64, 0.14);
    const chords: [string, string[]][] = [
      ['C2', ['C4', 'E4', 'G4']],
      ['G1', ['B3', 'D4', 'G4']],
      ['A1', ['C4', 'E4', 'A4']],
      ['F1', ['C4', 'F4', 'A4']],
    ];
    const hook: [number, string][][] = [
      [[0, 'E5'], [0.5, 'G5'], [1, 'G5'], [1.5, 'A5'], [2, 'G5'], [3, 'E5'], [3.5, 'D5']],
      [[0, 'D5'], [0.5, 'G5'], [1, 'G5'], [1.5, 'A5'], [2, 'B5'], [3, 'A5'], [3.5, 'G5']],
      [[0, 'C5'], [0.5, 'E5'], [1, 'E5'], [1.5, 'G5'], [2, 'A5'], [3, 'G5'], [3.5, 'E5']],
      [[0, 'F5'], [0.5, 'A5'], [1, 'A5'], [1.5, 'C6'], [2, 'A5'], [2.5, 'G5'], [3, 'F5'], [3.5, 'E5']],
    ];
    for (let bar = 0; bar < 16; bar++) {
      const b = bar * 4;
      const [root, tones] = chords[bar % 4];
      const rf = f(root) * 2; // bass sits an octave up from the written root
      for (let beat = 0; beat < 4; beat++) {
        s.at(b + beat, (t, _spb, out) => this.kick(out, t, 0.62));
        if (beat % 2 === 1) s.at(b + beat, (t, _spb, out) => this.clap(out, t, 0.22));
        s.at(b + beat + 0.5, (t, _spb, out) => this.hat(out, t, 0.08, true));
        if (bar >= 8) for (const q of [0.25, 0.75]) s.at(b + beat + q, (t, _spb, out) => this.hat(out, t, 0.03, false));
      }
      // octave-bouncing eighths
      for (let e = 0; e < 8; e++) s.at(b + e * 0.5, (t, spb, out) => this.bass(out, t, e % 2 ? rf * 2 : rf, spb * 0.42, 0.16, true));
      // bright stabs: on 2-and and 4-and at first, every offbeat once the hook is in
      const stabs = bar < 4 ? [1.5, 3.5] : [0.5, 1.5, 2.5, 3.5];
      for (const st of stabs) s.at(b + st, (t, _spb, out) => tones.forEach((n) => this.piano(out, t, f(n), 0.16, 0.03)));
      if (bar >= 8 && bar < 12) s.at(b, (t, spb, out) => this.strings(out, t, tones.map(f), spb * 4, 0.02, 2200));
      const withHook = (bar >= 4 && bar < 8) || bar >= 12;
      if (withHook)
        for (const [beat, n] of hook[bar % 4]) {
          s.at(b + beat, (t, _spb, out) => this.pluck(out, t, f(n), 0.05));
          if (bar >= 12) s.at(b + beat, (t, _spb, out) => this.bell(out, t, f(n) * 2, 0.016, 0.6));
        }
    }
    s.at(0, (t, _spb, out) => this.crash(out, t, 0.07));
    s.at(32, (t, _spb, out) => this.crash(out, t, 0.06));
    return s;
  }

  // ------------------------------------------------------------------ one-shot effects
  sfx(kind: WedSfx, vol = 1) {
    const ctx = this.ctx;
    if (this.disposed || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    const out = this.sfxBus;
    const v = Math.max(0, Math.min(2, vol));
    switch (kind) {
      case 'pop': {
        // the crack, then paper strips fluttering down
        this.burst(out, t, { gain: 0.5 * v, freq: 2600, q: 0.6, dur: 0.05, type: 'highpass' });
        this.burst(out, t, { gain: 0.25 * v, freq: 900, q: 1.2, dur: 0.08 });
        this.rustle(out, t + 0.06, 0.6, 0.06 * v);
        break;
      }
      case 'cannon': {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        g.connect(out);
        const o = this.osc('sine', 120, t, t + 0.36, g);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
        this.burst(out, t, { gain: 0.32 * v, freq: 700, q: 0.5, dur: 0.22, type: 'lowpass' });
        this.burst(out, t, { gain: 0.18 * v, freq: 3000, q: 0.6, dur: 0.07, type: 'highpass' });
        this.rustle(out, t + 0.12, 1.1, 0.07 * v);
        break;
      }
      case 'cheer': {
        // crowd: a swell of band-passed noise and a few voices sliding up into "yay"
        const n = this.burst(out, t, { gain: 0.14 * v, freq: 1100, q: 1.3, dur: 1.5, attack: 0.25 });
        n.bp.frequency.setValueAtTime(800, t);
        n.bp.frequency.linearRampToValueAtTime(1300, t + 0.5);
        for (let i = 0; i < 4; i++) {
          const st = t + i * 0.07 + Math.random() * 0.1;
          const base = 230 + Math.random() * 220;
          const form = ctx.createBiquadFilter();
          form.type = 'bandpass';
          form.frequency.value = 900 + Math.random() * 500;
          form.Q.value = 2.5;
          const g = this.envGain(out, st, 0.05 * v, 0.12, 0.45, 0.8);
          form.connect(g);
          const o = this.osc('sawtooth', base, st, st + 1.5, form);
          o.frequency.setValueAtTime(base * 0.85, st);
          o.frequency.linearRampToValueAtTime(base * 1.3, st + 0.35);
          o.frequency.linearRampToValueAtTime(base * 1.15, st + 1.3);
        }
        break;
      }
      case 'chime': {
        ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => this.bell(out, t + i * 0.09, f(n), 0.1 * v, 1.4));
        break;
      }
      case 'sparkle': {
        for (let i = 0; i < 8; i++) this.bell(out, t + i * 0.085 + Math.random() * 0.05, 2200 + Math.random() * 2600, 0.05 * v, 0.5);
        break;
      }
      case 'whoosh': {
        const n = this.burst(out, t, { gain: 0.2 * v, freq: 400, q: 1.6, dur: 0.75, attack: 0.25 });
        n.bp.frequency.setValueAtTime(300, t);
        n.bp.frequency.exponentialRampToValueAtTime(3200, t + 0.45);
        n.bp.frequency.exponentialRampToValueAtTime(900, t + 1.0);
        break;
      }
      case 'kiss': {
        // lips: a quick pitch-rising pop, then a soft bell
        const g = this.envGain(out, t, 0.18 * v, 0.004, 0.03, 0.08);
        const o = this.osc('sine', 500, t, t + 0.13, g);
        o.frequency.exponentialRampToValueAtTime(1300, t + 0.07);
        this.burst(out, t, { gain: 0.12 * v, freq: 2400, q: 1, dur: 0.03 });
        this.bell(out, t + 0.16, f('A6'), 0.07 * v, 1.2);
        this.bell(out, t + 0.26, f('E7'), 0.04 * v, 0.9);
        break;
      }
      case 'clink': {
        const hits: [number, number[]][] = [
          [0, [2350, 3380]],
          [0.07, [2610, 3720]],
        ];
        for (const [dt, pair] of hits) {
          for (let k = 0; k < pair.length; k++) {
            const fr = pair[k];
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t + dt);
            g.gain.linearRampToValueAtTime((k ? 0.07 : 0.12) * v, t + dt + 0.002);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.45);
            g.connect(out);
            this.osc('sine', fr, t + dt, t + dt + 0.47, g);
          }
        }
        break;
      }
      case 'envelope': {
        const n = this.burst(out, t, { gain: 0.12 * v, freq: 2600, q: 0.9, dur: 0.22, attack: 0.05 });
        n.bp.frequency.exponentialRampToValueAtTime(5200, t + 0.2);
        this.bell(out, t + 0.24, f('E7'), 0.08 * v, 0.9);
        this.bell(out, t + 0.31, f('B7'), 0.04 * v, 0.6);
        break;
      }
      case 'tick': {
        const g = this.envGain(out, t, 0.14 * v, 0.002, 0.01, 0.04);
        this.osc('sine', 1800, t, t + 0.07, g);
        this.burst(out, t, { gain: 0.05 * v, freq: 5000, q: 1, dur: 0.012 });
        break;
      }
      case 'catch': {
        // happy little fanfare: three brass notes up, the last one held
        const notes: [string, number][] = [
          ['G4', 0.13],
          ['C5', 0.13],
          ['E5', 0.13],
          ['G5', 0.55],
        ];
        const g = ctx.createGain();
        g.gain.value = v;
        g.connect(out);
        notes.forEach(([n, d], i) => this.brass(g, t + i * 0.14, f(n), d, 0.11));
        this.later(() => this.sfx('sparkle', 0.6 * v), 450);
        break;
      }
      case 'fizz': {
        // the pour: a hiss that swells and settles, with bubbles popping all over it
        this.burst(out, t, { gain: 0.07 * v, freq: 2600, q: 0.6, dur: 1.9, attack: 0.25, type: 'lowpass' });
        this.burst(out, t, { gain: 0.04 * v, freq: 6500, q: 0.7, dur: 2.0, attack: 0.4, type: 'highpass' });
        for (let i = 0; i < 26; i++) {
          const st = t + 0.15 + Math.random() * 1.9;
          const g = this.envGain(out, st, (0.012 + Math.random() * 0.02) * v, 0.002, 0.004, 0.025);
          const o = this.osc('sine', 2800 + Math.random() * 4200, st, st + 0.04, g);
          o.frequency.exponentialRampToValueAtTime(5000 + Math.random() * 3000, st + 0.03);
        }
        break;
      }
      case 'chant': {
        // a few guests shouting "Hôn đi!": an "ô" then an "i", pitch falling like a chant
        const voices = 3;
        for (let i = 0; i < voices; i++) {
          const st = t + Math.random() * 0.05;
          const f0 = 170 + Math.random() * 120;
          this.voice(out, st, f0, f0 * 0.95, 0.16, [[520, 6], [880, 7], [2500, 9]], 0.05 * v);
          this.voice(out, st + 0.21, f0 * 0.92, f0 * 0.8, 0.2, [[300, 6], [2250, 8], [2950, 9]], 0.045 * v);
        }
        this.burst(out, t, { gain: 0.03 * v, freq: 1600, q: 0.8, dur: 0.12 });
        break;
      }
      case 'dzo': {
        // the whole table: "DZÔÔÔ!" rising, glasses clinking all round
        for (let i = 0; i < 5; i++) {
          const st = t + Math.random() * 0.08;
          const f0 = 160 + Math.random() * 160;
          this.voice(out, st, f0 * 0.9, f0 * 1.25, 0.55, [[480, 5], [820, 6], [2400, 9]], 0.05 * v);
        }
        this.burst(out, t, { gain: 0.05 * v, freq: 1200, q: 1, dur: 0.6, attack: 0.08 });
        for (let i = 0; i < 6; i++) {
          const st = t + 0.04 + Math.random() * 0.25;
          const fr = 2200 + Math.random() * 1600;
          const g = this.envGain(out, st, (0.05 + Math.random() * 0.05) * v, 0.002, 0.005, 0.35);
          this.osc('sine', fr, st, st + 0.4, g);
          this.osc('sine', fr * 1.43, st, st + 0.3, g);
        }
        break;
      }
      case 'grab': {
        const n = this.burst(out, t, { gain: 0.16 * v, freq: 900, q: 1.2, dur: 0.25, attack: 0.02 });
        n.bp.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
        break;
      }
      case 'drumroll': {
        // snare roll speeding up and swelling for 1.6 s, then a crash
        let st = t;
        let gap = 0.05;
        let i = 0;
        while (st < t + 1.6) {
          const k = (st - t) / 1.6;
          this.burst(out, st, { gain: (0.05 + 0.13 * k) * v * (i % 2 ? 0.8 : 1), freq: 2400, q: 0.7, dur: 0.05 });
          st += gap;
          gap = Math.max(0.028, gap * 0.985);
          i++;
        }
        this.crash(out, t + 1.62, 0.2 * v);
        const g = this.envGain(out, t + 1.62, 0.25 * v, 0.004, 0.02, 0.3);
        const o = this.osc('sine', 110, t + 1.62, t + 2.0, g);
        o.frequency.exponentialRampToValueAtTime(45, t + 1.9);
        break;
      }
    }
  }

  /** A sung / shouted vowel: a sawtooth glottis through three formant band-passes. */
  private voice(out: AudioNode, t: number, f0: number, f1: number, dur: number, formants: [number, number][], v: number) {
    const ctx = this.ctx;
    const g = this.envGain(out, t, v, 0.025, Math.max(0.01, dur - 0.08), 0.12);
    for (const [fr, q] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fr;
      bp.Q.value = q;
      bp.connect(g);
      const o = this.osc('sawtooth', f0, t, t + dur + 0.15, bp, (Math.random() - 0.5) * 20);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
  }

  /** Paper strips / confetti fluttering: a scatter of tiny high noise ticks. */
  private rustle(out: AudioNode, t: number, dur: number, v: number) {
    const n = Math.round(dur * 26);
    for (let i = 0; i < n; i++) {
      const st = t + Math.random() * dur;
      const k = 1 - (st - t) / dur;
      this.burst(out, st, { gain: v * (0.4 + 0.6 * k), freq: 3500 + Math.random() * 4000, q: 1.5, dur: 0.012 + Math.random() * 0.02 });
    }
  }
}
