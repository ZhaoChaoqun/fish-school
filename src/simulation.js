export const FIXED_STEP = 1 / 60;
export const MAX_FRAME = 0.1;
export const MAX_STEPS = 6;
export const MAX_FISH = 2000;
export const BOUNDS = Object.freeze({ x: 29, minY: 3.6, maxY: 22, z: 23 });
export const OBSTACLES = Object.freeze([
  { x: -13, y: 0.6, z: 4, radius: 3.3 },
  { x: 12, y: 0.6, z: -5, radius: 3.6 },
  { x: 2, y: 0.1, z: 14, radius: 2.6 },
  { x: -22, y: 0.5, z: -13, radius: 3 },
  { x: 21, y: 0.7, z: 13, radius: 3.4 },
]);

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const CELL = 4.5;
const GX = 18, GY = 9, GZ = 15;
const ORIGIN_X = -40.5, ORIGIN_Y = -4.5, ORIGIN_Z = -31.5;
const MAX_CANDIDATES = 160;
const MAX_NEIGHBORS = 40;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class School {
  constructor(count = 850, seed = 42) {
    this.positions = new Float32Array(MAX_FISH * 3);
    this.velocities = new Float32Array(MAX_FISH * 3);
    this.nextVelocities = new Float32Array(MAX_FISH * 3);
    this.cruise = new Float32Array(MAX_FISH);
    this.scales = new Float32Array(MAX_FISH);
    this.phases = new Float32Array(MAX_FISH);
    this.heads = new Int32Array(GX * GY * GZ);
    this.next = new Int32Array(MAX_FISH);
    this.cohesion = 1;
    this.separation = 1;
    this.obstacles = OBSTACLES;
    this.reset(count, seed);
  }

  reset(count = this.count, seed = this.seed) {
    if (!Number.isInteger(count) || count < 200 || count > MAX_FISH) {
      throw new RangeError("Fish count must be an integer between 200 and 2000.");
    }
    this.count = count;
    this.seed = seed;
    this.time = 0;
    this.steps = 0;
    this.stats = { averageNeighbors: 0, maxCandidates: 0, maxTurn: 0 };
    const random = seededRandom(seed);
    const densityScale = Math.cbrt(count / 850);
    for (let i = 0; i < count; i++) {
      const group = i % 3;
      const angle = random() * Math.PI * 2;
      const vertical = random() * 2 - 1;
      const radius = Math.cbrt(random());
      const horizontal = Math.sqrt(1 - vertical * vertical) * radius;
      const k = i * 3;
      this.positions[k] = (group - 1) * 7 + Math.cos(angle) * horizontal * 7 * densityScale;
      this.positions[k + 1] = 11 + vertical * radius * 4.4 * densityScale + group * 0.65;
      this.positions[k + 2] = (group - 1) * -3 + Math.sin(angle) * horizontal * 5.7 * densityScale;
      this.cruise[i] = 2.6 + random() * 1.15;
      this.scales[i] = 0.68 + random() * 0.45;
      this.phases[i] = random() * Math.PI * 2;
      const heading = 0.2 + group * 0.45 + (random() - 0.5) * 0.7;
      this.velocities[k] = Math.cos(heading) * this.cruise[i];
      this.velocities[k + 1] = (random() - 0.5) * 0.3;
      this.velocities[k + 2] = Math.sin(heading) * this.cruise[i];
    }
  }

  cell(x, y, z) {
    const cx = clamp(Math.floor((x - ORIGIN_X) / CELL), 0, GX - 1);
    const cy = clamp(Math.floor((y - ORIGIN_Y) / CELL), 0, GY - 1);
    const cz = clamp(Math.floor((z - ORIGIN_Z) / CELL), 0, GZ - 1);
    return cx + GX * (cy + GY * cz);
  }

  buildGrid() {
    this.heads.fill(-1);
    // Rotate insertion order so the bounded neighbor budget does not favor fixed fish IDs.
    const start = this.steps % this.count;
    for (let n = 0; n < this.count; n++) {
      const i = (start + n) % this.count;
      const k = i * 3;
      const cell = this.cell(this.positions[k], this.positions[k + 1], this.positions[k + 2]);
      this.next[i] = this.heads[cell];
      this.heads[cell] = i;
    }
  }

  step(dt = FIXED_STEP) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > FIXED_STEP + 1e-9) {
      throw new RangeError("Integrate using a positive fixed step of at most 1/60 second.");
    }
    this.buildGrid();
    const p = this.positions, v = this.velocities, nextV = this.nextVelocities;
    let totalNeighbors = 0, maxCandidates = 0, maxTurn = 0;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      const x = p[k], y = p[k + 1], z = p[k + 2];
      const vx = v[k], vy = v[k + 1], vz = v[k + 2];
      const speed = Math.hypot(vx, vy, vz);
      const ux = vx / speed, uy = vy / speed, uz = vz / speed;
      const cx = clamp(Math.floor((x - ORIGIN_X) / CELL), 0, GX - 1);
      const cy = clamp(Math.floor((y - ORIGIN_Y) / CELL), 0, GY - 1);
      const cz = clamp(Math.floor((z - ORIGIN_Z) / CELL), 0, GZ - 1);
      let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, px = 0, py = 0, pz = 0;
      let neighbors = 0, candidates = 0;
      const personalSpace = 1.6 * this.scales[i] * this.separation;
      // Look in the current cell first, then rotate the surrounding-cell search order.
      for (let n = 0; n < 27 && candidates < MAX_CANDIDATES && neighbors < MAX_NEIGHBORS; n++) {
        const offset = n === 0 ? 13 : ((n + this.steps + i) % 26);
        const code = n === 0 ? 13 : (offset >= 13 ? offset + 1 : offset);
        const nx = cx + code % 3 - 1;
        const ny = cy + Math.floor(code / 3) % 3 - 1;
        const nz = cz + Math.floor(code / 9) - 1;
        if (nx < 0 || nx >= GX || ny < 0 || ny >= GY || nz < 0 || nz >= GZ) continue;
        let j = this.heads[nx + GX * (ny + GY * nz)];
        while (j !== -1 && candidates < MAX_CANDIDATES && neighbors < MAX_NEIGHBORS) {
          const q = j * 3;
          if (i !== j) {
            candidates++;
            const dx = x - p[q], dy = y - p[q + 1], dz = z - p[q + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < CELL * CELL) {
              const distance = Math.sqrt(d2);
              if (distance < personalSpace) {
                if (distance > 1e-5) {
                  const strength = (1 - distance / personalSpace) / distance;
                  sx += dx * strength;
                  sy += dy * strength;
                  sz += dz * strength;
                } else {
                  // Deterministic antisymmetric escape direction for coincident positions.
                  sx += i > j ? 1 : -1;
                  sy += i > j ? 0.37 : -0.37;
                  sz += i > j ? -0.53 : 0.53;
                }
              }
              if (dx * ux + dy * uy + dz * uz < distance * 0.75) {
                ax += v[q]; ay += v[q + 1]; az += v[q + 2];
                px += p[q]; py += p[q + 1]; pz += p[q + 2];
                neighbors++;
              }
            }
          }
          j = this.next[j];
        }
      }
      let fx = sx * 3.3, fy = sy * 3.3, fz = sz * 3.3;
      if (neighbors) {
        const inv = 1 / neighbors;
        fx += (ax * inv - vx) * 0.7 + (px * inv - x) * 0.115 * this.cohesion;
        fy += (ay * inv - vy) * 0.7 + (py * inv - y) * 0.115 * this.cohesion;
        fz += (az * inv - vz) * 0.7 + (pz * inv - z) * 0.115 * this.cohesion;
      }
      const futureX = x + vx * 2, futureY = y + vy * 2, futureZ = z + vz * 2;
      const innerX = BOUNDS.x - 7, innerZ = BOUNDS.z - 5;
      const edgeDistance = Math.hypot(futureX / innerX, futureZ / innerZ);
      const wallHorizontal = Math.max(0, (edgeDistance - 1) * Math.min(innerX, innerZ));
      const wallY = Math.max(0, BOUNDS.minY + 4 - futureY, futureY - BOUNDS.maxY + 4);
      const wallBlend = clamp(Math.max(wallHorizontal, wallY) / 3, 0, 1);
      // A gentle circulating current is spatially coherent, not independent per-fish jitter.
      fx += Math.cos(z * 0.075 + this.time * 0.09) * 0.13 - z * 0.008;
      fz += Math.sin(x * 0.08 + this.time * 0.08) * 0.13 + x * 0.008;
      fy += Math.sin(x * 0.12 + z * 0.09 + this.time * 0.22) * 0.1;
      for (const rock of this.obstacles) {
        const rx = x - rock.x, ry = y - rock.y, rz = z - rock.z;
        const along = rx * ux + ry * uy + rz * uz;
        const ahead = clamp(-along, 0, speed * 3.5);
        let dx = rx + ux * ahead, dy = ry + uy * ahead, dz = rz + uz * ahead;
        let distance = Math.hypot(dx, dy, dz);
        const clearance = rock.radius + 1.8;
        if (distance < clearance) {
          // Steer perpendicular to an impending collision, not backward into a head-on stall.
          if (distance < 0.15) {
            dx = -ux * uy; dy = 1 - uy * uy; dz = -uz * uy;
            if (Math.hypot(dx, dy, dz) < 0.01) { dx = 1; dy = 0; dz = 0; }
            distance = Math.hypot(dx, dy, dz);
          }
          const force = (clearance - Math.min(distance, clearance)) * 4 / Math.max(distance, 0.01);
          fx += dx * force; fy += (dy + 0.5) * force; fz += dz * force;
        }
      }
      if (wallBlend > 0) {
        // Safety blends last so obstacle lookahead cannot steer underneath the seabed.
        // Rounded edges turn with the local heading, not a common circulation direction.
        const horizontalBlend = clamp(wallHorizontal / 3, 0, 1);
        const verticalBlend = clamp(wallY / 2, 0, 1);
        fx *= 1 - wallBlend;
        fz *= 1 - wallBlend;
        if (horizontalBlend > 0) {
          const nx = futureX / (innerX * innerX), nz = futureZ / (innerZ * innerZ);
          const normalLength = Math.hypot(nx, nz);
          const normalX = nx / normalLength, normalZ = nz / normalLength;
          const outward = Math.max(0, ux * normalX + uz * normalZ);
          const tangent = -ux * normalZ + uz * normalX;
          const turn = Math.abs(tangent) > 0.05 ? Math.sign(tangent) : (Math.sin(x * 0.15 + z * 0.11) >= 0 ? 1 : -1);
          const inward = 1.4 + outward * 1.2;
          fx += (-normalX * inward - normalZ * turn * outward * 2.8) * horizontalBlend;
          fz += (-normalZ * inward + normalX * turn * outward * 2.8) * horizontalBlend;
        }
        const middleY = (BOUNDS.minY + BOUNDS.maxY) * 0.5;
        const verticalForce = clamp((middleY - futureY) * 0.9 - vy, -2.4, 2.4);
        fy = fy * (1 - wallBlend) + verticalForce * verticalBlend;
        if (verticalBlend > 0) {
          const horizontalSpeed = Math.hypot(ux, uz);
          const turnX = horizontalSpeed > 0.05 ? ux / horizontalSpeed : Math.cos(this.phases[i]);
          const turnZ = horizontalSpeed > 0.05 ? uz / horizontalSpeed : Math.sin(this.phases[i]);
          const verticalOutward = Math.max(0, uy * Math.sign(futureY - middleY));
          fx += turnX * verticalOutward * 2.4 * verticalBlend;
          fz += turnZ * verticalOutward * 2.4 * verticalBlend;
        }
      }
      const acceleration = Math.hypot(fx, fy, fz);
      const forceScale = Math.min(1, 2.4 / Math.max(acceleration, 1e-9));
      let tx = vx + fx * forceScale * dt, ty = vy + fy * forceScale * dt, tz = vz + fz * forceScale * dt;
      const targetLength = Math.hypot(tx, ty, tz);
      tx /= targetLength; ty /= targetLength; tz /= targetLength;
      const angle = Math.acos(clamp(ux * tx + uy * ty + uz * tz, -1, 1));
      const turnLimit = (0.85 + (this.cruise[i] - 2.6) * 0.18) * dt;
      if (angle > turnLimit) {
        const ratio = turnLimit / angle;
        const divisor = Math.sin(angle);
        const a = Math.sin((1 - ratio) * angle) / divisor;
        const b = Math.sin(ratio * angle) / divisor;
        tx = ux * a + tx * b; ty = uy * a + ty * b; tz = uz * a + tz * b;
      }
      const nextSpeed = clamp(
        speed + ((targetLength - speed) * 0.7 + (this.cruise[i] - speed) * 0.6) * dt,
        this.cruise[i] * 0.7, this.cruise[i] * 1.2,
      );
      nextV[k] = tx * nextSpeed; nextV[k + 1] = ty * nextSpeed; nextV[k + 2] = tz * nextSpeed;
      totalNeighbors += neighbors;
      maxCandidates = Math.max(maxCandidates, candidates);
      maxTurn = Math.max(maxTurn, Math.min(angle, turnLimit));
    }
    for (let i = 0; i < this.count * 3; i++) {
      v[i] = nextV[i];
      p[i] += v[i] * dt;
    }
    this.time += dt;
    this.steps++;
    this.stats = { averageNeighbors: totalNeighbors / this.count, maxCandidates, maxTurn };
  }
}

export class FixedClock {
  constructor() {
    this.accumulator = 0;
    this.droppedTime = 0;
  }
  reset() { this.accumulator = 0; }
  advance(delta, school) {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError("Frame delta must be finite and nonnegative.");
    const admitted = Math.min(delta, MAX_FRAME);
    this.droppedTime += delta - admitted;
    this.accumulator += admitted;
    let steps = 0;
    while (this.accumulator + 1e-10 >= FIXED_STEP && steps < MAX_STEPS) {
      school.step();
      this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
      steps++;
    }
    return steps;
  }
}
