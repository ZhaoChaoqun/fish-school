import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OBSTACLES, seededRandom } from "./simulation.js";
import { LIGHT_SHAFTS, SUN_DIRECTION, waterShader, waterUniforms, withWater } from "./water.js";

function finishPart(geometry, color, fin = 0) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  result.deleteAttribute("uv");
  const count = result.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b;
  }
  result.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  result.setAttribute("aFin", new THREE.BufferAttribute(new Float32Array(count).fill(fin), 1));
  return result;
}

function finFan(root, edge, color) {
  const points = [];
  for (let i = 0; i < edge.length - 1; i++) points.push(...root, ...edge[i], ...edge[i + 1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  return finishPart(geometry, color, 1);
}

export function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 16, 10);
  const positions = body.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const taper = 0.6 + (x + 1) * 0.2;
    positions.setXYZ(i, x * 0.54 + 0.1, positions.getY(i) * 0.21 * taper, positions.getZ(i) * 0.15 * taper);
  }
  body.computeVertexNormals();
  const bodyPart = finishPart(body, new THREE.Color("#cedce1"));
  const colors = bodyPart.attributes.color;
  const bp = bodyPart.attributes.position;
  const back = new THREE.Color("#204967"), silver = new THREE.Color("#c4d3dd"), belly = new THREE.Color("#e1eee7");
  const shade = new THREE.Color();
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i);
    shade.copy(silver).lerp(back, THREE.MathUtils.smoothstep(y, 0.06, 0.18));
    shade.lerp(belly, 1 - THREE.MathUtils.smoothstep(y, -0.14, 0));
    colors.setXYZ(i, shade.r, shade.g, shade.b);
  }
  const blue = new THREE.Color("#5e91ac"), pale = new THREE.Color("#91b4c4");
  const parts = [bodyPart,
    finFan([-0.37, 0, 0], [
      [-0.58, 0.09, 0], [-0.83, 0.235, 0.012], [-0.94, 0.25, 0.018],
      [-0.84, 0.105, 0.009], [-0.7, 0, 0],
      [-0.84, -0.105, 0.009], [-0.94, -0.25, 0.018], [-0.83, -0.235, 0.012], [-0.58, -0.09, 0],
    ], blue),
    finFan([-0.29, 0.13, 0], [
      [-0.26, 0.17, 0], [-0.17, 0.235, 0], [-0.045, 0.31, 0.009],
      [0.025, 0.295, 0.012], [0.09, 0.2, 0], [0.14, 0.16, 0],
    ], blue),
    finFan([-0.11, -0.12, 0], [
      [-0.36, -0.08, 0], [-0.32, -0.19, 0.012], [-0.22, -0.24, 0.01], [-0.07, -0.15, 0],
    ], blue),
  ];
  for (const sign of [-1, 1]) {
    parts.push(finFan([0.15, -0.05, sign * 0.12], [
      [0.06, -0.1, sign * 0.14], [-0.07, -0.17, sign * 0.235],
      [-0.25, -0.16, sign * 0.28], [-0.2, -0.085, sign * 0.16],
    ], pale));
    const eye = new THREE.SphereGeometry(0.032, 8, 6);
    eye.scale(1, 1, 0.55);
    eye.translate(0.44, 0.053, sign * 0.111);
    parts.push(finishPart(eye, new THREE.Color("#102733")));
    const glint = new THREE.SphereGeometry(0.009, 5, 4);
    glint.translate(0.449, 0.063, sign * 0.13);
    parts.push(finishPart(glint, new THREE.Color("#e5f8f7")));
  }
  const merged = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  merged.computeBoundingBox();
  merged.boundingBox.expandByVector(new THREE.Vector3(0, 0.008, 0.15));
  merged.computeBoundingSphere();
  merged.boundingSphere.radius += 0.15;
  return merged;
}

export function fishMaterial(time) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.3, metalness: 0.52, envMapIntensity: 1.35, side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `
      attribute vec2 iSwim;
      attribute float aFin;
      varying float vFin;
      vec2 swimOffset(float x) {
        float t = clamp((0.28 - x) / 1.25, 0.0, 1.0);
        float phase = uOceanTime * iSwim.y + iSwim.x + x * 4.2;
        return vec2(0.008 * sin(phase * 0.5), 0.15 * sin(phase)) * t * t;
      }
      vec2 swimSlope(float x) {
        float t = clamp((0.28 - x) / 1.25, 0.0, 1.0);
        float derivative = x > -0.97 && x < 0.28 ? -0.8 : 0.0;
        float phase = uOceanTime * iSwim.y + iSwim.x + x * 4.2;
        return vec2(
          0.008 * (2.0 * t * derivative * sin(phase * 0.5) + t * t * 2.1 * cos(phase * 0.5)),
          0.15 * (2.0 * t * derivative * sin(phase) + t * t * 4.2 * cos(phase))
        );
      }
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", `
      #include <beginnormal_vertex>
      // Inverse-transpose of the swim bend keeps moving reflection highlights attached to the body.
      objectNormal.x -= dot(swimSlope(position.x), objectNormal.yz);
      objectNormal = normalize(objectNormal);
    `);
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      transformed.yz += swimOffset(position.x);
      vFin = aFin;
    `);
    shader.fragmentShader = "varying float vFin;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
      #include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.57, vFin);
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <metalnessmap_fragment>", `
      #include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor, 0.16, vFin);
    `);
  };
  material.customProgramCacheKey = () => "pelagic-fish-v2";
  return withWater(material, time);
}

export function createCausticTexture() {
  const size = 256, cells = 7;
  const random = seededRandom(517);
  const sites = Array.from({ length: cells * cells }, () => [0.12 + random() * 0.76, 0.12 + random() * 0.76]);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / size * cells, py = y / size * cells;
      const cx = Math.floor(px), cy = Math.floor(py);
      let first = Infinity, second = Infinity;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const sx = cx + ox, sy = cy + oy;
          const site = sites[((sy + cells) % cells) * cells + (sx + cells) % cells];
          const distance = Math.hypot(sx + site[0] - px, sy + site[1] - py);
          if (distance < first) { second = first; first = distance; }
          else if (distance < second) second = distance;
        }
      }
      const ridge = Math.exp(-(((second - first) * 12) ** 2));
      const k = (y * size + x) * 4;
      data[k] = Math.round(ridge * 255);
      data[k + 1] = Math.round(Math.min(1, first) * 255);
      data[k + 2] = Math.round(random() * 255);
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function seabedHeight(x, z) {
  return -1.3 + Math.sin(x * 0.13) * 0.42 + Math.cos(z * 0.16) * 0.35 + Math.sin(x * 0.7 + z * 0.3) * 0.07;
}

function causticMaterial(color, time, texture, sand = false) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.89, envMapIntensity: 0.28 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uCaustics = { value: texture };
    if (sand) shader.uniforms.uReefRocks = { value: OBSTACLES.map(rock => new THREE.Vector3(rock.x, rock.z, rock.radius)) };
    shader.fragmentShader = `uniform sampler2D uCaustics;\n${sand ? `uniform vec3 uReefRocks[${OBSTACLES.length}];\n` : ""}` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
      vec2 causticUV = vOceanPosition.xz * 0.055;
      vec2 drift = vec2(uOceanTime * 0.012, -uOceanTime * 0.008);
      vec2 warp = vec2(sin(causticUV.y * 11.0 + uOceanTime * 0.18), cos(causticUV.x * 9.0 - uOceanTime * 0.13)) * 0.075;
      vec4 pattern = texture2D(uCaustics, causticUV + drift + warp);
      float secondary = texture2D(uCaustics, causticUV * 1.31 - drift * 0.7 + vec2(0.31, 0.19)).r;
      float caustic = pow(pattern.r * 0.68 + secondary * 0.32, 1.7);
      float upward = max(inverseTransformDirection(normal, viewMatrix).y, 0.0);
      float coverage = smoothstep(0.12, 0.8, 0.5 + sin(vOceanPosition.x * 0.19 + uOceanTime * 0.06) * cos(vOceanPosition.z * 0.23 - uOceanTime * 0.05) * 0.5);
      float sunlight = (0.12 + oceanLightPool(vOceanPosition) * 0.88) * coverage * exp(-max(vOceanPosition.y, 0.0) * 0.12);
      outgoingLight *= 1.0 + caustic * sunlight * upward * 0.7;
      ${sand ? `
        float ripple = sin(vOceanPosition.x * 5.2 + sin(vOceanPosition.z * 0.7) * 1.8) * 0.018;
        outgoingLight *= 0.97 + ripple + (pattern.g - 0.5) * 0.075;
        for (int rock = 0; rock < ${OBSTACLES.length}; rock++) {
          vec2 contact = vOceanPosition.xz - uReefRocks[rock].xy;
          outgoingLight *= 1.0 - exp(-dot(contact, contact) / pow(uReefRocks[rock].z * 0.8, 2.0)) * 0.23;
        }
      ` : ""}
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => `pelagic-caustics-v2-${sand}`;
  return withWater(material, time);
}

export function createOcean(scene, time) {
  const random = seededRandom(1907);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const texture = createCausticTexture();
  const seabed = new THREE.PlaneGeometry(270, 270, 110, 110);
  seabed.rotateX(-Math.PI / 2);
  const position = seabed.attributes.position;
  for (let i = 0; i < position.count; i++) position.setY(i, seabedHeight(position.getX(i), position.getZ(i)));
  seabed.computeVertexNormals();
  scene.add(new THREE.Mesh(seabed, causticMaterial("#a8b6a0", time, texture, true)));

  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), causticMaterial("#9caaa0", time, texture), 75);
  const rockVertices = rocks.geometry.attributes.position;
  for (let i = 0; i < rockVertices.count; i++) {
    const x = rockVertices.getX(i), y = rockVertices.getY(i), z = rockVertices.getZ(i);
    const factor = 1 + Math.sin(x * 7 + z * 4) * Math.cos(y * 6 - z * 3) * 0.065;
    rockVertices.setXYZ(i, x * factor, y * factor, z * factor);
  }
  rocks.geometry.computeVertexNormals();
  for (let i = 0; i < rocks.count; i++) {
    const obstacle = OBSTACLES[i];
    const anchor = OBSTACLES[i % OBSTACLES.length];
    const angle = random() * Math.PI * 2;
    const radius = anchor.radius + 1.3 + random() * 6;
    const x = obstacle ? obstacle.x : anchor.x + Math.cos(angle) * radius;
    const z = obstacle ? obstacle.z : anchor.z + Math.sin(angle) * radius;
    const size = obstacle ? obstacle.radius * 0.79 : 0.2 + random() * 0.72;
    dummy.position.set(x, obstacle ? obstacle.y - 0.32 : seabedHeight(x, z) + size * 0.25, z);
    dummy.scale.set(size, size * (0.63 + random() * 0.19), size * 0.86);
    dummy.rotation.set(random() * 0.2, random() * 6, random() * 0.14);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rocks.setColorAt(i, color.setHSL(0.4 + random() * 0.08, 0.06 + random() * 0.08, 0.66 + random() * 0.15));
  }
  scene.add(rocks);

  function patchPosition(index, inner = false) {
    const rock = OBSTACLES[index % OBSTACLES.length];
    const angle = random() * Math.PI * 2;
    const radius = rock.radius * (inner ? 0.7 + random() * 0.55 : 0.9 + random() * 1.25);
    return [rock.x + Math.cos(angle) * radius, rock.z + Math.sin(angle) * radius];
  }

  const branches = [], tips = [];
  const coralColors = ["#c39c78", "#b88378", "#81bba6", "#b9a6aa"];
  const up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), direction = new THREE.Vector3();
  function branch(start, end, thickness, tint, tip = false) {
    a.set(...start); b.set(...end);
    direction.subVectors(b, a);
    dummy.position.copy(a).add(b).multiplyScalar(0.5);
    dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    dummy.scale.set(thickness, direction.length(), thickness);
    dummy.updateMatrix();
    branches.push({ matrix: dummy.matrix.clone(), tint });
    if (tip) {
      dummy.position.copy(b);
      dummy.scale.setScalar(thickness * 1.08);
      dummy.quaternion.identity();
      dummy.updateMatrix();
      tips.push({ matrix: dummy.matrix.clone(), tint });
    }
  }
  for (let patch = 0; patch < 23; patch++) {
    const [x, z] = patchPosition(patch, true);
    const tint = coralColors[patch % coralColors.length];
    const fan = patch % 3 === 0;
    const angle = random() * Math.PI * 2;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    for (let stem = 0; stem < (fan ? 3 : 4); stem++) {
      const baseX = x + (random() - 0.5) * 1.25, baseZ = z + (random() - 0.5) * 1.25;
      const baseY = seabedHeight(baseX, baseZ) + 0.07;
      const height = 0.7 + random() * 1.65;
      const bend = (random() - 0.5) * 0.5;
      const middle = [baseX + dx * bend, baseY + height * 0.53, baseZ + dz * bend];
      const top = [baseX + dx * bend * 1.8, baseY + height, baseZ + dz * bend * 1.8];
      branch([baseX, baseY, baseZ], middle, 0.075, tint);
      branch(middle, top, 0.05, tint, true);
      for (let arm = 0; arm < (fan ? 5 : 3); arm++) {
        const fraction = 0.28 + arm * (fan ? 0.12 : 0.2);
        const origin = [baseX + dx * bend * fraction, baseY + height * fraction, baseZ + dz * bend * fraction];
        const armAngle = fan ? angle + (arm % 2 ? 0 : Math.PI) : random() * Math.PI * 2;
        const reach = height * (0.2 + random() * 0.28);
        const end = [origin[0] + Math.cos(armAngle) * reach, origin[1] + reach * 0.55, origin[2] + Math.sin(armAngle) * reach];
        branch(origin, end, 0.041, tint);
        branch(end, [end[0] + Math.cos(armAngle) * reach * 0.25, end[1] + reach * 0.6, end[2] + Math.sin(armAngle) * reach * 0.25], 0.025, tint, true);
      }
    }
  }
  function coralInstances(geometry, instances) {
    const mesh = new THREE.InstancedMesh(geometry, causticMaterial("#ffffff", time, texture), instances.length);
    instances.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, color.set(item.tint));
    });
    scene.add(mesh);
  }
  coralInstances(new THREE.CylinderGeometry(0.7, 1, 1, 6), branches);
  coralInstances(new THREE.SphereGeometry(1, 5, 4), tips);

  const leaves = [], leafColors = [], growth = [];
  for (let patch = 0; patch < 85; patch++) {
    const [x, z] = patchPosition(patch);
    const heightScale = patch % 7 === 0 ? 1.3 : 0.75;
    for (let leaf = 0; leaf < 5 + patch % 4; leaf++) {
      const height = (0.5 + random() * 2.2) * heightScale, width = 0.07 + random() * 0.08;
      const angle = random() * Math.PI * 2, dx = Math.cos(angle), dz = Math.sin(angle);
      const baseX = x + (random() - 0.5) * 0.8, baseZ = z + (random() - 0.5) * 0.8;
      const baseY = seabedHeight(baseX, baseZ);
      const tint = new THREE.Color().setHSL(0.43 + random() * 0.06, 0.23, 0.26 + random() * 0.17);
      for (let segment = 0; segment < 5; segment++) {
        const l = segment / 5, h = (segment + 1) / 5;
        const point = (t, side) => [
          baseX + Math.sin(t * 1.9) * dx * height * 0.3 + side * width * Math.sin((1 - t) * 1.7) * dz,
          baseY + t * height,
          baseZ + Math.sin(t * 1.9) * dz * height * 0.3 - side * width * Math.sin((1 - t) * 1.7) * dx,
        ];
        leaves.push(...point(l, -1), ...point(h, -1), ...point(l, 1), ...point(l, 1), ...point(h, -1), ...point(h, 1));
        growth.push(l * height, h * height, l * height, l * height, h * height, h * height);
        for (let vertex = 0; vertex < 6; vertex++) leafColors.push(tint.r, tint.g, tint.b);
      }
    }
  }
  const kelpGeometry = new THREE.BufferGeometry();
  kelpGeometry.setAttribute("position", new THREE.Float32BufferAttribute(leaves, 3));
  kelpGeometry.setAttribute("color", new THREE.Float32BufferAttribute(leafColors, 3));
  kelpGeometry.setAttribute("aGrowth", new THREE.Float32BufferAttribute(growth, 1));
  kelpGeometry.computeVertexNormals();
  const kelpMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, envMapIntensity: 0.3, side: THREE.DoubleSide });
  kelpMaterial.onBeforeCompile = shader => {
    shader.vertexShader = "attribute float aGrowth;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      float sway = aGrowth;
      transformed.x += sin(uOceanTime * 0.55 + position.z * 0.3) * sway * sway * 0.027;
      transformed.z += cos(uOceanTime * 0.4 + position.x * 0.25) * sway * 0.047;
    `);
    shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", `
      #include <beginnormal_vertex>
      float height = aGrowth;
      float phaseX = uOceanTime * 0.55 + position.z * 0.3;
      float phaseZ = uOceanTime * 0.4 + position.x * 0.25;
      float xy = sin(phaseX) * height * 0.054;
      float xz = cos(phaseX) * height * height * 0.0081;
      float zx = -sin(phaseZ) * height * 0.01175;
      float zy = cos(phaseZ) * 0.047;
      objectNormal = normalize(vec3(
        objectNormal.x - zx * objectNormal.z,
        (xz * zy - xy) * objectNormal.x + (1.0 - xz * zx) * objectNormal.y + (xy * zx - zy) * objectNormal.z,
        objectNormal.z - xz * objectNormal.x
      ));
    `);
  };
  kelpMaterial.customProgramCacheKey = () => "pelagic-kelp-v2";
  const kelp = new THREE.Mesh(kelpGeometry, withWater(kelpMaterial, time));
  kelpGeometry.computeBoundingSphere();
  kelpGeometry.boundingSphere.radius += 0.8;
  scene.add(kelp);

  const dustGeometry = new THREE.BufferGeometry();
  const dustCount = 520;
  const dustPositions = new Float32Array(dustCount * 3), dustSizes = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (random() - 0.5) * 90;
    dustPositions[i * 3 + 1] = random() * 34;
    dustPositions[i * 3 + 2] = (random() - 0.5) * 80;
    dustSizes[i] = 0.55 + random() * 1.2;
  }
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute("aSize", new THREE.BufferAttribute(dustSizes, 1));
  const dust = new THREE.Points(dustGeometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...waterUniforms(time), uPixelRatio: { value: Math.min(devicePixelRatio, 1.75) } },
    vertexShader: `
      ${waterShader}
      uniform float uPixelRatio;
      attribute float aSize;
      varying float vFade;
      void main() {
        vec3 p = position;
        p.x += sin(uOceanTime * 0.08 + position.z) * 0.6;
        p.y = mod(position.y + uOceanTime * 0.035, 34.0);
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(aSize * uPixelRatio * 38.0 / -view.z, 1.0, 3.2);
        float distance = length(view.xyz);
        vFade = exp(-distance * 0.042) * smoothstep(1.0, 6.0, distance) * (0.22 + oceanLightPool(p) * 0.78);
      }`,
    fragmentShader: `
      varying float vFade;
      void main() {
        float glow = 1.0 - smoothstep(0.08, 0.5, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(0.75, 0.89, 0.84, glow * vFade * 0.48);
      }`,
  }));
  dust.frustumCulled = false;
  scene.add(dust);

  const rayMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: waterUniforms(time),
    vertexShader: `
      varying vec2 vUv;
      varying vec2 vGlow;
      varying float vDistance;
      attribute vec2 aGlow;
      void main() {
        vUv = uv;
        vGlow = aGlow;
        vec3 p = position;
        p.x *= mix(1.25, 0.48, uv.y);
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        vDistance = length(view.xyz);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform float uOceanTime;
      varying vec2 vUv;
      varying vec2 vGlow;
      varying float vDistance;
      void main() {
        float beam = pow(max(0.0, sin(vUv.x * 3.14159265)), 2.5);
        float ends = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
        float shimmer = 0.88 + sin(uOceanTime * 0.14 + vGlow.y + vUv.y * 3.0) * 0.12;
        float distanceFade = exp(-max(vDistance - 25.0, 0.0) * 0.015);
        gl_FragColor = vec4(0.65, 0.85, 0.78, beam * ends * vGlow.x * shimmer * distanceFade);
      }`,
  });
  const rays = LIGHT_SHAFTS.map(shaft => {
    const length = shaft.height / SUN_DIRECTION.y;
    const geometry = new THREE.PlaneGeometry(shaft.width, length);
    const glow = new Float32Array(geometry.attributes.position.count * 2);
    for (let i = 0; i < glow.length; i += 2) { glow[i] = shaft.strength; glow[i + 1] = shaft.phase; }
    geometry.setAttribute("aGlow", new THREE.BufferAttribute(glow, 2));
    const ray = new THREE.Mesh(geometry, rayMaterial);
    ray.position.set(shaft.x, 0, shaft.z).addScaledVector(SUN_DIRECTION, length * 0.5);
    ray.frustumCulled = false;
    scene.add(ray);
    return ray;
  });
  const right = new THREE.Vector3(), normal = new THREE.Vector3(), basis = new THREE.Matrix4();
  return {
    update(camera) {
      for (const ray of rays) {
        normal.subVectors(camera.position, ray.position);
        normal.addScaledVector(SUN_DIRECTION, -normal.dot(SUN_DIRECTION)).normalize();
        if (normal.lengthSq() < 0.001) normal.set(0, 0, 1);
        right.crossVectors(SUN_DIRECTION, normal).normalize();
        normal.crossVectors(right, SUN_DIRECTION).normalize();
        basis.makeBasis(right, SUN_DIRECTION, normal);
        ray.quaternion.setFromRotationMatrix(basis);
      }
    },
  };
}
