/**
 * Tiny synth SFX: WebAudio oscillators plus a filtered-noise rolling loop.
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.rollSrc = null;
    this.rollGain = null;
    this.rollFilter = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this._buildRoll();
    return this.ctx;
  }

  _buildRoll() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.rollSrc = src;
    this.rollGain = gain;
    this.rollFilter = filter;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Rolling noise level, speed 0..12 */
  setRoll(speed, onGround) {
    if (!this.rollGain) return;
    const target = onGround ? Math.min(0.16, (speed / 12) * 0.16) : 0;
    this.rollGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    if (this.rollFilter) {
      this.rollFilter.frequency.setTargetAtTime(260 + speed * 46, this.ctx.currentTime, 0.1);
    }
  }

  blip({ freq = 440, to = null, dur = 0.12, type = 'sine', gain = 0.2, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  wallHit(strength) {
    const s = Math.min(1, strength / 9);
    if (s < 0.08) return;
    this.blip({ freq: 190 + s * 260, to: 90, dur: 0.07 + s * 0.05, type: 'triangle', gain: 0.05 + s * 0.14 });
  }

  roll() {
    this.blip({ freq: 150, to: 90, dur: 0.16, type: 'sawtooth', gain: 0.05 });
  }

  hole() {
    this.blip({ freq: 520, to: 60, dur: 0.75, type: 'sine', gain: 0.22 });
    this.blip({ freq: 300, to: 45, dur: 0.9, type: 'triangle', gain: 0.1, delay: 0.05 });
  }

  goal() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.blip({ freq: f, dur: 0.3, type: 'triangle', gain: 0.16, delay: i * 0.085 }));
  }

  levelDone() {
    this.blip({ freq: 660, dur: 0.16, type: 'square', gain: 0.1 });
    this.blip({ freq: 990, dur: 0.22, type: 'square', gain: 0.1, delay: 0.12 });
  }

  calibrate() {
    this.blip({ freq: 880, to: 1320, dur: 0.14, type: 'sine', gain: 0.12 });
  }
}
