import * as THREE from 'three';

/** World gravity (units/s²) */
export const GRAVITY = -30;
/** Horizontal speed cap */
export const MAX_SPEED = 22;
/** Hard caps so a fast tilting board can never rocket the ball away.
 *  Max hop height = MAX_UP_SPEED^2 / (2*|GRAVITY|) ≈ 0.34 units: not even the
 *  small interior walls (0.62) can be cleared, let alone the rim fence. */
export const MAX_UP_SPEED = 4.5;
export const MAX_DOWN_SPEED = 26;
/** How much of a moving surface's velocity the ball inherits. Full inheritance
 *  turns a fast-tilting board into a trampoline that flings the ball off. */
const PLATFORM_CARRY = 0.45;
/** Largest position correction applied per resolution pass */
const MAX_CORRECTION = 0.25;

const _local = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _prevLocal = new THREE.Vector3();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Collider: a box (arbitrarily rotated) or a sphere.
 * The tilting board is made of many boxes rotating together around the board
 * centre, so besides its own centre each collider also carries a pivot (the
 * rotation origin) used to compute the contact-point velocity.
 */
export class Collider {
  constructor(opts = {}) {
    this.shape = opts.shape || 'box';
    this.center = new THREE.Vector3().fromArray(opts.pos || [0, 0, 0]);
    this.half = new THREE.Vector3().fromArray(opts.half || [1, 1, 1]);
    this.radius = opts.radius ?? 1;
    const r = opts.rot || [0, 0, 0];
    this.quat = opts.quat
      ? opts.quat.clone()
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ'));
    this.invQuat = this.quat.clone().invert();
    /** Rotation / motion pivot, defaults to center */
    this.pivot = new THREE.Vector3().copy(this.center);
    /** Friction decay rate (1/s); higher = stickier */
    this.friction = opts.friction ?? (opts.kinematic ? 7 : 1.4);
    /** Restitution (walls give a little bounce) */
    this.restitution = opts.restitution ?? 0.05;
    this.kinematic = !!opts.kinematic;
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.tag = opts.tag || 'track';
    this.mesh = null;
    /** Bounding-sphere radius used by the broad phase */
    this.bound = this.shape === 'sphere' ? this.radius : this.half.length();
  }

  setRotation(quat) {
    this.quat.copy(quat);
    this.invQuat.copy(quat).invert();
  }

  setPosition(x, y, z) {
    this.center.set(x, y, z);
  }

  setPivot(x, y, z) {
    this.pivot.set(x, y, z);
  }

  /** Velocity of a point on the collider (for relative velocity) */
  velocityAt(point, out) {
    out.copy(this.velocity);
    if (this.angularVelocity.lengthSq() > 1e-9) {
      _tmp.copy(point).sub(this.pivot);
      out.add(_axis.crossVectors(this.angularVelocity, _tmp));
    }
    return out;
  }
}

/** Sphere rigid body */
export class SphereBody {
  constructor(radius = 0.42) {
    this.radius = radius;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.ground = null;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    /** Visual spin (angular velocity) */
    this.spin = new THREE.Vector3();
    this.wasGrounded = false;
    /** Largest impact speed this frame (audio / particles) */
    this.impact = 0;
  }

  teleport(pos, vel) {
    this.pos.copy(pos);
    if (vel) this.vel.copy(vel);
    else this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.onGround = false;
    this.ground = null;
    this.wasGrounded = false;
    this.impact = 0;
  }

  get speed() {
    return this.vel.length();
  }
}

/** Resolve the ball against one collider: position correction + velocity response */
function resolve(body, col, dt) {
  const r = body.radius;
  let pen;

  if (col.shape === 'sphere') {
    _delta.copy(body.pos).sub(col.center);
    const dist = _delta.length();
    const minD = r + col.radius;
    if (dist >= minD) return;
    if (dist < 1e-6) _normal.set(0, 1, 0);
    else _normal.copy(_delta).divideScalar(dist);
    pen = minD - dist;
  } else {
    _local.copy(body.pos).sub(col.center).applyQuaternion(col.invQuat);
    const h = col.half;
    _closest.set(clamp(_local.x, -h.x, h.x), clamp(_local.y, -h.y, h.y), clamp(_local.z, -h.z, h.z));
    _delta.copy(_local).sub(_closest);
    const d2 = _delta.lengthSq();

    if (d2 > 1e-10) {
      const dist = Math.sqrt(d2);
      if (dist >= r) return;
      _normal.copy(_delta).divideScalar(dist);
      pen = r - dist;
    } else {
      // Centre is inside the box: pick the face the ball actually crossed, using
      // last frame's position. Blindly choosing the shortest axis would push the
      // ball UP out of a thin wall and launch it over the board rim.
      _prevLocal.copy(_prev).sub(col.center).applyQuaternion(col.invQuat);
      const exits = [
        { pen: h.x - Math.abs(_local.x), axis: 0, sign: _local.x >= 0 ? 1 : -1, wasOutside: Math.abs(_prevLocal.x) > h.x },
        { pen: h.y - Math.abs(_local.y), axis: 1, sign: _local.y >= 0 ? 1 : -1, wasOutside: Math.abs(_prevLocal.y) > h.y },
        { pen: h.z - Math.abs(_local.z), axis: 2, sign: _local.z >= 0 ? 1 : -1, wasOutside: Math.abs(_prevLocal.z) > h.z },
      ];
      const crossed = exits.filter((e) => e.wasOutside);
      const pool = crossed.length ? crossed : exits;
      let pick = pool[0];
      let best = Infinity;
      for (const e of pool) {
        // vertical exits are penalised so we prefer sliding the ball back sideways
        const cost = e.axis === 1 ? e.pen * 2.5 : e.pen;
        if (cost < best) {
          best = cost;
          pick = e;
        }
      }
      _normal.set(0, 0, 0).setComponent(pick.axis, pick.sign);
      pen = r + pick.pen;
    }
    _normal.applyQuaternion(col.quat);
  }

  // position correction (clamped so deep overlaps never explode)
  body.pos.addScaledVector(_normal, Math.min(pen, MAX_CORRECTION) * 0.995);

  // approximate contact point
  _contact.copy(body.pos).addScaledVector(_normal, -r);
  const pv = col.velocityAt(_contact, _pv);
  if (pv.lengthSq() > 1e-9) pv.multiplyScalar(PLATFORM_CARRY);

  _rel.copy(body.vel).sub(pv);
  const vn = _rel.dot(_normal);
  if (vn < 0) {
    const impactSpeed = -vn;
    const e = impactSpeed > 1.6 ? col.restitution : 0;
    _rel.addScaledVector(_normal, -(1 + e) * vn);

    // tangential friction: exponential decay keeps the feel timestep independent
    const vnAfter = _rel.dot(_normal);
    _tan.copy(_rel).addScaledVector(_normal, -vnAfter);
    const f = 1 - Math.exp(-col.friction * dt);
    _rel.addScaledVector(_tan, -f);

    if (impactSpeed > body.impact) body.impact = impactSpeed;
  }
  body.vel.copy(_rel).add(pv);

  if (_normal.y > 0.55) {
    body.onGround = true;
    body.ground = col;
    body.groundNormal.copy(_normal);
  }
}

/**
 * Advance one fixed physics substep.
 */
export function stepWorld(body, colliders, dt) {
  body.onGround = false;
  body.ground = null;
  body.impact = 0;

  _prev.copy(body.pos);

  body.vel.y += GRAVITY * dt;

  const hs = Math.hypot(body.vel.x, body.vel.z);
  if (hs > MAX_SPEED) {
    const s = MAX_SPEED / hs;
    body.vel.x *= s;
    body.vel.z *= s;
  }

  body.pos.addScaledVector(body.vel, dt);

  const reach = body.radius + 1e-3;
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < colliders.length; i++) {
      const col = colliders[i];
      // broad phase: skip when the bounding spheres do not overlap
      const dx = body.pos.x - col.center.x;
      const dy = body.pos.y - col.center.y;
      const dz = body.pos.z - col.center.z;
      const rr = col.bound + reach;
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      resolve(body, col, dt);
    }
  }

  // Safety clamp: a fast tilting board must never fling the ball off the maze.
  const sp = body.vel.length();
  if (sp > MAX_SPEED) body.vel.multiplyScalar(MAX_SPEED / sp);
  if (body.vel.y > MAX_UP_SPEED) body.vel.y = MAX_UP_SPEED;
  else if (body.vel.y < -MAX_DOWN_SPEED) body.vel.y = -MAX_DOWN_SPEED;
}

/** Update the visual spin from velocity (rolling look) */
export function updateSpin(body, dt) {
  const v = body.vel;
  const r = body.radius;
  if (body.onGround) {
    // ω = (n × v) / r
    body.spin.crossVectors(body.groundNormal, v).divideScalar(r);
  } else {
    // Airborne: angular momentum is conserved, so the ball keeps tumbling.
    // Decaying the spin here is what made a fall read as "sliding", not dropping.
    body.spin.multiplyScalar(Math.exp(-0.1 * dt));
    if (body.spin.lengthSq() < 0.35) {
      const hx = v.z / r;
      const hz = -v.x / r;
      if (hx * hx + hz * hz > 1e-4) body.spin.set(hx, 0, hz);
      else if (v.y < -1) body.spin.set(0, 2.2, 0); // straight drop: tumble anyway
    }
  }
}
