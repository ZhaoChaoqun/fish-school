import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { School, FixedClock, MAX_FISH, seededRandom } from "./simulation.js";
import { createOcean, fishGeometry, fishMaterial } from "./art.js";
import { createWater, SUN_DIRECTION } from "./water.js";
import { createFishOrientation } from "./pose.js";
import "./style.css";

const errorBox = document.querySelector("#error");
function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch (error) {
  showError(`This ocean needs WebGL. Enable browser hardware acceleration and reload. ${error.message}`);
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.querySelector("#ocean").append(renderer.domElement);

const scene = new THREE.Scene();
function viewFov() {
  const halfHorizontal = innerHeight > innerWidth ? 29 : 25;
  return Math.max(48, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(halfHorizontal)) / (innerWidth / innerHeight))));
}
const camera = new THREE.PerspectiveCamera(viewFov(), innerWidth / innerHeight, 0.2, 300);
camera.position.set(26, 23, 43);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, innerWidth <= 700 && innerHeight > innerWidth ? 7.5 : 11, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 11;
controls.maxDistance = 83;
controls.maxPolarAngle = Math.PI * 0.485;
controls.minPolarAngle = Math.PI * 0.14;
controls.enablePan = false;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.65;
controls.update();

function frameView() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = viewFov();
  if (innerWidth <= 700 && innerHeight > innerWidth) {
    const top = document.querySelector(".masthead").getBoundingClientRect().bottom + 28;
    const bottom = document.querySelector(".controls").getBoundingClientRect().top - 24;
    const offset = Math.max(0, innerHeight * 0.5 - (top + bottom) * 0.5);
    camera.setViewOffset(innerWidth, innerHeight, 0, offset, innerWidth, innerHeight);
  } else {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}
frameView();

scene.add(new THREE.HemisphereLight("#d8f0ed", "#2b5163", 1.75));
const sun = new THREE.DirectionalLight("#fff2d5", 3);
sun.position.copy(SUN_DIRECTION).multiplyScalar(50);
scene.add(sun);
const rim = new THREE.DirectionalLight("#75c1df", 1.15);
rim.position.set(8, 20, -25);
scene.add(rim);

const time = { value: 0 };
createWater(scene, renderer, time);
const ocean = createOcean(scene, time);
const school = new School();
const clock = new FixedClock();
const geometry = fishGeometry();
const swim = new Float32Array(MAX_FISH * 2);
geometry.setAttribute("iSwim", new THREE.InstancedBufferAttribute(swim, 2));
const fish = new THREE.InstancedMesh(geometry, fishMaterial(time), MAX_FISH);
fish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
// Instances move every step; a stale initial bounding sphere would incorrectly cull them.
fish.frustumCulled = false;
scene.add(fish);
const dummy = new THREE.Object3D();
const orientFish = createFishOrientation();
const direction = new THREE.Vector3();
const tint = new THREE.Color();
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
let previous = performance.now();
let resetSerial = 0;
let frameCount = 0, fpsStart = previous, measuredFps = 0;
let simulationMs = 0;
let renderedSteps = -1;

function populateAppearance() {
  const random = seededRandom(school.seed + 311);
  fish.count = school.count;
  for (let i = 0; i < school.count; i++) {
    swim[i * 2] = school.phases[i];
    swim[i * 2 + 1] = 6.6 + school.cruise[i] * 1.8;
    const variant = random();
    tint.set(variant < 0.09 ? "#e7d4a8" : variant < 0.36 ? "#abcce0" : "#e0ecee");
    fish.setColorAt(i, tint);
  }
  geometry.attributes.iSwim.needsUpdate = true;
  fish.instanceColor.needsUpdate = true;
}

function updateFish() {
  for (let i = 0; i < school.count; i++) {
    const k = i * 3;
    dummy.position.set(school.positions[k], school.positions[k + 1], school.positions[k + 2]);
    direction.set(school.velocities[k], school.velocities[k + 1], school.velocities[k + 2]).normalize();
    orientFish(direction, dummy.quaternion);
    dummy.scale.setScalar(school.scales[i]);
    dummy.updateMatrix();
    fish.setMatrixAt(i, dummy.matrix);
  }
  fish.instanceMatrix.needsUpdate = true;
  renderedSteps = school.steps;
}

function resetSchool(count = school.count) {
  school.reset(count, 42 + ++resetSerial * 97);
  clock.reset();
  populateAppearance();
  updateFish();
  previous = performance.now();
}

const play = document.querySelector("#play");
function updatePlaybackUI() {
  play.setAttribute("aria-label", paused ? "Play simulation" : "Pause simulation");
  play.setAttribute("aria-pressed", String(paused));
  document.querySelector("#play-label").textContent = paused ? "Resume" : "Pause";
  document.querySelector("#play-icon").textContent = paused ? "▷" : "Ⅱ";
  document.querySelector("#status").textContent = paused ? "A moment of stillness" : "School in motion";
}
play.addEventListener("click", () => {
  paused = !paused;
  clock.reset();
  previous = performance.now();
  updatePlaybackUI();
});
document.querySelector("#reset").addEventListener("click", () => resetSchool());
const population = document.querySelector("#count");
population.addEventListener("input", () => {
  document.querySelector("#count-value").textContent = Number(population.value).toLocaleString("en-US");
});
population.addEventListener("change", () => resetSchool(Number(population.value)));
for (const key of ["cohesion", "separation"]) {
  document.querySelector(`#${key}`).addEventListener("input", event => {
    school[key] = Number(event.target.value);
    document.querySelector(`#${key}-value`).textContent = school[key] < 0.9 ? (key === "cohesion" ? "Loose" : "Close") : school[key] > 1.15 ? (key === "cohesion" ? "Close-knit" : "Spacious") : "Balanced";
  });
}
for (const slider of document.querySelectorAll('input[type="range"]')) {
  const fill = () => slider.style.setProperty("--fill", `${(slider.value - slider.min) / (slider.max - slider.min) * 100}%`);
  slider.addEventListener("input", fill);
  fill();
}

window.addEventListener("resize", () => {
  frameView();
  renderer.setSize(innerWidth, innerHeight);
});
document.addEventListener("visibilitychange", () => {
  previous = performance.now();
  clock.reset();
});
renderer.domElement.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  showError("The graphics context was lost. Reload this page to return to the ocean.");
});

populateAppearance();
updateFish();
updatePlaybackUI();

function animate(now) {
  requestAnimationFrame(animate);
  // Input events can run after the frame timestamp but before its RAF callback.
  const delta = Math.max(0, (now - previous) / 1000);
  previous = now;
  const start = performance.now();
  if (!paused && !document.hidden) clock.advance(delta, school);
  simulationMs = simulationMs * 0.94 + (performance.now() - start) * 0.06;
  time.value = school.time;
  if (school.steps !== renderedSteps) updateFish();
  controls.update();
  ocean.update(camera);
  renderer.render(scene, camera);
  frameCount++;
  if (now - fpsStart >= 1000) {
    measuredFps = frameCount * 1000 / (now - fpsStart);
    document.querySelector("#fps").textContent = `${Math.round(measuredFps)} fps`;
    frameCount = 0;
    fpsStart = now;
  }
}
requestAnimationFrame(animate);

// Read-only diagnostics for local verification; no telemetry or network calls.
window.__pelagic = Object.freeze({
  snapshot() {
    let finite = true, minY = Infinity, maxY = -Infinity, maxX = 0, maxZ = 0, minSpeed = Infinity, maxSpeed = 0;
    for (let i = 0; i < school.count; i++) {
      const k = i * 3;
      const speed = Math.hypot(school.velocities[k], school.velocities[k + 1], school.velocities[k + 2]);
      finite &&= Number.isFinite(speed) && Number.isFinite(school.positions[k]) && Number.isFinite(school.positions[k + 1]) && Number.isFinite(school.positions[k + 2]);
      minY = Math.min(minY, school.positions[k + 1]); maxY = Math.max(maxY, school.positions[k + 1]);
      maxX = Math.max(maxX, Math.abs(school.positions[k])); maxZ = Math.max(maxZ, Math.abs(school.positions[k + 2]));
      minSpeed = Math.min(minSpeed, speed); maxSpeed = Math.max(maxSpeed, speed);
    }
    return {
      count: school.count, paused, time: school.time, steps: school.steps, seed: school.seed, finite,
      minY, maxY, maxX, maxZ, minSpeed, maxSpeed, ...school.stats,
      cohesion: school.cohesion, separation: school.separation, fps: measuredFps, simulationMs,
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      firstPosition: Array.from(school.positions.slice(0, 3)), firstVelocity: Array.from(school.velocities.slice(0, 3)),
      firstMatrix: Array.from(fish.instanceMatrix.array.slice(0, 16)),
      camera: camera.position.toArray(), droppedTime: clock.droppedTime,
      cameraTarget: controls.target.toArray(), verticalFov: camera.fov,
      viewOffsetY: camera.view?.enabled ? camera.view.offsetY : 0,
      pixelRatio: renderer.getPixelRatio(), proceduralReflections: Boolean(scene.environment),
    };
  },
});
