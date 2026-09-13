import * as THREE from 'three';

/**
 * Face / head-pose tracking with MediaPipe FaceLandmarker (local wasm + model,
 * fully offline).
 *
 * Emits two normalised signals (-1..1):
 *   roll  -- head tilt left/right (outer-eye-corner line angle, very stable)
 *   pitch -- head up/down (pitch from the 4x4 facial transformation matrix)
 *
 * After the first stable detections the current pose becomes the neutral
 * baseline; when the face is lost the signals fade smoothly back to 0.
 */

const ROLL_RANGE = 0.32; // rad; ~18° of head tilt = full deflection
const PITCH_RANGE = 0.36; // rad; ~21° of nod = full deflection
const DEADZONE = 0.05;
const LOST_MS = 500;

export class FaceTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.stream = null;
    this.ready = false;
    this.running = false;

    this.present = false;
    this.lastSeen = -1e9;
    this.confidence = 0;

    this.roll = 0; // smoothed output
    this.pitch = 0;
    this.signalX = 0;
    this.signalY = 0;
    this.rawRoll = 0;
    this.rawPitch = 0;

    this.baseline = null;
    this.calibrating = true;
    this._cal = [];

    this.landmarks = null;
    this._lastFrameTime = -1;
    this._lastTs = -1;
    this._loop = null;

    this._mat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  /** Load wasm + model (does not open the camera) */
  async init(onProgress) {
    onProgress?.('Loading face model…');
    const mod = await import('../vendor/mediapipe/vision_bundle.mjs');
    const { FilesetResolver, FaceLandmarker } = mod;
    const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const opts = (delegate) => ({
      baseOptions: {
        modelAssetPath: './vendor/mediapipe/face_landmarker.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      console.warn('[face] GPU delegate unavailable, falling back to CPU', e);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    this.ready = true;
  }

  async startCamera(onProgress) {
    onProgress?.('Requesting camera permission…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user',
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    await waitForVideo(this.video);
  }

  start() {
    if (!this.ready || this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this._loop = requestAnimationFrame(tick);
      const v = this.video;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      if (v.currentTime === this._lastFrameTime) return;
      this._lastFrameTime = v.currentTime;
      const now = performance.now();
      if (now - this._lastTs < 30) return; // ~30 Hz inference, leaves room for rendering
      this._lastTs = now;
      try {
        this._handle(this.landmarker.detectForVideo(v, now), now);
      } catch (e) {
        /* ignore a single bad frame */
      }
    };
    this._loop = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this._loop) cancelAnimationFrame(this._loop);
    this._loop = null;
  }

  dispose() {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try {
      this.landmarker?.close?.();
    } catch (e) {
      /* ignore */
    }
    this.landmarker = null;
    this.ready = false;
  }

  /** Re-take the current pose as the neutral baseline */
  recalibrate() {
    this.calibrating = true;
    this._cal.length = 0;
    this.baseline = null;
    this.roll = 0;
    this.pitch = 0;
  }

  _handle(res, now) {
    const lm = res?.faceLandmarks?.[0];
    if (!lm || lm.length < 300) {
      this.confidence = Math.max(0, this.confidence - 0.2);
      if (this.confidence === 0) this.landmarks = null;
      return;
    }
    this.present = true;
    this.lastSeen = now;
    this.landmarks = lm;
    this.confidence = Math.min(1, this.confidence + 0.15);

    // --- roll: angle of the outer-eye-corner line ---
    const a = lm[33]; // outer corner of one eye
    const b = lm[263]; // outer corner of the other eye
    const aspect = (this.video.videoWidth || 4) / (this.video.videoHeight || 3);
    const roll = Math.atan2(b.y - a.y, (b.x - a.x) * aspect);

    // --- pitch: decomposed from the facial transformation matrix ---
    let pitch = 0;
    const mtx = res.facialTransformationMatrixes?.[0];
    if (mtx?.data?.length === 16) {
      this._mat.fromArray(mtx.data);
      this._mat.decompose(this._pos, this._quat, this._scl);
      this._euler.setFromQuaternion(this._quat, 'YXZ');
      pitch = this._euler.x;
    }

    this.rawRoll = roll;
    this.rawPitch = pitch;

    if (this.calibrating) {
      this._cal.push({ roll, pitch });
      while (this._cal.length > 24) this._cal.shift();
      if (this._cal.length >= 20) {
        const rs = this._cal.map((s) => s.roll).sort((x, y) => x - y);
        const ps = this._cal.map((s) => s.pitch).sort((x, y) => x - y);
        this.baseline = { roll: rs[rs.length >> 1], pitch: ps[ps.length >> 1] };
        this.calibrating = false;
        this.calibratedAt = now;
      }
      return;
    }

    this.signalX = applyCurve((roll - this.baseline.roll) / ROLL_RANGE);
    this.signalY = applyCurve((pitch - this.baseline.pitch) / PITCH_RANGE);
  }

  /** Call every frame: smoothing + recentring while the face is lost */
  update(dt) {
    const now = performance.now();
    if (this.lastSeen < 0 || now - this.lastSeen > LOST_MS) this.present = false;

    const active = this.present && !this.calibrating;
    const tx = active ? this.signalX : 0;
    const ty = active ? this.signalY : 0;
    const k = 1 - Math.exp(-(active ? 14 : 6) * dt);
    this.roll += (tx - this.roll) * k;
    this.pitch += (ty - this.pitch) * k;
    return this;
  }

  get calibrated() {
    return !this.calibrating && !!this.baseline;
  }
}

function applyCurve(v) {
  const s = Math.sign(v);
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  const t = Math.min(1, (a - DEADZONE) / (1 - DEADZONE));
  return s * t * t * (3 - 2 * t); // smoothstep
}

function waitForVideo(v) {
  return new Promise((resolve) => {
    if (v.videoWidth) return resolve();
    const check = () => (v.videoWidth ? resolve() : requestAnimationFrame(check));
    check();
  });
}
