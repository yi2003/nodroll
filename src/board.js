import * as THREE from 'three';
import { Collider } from './physics.js';
import { CELL, FLOOR_T, FLOOR, WALL, HOLE } from './levels.js';
import { makeTrackTexture, makeTextSprite } from './textures.js';

const MAX_TILT = 0.30; // ≈17°
const MAX_TILT_RATE = 0.8; // rad/s (≈46°/s); the board edge still moves fast, so the
                           // physics also caps how much velocity the ball inherits

/**
 * Tiltable maze board: grid floor + wall blocks + holes + the green goal door.
 * Physics colliders mirror the instanced meshes and follow the board pose.
 */
export class Board {
  constructor(scene, level, glowTex) {
    this.level = level;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.colliders = [];
    this.quat = new THREE.Quaternion();
    this.invQuat = new THREE.Quaternion();
    this.prevQuat = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.tiltX = 0;
    this.tiltZ = 0;
    this.maxTilt = MAX_TILT;
    this.glowTex = glowTex;
    this._dq = new THREE.Quaternion();

    this.build();
    this.sync();
  }

  // ---------------------------------------------------------------- build
  build() {
    const { cols, rows, grid, door } = this.level;
    const cell = CELL;
    const wallH = this.level.cfg.wallH;
    // the outer ring is a tall fence, so a popped-up ball can never leave the maze
    const rimH = Math.max(wallH * 2.9, 1.7);
    this.wallH = wallH;
    this.rimH = rimH;
    const scaleM = new THREE.Matrix4();

    this.width = cols * cell;
    this.depth = rows * cell;
    this.halfW = this.width / 2;
    this.halfD = this.depth / 2;
    this.radius = Math.hypot(this.width, this.depth) * 0.5;

    const floorTex = makeTrackTexture();
    floorTex.repeat.set(cols / 3, rows / 3);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x8a3cff,
      map: floorTex,
      roughness: 0.66,
      metalness: 0.04,
      emissive: 0x2b0a63,
      emissiveIntensity: 0.85,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x6a25d8,
      map: floorTex,
      roughness: 0.7,
      metalness: 0.05,
      emissive: 0x1d0550,
      emissiveIntensity: 0.9,
    });

    // count instances
    let floorCount = 0;
    let wallCount = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === WALL) {
        floorCount++;
        wallCount++;
      } else if (grid[i] === FLOOR || grid[i] === HOLE) {
        if (grid[i] === FLOOR) floorCount++;
      }
    }

    const floorGeo = new THREE.BoxGeometry(cell, FLOOR_T, cell);
    const wallGeo = new THREE.BoxGeometry(cell, wallH, cell);
    const floors = new THREE.InstancedMesh(floorGeo, floorMat, floorCount);
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
    floors.receiveShadow = true;
    walls.castShadow = true;
    walls.receiveShadow = true;

    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    let fi = 0;
    let wi = 0;

    this.cellPos = (col, row) =>
      new THREE.Vector2((col - (cols - 1) / 2) * cell, ((rows - 1) / 2 - row) * cell);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const v = grid[row * cols + col];
        if (v === HOLE) continue;
        const p = this.cellPos(col, row);

        // floor tile
        m.makeTranslation(p.x, -FLOOR_T / 2, p.y);
        floors.setMatrixAt(fi, m);
        color.setHSL(0.755 + (Math.sin(col * 3.1 + row * 1.7) * 0.5 + 0.5) * 0.02, 0.82, 0.56 + ((col + row) % 3) * 0.012);
        floors.setColorAt(fi, color);
        fi++;

        const col0 = new Collider({
          pos: [p.x, -FLOOR_T / 2, p.y],
          half: [cell / 2, FLOOR_T / 2, cell / 2],
          friction: 1.4,
          restitution: 0.05,
          tag: 'floor',
        });
        col0.local = new THREE.Vector3(p.x, -FLOOR_T / 2, p.y);
        this.colliders.push(col0);

        // wall block (taller on the outer ring: it doubles as a fence)
        if (v === WALL) {
          const isRim = col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
          const wh = isRim ? rimH : wallH;
          m.makeTranslation(p.x, wh / 2, p.y);
          if (isRim) m.multiply(scaleM.makeScale(1, rimH / wallH, 1));
          walls.setMatrixAt(wi, m);
          color.setHSL(0.765, isRim ? 0.6 : 0.78, (isRim ? 0.38 : 0.44) + ((col * 2 + row) % 3) * 0.02);
          walls.setColorAt(wi, color);
          wi++;
          const cw = new Collider({
            pos: [p.x, wh / 2, p.y],
            half: [cell / 2, wh / 2, cell / 2],
            friction: 0.8,
            restitution: isRim ? 0.25 : 0.42,
            tag: isRim ? 'rim' : 'wall',
          });
          cw.local = new THREE.Vector3(p.x, wh / 2, p.y);
          this.colliders.push(cw);
        }
      }
    }
    floors.instanceMatrix.needsUpdate = true;
    walls.instanceMatrix.needsUpdate = true;
    if (floors.instanceColor) floors.instanceColor.needsUpdate = true;
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
    this.group.add(floors, walls);

    // holes: black pit + violet rim
    const holeRims = new THREE.Group();
    for (const h of this.level.holeCells) {
      const p = this.cellPos(h.col, h.row);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(cell * 0.52, 0.055, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xb46bff, toneMapped: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.012, p.y);
      const pit = new THREE.Mesh(
        new THREE.CircleGeometry(cell * 0.5, 24),
        new THREE.MeshBasicMaterial({ color: 0x05030a, toneMapped: false })
      );
      pit.rotation.x = -Math.PI / 2;
      pit.position.set(p.x, -FLOOR_T - 0.4, p.y);
      holeRims.add(ring, pit);
    }
    this.group.add(holeRims);

    // start marker
    const sp = this.cellPos(this.level.start.col, this.level.start.row);
    this.startLocal = new THREE.Vector3(sp.x, 0, sp.y);
    const startRing = new THREE.Mesh(
      new THREE.RingGeometry(cell * 0.22, cell * 0.34, 28),
      new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.75, toneMapped: false, side: THREE.DoubleSide })
    );
    startRing.rotation.x = -Math.PI / 2;
    startRing.position.set(sp.x, 0.014, sp.y);
    this.group.add(startRing);

    // goal door
    this.buildDoor(door);

    // tutorial labels
    this.buildHints();
  }

  buildHints() {
    const hints = this.level.cfg.hints || [];
    for (const hint of hints) {
      const p = this.cellPos(hint.col, hint.row);
      const spr = makeTextSprite(hint.text);
      const hgt = hint.size || 0.62;
      spr.scale.set(hgt * spr.userData.aspect, hgt, 1);
      spr.position.set(p.x, hint.y ?? 1.9, p.y);
      this.group.add(spr);
    }
  }

  buildDoor(door) {
    const p = this.cellPos(door.col, door.row);
    const cell = CELL;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.y);

    const green = new THREE.MeshStandardMaterial({
      color: 0x38ff9c,
      emissive: 0x1cff88,
      emissiveIntensity: 1.5,
      roughness: 0.35,
      toneMapped: true,
    });
    const postW = 0.14;
    const openW = cell * 0.62;
    const h = cell * 0.98;
    const post = new THREE.BoxGeometry(postW, h, postW);
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(post, green);
      b.position.set((s * openW) / 2, h / 2, 0);
      g.add(b);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(openW + postW, postW, postW), green);
    lintel.position.set(0, h, 0);
    g.add(lintel);

    // glowing veil inside the door
    const veil = new THREE.Mesh(
      new THREE.PlaneGeometry(openW, h),
      new THREE.MeshBasicMaterial({
        color: 0x2bffa0,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    veil.position.set(0, h / 2, 0);
    g.add(veil);

    // floor glow pad
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(cell * 0.45, 28),
      new THREE.MeshBasicMaterial({
        color: 0x2bffa0,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        toneMapped: false,
      })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.015;
    g.add(pad);

    const light = new THREE.PointLight(0x39ffa5, 6, 7, 2);
    light.position.set(0, h * 0.6, 0);
    g.add(light);

    // face the door towards the start so it is visible along the way
    const s = this.cellPos(this.level.start.col, this.level.start.row);
    const yaw = Math.atan2(s.x - p.x, s.y - p.y);
    g.rotation.y = yaw;
    this.doorGroup = g;
    this.doorYaw = yaw;
    this.group.add(g);
  }

  // ---------------------------------------------------------------- pose
  /**
   * @param {number} tx target pitch (about X; positive sinks the near edge)
   * @param {number} tz target roll (about Z; positive lifts +X)
   */
  update(dt, tx, tz, rate = 11) {
    // exponential smoothing, but rate-limited: a real player tilts the board
    // slowly, and without this the board edge velocity (omega x r) would fling
    // the ball across (or off) the maze.
    const k = 1 - Math.exp(-rate * dt);
    const maxStep = MAX_TILT_RATE * dt;
    const dx = (tx - this.tiltX) * k;
    const dz = (tz - this.tiltZ) * k;
    this.tiltX += THREE.MathUtils.clamp(dx, -maxStep, maxStep);
    this.tiltZ += THREE.MathUtils.clamp(dz, -maxStep, maxStep);

    this.prevQuat.copy(this.quat);
    this.euler.set(this.tiltX, 0, this.tiltZ, 'YXZ');
    this.quat.setFromEuler(this.euler);
    this.invQuat.copy(this.quat).invert();
    this.group.quaternion.copy(this.quat);

    // world-space angular velocity
    const dq = this._dq.copy(this.quat).multiply(this.prevQuat.clone().invert());
    let w = dq.w;
    let { x, y, z } = dq;
    if (w < 0) {
      w = -w;
      x = -x;
      y = -y;
      z = -z;
    }
    const s = Math.sqrt(Math.max(0, 1 - w * w));
    if (s > 1e-6 && dt > 1e-6) {
      const angle = 2 * Math.acos(Math.min(1, w));
      this.angularVelocity.set((x / s) * (angle / dt), (y / s) * (angle / dt), (z / s) * (angle / dt));
    } else {
      this.angularVelocity.set(0, 0, 0);
    }
    this.sync();
  }

  /** Push the current board pose into every collider */
  sync() {
    const q = this.quat;
    const w = this.angularVelocity;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      c.center.copy(c.local).applyQuaternion(q);
      c.setRotation(q);
      c.pivot.set(0, 0, 0);
      c.angularVelocity.copy(w);
      c.velocity.set(0, 0, 0);
    }
  }

  /** World position -> board-local position */
  toLocal(world, out) {
    return out.copy(world).applyQuaternion(this.invQuat);
  }

  /** Board-local position -> world position */
  toWorld(local, out) {
    return out.copy(local).applyQuaternion(this.quat);
  }

  /** World position of a grid cell centre */
  cellWorld(col, row, y = 0) {
    const p = this.cellPos(col, row);
    return new THREE.Vector3(p.x, y, p.y).applyQuaternion(this.quat);
  }

  /** Nearest pit to a board-local position (used for fall FX placement) */
  nearestHole(localPos) {
    let best = null;
    let bestD = Infinity;
    for (const h of this.level.holeCells) {
      const p = this.cellPos(h.col, h.row);
      const d = (p.x - localPos.x) * (p.x - localPos.x) + (p.y - localPos.z) * (p.y - localPos.z);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return bestD < 9 ? best : null;
  }

  /** Is the ball inside the goal door cell? */
  atDoor(localPos) {
    const p = this.cellPos(this.level.door.col, this.level.door.row);
    return (
      localPos.y < 1.2 &&
      Math.abs(localPos.x - p.x) < CELL * 0.45 &&
      Math.abs(localPos.z - p.y) < CELL * 0.45
    );
  }
}
