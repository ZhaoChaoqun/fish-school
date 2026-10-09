# Pelagic

A procedural Three.js underwater world. Start with 850 individually moving fish above a reef, with silver, blue and occasional gold bodies, forked tails and fins. All artwork is generated locally; there are no remote artwork assets, CDN imports or telemetry.

**Live website:** [zhaochaoqun.github.io/fish-school](https://zhaochaoqun.github.io/fish-school/)

The fish-school project is independent of harbour-town and can also run entirely on your machine.

## Run locally

Requires Node.js 20.19+ or 22.12+ (developed with Node 25).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:4180**. The server binds only to loopback and fails rather than stealing another port. For a production preview, run `npm run build`, then `npm run preview` after stopping the development server. `npm test` runs deterministic simulation checks with Node's built-in test runner.

## GitHub Pages

Pushes to `main` run the deterministic simulation tests, build the Vite site and deploy only `dist/` using `.github/workflows/pages.yml`. The workflow can also be run manually from GitHub Actions. Relative build asset URLs support the `/fish-school/` Pages subpath without changing the local preview. No server-side service or API key is needed; the entire simulation runs in the visitor's browser.

## Explore

Drag to orbit; scroll or pinch to zoom. **Pause** freezes fish, tails, plants and suspended particles while keeping camera exploration available. **New school** creates a new seeded starting school, preserving population, behavior settings and playback state. Population ranges from 200 to 2,000; changing it reseeds the school and scales its initial volume to preserve density. **Togetherness** adjusts cohesion; **Personal space** adjusts the separation radius. The restrained ranges are intended to keep the scene alive rather than collapse it into a rigid mass. Reduced-motion preferences start the scene paused.

## How the school lives

These are actual three-dimensional Boids, not an optimization/search algorithm:

- **Separation:** steer away from nearby fish, especially within personal space.
- **Alignment:** gradually match the velocity of visible local neighbors.
- **Cohesion:** gently steer toward those neighbors' average position.

Each fish has its own cruise speed, scale, color and swimming phase. A bounded spatial grid searches the surrounding 27 cells rather than all fish pairs. It considers at most 160 candidates and 40 visible neighbors per fish per step, rotating search order to reduce sampling bias. A rear blind cone makes the neighborhood directional. Soft boundary forces, sphere-based rock avoidance with lookahead, bounded acceleration, turn-rate limits and a weak coherent circulating current shape the motion. Three starting groups can mix or separate; there is no global leader or hard-coded school trajectory.

Simulation uses fixed 1/60-second steps. Frame deltas are clamped to 100 ms and six steps maximum, so a slow browser does not produce explosive jumps; under severe load simulated time deliberately slows instead of catching up without bound. Instanced fish use one merged body/fin/tail/eye mesh and per-instance vertex-shader tail animation. Reef plants, caustic hints and translucent light shafts are procedural; shafts are an artistic approximation, not volumetric scattering.

## Tradeoffs and checks

This is a CPU-steered, GPU-instanced scene. The bounded neighborhood budget approximates very dense schools, and obstacle avoidance is steering rather than a full collision/contact solver. It does not guarantee nonintersecting individual bodies in every configuration. Camera and rendering remain active when paused. Device pixel ratio is capped at 1.75; performance depends on population, viewport and GPU. The UI reports measured rendering FPS, not a promised 60 FPS.

`window.__pelagic.snapshot()` exposes read-only local diagnostics for simulation steps, finite/bounded state, neighborhood work, turn limits, rendering statistics and measured FPS. No data leaves the browser. Unit checks cover deterministic reset, 200/850/2,000 fish over 1,200 steps, speed/turn limits, obstacle clearance, coincident starts and frame-rate-independent integration.

## Verified local preview

Eight deterministic tests pass, including a 7,200-step (two simulated minutes) run with no nonfinite state or unbounded drift and independently varying headings. A real Chrome WebGL2 check exercised animation, pause/resume, population changes, reset, both behavior controls, orbit/zoom, mobile layout and reduced-motion startup, with zero console/page errors and zero external asset requests. Instance orientation was checked against actual swimming velocity.

Representative images are in `screenshots/pelagic.png`, `screenshots/pelagic-dense.png` and `screenshots/pelagic-mobile.png`; `screenshots/browser-validation.json` records the browser checks. `screenshots/performance.json` records 239 sampled frame intervals per population at 1512×982, DPR 1: approximately 60 FPS at both 850 and 2,000 fish, with mean simulation work of about 0.71 ms and 1.47 ms respectively. This was **hardware-rendered headless Chrome on Apple M5 Pro via ANGLE Metal**, not software SwiftShader, and is a measured result for that setup—not a performance guarantee for other devices.
