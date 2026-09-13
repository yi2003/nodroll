/**
 * Fallback controls: keyboard / mouse drag / touch drag tilting, so the game is
 * playable without a camera. Emits the same normalised signal as the head
 * tracker: x: +1 = ball should roll to screen-right, y: +1 = roll away.
 */
export class TiltInput {
  constructor(canvas, onAction) {
    this.canvas = canvas;
    this.onAction = onAction || (() => {});
    this.keys = new Set();
    this.x = 0;
    this.y = 0;
    this.kx = 0;
    this.ky = 0;
    this.dragging = false;
    this.pointer = null;
    this.dragStart = { x: 0, y: 0 };
    this.dragTilt = { x: 0, y: 0 };
    this.dragActive = false;
    this.touchActive = false;
    this._bind();
  }

  _bind() {
    const kd = (e) => {
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'KeyR') this.onAction('restart');
      if (k === 'KeyC') this.onAction('recalibrate');
      if (k === 'KeyM') this.onAction('mute');
      if (k === 'Escape' || k === 'KeyP') this.onAction('pause');
      if (k === 'KeyF') this.onAction('fullscreen');
    };
    const ku = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => this.keys.clear());

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.dragging = true;
      this.dragActive = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const scale = e.pointerType === 'touch' ? 90 : 150;
      const dx = (e.clientX - this.dragStart.x) / scale;
      const dy = (e.clientY - this.dragStart.y) / scale;
      this.dragTilt.x = clamp(dx);
      this.dragTilt.y = clamp(dy);
    });
    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.dragTilt.x = 0;
      this.dragTilt.y = 0;
      c.classList.remove('dragging');
      try {
        c.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  update(dt) {
    const K = this.keys;
    let kx = 0;
    let ky = 0;
    if (K.has('KeyA') || K.has('ArrowLeft')) kx -= 1;
    if (K.has('KeyD') || K.has('ArrowRight')) kx += 1;
    if (K.has('KeyW') || K.has('ArrowUp')) ky += 1;
    if (K.has('KeyS') || K.has('ArrowDown')) ky -= 1;

    const k = 1 - Math.exp(-10 * dt);
    this.kx += (kx - this.kx) * k;
    this.ky += (ky - this.ky) * k;

    // drag right = right side sinks = ball rolls right
    this.x = clamp(this.kx + this.dragTilt.x);
    this.y = clamp(this.ky - this.dragTilt.y);

    const active = Math.abs(this.kx) > 0.02 || Math.abs(this.ky) > 0.02 || this.dragActive;
    this.dragActive = this.dragging;
    return { x: this.x, y: this.y, active };
  }
}

function clamp(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
