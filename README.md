# Pelagic

A procedural Three.js shallow ocean. Start with 850 individually moving silver-blue fish above sunlit reef pockets and open sand, with deep-blue backs, pale bellies, occasional muted gold bodies and flexible forked tails. All artwork, water and reflection textures are generated locally; there are no remote artwork assets, CDN imports or telemetry.

**Live website:** [zhaochaoqun.github.io/fish-school](https://zhaochaoqun.github.io/fish-school/)

The fish-school project is independent of harbour-town and can also run entirely on your machine.

## Run locally

Requires Node.js 20.19+ or 22.12+ (developed with Node 25).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:4180**. The server binds only to loopback and fails rather than stealing another port. For a production preview, run `npm run build`, then `npm run preview` after stopping the development server. `npm test` runs deterministic simulation checks with Node's built-in test runner.

To preserve an existing server, select a different **free** port explicitly:

```sh
npm run dev -- --port 4187
```

The same override works with `npm run preview`. Starting either local server never publishes or updates the live website.

## GitHub Pages

Pushes to `main` run the deterministic simulation tests, build the Vite site and deploy only `dist/` using `.github/workflows/pages.yml`. The workflow can also be run manually from GitHub Actions. Relative build asset URLs support the `/fish-school/` Pages subpath without changing the local preview. No server-side service or API key is needed; the entire simulation runs in the visitor's browser.

## Explore

Drag to orbit; scroll or pinch to zoom. **Pause** freezes fish, tails, plants and suspended particles while keeping camera exploration available. **New school** creates a new seeded starting school, preserving population, behavior settings and playback state. Population ranges from 200 to 2,000; changing it reseeds the school and scales its initial volume to preserve density. **Togetherness** adjusts cohesion; **Personal space** adjusts the separation radius. The restrained ranges are intended to keep the scene alive rather than collapse it into a rigid mass. Reduced-motion preferences start the scene paused.

## How the school lives

These are actual three-dimensional Boids, not an optimization/search algorithm:

- **Separation:** steer away from nearby fish, especially within personal space.
- **Alignment:** gradually match the velocity of visible local neighbors.
- **Cohesion:** gently steer toward those neighbors' average position.

Each fish has its own cruise speed, scale, color and swimming phase. A bounded spatial grid searches the surrounding 27 cells rather than all fish pairs. It considers at most 160 candidates and 40 visible neighbors per fish per step, rotating search order to reduce sampling bias. A rear blind cone makes the neighborhood directional. Rounded horizontal lookahead boundaries turn with each fish's local heading instead of piling up along planar walls. Floor/ceiling steering takes priority over obstacle/current forces near the limits and gives head-on vertical swimmers room to turn rather than stall. Sphere-based rock avoidance, bounded acceleration, turn-rate limits and a weak coherent circulating current remain in place. Three seeded starting volumes can mix or separate; they are an initial condition, not a maintained school shape. There is no global leader or hard-coded school trajectory.

Simulation uses fixed 1/60-second steps. Frame deltas are clamped to 100 ms and six steps maximum, so a slow browser does not produce explosive jumps; under severe load simulated time deliberately slows instead of catching up without bound. Instanced fish use one merged body/fin/tail/eye mesh and per-instance vertex-shader swimming. Their forward axes follow actual velocity, with a world-up reference that avoids accidental rolling through full turns.

## The shallow-water look

Distance attenuation and the background share the same world-oriented blue/teal gradient, mixed in linear light before tone mapping. Near water stays clearer, deeper water darkens gently, and an extended seabed disappears into the water instead of ending at a visible floor edge. Four varied, oblique artistic shafts share the sun direction and reef light-pool coordinates. They turn around their light axes for readable orbit views; they are not volumetric scattering.

A small, locally generated HDR surface-light texture is prefiltered with Three.js PMREM once at startup. It supplies broad silver reflections rather than relying on metalness alone. The fish retain dark backs and pale bellies; segmented fin outlines use softer, rougher shading. Body-to-tail bending updates its normals analytically, pads geometry bounds and shares the simulation clock. Foliage has anchored roots, matching deformed normals and padded bounds too.

Vegetation and small stones cluster around the five simulation collision rocks, leaving sand corridors. The main rock meshes stay inside their avoidance spheres; decorative stones stay below the swimming volume. Seeded, mipmapped caustics drift and warp in uneven sunlit patches instead of drawing a uniform floor grid. Suspended particles are reduced from 1,400 to 520 sparse, light-sensitive specks.

The default view is wider and slightly elevated. Portrait projection uses the space between the unchanged masthead and a compact, fully accessible control panel. This is startup/resize framing, not a camera that follows the school: orbit, zoom and the camera position survive **New school**. Dense fronts can still briefly look curtain-like from some angles; the school is allowed to evolve naturally instead of being forced into a decorative outline.

## Tradeoffs and checks

This is a CPU-steered, GPU-instanced scene. The bounded neighborhood budget approximates very dense schools, and obstacle avoidance is steering rather than a full collision/contact solver. It does not guarantee nonintersecting individual bodies in every configuration. Camera and rendering remain active when paused. Device pixel ratio is capped at 1.75; performance depends on population, viewport and GPU. The UI reports measured rendering FPS, not a promised 60 FPS.

`window.__pelagic.snapshot()` exposes read-only local diagnostics for simulation steps, finite/bounded state, neighborhood work, turn limits, rendering statistics, measured FPS, camera framing, pixel ratio and procedural reflections. No data leaves the browser. Unit checks cover deterministic reset, 200/850/2,000 fish over 1,200 steps, speed/turn limits, obstacle clearance, coincident starts, frame-rate-independent integration, volume/density scaling, head-on boundary recovery, shader clocks/normals, upright orientation and visual rock bounds.

## Visual-upgrade verification (2026-10-09)

**16 unit tests and the production build pass.** The two-minute seeded run remains bounded with 746 of 850 headings differing substantially from the first fish. Real Chrome WebGL checks exercised all populations and behavior extremes, repeated resets while paused, resume, orbit/zoom, reduced-motion startup and five narrow/landscape layouts (down to 320x568), with no console/page errors or external asset requests. With a stationary camera, pause freezes the rendered scene pixel-for-pixel, including fish, fins, foliage, dust, caustics and shafts.

Evidence is in [`screenshots/visual-upgrade/`](screenshots/visual-upgrade/). Desktop and mobile before/after material comparisons restore the original release's complete fish positions, velocities, cruise speeds, scales, swimming phases and clock at seed 42, 8 seconds, using its original camera. Separate default-camera images show the intentional framing and native simulation changes. Shape sheets compare 2/8/30/60 seconds across three populations and multiple seeds. Both 850 and 2,000 fish fit the default desktop and 390x844 portrait frames at all four sampled times.

The following are **new measurements on the same Apple M5 Pro host, hardware-rendered Chrome via ANGLE Metal, 1512x982, DPR 1**. Each population warmed up for three seconds before sampling 239 frame intervals; each version used its own default camera. Simulation work is the mean of the existing smoothed CPU timing diagnostic, not total frame/GPU cost. Differences within these small CPU timings should not be treated as a guaranteed speedup.

| Fish | Baseline FPS | Upgrade FPS | Baseline simulation ms | Upgrade simulation ms |
| --- | ---: | ---: | ---: | ---: |
| 200 | 60.000 | 60.004 | 0.246 | 0.249 |
| 850 | 60.002 | 60.002 | 0.838 | 0.752 |
| 2,000 | 60.002 | 60.004 | 1.612 | 1.576 |

The upgraded default view uses 12 draw calls; at 2,000 fish it renders approximately 1.13 million triangles. These are local measurements, **not a 60 FPS promise for mobile hardware or other devices**. `performance-before.json`, `performance-after.json`, `browser-checks.json` and `production-smoke.json` retain the measured records.

## Original-release verification (historical)

The following results were recorded for the original release, `7f067a5`, not for the visual upgrade. Eight deterministic tests passed, including a 7,200-step (two simulated minutes) run with no nonfinite state or unbounded drift and independently varying headings. A real Chrome WebGL2 check exercised animation, pause/resume, population changes, reset, both behavior controls, orbit/zoom, mobile layout and reduced-motion startup, with zero console/page errors and zero external asset requests. Instance orientation was checked against actual swimming velocity.

Representative images are in `screenshots/pelagic.png`, `screenshots/pelagic-dense.png` and `screenshots/pelagic-mobile.png`; `screenshots/browser-validation.json` records the browser checks. `screenshots/performance.json` records 239 sampled frame intervals per population at 1512×982, DPR 1: approximately 60 FPS at both 850 and 2,000 fish, with mean simulation work of about 0.71 ms and 1.47 ms respectively. This was **hardware-rendered headless Chrome on Apple M5 Pro via ANGLE Metal**, not software SwiftShader, and is a measured result for that setup—not a performance guarantee for other devices.
