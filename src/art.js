import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OBSTACLES, seededRandom } from "./simulation.js";

function finishPart(geometry, color) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  result.deleteAttribute("uv");
  const colors = new Float32Array(result.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b;
  }
  result.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return result;
}

function fin(points, color) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.computeVertexNormals();
  return finishPart(geometry, color);
}

export function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 16, 10);
  const positions = body.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const taper = 0.65 + (x + 1) * 0.175;
    positions.setXYZ(i, x * 0.53 + 0.1, positions.getY(i) * 0.225 * taper, positions.getZ(i) * 0.155 * taper);
  }
  body.computeVertexNormals();
  const bodyPart = finishPart(body, new THREE.Color("#d6e9ee"));
  const colors = bodyPart.attributes.color;
  const bp = bodyPart.attributes.position;
  const shade = new THREE.Color();
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i), z = bp.getZ(i);
    shade.set(y > 0.07 ? "#406f90" : y < -0.05 ? "#e0f1e9" : "#a9cdd3");
    if (Math.abs(y) < 0.034 && Math.abs(z) > 0.09) shade.set("#ecf4dd");
    colors.setXYZ(i, shade.r, shade.g, shade.b);
  }
  const blue = new THREE.Color("#729fba");
  const pale = new THREE.Color("#a4c1c6");
  const parts = [bodyPart,
    fin([[-0.43, 0.035, 0], [-0.9, 0.28, 0], [-0.76, 0, 0],
      [-0.43, -0.035, 0], [-0.76, 0, 0], [-0.9, -0.28, 0]], blue),
    fin([[0.17, 0.17, 0], [-0.11, 0.37, 0], [-0.33, 0.115, 0]], blue),
    fin([[0.08, -0.13, 0.09], [-0.24, -0.22, 0.3], [-0.12, -0.07, 0.1]], pale),
    fin([[0.08, -0.13, -0.09], [-0.12, -0.07, -0.1], [-0.24, -0.22, -0.3]], pale),
    fin([[-0.17, -0.13, 0], [-0.35, -0.27, 0], [-0.4, -0.06, 0]], blue),
  ];
  for (const sign of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.039, 8, 6);
    eye.scale(1, 1, 0.55);
    eye.translate(0.43, 0.064, sign * 0.113);
    parts.push(finishPart(eye, new THREE.Color("#102934")));
    const glint = new THREE.SphereGeometry(0.012, 5, 4);
    glint.translate(0.442, 0.076, sign * 0.135);
    parts.push(finishPart(glint, new THREE.Color("#edffff")));
  }
  const merged = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return merged;
}

export function fishMaterial(time) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.34, metalness: 0.42, side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.vertexShader = "attribute vec2 iSwim;\nuniform float uTime;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      float tail = smoothstep(0.1, 0.88, -position.x);
      float wave = sin(uTime * iSwim.y + iSwim.x + position.x * 3.8);
      transformed.z += wave * tail * tail * 0.19;
      transformed.y += sin(uTime * iSwim.y * 0.5 + iSwim.x) * tail * 0.015;
    `);
  };
  material.customProgramCacheKey = () => "pelagic-fish-v1";
  return material;
}

function causticMaterial(color, time, options = {}) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.94, ...options });
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.vertexShader = "varying vec3 vOceanPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", `
      #include <worldpos_vertex>
      vec4 oceanPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        oceanPosition = instanceMatrix * oceanPosition;
      #endif
      vOceanPosition = (modelMatrix * oceanPosition).xyz;
    `);
    shader.fragmentShader = "uniform float uTime;\nvarying vec3 vOceanPosition;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>", `
      vec2 c = vOceanPosition.xz * 1.25;
      float a = sin(c.x + sin(c.y * 1.3 + uTime * 0.24)) * sin(c.y - sin(c.x * 1.1 - uTime * 0.2));
      float b = sin(c.x * 0.8 - c.y * 0.65 + uTime * 0.17);
      float lines = pow(1.0 - abs(a * 0.8 + b * 0.2), 22.0);
      gl_FragColor.rgb += vec3(0.045, 0.09, 0.065) * lines * exp(-max(vOceanPosition.y, 0.0) * 0.1);
      #include <dithering_fragment>
    `);
  };
  material.customProgramCacheKey = () => "pelagic-caustics-v1";
  return material;
}

export function createOcean(scene, time) {
  const random = seededRandom(1907);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const seabed = new THREE.PlaneGeometry(125, 110, 65, 60);
  seabed.rotateX(-Math.PI / 2);
  const position = seabed.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    position.setY(i, -1.3 + Math.sin(x * 0.13) * 0.42 + Math.cos(z * 0.16) * 0.35 + Math.sin(x * 0.7 + z * 0.3) * 0.07);
  }
  seabed.computeVertexNormals();
  scene.add(new THREE.Mesh(seabed, causticMaterial("#507c76", time)));

  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), causticMaterial("#427978", time), 75);
  const rockVertices = rocks.geometry.attributes.position;
  for (let i = 0; i < rockVertices.count; i++) {
    const x = rockVertices.getX(i), y = rockVertices.getY(i), z = rockVertices.getZ(i);
    const factor = 1 + Math.sin(x * 7 + z * 4) * Math.cos(y * 6 - z * 3) * 0.085;
    rockVertices.setXYZ(i, x * factor, y * factor, z * factor);
  }
  rocks.geometry.computeVertexNormals();
  for (let i = 0; i < rocks.count; i++) {
    const obstacle = OBSTACLES[i];
    const size = obstacle ? obstacle.radius * 0.81 : 0.35 + random() * 1.3;
    dummy.position.set(obstacle?.x ?? (random() - 0.5) * 91, -0.7, obstacle?.z ?? (random() - 0.5) * 73);
    dummy.scale.set(size, size * (0.7 + random() * 0.25), size * 0.9);
    dummy.rotation.set(random(), random() * 6, random() * 0.3);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rocks.setColorAt(i, color.setHSL(0.45 + random() * 0.05, 0.12, 0.43 + random() * 0.12));
  }
  scene.add(rocks);

  const branches = [];
  const tips = [];
  const coralColors = ["#bc8f8c", "#b6a0bd", "#75b9a5", "#c5a878"];
  const up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), direction = new THREE.Vector3();
  function branch(start, end, thickness, tint) {
    a.set(...start); b.set(...end);
    direction.subVectors(b, a);
    dummy.position.copy(a).add(b).multiplyScalar(0.5);
    dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    dummy.scale.set(thickness, direction.length(), thickness);
    dummy.updateMatrix();
    branches.push({ matrix: dummy.matrix.clone(), tint });
    dummy.position.copy(b);
    dummy.scale.setScalar(thickness * 1.05);
    dummy.quaternion.identity();
    dummy.updateMatrix();
    tips.push({ matrix: dummy.matrix.clone(), tint });
  }
  for (let patch = 0; patch < 24; patch++) {
    const x = (random() - 0.5) * 68, z = (random() - 0.5) * 48;
    const tint = coralColors[patch % coralColors.length];
    for (let stem = 0; stem < 5; stem++) {
      const baseX = x + (random() - 0.5) * 1.9, baseZ = z + (random() - 0.5) * 1.9;
      const height = 0.9 + random() * 1.8;
      const top = [baseX + (random() - 0.5) * 0.5, height - 0.5, baseZ + (random() - 0.5) * 0.5];
      branch([baseX, -1, baseZ], top, 0.08 + height * 0.035, tint);
      for (let arm = 0; arm < 3; arm++) {
        const fraction = 0.35 + arm * 0.18;
        const origin = [baseX, -0.8 + height * fraction, baseZ];
        const angle = random() * Math.PI * 2;
        const end = [baseX + Math.cos(angle) * 0.5, origin[1] + 0.6, baseZ + Math.sin(angle) * 0.5];
        branch(origin, end, 0.065, tint);
        branch(end, [end[0] + Math.cos(angle + 1) * 0.3, end[1] + 0.35, end[2] + Math.sin(angle + 1) * 0.3], 0.045, tint);
      }
    }
  }
  function coralInstances(geometry, instances) {
    const mesh = new THREE.InstancedMesh(geometry, causticMaterial("#ffffff", time), instances.length);
    instances.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, color.set(item.tint));
    });
    scene.add(mesh);
  }
  coralInstances(new THREE.CylinderGeometry(0.7, 1, 1, 5), branches);
  coralInstances(new THREE.SphereGeometry(1, 5, 4), tips);

  const leaves = [];
  for (let patch = 0; patch < 100; patch++) {
    const x = (random() - 0.5) * 85, z = (random() - 0.5) * 65;
    for (let leaf = 0; leaf < 6; leaf++) {
      const height = 0.6 + random() * 2.8, width = 0.07 + random() * 0.09;
      const angle = random() * 6.28;
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const baseX = x + random() * 0.7, baseZ = z + random() * 0.7;
      for (let segment = 0; segment < 5; segment++) {
        const l = segment / 5, h = (segment + 1) / 5;
        const point = (t, side) => [
          baseX + Math.sin(t * 2) * dx * height * 0.22 + side * width * (1 - t) * dz,
          -1 + t * height,
          baseZ + Math.sin(t * 2) * dz * height * 0.22 - side * width * (1 - t) * dx,
        ];
        leaves.push(...point(l, -1), ...point(h, -1), ...point(l, 1), ...point(l, 1), ...point(h, -1), ...point(h, 1));
      }
    }
  }
  const kelpGeometry = new THREE.BufferGeometry();
  kelpGeometry.setAttribute("position", new THREE.Float32BufferAttribute(leaves, 3));
  kelpGeometry.computeVertexNormals();
  const kelpMaterial = new THREE.MeshStandardMaterial({ color: "#286b60", roughness: 0.8, side: THREE.DoubleSide });
  kelpMaterial.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      float sway = max(position.y + 1.0, 0.0);
      transformed.x += sin(uTime * 0.55 + position.z * 0.3) * sway * sway * 0.035;
      transformed.z += cos(uTime * 0.4 + position.x * 0.25) * sway * 0.06;
    `);
  };
  scene.add(new THREE.Mesh(kelpGeometry, kelpMaterial));

  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(1400 * 3), dustSizes = new Float32Array(1400);
  for (let i = 0; i < 1400; i++) {
    dustPositions[i * 3] = (random() - 0.5) * 85;
    dustPositions[i * 3 + 1] = random() * 35;
    dustPositions[i * 3 + 2] = (random() - 0.5) * 70;
    dustSizes[i] = 0.5 + random() * 1.5;
  }
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute("aSize", new THREE.BufferAttribute(dustSizes, 1));
  const dust = new THREE.Points(dustGeometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: time, uPixelRatio: { value: Math.min(devicePixelRatio, 1.75) } },
    vertexShader: `
      uniform float uTime; uniform float uPixelRatio; attribute float aSize; varying float vFade;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.08 + position.z) * 0.65;
        p.y = mod(position.y + uTime * 0.055, 35.0);
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(aSize * uPixelRatio * 34.0 / -view.z, 1.0, 4.0);
        vFade = exp(-length(view.xyz) * 0.025);
      }`,
    fragmentShader: `
      varying float vFade;
      void main() {
        float glow = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(0.64, 0.91, 0.87, glow * vFade * 0.33);
      }`,
  }));
  scene.add(dust);

  const rayMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: time },
    vertexShader: "varying vec2 vUv; void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: `
      varying vec2 vUv; uniform float uTime;
      void main() {
        float beam = pow(max(0.0, sin(vUv.x * 3.14159265)), 2.0);
        float fade = smoothstep(0.0, 0.25, vUv.y) * (0.6 + vUv.y * 0.4);
        gl_FragColor = vec4(0.46, 0.8, 0.72, beam * fade * (0.035 + sin(uTime * 0.19 + vUv.y * 2.0) * 0.006));
      }`,
  });
  for (let i = 0; i < 7; i++) {
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(2 + random() * 3, 42), rayMaterial);
    ray.position.set(-23 + i * 7, 20, -14 - random() * 10);
    ray.rotation.z = -0.28;
    ray.rotation.y = 0.22;
    scene.add(ray);
  }
}
