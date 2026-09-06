// Tiny WebAudio synthesiser for game sounds. No audio files; everything is
// generated, so the single-file build stays self-contained. The context is
// created lazily on the first user gesture (browsers require it).

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
    this._unlockBound = () => this.unlock();
  }

  /** Call from the first click/keypress to satisfy autoplay policies. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
  }

  _tone({ freq = 440, type = 'sine', dur = 0.12, gain = 0.25, attack = 0.005, delay = 0, slideTo = null }) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.06, gain = 0.2, delay = 0, hp = 800 }) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  play(name) {
    if (!this.enabled || !this.ctx) return;
    switch (name) {
      case 'deal':
        this._noise({ dur: 0.04, gain: 0.12, hp: 1200 });
        break;
      case 'card':
        this._noise({ dur: 0.05, gain: 0.18, hp: 900 });
        this._tone({ freq: 180, type: 'triangle', dur: 0.05, gain: 0.08 });
        break;
      case 'turn':
        this._tone({ freq: 880, type: 'sine', dur: 0.14, gain: 0.12 });
        break;
      case 'bid':
        this._tone({ freq: 520, type: 'triangle', dur: 0.08, gain: 0.1 });
        break;
      case 'trick-us':
        this._tone({ freq: 660, type: 'triangle', dur: 0.12, gain: 0.16 });
        this._tone({ freq: 990, type: 'triangle', dur: 0.16, gain: 0.16, delay: 0.09 });
        break;
      case 'trick-them':
        this._tone({ freq: 240, type: 'triangle', dur: 0.16, gain: 0.14 });
        break;
      case 'set':
        this._tone({ freq: 300, type: 'sawtooth', dur: 0.25, gain: 0.12, slideTo: 120 });
        this._noise({ dur: 0.12, gain: 0.15, hp: 300 });
        break;
      case 'nil-made':
        [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 0.18, gain: 0.14, delay: i * 0.07 }));
        break;
      case 'nil-busted':
        this._tone({ freq: 440, type: 'square', dur: 0.2, gain: 0.08, slideTo: 200 });
        break;
      case 'bags':
        this._tone({ freq: 140, type: 'sawtooth', dur: 0.35, gain: 0.14, slideTo: 60 });
        this._noise({ dur: 0.2, gain: 0.2, hp: 200 });
        break;
      case 'win':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.16, delay: i * 0.11 }));
        break;
      case 'lose':
        [392, 349, 311, 262].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.32, gain: 0.13, delay: i * 0.16 }));
        break;
      case 'click':
        this._tone({ freq: 700, type: 'sine', dur: 0.04, gain: 0.06 });
        break;
      case 'error':
        this._tone({ freq: 200, type: 'square', dur: 0.09, gain: 0.06 });
        break;
      default:
        break;
    }
  }
}
