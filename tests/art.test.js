import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { fishGeometry, fishMaterial, createOcean, createCausticTexture } from "../src/art.js";
import { createFishOrientation } from "../src/pose.js";
import { OBSTACLES, BOUNDS } from "../src/simulation.js";
import { LIGHT_SHAFTS, SUN_DIRECTION } from "../src/water.js";

function shaderFor(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
}

test("fish keep a single finite merged geometry with deformable fins and padded bounds", () => {
  const geometry = fishGeometry();
  const count = geometry.attributes.position.count;
  assert.equal(geometry.index, null);
  for (const name of ["normal", "color", "aFin"]) assert.equal(geometry.attributes[name].count, count);
  for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
  assert.ok(geometry.attributes.aFin.array.includes(1));
  assert.ok(geometry.attributes.aFin.array.includes(0));
  assert.ok(count / 3 < 560, "Fish geometry became too expensive for 2,000 instances");
  const position = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    position.fromBufferAttribute(geometry.attributes.position, i);
    position.y += 0.008; position.z += 0.15;
    assert.ok(geometry.boundingBox.containsPoint(position));
    assert.ok(geometry.boundingSphere.containsPoint(position));
  }
  geometry.dispose();
});

test("fish shader shares the fixed simulation clock and updates bend normals before lighting", () => {
  const time = { value: 7 };
  const material = fishMaterial(time);
  const shader = shaderFor(material);
  assert.equal(shader.uniforms.uOceanTime, time);
  assert.equal((shader.vertexShader.match(/uniform float uOceanTime;/g) ?? []).length, 1);
  assert.ok(shader.vertexShader.indexOf("objectNormal.x -= dot") < shader.vertexShader.indexOf("#include <defaultnormal_vertex>"));
  assert.ok(shader.vertexShader.includes("transformed.yz += swimOffset(position.x)"));
  assert.ok(shader.fragmentShader.indexOf("outgoingLight = mix(outgoingLight") < shader.fragmentShader.indexOf("#include <tonemapping_fragment>"));
  const key = material.customProgramCacheKey();
  time.value = 12;
  assert.equal(material.customProgramCacheKey(), key);
  assert.equal(shader.uniforms.uOceanTime.value, 12);
  material.dispose();
});

test("velocity-aligned fish remain upright through complete turns and pitched swimming", () => {
  const orient = createFishOrientation(), quaternion = new THREE.Quaternion();
  const direction = new THREE.Vector3(), forward = new THREE.Vector3(), up = new THREE.Vector3();
  for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.13) {
    for (const pitch of [-0.55, 0, 0.55]) {
      direction.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
      orient(direction, quaternion);
      forward.set(1, 0, 0).applyQuaternion(quaternion);
      up.set(0, 1, 0).applyQuaternion(quaternion);
      assert.ok(forward.dot(direction) > 0.999999);
      assert.ok(up.y > 0.85, `Fish rolled over at heading ${yaw}`);
      assert.ok(Math.abs(up.dot(direction)) < 1e-6);
    }
  }
  for (const y of [-1, 1]) {
    orient(direction.set(0, y, 0), quaternion);
    assert.ok(quaternion.toArray().every(Number.isFinite));
    assert.ok(new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).dot(direction) > 0.999999);
  }
});

test("procedural caustics are seeded, mipmapped and repeat without external assets", () => {
  const a = createCausticTexture(), b = createCausticTexture();
  assert.deepEqual(a.image.data, b.image.data);
  assert.equal(a.wrapS, THREE.RepeatWrapping);
  assert.equal(a.wrapT, THREE.RepeatWrapping);
  assert.equal(a.generateMipmaps, true);
  let bright = 0, dark = 0;
  for (let i = 0; i < a.image.data.length; i += 4) {
    if (a.image.data[i] > 200) bright++;
    if (a.image.data[i] < 30) dark++;
  }
  const texels = a.image.width * a.image.height;
  assert.ok(bright / texels > 0.025 && bright / texels < 0.25);
  assert.ok(dark / texels > 0.45, "Caustics became an evenly lit grid");
  a.dispose(); b.dispose();
});

test("reef collision rocks stay inside their simulation spheres and vegetation has anchored roots", () => {
  const scene = new THREE.Scene(), time = { value: 0 };
  const originalRatio = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 1;
  try {
    const ocean = createOcean(scene, time);
    const rocks = scene.children.find(mesh => mesh.isInstancedMesh && mesh.count === 75);
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), center = new THREE.Vector3();
    for (let i = 0; i < rocks.count; i++) {
      rocks.getMatrixAt(i, matrix);
      const obstacle = OBSTACLES[i];
      if (obstacle) center.set(obstacle.x, obstacle.y, obstacle.z);
      for (let vertex = 0; vertex < rocks.geometry.attributes.position.count; vertex++) {
        point.fromBufferAttribute(rocks.geometry.attributes.position, vertex).applyMatrix4(matrix);
        if (obstacle) assert.ok(point.distanceTo(center) < obstacle.radius, `Visual rock ${i} exceeds its avoidance sphere`);
        else assert.ok(point.y < BOUNDS.minY - 0.5, "Decorative rock entered the fish swimming volume");
      }
    }
    const plants = scene.children.find(mesh => mesh.geometry?.attributes.aGrowth);
    assert.equal(plants.geometry.attributes.aGrowth.count, plants.geometry.attributes.position.count);
    assert.ok(plants.geometry.attributes.aGrowth.array.includes(0));
    const plantShader = shaderFor(plants.material);
    assert.equal(plantShader.uniforms.uOceanTime, time);
    assert.ok(plantShader.vertexShader.includes("float sway = aGrowth"));
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(26, 18.5, 43);
    ocean.update(camera);
    const shafts = scene.children.filter(mesh => mesh.geometry?.attributes.aGlow);
    assert.equal(shafts.length, LIGHT_SHAFTS.length);
    for (const shaft of shafts) {
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(shaft.quaternion);
      assert.ok(axis.dot(SUN_DIRECTION) > 0.999999);
      assert.equal(shaft.material.uniforms.uOceanTime, time);
    }
    const geometries = new Set(), materials = new Set();
    scene.traverse(mesh => {
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) materials.add(mesh.material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  } finally {
    if (originalRatio === undefined) delete globalThis.devicePixelRatio;
    else globalThis.devicePixelRatio = originalRatio;
  }
});
