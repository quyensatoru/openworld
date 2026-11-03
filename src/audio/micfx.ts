// Karaoke mic effects: compressor → bass/treble → dry + echo (filtered feedback delay) + reverb
// (generated impulse response). Every listener runs the same chain on a singer's voice (with the
// singer's settings from the server), and the singer can monitor their own voice through it.
import type { MicFx } from '../../shared/karaoke';

const irCache = new WeakMap<BaseAudioContext, AudioBuffer[]>();

/** Stereo exponentially-decaying noise: small room / karaoke room / hall. */
function impulse(ctx: BaseAudioContext, room: number): AudioBuffer {
  let list = irCache.get(ctx);
  if (!list) irCache.set(ctx, (list = []));
  if (list[room]) return list[room];
  const secs = [0.9, 1.9, 3.4][room] ?? 1.9;
  const decay = [3.2, 2.6, 2.1][room] ?? 2.6;
  const pre = Math.floor(ctx.sampleRate * [0.008, 0.018, 0.03][room]);
  const n = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, n + pre, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // a touch of low-pass that gets darker over time, like real rooms
      const k = 0.55 + 0.4 * t;
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i + pre] = lp * 2.2 * Math.pow(1 - t, decay);
    }
  }
  list[room] = buf;
  return buf;
}

export class MicFxChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private comp: DynamicsCompressorNode;
  private bass: BiquadFilterNode;
  private treble: BiquadFilterNode;
  private dry: GainNode;
  private echoSend: GainNode;
  private delay: DelayNode;
  private fbFilter: BiquadFilterNode;
  private feedback: GainNode;
  private echoOut: GainNode;
  private revSend: GainNode;
  private conv: ConvolverNode;
  private room = -1;

  constructor(
    private ctx: AudioContext,
    fx: MicFx,
  ) {
    const g = (v: number) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    this.input = g(1);
    this.output = g(1);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -26;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.2;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.18;
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 180;
    this.treble = ctx.createBiquadFilter();
    this.treble.type = 'highshelf';
    this.treble.frequency.value = 3800;
    this.dry = g(1);
    this.echoSend = g(0);
    this.delay = ctx.createDelay(1);
    this.fbFilter = ctx.createBiquadFilter();
    this.fbFilter.type = 'lowpass';
    this.fbFilter.frequency.value = 3200;
    this.feedback = g(0);
    this.echoOut = g(1);
    this.revSend = g(0);
    this.conv = ctx.createConvolver();
    this.input.connect(this.comp).connect(this.bass).connect(this.treble);
    this.treble.connect(this.dry).connect(this.output);
    // echo: send → delay → (filter → feedback → delay) → out
    this.treble.connect(this.echoSend).connect(this.delay);
    this.delay.connect(this.fbFilter).connect(this.feedback).connect(this.delay);
    this.fbFilter.connect(this.echoOut).connect(this.output);
    // reverb (fed from the dry voice and a bit of the echo, so echoes get a tail too)
    this.treble.connect(this.revSend);
    this.echoOut.connect(this.revSend);
    this.revSend.connect(this.conv).connect(this.output);
    this.set(fx, true);
  }

  set(fx: MicFx, now = false) {
    const t = this.ctx.currentTime;
    const p = (a: AudioParam, v: number) => (now ? (a.value = v) : a.setTargetAtTime(v, t, 0.05));
    p(this.input.gain, fx.vol);
    p(this.bass.gain, fx.bass);
    p(this.treble.gain, fx.treble);
    p(this.echoSend.gain, Math.min(0.85, fx.echo * 0.95));
    p(this.feedback.gain, fx.echo > 0 ? Math.min(0.62, 0.12 + fx.echo * 0.5) : 0);
    p(this.delay.delayTime, fx.delay);
    p(this.revSend.gain, fx.reverb * 0.9);
    p(this.dry.gain, 1 - fx.reverb * 0.18);
    if (fx.room !== this.room) {
      this.room = fx.room;
      this.conv.buffer = impulse(this.ctx, fx.room);
    }
  }

  dispose() {
    for (const n of [this.input, this.comp, this.bass, this.treble, this.dry, this.echoSend, this.delay, this.fbFilter, this.feedback, this.echoOut, this.revSend, this.conv, this.output]) {
      try {
        n.disconnect();
      } catch {
        /* already */
      }
    }
  }
}
