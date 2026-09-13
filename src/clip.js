/**
 * Rolling clip recorder.
 *
 * Keeps the last N seconds of canvas video in memory so a clear (or a wipeout)
 * can be saved/shared instantly - head-tilt demos are the ones worth posting.
 * Uses MediaRecorder over canvas.captureStream(): no server, no assets.
 */
export class ClipRecorder {
  constructor(canvas, seconds = 8) {
    this.canvas = canvas;
    this.seconds = seconds;
    this.supported = typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
    this.chunks = [];
    this.recorder = null;
    this.stream = null;
    this.started = false;
    this.mimeType = '';
  }

  /** Begin the rolling buffer (call after a user gesture). */
  start() {
    if (!this.supported || this.started) return false;
    try {
      this.stream = this.canvas.captureStream(30);
      const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      this.mimeType = types.find((t) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(t)) || '';
      this.recorder = new MediaRecorder(this.stream, {
        ...(this.mimeType ? { mimeType: this.mimeType } : {}),
        videoBitsPerSecond: 5_000_000,
      });
      this.recorder.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        this.chunks.push({ blob: e.data, t: performance.now() });
        this._trim();
      };
      this.recorder.start(400); // timeslice -> a chunk every ~0.4s
      this.started = true;
      return true;
    } catch (e) {
      console.warn('[clip] recorder unavailable', e);
      this.supported = false;
      return false;
    }
  }

  pause() {
    if (this.recorder && this.recorder.state === 'recording') this.recorder.pause();
  }

  resume() {
    if (this.recorder && this.recorder.state === 'paused') this.recorder.resume();
  }

  stop() {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch (e) {
      /* ignore */
    }
    this.started = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }

  _trim() {
    const cutoff = performance.now() - (this.seconds + 1.5) * 1000;
    while (this.chunks.length && this.chunks[0].t < cutoff) this.chunks.shift();
  }

  get ready() {
    return this.started && this.chunks.length > 0;
  }

  /** Seconds currently buffered */
  get buffered() {
    if (!this.chunks.length) return 0;
    return Math.min(this.seconds, (performance.now() - this.chunks[0].t) / 1000);
  }

  /** Snapshot the last `seconds` as a webm blob */
  build() {
    if (!this.ready) return null;
    this._trim();
    const keep = this.chunks.filter((c) => c.t >= performance.now() - this.seconds * 1000);
    const use = keep.length ? keep : this.chunks;
    return new Blob(use.map((c) => c.blob), { type: this.mimeType || 'video/webm' });
  }

  /** Share via the OS sheet when possible, otherwise download. */
  async share({ name = 'tiltlab-clip.webm', text = 'TILT LAB — head-tilt marble maze' } = {}) {
    const blob = this.build();
    if (!blob) return false;
    let file = null;
    try {
      file = new File([blob], name, { type: blob.type });
    } catch (e) {
      /* very old browsers */
    }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text, title: 'TILT LAB' });
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
    return true;
  }
}
