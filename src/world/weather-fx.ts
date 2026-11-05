// Sky and weather over the office: a gradient dome with drifting clouds and stars, rain falling
// outside the building, and the warm spill of the lit rooms on the lawn after dark.
//
// Everything here is one draw call each and animated from a single uniform, so a storm at night
// costs three extra calls and no per-frame CPU work beyond a few number assignments.
import * as THREE from 'three';
import { OFFICE_D, OFFICE_W } from '../../shared/map';
import { daylight, goldenHour, rainLevel, type Weather } from '../../shared/weather';
import type { GfxQuality } from './engine';
import { IS_TOUCH } from '../ui/touch-detect';

/** Middle of the building footprint, in drawn coordinates (every floor sits on top of this one). */
const CX = OFFICE_W / 2;
const CZ = OFFICE_D / 2;
/** How tall the rain column is — floor 6 is about 20 m up, so this covers every storey. */
const FALL_H = 28;
const RAIN_COUNT: Record<GfxQuality, number> = IS_TOUCH ? { high: 1100, low: 700, eco: 0 } : { high: 2600, low: 1200, eco: 0 };
const RAIN_DAY = new THREE.Color('#7e94a8');
const RAIN_NIGHT = new THREE.Color('#c3d6e6');

// ------------------------------------------------------------------ sky texture
/** Value noise that tiles along x, so the cloud layer can drift round the dome forever. */
function tileNoise(w: number, h: number, cells: number, rnd: () => number): Float32Array {
  const gw = cells;
  const gh = Math.max(2, Math.round((cells * h) / w));
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(w * h);
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * gh;
    const y0 = Math.floor(gy);
    const fy = fade(gy - y0);
    const ya = Math.min(gh - 1, y0);
    const yb = Math.min(gh - 1, y0 + 1);
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * gw;
      const x0 = Math.floor(gx);
      const fx = fade(gx - x0);
      const xa = x0 % gw;
      const xb = (x0 + 1) % gw;
      const top = grid[ya * gw + xa] * (1 - fx) + grid[ya * gw + xb] * fx;
      const bot = grid[yb * gw + xa] * (1 - fx) + grid[yb * gw + xb] * fx;
      out[y * w + x] = top * (1 - fy) + bot * fy;
    }
  }
  return out;
}

/** R = cloud shape (4 octaves of tiling noise), G = stars. Built once, ~3 ms. */
function skyTexture(): THREE.DataTexture {
  const W = 512;
  const H = 256;
  let seed = 0x9e3779b9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cloud = new Float32Array(W * H);
  let amp = 0.55;
  let total = 0;
  for (const cells of [4, 8, 17, 35]) {
    const layer = tileNoise(W, H, cells, rnd);
    for (let i = 0; i < cloud.length; i++) cloud[i] += layer[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = Math.min(255, (cloud[i] / total) * 255);
    // stars: a sparse scatter of bright pixels, denser high up (towards v = 1)
    const v = Math.floor(i / W) / H;
    data[i * 4 + 1] = rnd() < 0.0016 * (0.3 + v) ? 180 + rnd() * 75 : 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const SKY_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vDir;
  void main() {
    vUv = uv;
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uCloudCol;
  uniform vec3 uSunCol;
  uniform vec3 uSunDir;
  uniform float uCloud;
  uniform float uStars;
  uniform float uSun;
  uniform float uDrift;
  uniform sampler2D uTex;
  varying vec2 vUv;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.62));
    if (uStars > 0.001) {
      float st = texture2D(uTex, vUv * vec2(3.0, 1.0)).g;
      col += uStars * st * (0.25 + 0.75 * h);
    }
    if (uSun > 0.001) {
      float d = max(dot(normalize(vDir), uSunDir), 0.0);
      col += uSunCol * uSun * (pow(d, 220.0) * 1.6 + pow(d, 7.0) * 0.14);
    }
    if (uCloud > 0.004) {
      float c = texture2D(uTex, vUv * vec2(2.0, 1.0) + vec2(uDrift, 0.0)).r;
      // more cover = the threshold drops, so the same noise field grows into a solid deck
      float m = smoothstep(0.74 - uCloud * 0.52, 0.95 - uCloud * 0.42, c);
      col = mix(col, uCloudCol, m * min(1.0, uCloud * 1.15) * smoothstep(0.0, 0.1, h));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// ------------------------------------------------------------------ rain
const RAIN_VERT = /* glsl */ `
  attribute float aTip;
  attribute float aSpeed;
  uniform float uTime;
  uniform float uLen;
  uniform float uSlant;
  varying float vFade;
  void main() {
    vec3 p = position;
    p.y = ${FALL_H.toFixed(1)} - mod(position.y + uTime * aSpeed, ${FALL_H.toFixed(1)});
    p.y -= aTip * uLen;
    p.x += aTip * uSlant;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // fade both ends of the column: the far edge so it does not stop in mid-air, and anything
    // right on top of the camera so no drop smears across the view
    float d = -mv.z;
    vFade = smoothstep(1.0, 4.0, d) * (1.0 - smoothstep(34.0, 76.0, d));
    gl_Position = projectionMatrix * mv;
  }
`;

const RAIN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * vFade);
  }
`;

// ------------------------------------------------------------------ light spilling out at night
const SPILL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vPos;
  void main() {
    // distance from the outside of the building footprint, in metres
    vec2 q = abs(vPos) - vec2(${CX.toFixed(1)}, ${CZ.toFixed(1)});
    float d = length(max(q, 0.0));
    float a = exp(-d / 6.5) * step(0.05, d);
    gl_FragColor = vec4(uColor, a * uStrength);
  }
`;

const SPILL_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Everything the look of a moment depends on: the sky itself plus how the office is lit. */
export interface SkyLook {
  horizon: THREE.Color;
  zenith: THREE.Color;
  cloudCol: THREE.Color;
  sunCol: THREE.Color;
  /** Where the sun (or moon) sits, as a direction. */
  sunDir: THREE.Vector3;
  cloud: number;
  stars: number;
  sun: number;
  /** Rain, 0 (dry) .. 1 (downpour). */
  rain: number;
  /** Warm glow out of the windows onto the lawn, 0..1. */
  spill: number;
  /** 0 = daylight, 1 = fully dark outside. */
  night: number;
  // --- lighting (applied by the engine)
  exposure: number;
  hemiI: number;
  keyI: number;
  winI: number;
  env: number;
  hemiCol: THREE.Color;
  keyCol: THREE.Color;
  winCol: THREE.Color;
  fog: THREE.Color;
  /** Where to hang the key light, as an offset from straight overhead. */
  keyX: number;
  keyZ: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const col = (hex: string) => new THREE.Color(hex);

export function blankLook(): SkyLook {
  return {
    horizon: col('#e8eef3'),
    zenith: col('#9dc4e8'),
    cloudCol: col('#ffffff'),
    sunCol: col('#fff3d0'),
    sunDir: new THREE.Vector3(0, 1, 0),
    cloud: 0.3,
    stars: 0,
    sun: 1,
    rain: 0,
    spill: 0,
    night: 0,
    exposure: 0.95,
    hemiI: 0.6,
    keyI: 1.7,
    winI: 0.6,
    env: 0.35,
    hemiCol: col('#f4f7ff'),
    keyCol: col('#fff6ea'),
    winCol: col('#dbe8ff'),
    fog: col('#e8eef3'),
    keyX: -5,
    keyZ: -4,
  };
}

/**
 * The whole look of the office for a given moment in Hanoi. Pure maths — the engine eases from one
 * of these to the next over a few seconds and hands it to the renderer.
 */
export function computeSky(w: Weather, hour: number, out = blankLook()): SkyLook {
  const day = daylight(hour, w.sunrise, w.sunset);
  const night = 1 - day;
  const cloud = clamp01(w.cloud);
  const wet = rainLevel(w);
  // low sun only shows through a reasonably clear sky
  const golden = goldenHour(hour, w.sunrise, w.sunset) * (1 - 0.75 * cloud) * day;
  const grey = clamp01(Math.max(cloud, wet * 0.8 + 0.2));

  // --- where the sun (or the moon, after dark) sits
  const dayLen = Math.max(1, w.sunset - w.sunrise);
  const inDay = hour >= w.sunrise && hour <= w.sunset;
  const t = inDay ? (hour - w.sunrise) / dayLen : ((hour < w.sunrise ? hour + 24 : hour) - w.sunset) / Math.max(1, 24 - dayLen);
  const ang = Math.PI * clamp01(t);
  // rises in the east (+x), sets in the west, and tracks round the south (+z) as it does in Hanoi
  out.sunDir.set(Math.cos(ang), Math.max(0.02, Math.sin(ang)), 0.38).normalize();
  out.sun = inDay ? day * (1 - cloud * 0.88) : night * 0.5 * (1 - cloud * 0.9);
  out.sunCol.copy(col('#fff6d2')).lerp(col('#ffb870'), golden);
  if (!inDay) out.sunCol.copy(col('#e3ecff'));

  // --- the sky itself
  out.zenith.copy(col('#4e93da')).lerp(col('#a9b6c4'), grey).lerp(col('#070c18'), night);
  out.horizon
    .copy(col('#dceaf4'))
    .lerp(col('#c3cad2'), grey)
    .lerp(col('#f7c89a'), golden * 0.65)
    .lerp(col('#121a2d'), night);
  out.cloudCol.copy(col('#ffffff')).lerp(col('#7e8894'), wet * 0.75).lerp(col('#f3b98c'), golden * 0.5).lerp(col('#1b2338'), night);
  out.cloud = grey;
  out.stars = night * (1 - cloud * 0.92) * 0.9;
  out.rain = wet;
  out.spill = night * (0.42 + 0.18 * wet);
  out.night = night;

  // --- the office lights. After dark the key light stops being the sun and becomes the ceiling:
  // the rooms stay lit and warm while everything outside falls away.
  out.exposure = 0.83 + 0.14 * day - 0.05 * cloud * day - 0.05 * wet;
  // the ceiling lights stay on all night: people are here to work, so the rooms read clearly
  out.keyI = 1.45 + 0.5 * day * (1 - 0.55 * cloud) - 0.18 * wet;
  // the sky, on the other hand, gives almost nothing after dark — that is what empties the lawn
  out.hemiI = 0.07 + 0.57 * day * (1 - 0.28 * cloud) - 0.1 * wet * day;
  out.winI = 0.04 + 0.62 * day * (1 - 0.45 * cloud) - 0.12 * wet;
  out.env = 0.1 + 0.27 * day * (1 - 0.3 * cloud);
  out.hemiCol.copy(col('#f4f7ff')).lerp(col('#cfd6de'), grey * 0.7).lerp(col('#39466b'), night);
  out.keyCol.copy(col('#fff6ea')).lerp(col('#eef3f8'), wet * 0.6).lerp(col('#ffd9a8'), golden).lerp(col('#ffe6c2'), night);
  out.winCol.copy(col('#dbe8ff')).lerp(col('#ffc898'), golden).lerp(col('#4a5a8c'), night);
  out.fog.copy(out.horizon);
  out.keyX = -5 + Math.cos(ang) * 9 * day;
  out.keyZ = -4 + 5 * day;
  return out;
}

/** Ease one look towards another, in place. */
export function lerpLook(cur: SkyLook, to: SkyLook, k: number) {
  cur.horizon.lerp(to.horizon, k);
  cur.zenith.lerp(to.zenith, k);
  cur.cloudCol.lerp(to.cloudCol, k);
  cur.sunCol.lerp(to.sunCol, k);
  cur.sunDir.lerp(to.sunDir, k).normalize();
  cur.hemiCol.lerp(to.hemiCol, k);
  cur.keyCol.lerp(to.keyCol, k);
  cur.winCol.lerp(to.winCol, k);
  cur.fog.lerp(to.fog, k);
  for (const f of ['cloud', 'stars', 'sun', 'rain', 'spill', 'night', 'exposure', 'hemiI', 'keyI', 'winI', 'env', 'keyX', 'keyZ'] as const) {
    cur[f] += (to[f] - cur[f]) * k;
  }
}

export class WeatherFx {
  private dome: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private rain: THREE.LineSegments | null = null;
  private rainMat: THREE.ShaderMaterial | null = null;
  private spill: THREE.Mesh;
  private spillMat: THREE.ShaderMaterial;
  private tex: THREE.DataTexture;
  private quality: GfxQuality = 'high';
  private drift = 0;
  private wet = 0;

  constructor(private scene: THREE.Scene) {
    this.tex = skyTexture();
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      // drawn after the opaque pass with depth testing on: indoors almost every pixel of it fails
      // the test, so the sky costs nothing while you are at your desk
      depthWrite: false,
      depthTest: true,
      fog: false,
      uniforms: {
        uHorizon: { value: new THREE.Color('#e8eef3') },
        uZenith: { value: new THREE.Color('#9dc4e8') },
        uCloudCol: { value: new THREE.Color('#ffffff') },
        uSunCol: { value: new THREE.Color('#fff3d0') },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uCloud: { value: 0.3 },
        uStars: { value: 0 },
        uSun: { value: 1 },
        uDrift: { value: 0 },
        uTex: { value: this.tex },
      },
    });
    // 290 m keeps it inside the camera's 320 m far plane
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(290, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.54), this.skyMat);
    this.dome.renderOrder = 1; // after everything else, so hidden sky is never shaded
    this.dome.frustumCulled = false;
    this.dome.position.set(CX, 0, CZ);
    scene.add(this.dome);

    this.spillMat = new THREE.ShaderMaterial({
      vertexShader: SPILL_VERT,
      fragmentShader: SPILL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uColor: { value: new THREE.Color('#ffd49a') }, uStrength: { value: 0 } },
    });
    this.spill = new THREE.Mesh(new THREE.PlaneGeometry(2 * (CX + 26), 2 * (CZ + 26)), this.spillMat);
    this.spill.rotation.x = -Math.PI / 2;
    this.spill.position.set(CX, 0.035, CZ);
    this.spill.visible = false;
    scene.add(this.spill);
  }

  setQuality(q: GfxQuality) {
    // "Tiết kiệm pin" drops the dome and the rain: the sky is then the flat background colour,
    // which still follows the hour and the weather, just without clouds, stars or drops
    this.dome.visible = q !== 'eco';
    if (q === this.quality && (this.rain || RAIN_COUNT[q] === 0)) return;
    this.quality = q;
    this.buildRain();
  }

  /** The rain column: one LineSegments, with every drop outside the building. */
  private buildRain() {
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose();
      this.rain = null;
      this.rainMat = null;
    }
    const n = RAIN_COUNT[this.quality];
    if (!n) return;
    const pos = new Float32Array(n * 6);
    const tip = new Float32Array(n * 2);
    const speed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      let x = 0;
      let z = 0;
      // rejection sampling: drops ring the building, never inside it (you watch the rain through
      // the windows, and nothing falls through the ceiling onto your desk)
      for (let tries = 0; tries < 24; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = 7 + Math.sqrt(Math.random()) * 55;
        x = CX + Math.cos(a) * r;
        z = CZ + Math.sin(a) * r;
        if (x < -1.5 || x > OFFICE_W + 1.5 || z < -1.5 || z > OFFICE_D + 1.5) break;
      }
      const y = Math.random() * FALL_H;
      const v = 14 + Math.random() * 10;
      for (const k of [0, 1]) {
        pos[i * 6 + k * 3] = x;
        pos[i * 6 + k * 3 + 1] = y;
        pos[i * 6 + k * 3 + 2] = z;
        tip[i * 2 + k] = k;
        speed[i * 2 + k] = v;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uLen: { value: 0.55 },
        uSlant: { value: 0.12 },
        uColor: { value: new THREE.Color('#d6e6f2') },
        uOpacity: { value: 0 },
      },
    });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  /** Set the look of the sky. Called about once a minute, and eased into over a few seconds. */
  apply(look: SkyLook) {
    const u = this.skyMat.uniforms;
    (u.uHorizon.value as THREE.Color).copy(look.horizon);
    (u.uZenith.value as THREE.Color).copy(look.zenith);
    (u.uCloudCol.value as THREE.Color).copy(look.cloudCol);
    (u.uSunCol.value as THREE.Color).copy(look.sunCol);
    (u.uSunDir.value as THREE.Vector3).copy(look.sunDir);
    u.uCloud.value = look.cloud;
    u.uStars.value = look.stars;
    u.uSun.value = look.sun;
    this.wet = look.rain;
    if (this.rainMat) {
      const u = this.rainMat.uniforms;
      u.uOpacity.value = 0.22 + 0.33 * look.rain;
      u.uLen.value = 0.8 + 1.3 * look.rain;
      u.uSlant.value = 0.1 + 0.3 * look.rain;
      // grey-blue by day so it reads against a bright overcast sky; paler once it is dark out
      (u.uColor.value as THREE.Color).copy(RAIN_DAY).lerp(RAIN_NIGHT, look.night);
    }
    if (this.rain) this.rain.visible = look.rain > 0.02;
    this.spillMat.uniforms.uStrength.value = look.spill;
    this.spill.visible = look.spill > 0.01;
  }

  /** Keep the dome on the camera so it never clips, and move the clouds and the rain along. */
  update(dt: number, camera: THREE.Camera) {
    this.dome.position.copy(camera.position); // the horizon always sits at eye level
    this.drift += dt * 0.0022;
    this.skyMat.uniforms.uDrift.value = this.drift;
    // the column is a fixed ring 60 m across the building, which the player can never leave, so it
    // never has to follow the camera (moving it would slide drops indoors)
    if (this.rain?.visible && this.rainMat) this.rainMat.uniforms.uTime.value += dt * (0.7 + 0.6 * this.wet);
  }

  dispose() {
    this.scene.remove(this.dome, this.spill);
    this.dome.geometry.dispose();
    this.spill.geometry.dispose();
    this.skyMat.dispose();
    this.spillMat.dispose();
    this.tex.dispose();
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose();
      this.rainMat?.dispose();
    }
  }
}
