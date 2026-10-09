import test from "node:test";
import assert from "node:assert/strict";
import { School, FixedClock, FIXED_STEP, BOUNDS, OBSTACLES } from "../src/simulation.js";

function inspect(school) {
  let minY = Infinity, maxY = -Infinity, maxX = 0, maxZ = 0, minClearance = Infinity;
  for (let i = 0; i < school.count; i++) {
    const k = i * 3;
    const [x, y, z] = school.positions.subarray(k, k + 3);
    const speed = Math.hypot(...school.velocities.subarray(k, k + 3));
    assert.ok([x, y, z, speed].every(Number.isFinite), `Nonfinite state at fish ${i}`);
    assert.ok(speed >= school.cruise[i] * 0.7 - 1e-5 && speed <= school.cruise[i] * 1.2 + 1e-5, "Speed outside clamp");
    maxX = Math.max(maxX, Math.abs(x)); maxZ = Math.max(maxZ, Math.abs(z));
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    for (const obstacle of OBSTACLES) {
      minClearance = Math.min(minClearance, Math.hypot(x - obstacle.x, y - obstacle.y, z - obstacle.z) - obstacle.radius);
    }
  }
  assert.ok(maxX < BOUNDS.x + 2, `x drift ${maxX}`);
  assert.ok(maxZ < BOUNDS.z + 2, `z drift ${maxZ}`);
  assert.ok(minY > BOUNDS.minY - 1.5 && maxY < BOUNDS.maxY + 1.5, `y drift ${minY}, ${maxY}`);
  assert.ok(minClearance > 0.15, `Obstacle penetration ${minClearance}`);
  return { minY, maxY, maxX, maxZ, minClearance };
}

test("deterministic seeds and reset preserve appearance and initial state", () => {
  const a = new School(850, 42), b = new School(850, 42);
  for (let i = 0; i < 120; i++) { a.step(); b.step(); }
  assert.deepEqual(a.positions, b.positions);
  a.reset(850, 42);
  assert.deepEqual(a.positions, new School(850, 42).positions);
  assert.equal(a.time, 0);
  assert.equal(a.steps, 0);
});

for (const [count, cohesion, separation] of [[200, 0.45, 1.6], [850, 1, 1], [2000, 1.55, 0.65]]) {
  test(`${count} fish stay finite, bounded and collision-free for 1200 fixed steps`, () => {
    const school = new School(count, 72);
    school.cohesion = cohesion;
    school.separation = separation;
    let neighborSum = 0, turnMax = 0;
    let previous = school.velocities.slice();
    for (let step = 0; step < 1200; step++) {
      school.step();
      assert.ok(school.stats.maxCandidates <= 160);
      assert.ok(school.stats.averageNeighbors <= 40);
      neighborSum += school.stats.averageNeighbors;
      turnMax = Math.max(turnMax, school.stats.maxTurn);
      if (step % 60 === 0) inspect(school);
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        const a = previous.subarray(k, k + 3), b = school.velocities.subarray(k, k + 3);
        const cosine = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
        const turn = Math.acos(Math.max(-1, Math.min(1, cosine)));
        assert.ok(turn <= (0.85 + (school.cruise[i] - 2.6) * 0.18) * FIXED_STEP + 1e-5, `Instant turn ${turn}`);
      }
      previous.set(school.velocities);
    }
    assert.ok(neighborSum / 1200 > 2, "No local schooling");
    assert.ok(turnMax > 0.005, "School never turns");
    console.log(JSON.stringify({ count, averageNeighbors: neighborSum / 1200, maxTurnDegrees: turnMax * 180 / Math.PI, ...inspect(school) }));
  });
}

test("coincident fish separate without NaNs or excessive speed", () => {
  const school = new School(200, 7);
  school.positions.fill(0);
  for (let i = 0; i < school.count; i++) school.positions[i * 3 + 1] = 12;
  for (let i = 0; i < 600; i++) school.step();
  inspect(school);
  assert.ok(Math.max(...school.positions) > 13);
});

test("the school remains bounded over two simulated minutes, with independent motion", () => {
  const school = new School(850, 42);
  for (let step = 0; step < 7200; step++) {
    school.step();
    if (step % 120 === 0) inspect(school);
  }
  inspect(school);
  const a = school.velocities.subarray(0, 3);
  let independent = 0;
  for (let i = 1; i < school.count; i++) {
    const b = school.velocities.subarray(i * 3, i * 3 + 3);
    const similarity = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
    if (similarity < 0.9) independent++;
  }
  assert.ok(independent > school.count * 0.15, `School became a rigid mass: only ${independent} varied headings`);
  console.log(JSON.stringify({ longRunSteps: school.steps, independentHeadings: independent, ...inspect(school) }));
});

test("obstacle lookahead turns an approaching school away from a rock", () => {
  const school = new School(200, 21);
  const obstacle = { x: 0, y: 12, z: 0, radius: 3 };
  school.obstacles = [obstacle];
  for (let i = 0; i < school.count; i++) {
    const k = i * 3;
    school.positions[k] = -9 - (i % 10) * 0.5;
    school.positions[k + 1] = 12 + ((i % 7) - 3) * 0.2;
    school.positions[k + 2] = ((i % 11) - 5) * 0.25;
    school.velocities[k] = school.cruise[i];
    school.velocities[k + 1] = 0;
    school.velocities[k + 2] = 0;
  }
  let minClearance = Infinity;
  for (let step = 0; step < 600; step++) {
    school.step();
    for (let i = 0; i < school.count; i++) {
      const k = i * 3;
      minClearance = Math.min(minClearance, Math.hypot(school.positions[k], school.positions[k + 1] - 12, school.positions[k + 2]) - 3);
    }
  }
  assert.ok(minClearance > 0.1, `Collision with lookahead obstacle: ${minClearance}`);
});

test("fixed integration is frame-rate independent and bounds slow-frame work", () => {
  const a = new School(200, 2), b = new School(200, 2);
  const ca = new FixedClock(), cb = new FixedClock();
  for (let i = 0; i < 60; i++) ca.advance(1 / 30, a);
  for (let i = 0; i < 288; i++) cb.advance(1 / 144, b);
  assert.equal(a.steps, 120);
  assert.equal(b.steps, 120);
  assert.deepEqual(a.positions, b.positions);
  const before = a.steps;
  assert.equal(ca.advance(5, a), 6);
  assert.equal(a.steps - before, 6);
  assert.ok(ca.droppedTime >= 4.9);
  assert.throws(() => ca.advance(NaN, a), RangeError);
  assert.throws(() => a.step(1), RangeError);
  assert.throws(() => a.reset(2001), RangeError);
});

test("seeded starting groups occupy three-dimensional volumes and scale density with population", () => {
  const small = new School(200, 42), dense = new School(2000, 42);
  const densityRatio = Math.cbrt(10);
  let central = 0, upper = 0;
  for (let i = 0; i < small.count; i++) {
    const k = i * 3, group = i % 3;
    const center = [(group - 1) * 7, 11 + group * 0.65, (group - 1) * -3];
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs((small.positions[k + axis] - center[axis]) * densityRatio - (dense.positions[k + axis] - center[axis])) < 2e-6);
    }
  }
  const scale = Math.cbrt(dense.count / 850);
  for (let i = 0; i < dense.count; i++) {
    const k = i * 3, group = i % 3;
    const x = (dense.positions[k] - (group - 1) * 7) / (7 * scale);
    const y = (dense.positions[k + 1] - 11 - group * 0.65) / (4.4 * scale);
    const z = (dense.positions[k + 2] - (group - 1) * -3) / (5.7 * scale);
    assert.ok(x * x + y * y + z * z <= 1.000001);
    if (Math.abs(y) < 0.3) central++;
    if (Math.abs(y) > 0.7) upper++;
  }
  assert.ok(central > upper * 2.5, "Starting school has a slab-like uniform height distribution");
  inspect(dense);
});

test("rounded soft boundaries turn head-on and corner approaches without stalls or unbounded drift", () => {
  for (const [x, z] of [[23, 0], [-23, 0], [0, 18], [18, 15]]) {
    const school = new School(200, 83);
    const length = Math.hypot(x / (22 * 22), z / (18 * 18));
    for (let i = 0; i < school.count; i++) {
      const k = i * 3;
      school.positions[k] = x + ((i % 10) - 5) * 0.05;
      school.positions[k + 1] = 12 + ((i % 7) - 3) * 0.1;
      school.positions[k + 2] = z + ((i % 11) - 5) * 0.05;
      school.velocities[k] = x / (22 * 22) / length * school.cruise[i];
      school.velocities[k + 1] = 0;
      school.velocities[k + 2] = z / (18 * 18) / length * school.cruise[i];
    }
    for (let step = 0; step < 600; step++) {
      school.step();
      if (step % 30 === 0) inspect(school);
    }
    inspect(school);
    assert.ok(school.stats.maxTurn > 0.003);
  }
});

test("ceiling and floor lookahead turn vertical swimmers instead of braking them into a boundary", () => {
  for (const sign of [-1, 1]) {
    const school = new School(200, 83);
    for (let i = 0; i < school.count; i++) {
      const k = i * 3;
      school.positions[k] = ((i % 10) - 5) * 0.05;
      school.positions[k + 1] = 12 + ((i % 7) - 3) * 0.05;
      school.positions[k + 2] = ((i % 11) - 5) * 0.05;
      school.velocities[k] = 0;
      school.velocities[k + 1] = sign * school.cruise[i];
      school.velocities[k + 2] = 0;
    }
    for (let step = 0; step < 600; step++) {
      school.step();
      if (step % 15 === 0) inspect(school);
    }
    inspect(school);
  }
});
