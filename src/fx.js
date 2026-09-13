import * as THREE from 'three';
import { makeGlowTexture } from './textures.js';

const GRAV = -14;

/** Particle pool: impact sparks, dust and the ball trail */
export class FX {
  constructor(scene, max = 700) {
    this.max = max;
    this.parts = [];
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) {
      this.positions[i * 3 + 1] = -9999;
      this.parts.push({ life: 0 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.34,
      map: makeGlowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
    this.cursor = 0;

    // expanding rings: pit mouths and respawn pads
    this._flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.7, 1.0, 40);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, size: 1 });
    }
  }

  /** Flat expanding ring, optionally aligned to a surface orientation */
  ring(pos, color, size = 1, life = 0.6, quat = null) {
    let r = this.rings.find((x) => x.life <= 0);
    if (!r) r = this.rings[0];
    r.life = life;
    r.max = life;
    r.size = size;
    r.mesh.position.copy(pos);
    if (quat) r.mesh.quaternion.copy(quat).multiply(this._flat);
    else r.mesh.quaternion.copy(this._flat);
    r.mesh.material.color.copy(color);
    r.mesh.material.opacity = 0.9;
    r.mesh.scale.setScalar(0.35 * size);
    r.mesh.visible = true;
  }

  spawn(x, y, z, vx, vy, vz, color, life, drag = 1.6) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = this.parts[i];
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.drag = drag;
    p.r = color.r;
    p.g = color.g;
    p.b = color.b;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
  }

  burst(pos, color, count = 12, speed = 3.2, life = 0.55) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.spawn(
        pos.x,
        pos.y,
        pos.z,
        Math.cos(a) * Math.cos(e) * s,
        Math.abs(Math.sin(e)) * s * 0.9 + 1.2,
        Math.sin(a) * Math.cos(e) * s,
        color,
        life * (0.6 + Math.random() * 0.8)
      );
    }
  }

  trail(pos, vel, color) {
    this.spawn(
      pos.x + (Math.random() - 0.5) * 0.12,
      pos.y + (Math.random() - 0.5) * 0.12,
      pos.z + (Math.random() - 0.5) * 0.12,
      -vel.x * 0.12,
      0.5 + Math.random() * 0.6,
      -vel.z * 0.12,
      color,
      0.45
    );
  }

  update(dt) {
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      r.mesh.scale.setScalar((0.35 + t * 1.15) * r.size);
      r.mesh.material.opacity = 0.9 * (1 - t) * (1 - t);
      if (r.life <= 0) r.mesh.visible = false;
    }

    let alive = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      alive = true;
      p.life -= dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d + GRAV * dt * 0.35;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = Math.max(0, p.life / p.maxLife);
      const f = t * t;
      this.positions[i * 3] = p.life > 0 ? p.x : 0;
      this.positions[i * 3 + 1] = p.life > 0 ? p.y : -9999;
      this.positions[i * 3 + 2] = p.life > 0 ? p.z : 0;
      this.colors[i * 3] = p.r * f;
      this.colors[i * 3 + 1] = p.g * f;
      this.colors[i * 3 + 2] = p.b * f;
    }
    if (alive) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }
}
