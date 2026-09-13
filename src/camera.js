import * as THREE from 'three';

/** Overhead 3D camera: auto-frames the board and gently follows the ball */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.elevation = THREE.MathUtils.degToRad(52);
    this.dist = 30;
    this.look = new THREE.Vector3(0, 0, 0);
    this.targetLook = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.shake = 0;
  }

  /** Pick a distance that keeps the whole board in frame */
  fit(board) {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect || 1;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const halfW = board.width / 2 + 1.2;
    const halfD = board.depth / 2 + 1.2;
    // vertical: on-screen projection of the board depth
    const projD = halfD * Math.sin(this.elevation) + 3.2;
    const dV = projD / Math.tan(vfov / 2);
    const dH = halfW / Math.tan(hfov / 2);
    this.dist = Math.max(dV, dH) * 1.06;
    this.boardY = 0;
  }

  snap() {
    this.look.copy(this.targetLook);
    this.pos.copy(this.targetPos);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(dt, ballWorldPos, emphasis = 0.28) {
    // look between the board centre and the ball
    this.targetLook.set(ballWorldPos.x * emphasis, 0.4, ballWorldPos.z * emphasis);
    const k = 1 - Math.exp(-6 * dt);
    this.look.lerp(this.targetLook, k);

    const ce = Math.cos(this.elevation);
    const se = Math.sin(this.elevation);
    this.targetPos.set(this.look.x * 0.35, this.look.y + this.dist * se, this.look.z + this.dist * ce);
    const kp = 1 - Math.exp(-9 * dt);
    this.pos.lerp(this.targetPos, kp);

    this.shake = Math.max(0, this.shake - dt * 2.4);
    const s = this.shake * this.shake * 0.35;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * s,
      this.pos.y + (Math.random() - 0.5) * s,
      this.pos.z + (Math.random() - 0.5) * s
    );
    this.camera.lookAt(this.look);
  }

  kick(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }
}
