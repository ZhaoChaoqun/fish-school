import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { School, FixedClock, MAX_FISH, seededRandom } from "./simulation.js";
import { createOcean, fishGeometry, fishMaterial } from "./art.js";
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
renderer.toneMappingExposure = 1.22;
document.querySelector("#ocean").append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c5367");
scene.fog = new THREE.FogExp2("#125b6c", 0.018);
function viewFov() {
  return Math.max(48, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / (innerWidth / innerHeight))));
}
const camera = new THREE.PerspectiveCamera(viewFov(), innerWidth / innerHeight, 0.2, 170);
camera.position.set(24, 16.5, 34);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10.5, 0);
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

scene.add(new THREE.HemisphereLight("#bcebe4", "#235465", 2.5));
const sun = new THREE.DirectionalLight("#fff4d9", 3.4);
sun.position.set(-18, 42, 14);
scene.add(sun);
const rim = new THREE.DirectionalLight("#5bc8eb", 1.9);
rim.position.set(8, 20, -25);
scene.add(rim);

const time = { value: 0 };
createOcean(scene, time);
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
const forward = new THREE.Vector3(1, 0, 0);
const direction = new THREE.Vector3();
const tint = new THREE.Color();
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
let previous = performance.now();
let resetSerial = 0;
let frameCount = 0, fpsStart = previous, measuredFps = 0;
let simulationMs = 0;

function populateAppearance() {
  const random = seededRandom(school.seed + 311);
  fish.count = school.count;
  for (let i = 0; i < school.count; i++) {
    swim[i * 2] = school.phases[i];
    swim[i * 2 + 1] = 6.6 + school.cruise[i] * 1.8;
    const variant = random();
    tint.set(variant < 0.12 ? "#e9cf8c" : variant < 0.4 ? "#9fcae1" : "#d1e9e5");
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
    dummy.quaternion.setFromUnitVectors(forward, direction);
    dummy.scale.setScalar(school.scales[i]);
    dummy.updateMatrix();
    fish.setMatrixAt(i, dummy.matrix);
  }
  fish.instanceMatrix.needsUpdate = true;
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
  camera.aspect = innerWidth / innerHeight;
  camera.fov = viewFov();
  camera.updateProjectionMatrix();
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
  updateFish();
  controls.update();
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
    };
  },
});
