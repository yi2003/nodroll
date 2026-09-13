import * as THREE from 'three';
import { generateLevel, LEVELS, BALL_R } from './levels.js';
import { Board } from './board.js';
import { SphereBody, stepWorld, updateSpin } from './physics.js';
import { CameraRig } from './camera.js';
import { TiltInput } from './input.js';
import { FaceTracker } from './face.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';
import { ClipRecorder } from './clip.js';
import { makeBallTexture, makeSkyTexture, makeGlowTexture } from './textures.js';

const FIXED = 1 / 120; // fixed physics timestep
const TILT_MAX = 0.30; // max tilt ≈17°

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const video = $('cam');
const hud = $('hud');
const el = {
  level: $('hud-level'),
  time: $('hud-time'),
  falls: $('hud-falls'),
  best: $('hud-best'),
  bubble: $('bubble-dot'),
  barX: $('bar-x'),
  barY: $('bar-y'),
  faceDot: $('face-dot'),
  faceText: $('face-text'),
  camView: $('cam-view'),
  banner: $('banner'),
  drawer: $('drawer'),
  toast: $('toast'),
  flash: $('flash'),
  ghost: $('ghost'),
  fade: $('fade'),
  clip: $('btn-clip'),
  clipDrawer: $('btn-clip-drawer'),
  loading: $('loading'),
  start: $('overlay-start'),
  clear: $('overlay-clear'),
  clearTitle: $('clear-title'),
  clearStats: $('clear-stats'),
  next: $('btn-next'),
  retry: $('btn-retry'),
  sens: $('set-sens'),
  sensVal: $('sens-val'),
  invX: $('set-invx'),
  invY: $('set-invy'),
  pauseLost: $('set-pauselost'),
  mute: $('set-mute'),
  modeFace: $('set-mode-face'),
  modeKb: $('set-mode-kb'),
};
const camCtx = el.camView.getContext('2d');

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0716, 70, 300);
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 800);
const rig = new CameraRig(camera);

const hemi = new THREE.HemisphereLight(0xa98cff, 0x0d0618, 1.5);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 2.0);
dir.position.set(34, 74, 26);
dir.castShadow = true;
dir.shadow.mapSize.set(1536, 1536);
dir.shadow.bias = -0.0006;
dir.shadow.normalBias = 0.02;
scene.add(dir, dir.target);
const fill = new THREE.DirectionalLight(0x7a4dff, 0.55);
fill.position.set(-26, 16, -30);
scene.add(fill);

const glowTex = makeGlowTexture();

buildEnvironment();

function buildEnvironment() {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(430, 32, 24),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // star dust
  const N = 520;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 120 + Math.random() * 200;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 1.6 - 0.6);
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
    pos[i * 3 + 1] = Math.cos(ph) * r * 0.55 + 20;
    pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(
    g,
    new THREE.PointsMaterial({ size: 2.4, map: glowTex, color: 0xbba8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false })
  );
  stars.frustumCulled = false;
  scene.add(stars);

  // dark shards drifting far below for depth
  const shardMat = new THREE.MeshStandardMaterial({ color: 0x1b1030, roughness: 0.9, metalness: 0.1, emissive: 0x0a0418, emissiveIntensity: 0.6 });
  for (let i = 0; i < 18; i++) {
    const s = 3 + Math.random() * 9;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * (0.4 + Math.random()), s * (0.6 + Math.random())), shardMat);
    const a = Math.random() * Math.PI * 2;
    const r = 55 + Math.random() * 90;
    m.position.set(Math.cos(a) * r, -18 - Math.random() * 60, Math.sin(a) * r);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    scene.add(m);
  }
}

// ---------------------------------------------------------------- ball
const ballMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: makeBallTexture(),
  roughness: 0.48,
  metalness: 0.03,
  emissive: 0x1a1428,
  emissiveIntensity: 0.5,
});
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), ballMat);
ballMesh.castShadow = true;
ballMesh.receiveShadow = false;
scene.add(ballMesh);
const body = new SphereBody(BALL_R);

// ---------------------------------------------------------------- systems
const fx = new FX(scene);
const sfx = new Sfx();
const tiltInput = new TiltInput(canvas, (a) => onAction(a));
const tracker = new FaceTracker(video);
/** Rolling 8 s clip buffer - head-tilt clears are the ones worth posting. */
const clip = new ClipRecorder(canvas, 8);
const isTouch = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;

// keyboard / drag is the default path on desktop; head control is an upgrade
const savedSettings = readJSON('tiltlab.settings') || {};
const settings = Object.assign(
  { mode: 'kb', sens: 1, invX: false, invY: false, pauseOnLost: true, muted: false },
  savedSettings
);
// v2 maps the head-roll axis straight through (tilt your head left -> the board
// rolls left). An "invert left/right" choice saved before that would double-flip
// it, so those two flags are reset once.
if (savedSettings.v !== 2) {
  settings.invX = false;
  settings.invY = false;
}
settings.v = 2;
let bestTimes = readJSON('tiltlab.best') || {};

// adaptive quality: weak machines degrade automatically to stay responsive
const quality = { level: 0, acc: 0, frames: 0, cooldown: 2 };
function applyQuality(level) {
  if (level === quality.level) return;
  quality.level = level;
  if (level === 0) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    dir.shadow.mapSize.set(1536, 1536);
  } else if (level === 1) {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    dir.shadow.mapSize.set(1024, 1024);
  } else {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
  }
  dir.shadow.map?.dispose();
  dir.shadow.map = null;
  scene.traverse((o) => {
    if (o.material) o.material.needsUpdate = true;
  });
}

const state = {
  phase: 'menu', // menu | playing | paused | clear | done
  index: 0,
  time: 0,
  falls: 0,
  totalTime: 0,
  respawn: 0,
  frozen: false,
  wasCalibrated: false,
  dropIn: 0, // >0 while the ball scales back in after a respawn
  ghostTimer: 0,
  lastImpact: 0,
  trail: 0,
  camAcc: 0,
  facePauseBanner: false,
};

let board = null;
let level = null;

// ---------------------------------------------------------------- level
function setupLevel(index) {
  state.index = index;
  if (board) {
    scene.remove(board.group);
    disposeGroup(board.group);
  }
  const cfg = LEVELS[index];
  level = generateLevel(cfg);
  board = new Board(scene, level, glowTex);
  rig.fit(board);
  rig.look.set(0, 0, 0);
  rig.update(1, new THREE.Vector3(0, 0, 0), 0);
  rig.snap();
  resetBall();
  state.time = 0;
  state.falls = 0;
  state.respawn = 0;
  el.level.textContent = cfg.name.slice(0, 2);
  updateBestLabel();
}

const DROP_TIME = 0.34;

/** Place the ball on the start pad (used at level start: no fanfare). */
function resetBall() {
  const p = board.startLocal.clone();
  p.y = BALL_R + 0.05;
  board.toWorld(p, p);
  body.teleport(p);
  ballMesh.quaternion.identity();
  ballMesh.scale.setScalar(1);
  state.dropIn = 0;
}

/**
 * Soft respawn: fade the cut, then coast back in - the ball materialises a
 * little above the pad and settles, instead of popping in at zero velocity.
 */
function startRespawn() {
  const p = board.startLocal.clone();
  p.y = BALL_R + 1.1;
  board.toWorld(p, p);
  body.teleport(p, new THREE.Vector3(0, -1.6, 0));
  ballMesh.quaternion.identity();
  ballMesh.scale.setScalar(0.45);
  state.dropIn = DROP_TIME;
  fadeScreen(0.45);
  const w = board.cellWorld(level.start.col, level.start.row, 0.06);
  fx.ring(w, new THREE.Color(0x5ce1ff), 1.15, 0.7, board.quat);
  fx.burst(w, new THREE.Color(0x6fd8ff), 10, 1.6, 0.45);
  sfx.roll();
}

function fadeScreen(dur = 0.45) {
  el.fade.style.transition = 'none';
  el.fade.style.opacity = '0.94';
  requestAnimationFrame(() => {
    el.fade.style.transition = `opacity ${dur}s ease`;
    el.fade.style.opacity = '0';
  });
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

// ---------------------------------------------------------------- flow
function setPhase(p) {
  const prev = state.phase;
  state.phase = p;
  if (p === 'playing' && prev !== 'playing' && prev !== 'paused') showGhost(state.index === 0 ? 8 : 4.5);
  if (p !== 'playing') hideGhost();
  if (p === 'playing') clip.resume();
  else clip.pause();
  el.start.classList.toggle('hidden', p !== 'menu');
  el.clear.classList.toggle('hidden', !(p === 'clear' || p === 'done'));
  hud.classList.toggle('hidden', p === 'menu');
  el.drawer.classList.toggle('hidden', p !== 'paused');
}

async function startRun(mode) {
  setPhase('playing');
  sfx.ensure();
  clip.start();
  sfx.setMuted(settings.muted);
  state.totalTime = 0;
  setupLevel(0);
  await useMode(mode, true);
}

async function useMode(mode, silent) {
  settings.mode = mode;
  saveSettings();
  syncSettingsUI();
  if (mode !== 'face') {
    el.faceText.textContent = 'Keyboard / drag mode';
    el.faceDot.className = 'dot warn';
    return true;
  }
  if (tracker.ready) {
    tracker.recalibrate();
    return true;
  }
  try {
    el.faceText.textContent = 'Loading model…';
    await tracker.init((msg) => (el.faceText.textContent = msg));
    await tracker.startCamera((msg) => (el.faceText.textContent = msg));
    tracker.recalibrate();
    tracker.start();
    toast('Sit straight and look at the screen — auto-calibrating…');
    return true;
  } catch (e) {
    console.error(e);
    toast('Camera unavailable — switched to keyboard mode');
    settings.mode = 'kb';
    saveSettings();
    syncSettingsUI();
    el.faceText.textContent = 'Camera unavailable';
    el.faceDot.className = 'dot bad';
    if (!silent) setBanner('Camera unavailable — tilt the board with the arrow keys');
    return false;
  }
}

function nextLevel() {
  if (state.index + 1 >= LEVELS.length) {
    setPhase('done');
    return;
  }
  state.totalTime += state.time;
  setupLevel(state.index + 1);
  setPhase('playing');
}

function clearLevel() {
  if (state.phase !== 'playing') return;
  const cfg = LEVELS[state.index];
  const key = cfg.name.slice(0, 2);
  const prev = bestTimes[key];
  const isBest = !prev || state.time < prev;
  if (isBest) {
    bestTimes[key] = state.time;
    saveJSON('tiltlab.best', bestTimes);
  }
  updateBestLabel();
  sfx.goal();
  const doorWorld = board.cellWorld(level.door.col, level.door.row, 1.2);
  const c = new THREE.Color(0x45ff9a);
  fx.burst(doorWorld, c, 40, 5, 0.9);
  rig.kick(0.5);

  const last = state.index + 1 >= LEVELS.length;
  if (last) {
    state.totalTime += state.time;
    el.clearTitle.textContent = 'All levels cleared!';
    const total = state.totalTime;
    el.clearStats.innerHTML = `${LEVELS.length} levels in <b>${fmt(total)}</b><br>${state.falls} total falls`;
    el.next.textContent = 'Play again';
  } else {
    el.clearTitle.textContent = 'Level cleared!';
    el.clearStats.innerHTML = `${cfg.name} · <b>${fmt(state.time)}</b>${isBest ? ' · <b>new record</b>' : ''}<br>${state.falls} fall${state.falls === 1 ? '' : 's'}`;
    el.next.textContent = 'Next level';
  }
  refreshClipButton();
  setPhase(last ? 'done' : 'clear');
}

function handleFall() {
  if (state.respawn > 0) return;
  state.falls++;
  state.respawn = 0.95; // let the ball really drop into the dark first
  sfx.hole();
  // Fall FX belongs to the pit mouth, at deck level - drawing anything under the
  // deck is what makes a miss read as "sinking through the wood".
  const hole = board.nearestHole(_tmpLocal);
  if (hole) {
    const mouth = board.cellWorld(hole.col, hole.row, 0.05);
    fx.ring(mouth, new THREE.Color(0x9a6bff), 1.5, 0.8, board.quat);
    fx.burst(mouth, new THREE.Color(0x7c3aed), 16, 2.4, 0.55);
  }
  rig.kick(0.3);
}

/** Outside the board footprint (safety net for the rim fence) */
function offBoard(l) {
  return Math.abs(l.x) > board.halfW + 0.4 || Math.abs(l.z) > board.halfD + 0.4;
}

// ---------------------------------------------------------------- input -> tilt
const _tmpLocal = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();

function computeTilt(dt) {
  let x = 0;
  let y = 0;
  const faceOk = settings.mode === 'face' && tracker.ready && tracker.calibrated && tracker.present;

  if (faceOk) {
    // The raw eye-corner angle runs opposite to screen-right, so it is negated:
    // tilt your head to one side and the board rolls that same way.
    x = -tracker.roll;
    y = tracker.pitch;
  } else {
    const kb = tiltInput.update(dt);
    if (kb.active || settings.mode !== 'face' || !tracker.ready) {
      x = kb.x;
      y = kb.y;
    }
  }

  x *= settings.sens;
  y *= settings.sens;
  if (settings.invX) x = -x;
  if (settings.invY) y = -y;
  x = THREE.MathUtils.clamp(x, -1, 1);
  y = THREE.MathUtils.clamp(y, -1, 1);
  return { x, y };
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
let acc = 0;

renderer.setAnimationLoop((now) => {
  const dt = Math.min(1 / 15, Math.max(0, (now - last) / 1000)) || 0.016;
  last = now;

  tracker.update(dt);
  if (tracker.calibrated && !state.wasCalibrated) {
    state.wasCalibrated = true;
    sfx.calibrate();
    toast('Calibrated · tilt your head to test');
  } else if (!tracker.calibrated) {
    state.wasCalibrated = false;
  }
  const tilt = computeTilt(dt);

  const faceLost = settings.mode === 'face' && tracker.ready && tracker.calibrated && !tracker.present;
  state.faceLost = faceLost;
  const faceHold = faceLost && settings.pauseOnLost;
  const frozen = state.phase !== 'playing' || faceHold;

  if (state.phase === 'playing') state.time += dt;

  if (!frozen) {
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 14) {
      const tx = -tilt.y * TILT_MAX;
      const tz = -tilt.x * TILT_MAX;
      board.update(FIXED, tx, tz);
      stepWorld(body, board.colliders, FIXED);
      updateSpin(body, FIXED);
      acc -= FIXED;
      steps++;
    }
    if (steps === 14) acc = 0;

    // impact feedback
    if (body.impact > 2.6 && now - state.lastImpact > 90) {
      state.lastImpact = now;
      sfx.wallHit(body.impact);
      if (body.impact > 4.5) {
        fx.burst(body.pos, new THREE.Color(0xd8b6ff), 6, 2.2, 0.4);
        rig.kick(Math.min(0.35, body.impact / 40));
      }
    }

    // motion trail
    const speed = body.speed;
    if (speed > 4.5 && body.onGround) {
      state.trail += dt;
      if (state.trail > 0.028) {
        state.trail = 0;
        fx.trail(body.pos, body.vel, new THREE.Color(0xb98cff).multiplyScalar(0.5));
      }
    }

    // fell into a hole / reached the door
    board.toLocal(body.pos, _tmpLocal);
    if (state.respawn > 0) {
      state.respawn -= dt;
      if (state.respawn <= 0) startRespawn();
    } else if (_tmpLocal.y < -1.2 || offBoard(_tmpLocal)) {
      // Fell through a pit (deck bottom is at -0.7, so this only fires once the
      // ball is genuinely below the deck), or got past the rim fence.
      handleFall();
    } else if (board.atDoor(_tmpLocal)) {
      clearLevel();
    }
  } else {
    tiltInput.update(dt); // keep internal state ticking
    acc = 0;
    // while paused by face-loss, slowly level the board
    if (faceHold) board.update(dt, 0, 0, 5);
    if (state.respawn > 0) state.respawn = Math.max(state.respawn, 0.25);
  }

  // ball transform (with the respawn materialise)
  if (state.dropIn > 0) {
    state.dropIn = Math.max(0, state.dropIn - dt);
    const t = 1 - state.dropIn / DROP_TIME;
    const e = t * t * (3 - 2 * t);
    ballMesh.scale.setScalar(0.45 + 0.55 * e);
  } else if (ballMesh.scale.x !== 1) {
    ballMesh.scale.setScalar(1);
  }
  ballMesh.position.copy(body.pos);
  if (body.spin.lengthSq() > 1e-8) {
    _axis.copy(body.spin).normalize();
    _dq.setFromAxisAngle(_axis, body.spin.length() * dt);
    ballMesh.quaternion.premultiply(_dq);
  }

  if (state.ghostTimer > 0) {
    state.ghostTimer -= dt;
    if ((state.phase === 'playing' && (Math.abs(tilt.x) > 0.12 || Math.abs(tilt.y) > 0.12)) || state.ghostTimer <= 0) hideGhost();
  }

  fx.update(dt);
  sfx.setRoll(body.speed, body.onGround);
  rig.update(dt, body.pos, state.phase === 'playing' ? 0.3 : 0.15);
  updateHud(dt, tilt);
  drawCamPreview(dt);
  renderer.render(scene, camera);

  // adaptive quality
  quality.acc += dt;
  quality.frames++;
  if (quality.acc > 2.2) {
    const fps = quality.frames / quality.acc;
    quality.acc = 0;
    quality.frames = 0;
    if (quality.cooldown > 0) quality.cooldown--;
    else if (fps < 32 && quality.level < 2) applyQuality(quality.level + 1);
  }

  if (!el.loading.classList.contains('done')) el.loading.classList.add('done');
});

// ---------------------------------------------------------------- HUD
let camTick = 0;
function updateHud(dt, tilt) {
  el.time.textContent = fmt(state.time);
  el.falls.textContent = String(state.falls);
  el.bubble.style.transform = `translate(${tilt.x * 18}px, ${-tilt.y * 18}px)`;
  el.barX.style.transform = `translateY(${-tilt.x * 18}px)`;
  el.barY.style.transform = `translateY(${-tilt.y * 18}px)`;

  // face status
  if (settings.mode === 'face' && tracker.ready) {
    if (!tracker.calibrated) {
      el.faceText.textContent = tracker.present ? 'Calibrating — sit naturally' : 'No face detected — look at the camera';
      el.faceDot.className = tracker.present ? 'dot warn' : 'dot bad';
    } else if (tracker.present) {
      el.faceText.textContent = 'Face locked · calibrated';
      el.faceDot.className = 'dot ok';
    } else {
      el.faceText.textContent = settings.pauseOnLost ? 'Face lost · paused' : 'Face lost · recentering';
      el.faceDot.className = 'dot bad';
    }
  }

  // banner
  if (state.phase === 'playing') {
    if (settings.mode === 'face' && tracker.ready && !tracker.calibrated) {
      setBanner(tracker.present ? 'Calibrating: sit up and look at the screen…' : 'Put your face in the frame so the camera can see you');
    } else if (state.faceLost) {
      setBanner(settings.pauseOnLost ? 'No face detected · paused (come back to resume)' : 'No face detected · leveling the board');
    } else {
      setBanner(null);
    }
  } else if (state.phase !== 'playing') {
    setBanner(null);
  }
}

function drawCamPreview(dt) {
  camTick += dt;
  if (camTick < 0.05) return;
  camTick = 0;
  const w = el.camView.width;
  const h = el.camView.height;
  camCtx.clearRect(0, 0, w, h);
  camCtx.fillStyle = '#0b0716';
  camCtx.fillRect(0, 0, w, h);
  if (settings.mode !== 'face' || !tracker.stream) {
    camCtx.fillStyle = '#544a70';
    camCtx.font = '13px sans-serif';
    camCtx.textAlign = 'center';
    camCtx.fillText('Keyboard / drag mode', w / 2, h / 2);
    return;
  }
  if (video.readyState >= 2) {
    camCtx.save();
    camCtx.translate(w, 0);
    camCtx.scale(-1, 1);
    camCtx.drawImage(video, 0, 0, w, h);
    camCtx.restore();
  }
  // eye line + centre line
  camCtx.strokeStyle = 'rgba(86, 224, 255, 0.28)';
  camCtx.lineWidth = 1;
  camCtx.beginPath();
  camCtx.moveTo(0, h / 2);
  camCtx.lineTo(w, h / 2);
  camCtx.stroke();

  const lm = tracker.landmarks;
  if (lm && tracker.present) {
    const pts = [33, 263].map((i) => ({ x: (1 - lm[i].x) * w, y: lm[i].y * h }));
    camCtx.strokeStyle = tracker.calibrated ? '#45ff9a' : '#ffcb45';
    camCtx.lineWidth = 2;
    camCtx.beginPath();
    camCtx.moveTo(pts[0].x, pts[0].y);
    camCtx.lineTo(pts[1].x, pts[1].y);
    camCtx.stroke();
    camCtx.fillStyle = camCtx.strokeStyle;
    for (const p of pts) {
      camCtx.beginPath();
      camCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      camCtx.fill();
    }
  }
  // tilt indicator
  const cx = w - 26;
  const cy = h - 26;
  camCtx.strokeStyle = 'rgba(160, 120, 255, 0.4)';
  camCtx.beginPath();
  camCtx.arc(cx, cy, 18, 0, Math.PI * 2);
  camCtx.stroke();
  camCtx.fillStyle = '#8b3bff';
  camCtx.beginPath();
  camCtx.arc(cx - THREE.MathUtils.clamp(tracker.roll, -1, 1) * 16, cy - THREE.MathUtils.clamp(tracker.pitch, -1, 1) * 16, 5, 0, Math.PI * 2);
  camCtx.fill();
}

let bannerText = null;
function setBanner(text) {
  if (text === bannerText) return;
  bannerText = text;
  if (!text) {
    el.banner.classList.add('hidden');
  } else {
    el.banner.textContent = text;
    el.banner.classList.remove('hidden');
  }
}

// ---------------------------------------------------------------- ghost hint
function ghostText() {
  if (settings.mode === 'face') return 'Tilt your head to steer · R restart · Esc settings';
  return isTouch ? 'Drag to tilt · R restart' : 'WASD / arrows tilt · R restart · Esc settings';
}

function showGhost(seconds = 5) {
  el.ghost.textContent = ghostText();
  el.ghost.classList.remove('hidden');
  requestAnimationFrame(() => el.ghost.classList.add('show'));
  state.ghostTimer = seconds;
}

function hideGhost() {
  if (!state.ghostTimer) return;
  state.ghostTimer = 0;
  el.ghost.classList.remove('show');
  setTimeout(() => {
    if (!state.ghostTimer) el.ghost.classList.add('hidden');
  }, 520);
}

// ---------------------------------------------------------------- clip
async function saveClip() {
  if (!clip.ready) {
    toast('No clip buffered yet');
    return;
  }
  const cfg = LEVELS[state.index];
  const face = settings.mode === 'face';
  const name = `tiltlab-${cfg.name.slice(0, 2)}-${Date.now().toString(36)}.webm`;
  const text = `TILT LAB · ${cfg.name}${face ? ' · head control' : ''} · ${fmt(state.time)}`;
  const ok = await clip.share({ name, text });
  if (ok) toast(face ? 'Head-tilt clip saved' : 'Clip saved');
}

function refreshClipButton() {
  const can = clip.ready;
  el.clip.classList.toggle('hidden', !can);
  if (!can) return;
  const face = settings.mode === 'face';
  el.clip.textContent = face ? 'Share head-tilt clip (last 8s)' : 'Save clip (last 8s)';
  el.clip.className = face ? 'primary' : 'ghost-btn';
}

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2000);
}

function flash() {
  el.flash.classList.remove('fire');
  void el.flash.offsetWidth;
  el.flash.classList.add('fire');
}

function updateBestLabel() {
  const key = LEVELS[state.index].name.slice(0, 2);
  const b = bestTimes[key];
  el.best.textContent = b ? fmt(b) : '--';
}

function fmt(t) {
  if (t == null) return '--';
  if (t < 60) return `${t.toFixed(1)}s`;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- actions
function onAction(a) {
  if (a === 'restart') {
    if (state.phase === 'playing' || state.phase === 'clear') {
      setupLevel(state.index);
      if (state.phase === 'clear') setPhase('playing');
      toast('Restarted');
    }
  } else if (a === 'pause') {
    toggleDrawer();
  } else if (a === 'recalibrate') {
    tracker.recalibrate();
    if (settings.mode !== 'face') toast('Keyboard mode needs no calibration');
    else {
      toast('Re-calibrating neutral pose');
      sfx.calibrate();
    }
  } else if (a === 'hint') {
    showGhost(4);
  } else if (a === 'mute') {
    const m = sfx.toggleMute();
    settings.muted = m;
    saveSettings();
    syncSettingsUI();
    toast(m ? 'Muted' : 'Sound on');
  } else if (a === 'fullscreen') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
}

function toggleDrawer() {
  if (state.phase === 'playing') setPhase('paused');
  else if (state.phase === 'paused') setPhase('playing');
}

$('btn-start-face').addEventListener('click', () => startRun('face'));
$('btn-start-kb').addEventListener('click', () => startRun('kb'));
$('btn-gear').addEventListener('click', toggleDrawer);
$('btn-resume').addEventListener('click', () => setPhase('playing'));
$('btn-recal').addEventListener('click', () => onAction('recalibrate'));
$('btn-restart-level').addEventListener('click', () => {
  setupLevel(state.index);
  setPhase('playing');
});
el.clip.addEventListener('click', saveClip);
el.clipDrawer.addEventListener('click', saveClip);
el.next.addEventListener('click', () => {
  if (state.phase === 'done') {
    state.totalTime = 0;
    setupLevel(0);
    setPhase('playing');
  } else {
    nextLevel();
  }
});
el.retry.addEventListener('click', () => {
  setupLevel(state.index);
  setPhase('playing');
});
el.modeFace.addEventListener('click', () => useMode('face'));
el.modeKb.addEventListener('click', () => useMode('kb'));
el.sens.addEventListener('input', () => {
  settings.sens = parseFloat(el.sens.value);
  el.sensVal.textContent = `${settings.sens.toFixed(2)}×`;
  saveSettings();
});
el.invX.addEventListener('change', () => {
  settings.invX = el.invX.checked;
  saveSettings();
});
el.invY.addEventListener('change', () => {
  settings.invY = el.invY.checked;
  saveSettings();
});
el.pauseLost.addEventListener('change', () => {
  settings.pauseOnLost = el.pauseLost.checked;
  saveSettings();
});
el.mute.addEventListener('change', () => {
  settings.muted = el.mute.checked;
  sfx.setMuted(settings.muted);
  saveSettings();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (board) {
    rig.fit(board);
    rig.snap();
  }
});

// ---------------------------------------------------------------- settings persistence
function syncSettingsUI() {
  el.sens.value = String(settings.sens);
  el.sensVal.textContent = `${settings.sens.toFixed(2)}×`;
  el.invX.checked = settings.invX;
  el.invY.checked = settings.invY;
  el.pauseLost.checked = settings.pauseOnLost;
  el.mute.checked = settings.muted;
  el.modeFace.classList.toggle('on', settings.mode === 'face');
  el.modeKb.classList.toggle('on', settings.mode === 'kb');
}

function saveSettings() {
  saveJSON('tiltlab.settings', settings);
}

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (e) {
    return null;
  }
}

function saveJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    /* ignore */
  }
}

// ---------------------------------------------------------------- boot
setupLevel(0);
setPhase('menu');
syncSettingsUI();
sfx.setMuted(settings.muted);
el.faceText.textContent = settings.mode === 'face' ? 'Idle' : 'Keyboard mode';
// debug / automated-test hooks
window.__til = {
  state,
  body,
  board: () => board,
  level: () => level,
  ball: () => ballMesh,
  clip,
  fx,
  tracker,
  settings,
  LEVELS,
  startRun,
  setPhase,
  goto: (i) => {
    setupLevel(i);
    setPhase('playing');
  },
  resetBall,
};
