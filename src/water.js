import * as THREE from "three";

export const SUN_DIRECTION = new THREE.Vector3(-18, 36, 11).normalize();
export const LIGHT_SHAFTS = Object.freeze([
  { x: -16, z: 3, width: 5.6, height: 37, strength: 0.058, phase: 0.7 },
  { x: 11, z: -7, width: 7.8, height: 41, strength: 0.047, phase: 2.6 },
  { x: -21, z: -15, width: 3.1, height: 34, strength: 0.033, phase: 4.2 },
  { x: 24, z: 12, width: 2.2, height: 39, strength: 0.025, phase: 1.9 },
]);

const deepWater = new THREE.Color().setRGB(0.009, 0.042, 0.08);
const shallowWater = new THREE.Color().setRGB(0.052, 0.275, 0.37);
const poolFunctions = LIGHT_SHAFTS.map(shaft => {
  const radius = (shaft.width * 1.4).toFixed(3);
  return `pool = max(pool, exp(-dot(q - vec2(${shaft.x.toFixed(1)}, ${shaft.z.toFixed(1)}), q - vec2(${shaft.x.toFixed(1)}, ${shaft.z.toFixed(1)})) / ${radius} / ${radius}));`;
}).join("\n");

export const waterShader = `
  uniform float uOceanTime;
  uniform vec3 uOceanSun;
  uniform vec3 uDeepWater;
  uniform vec3 uShallowWater;
  float oceanLightPool(vec3 p) {
    vec2 q = p.xz - uOceanSun.xz / uOceanSun.y * p.y;
    float pool = 0.0;
    ${poolFunctions}
    return pool;
  }
  vec3 oceanWaterColor(vec3 ray, float cameraHeight) {
    float height = clamp(0.37 + ray.y * 0.9 + (cameraHeight - 12.0) * 0.003, 0.0, 1.0);
    vec3 water = mix(uDeepWater, uShallowWater, height);
    float surfaceLight = pow(max(dot(ray, uOceanSun), 0.0), 8.0);
    return water + vec3(0.028, 0.05, 0.043) * surfaceLight;
  }
`;

export function waterUniforms(time) {
  return {
    uOceanTime: time,
    uOceanSun: { value: SUN_DIRECTION },
    uDeepWater: { value: deepWater },
    uShallowWater: { value: shallowWater },
  };
}

export function withWater(material, time) {
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.fog = false;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    Object.assign(shader.uniforms, waterUniforms(time));
    shader.vertexShader = `uniform float uOceanTime;\nvarying vec3 vOceanPosition;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", `
      #include <worldpos_vertex>
      vec4 oceanPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        oceanPosition = instanceMatrix * oceanPosition;
      #endif
      vOceanPosition = (modelMatrix * oceanPosition).xyz;
    `);
    shader.fragmentShader = `varying vec3 vOceanPosition;\n${waterShader}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
      float oceanDepth = smoothstep(-1.0, 28.0, vOceanPosition.y);
      outgoingLight *= mix(0.72, 1.08, oceanDepth) * (0.83 + oceanLightPool(vOceanPosition) * 0.23);
      vec3 oceanRay = vOceanPosition - cameraPosition;
      float opticalDistance = max(length(oceanRay) - 16.0, 0.0) * 0.025;
      float waterFade = 1.0 - exp(-opticalDistance * opticalDistance);
      outgoingLight = mix(outgoingLight, oceanWaterColor(normalize(oceanRay), cameraPosition.y), waterFade);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${cacheKey}-water-v1`;
  return material;
}

export function createWater(scene, renderer, time) {
  const width = 256, height = 128;
  const pixels = new Float32Array(width * height * 4);
  const direction = new THREE.Vector3();
  for (let y = 0; y < height; y++) {
    const latitude = (y / (height - 1) - 0.5) * Math.PI;
    for (let x = 0; x < width; x++) {
      const longitude = (x / width - 0.5) * Math.PI * 2;
      direction.set(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude));
      const upper = THREE.MathUtils.smoothstep(direction.y, -0.15, 0.9);
      // A broad surface window, rather than a tiny hotspot, makes silver flanks catch the light.
      const window = Math.exp(-(((direction.y - 0.62) / 0.3) ** 2)) * (0.62 + 0.38 * Math.max(0, direction.dot(SUN_DIRECTION)));
      const sun = Math.max(0, direction.dot(SUN_DIRECTION)) ** 18;
      const k = (y * width + x) * 4;
      pixels[k] = 0.018 + upper * 0.27 + window * 1.55 + sun * 1.4;
      pixels[k + 1] = 0.052 + upper * 0.42 + window * 1.72 + sun * 1.25;
      pixels[k + 2] = 0.078 + upper * 0.48 + window * 1.73 + sun * 0.95;
      pixels[k + 3] = 1;
    }
  }
  const source = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.LinearSRGBColorSpace;
  source.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(renderer);
  const reflection = generator.fromEquirectangular(source);
  source.dispose();
  generator.dispose();
  scene.environment = reflection.texture;
  scene.environmentIntensity = 0.58;

  const dome = new THREE.Mesh(new THREE.SphereGeometry(145, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: waterUniforms(time),
    vertexShader: `
      varying vec3 vWaterRay;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWaterRay = world.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      varying vec3 vWaterRay;
      ${waterShader}
      void main() {
        gl_FragColor = vec4(oceanWaterColor(normalize(vWaterRay), cameraPosition.y), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  dome.position.y = 12;
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);
  return reflection;
}
