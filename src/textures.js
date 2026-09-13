import * as THREE from 'three';

/** Radial glow sprite (particles, pickups) */
export function makeGlowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Mottled noise texture for the violet board */
export function makeTrackTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    const r = 1 + Math.random() * 9;
    const a = 0.012 + Math.random() * 0.05;
    const dark = Math.random() > 0.42;
    g.fillStyle = dark ? `rgba(40,0,90,${a})` : `rgba(255,235,255,${a * 0.9})`;
    g.beginPath();
    g.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 4;
  return tex;
}

/** Ball surface: light grey with speckles so rolling is visible */
export function makeBallTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#eaecf2';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1500; i++) {
    const r = 2 + Math.random() * 8;
    const a = 0.03 + Math.random() * 0.08;
    const v = 120 + Math.random() * 70;
    g.fillStyle = `rgba(${v | 0},${(v - 4) | 0},${(v + 12) | 0},${a})`;
    g.beginPath();
    g.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
    g.fill();
  }
  // a few darker blotches make the spin readable
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(105,100,125,${0.10 + Math.random() * 0.1})`;
    g.beginPath();
    g.arc(Math.random() * s, Math.random() * s, 6 + Math.random() * 16, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Gradient sky (inside of a large sphere) */
export function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#05030c');
  grad.addColorStop(0.34, '#0d0a1c');
  grad.addColorStop(0.52, '#241b38');
  grad.addColorStop(0.62, '#5b5266');
  grad.addColorStop(0.68, '#2c2338');
  grad.addColorStop(0.8, '#0b0716');
  grad.addColorStop(1.0, '#05030c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Floating label sprite (tutorial hints) */
export function makeTextSprite(text, opts = {}) {
  const { color = '#ffffff', bg = 'rgba(18,10,38,0.82)', border = 'rgba(160,120,255,0.55)', accent = '#56e0ff' } = opts;
  const fontPx = 46;
  const padX = 26;
  const padY = 18;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `600 ${fontPx}px system-ui, "Segoe UI", sans-serif`;
  const textW = Math.ceil(measure.measureText(text).width);
  const w = textW + padX * 2;
  const h = fontPx + padY * 2;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const r = 18;
  g.beginPath();
  g.moveTo(r, 0);
  g.lineTo(w - r, 0);
  g.quadraticCurveTo(w, 0, w, r);
  g.lineTo(w, h - r);
  g.quadraticCurveTo(w, h, w - r, h);
  g.lineTo(r, h);
  g.quadraticCurveTo(0, h, 0, h - r);
  g.lineTo(0, r);
  g.quadraticCurveTo(0, 0, r, 0);
  g.closePath();
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = border;
  g.stroke();
  g.fillStyle = accent;
  g.fillRect(padX * 0.5, h * 0.4, 5, h * 0.2);
  g.font = `600 ${fontPx}px system-ui, "Segoe UI", sans-serif`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2 + 4, h / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
  );
  spr.userData.aspect = w / h;
  return spr;
}
