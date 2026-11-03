// "Dresses" a base body (the free Quaternius bodies come in underwear) with a shader:
// each vertex gets how much it belongs to the torso / legs / feet / forearms from its skin weights,
// and the fragment shader paints shirt, trousers and shoes there with crisp, smooth edges.
// Cloth areas are also pushed out a few millimetres and lose the muscle normal-map detail
// so they read as fabric rather than body paint.
import * as THREE from 'three';

const TOP = /^(spine_0[123]|clavicle_[lr]|upperarm_[lr])$|(Spine[12]?|Shoulder|LeftArm|RightArm)$/i;
const BOTTOM = /^(pelvis|thigh_[lr]|calf_[lr])$|(Hips|UpLeg|Leg)$/i;
const SHOES = /^(foot_[lr]|ball_[lr]|ball_leaf_[lr])$|(Foot|ToeBase|Toe_End)$/i;
const FOREARM = /^lowerarm_[lr]$|ForeArm$/i;

/** Adds a vec4 `clothW` attribute (top, bottom, shoes, forearm) to a skinned body geometry, once. */
export function addClothWeights(mesh: THREE.SkinnedMesh): void {
  const geo = mesh.geometry;
  if (geo.getAttribute('clothW')) return;
  const cat = mesh.skeleton.bones.map((b) => (TOP.test(b.name) ? 0 : BOTTOM.test(b.name) ? 1 : SHOES.test(b.name) ? 2 : FOREARM.test(b.name) ? 3 : -1));
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const out = new Float32Array(si.count * 4);
  const idx = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (let v = 0; v < si.count; v++) {
    idx[0] = si.getX(v);
    idx[1] = si.getY(v);
    idx[2] = si.getZ(v);
    idx[3] = si.getW(v);
    w[0] = sw.getX(v);
    w[1] = sw.getY(v);
    w[2] = sw.getZ(v);
    w[3] = sw.getW(v);
    const sum = w[0] + w[1] + w[2] + w[3] || 1;
    for (let k = 0; k < 4; k++) {
      const c = cat[idx[k]];
      if (c >= 0) out[v * 4 + c] += w[k] / sum;
    }
  }
  geo.setAttribute('clothW', new THREE.BufferAttribute(out, 4));
}

export interface ClothUniforms {
  uTop: { value: THREE.Color };
  uBottom: { value: THREE.Color };
  uShoes: { value: THREE.Color };
  uLongSleeve: { value: number };
  uInflate: { value: number };
  /** 1 = two-piece swimsuit (bands at chest and hips, in the top / bottom colours) instead of clothes. */
  uSwim: { value: number };
}

export function makeClothUniforms(): ClothUniforms {
  return {
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uShoes: { value: new THREE.Color() },
    uLongSleeve: { value: 0 },
    uInflate: { value: 0.011 },
    uSwim: { value: 0 },
  };
}

/** Patch a (per-avatar) MeshStandardMaterial so it draws clothes over the skin texture. */
export function applyClothShader(material: THREE.MeshStandardMaterial, u: ClothUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 clothW;
uniform float uLongSleeve;
uniform float uInflate;
uniform float uSwim;
varying vec4 vClothW;
varying float vBindY;
varying float vBindX;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vClothW = clothW;
#ifdef USE_SKINNING
vec4 bindPos = bindMatrix * vec4(position, 1.0);
#else
vec4 bindPos = vec4(position, 1.0);
#endif
vBindY = bindPos.y;
vBindX = bindPos.x;
float infTop = smoothstep(0.35, 0.6, clothW.x + clothW.w * uLongSleeve);
float infBottom = smoothstep(0.35, 0.6, clothW.y);
float infShoes = smoothstep(0.3, 0.6, clothW.z);
// fabric thickness: shirt a bit looser than trousers, shoes chunky
transformed += normalize(normal) * uInflate * max(max(infTop * 1.0, infBottom * 0.75) * (1.0 - uSwim), infShoes * 2.4);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uShoes;
uniform float uLongSleeve;
uniform float uSwim;
varying vec4 vClothW;
varying float vBindY;
varying float vBindX;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float clothTop = smoothstep(0.40, 0.50, vClothW.x + vClothW.w * uLongSleeve);
float clothShoes = smoothstep(0.42, 0.52, vClothW.z);
float clothBottom = smoothstep(0.45, 0.55, vClothW.y) * (1.0 - clothTop) * (1.0 - clothShoes);
clothTop *= (1.0 - clothShoes);
if (uSwim > 0.5) {
  // UBC bodies in bind space: feet at -1, head at +1; bust ~0.44..0.60, hips ~0..0.13
  float torso = smoothstep(0.3, 0.5, vClothW.x) * (1.0 - smoothstep(0.16, 0.19, abs(vBindX)));
  clothTop = torso * smoothstep(0.425, 0.44, vBindY) * (1.0 - smoothstep(0.59, 0.605, vBindY));
  float legLine = -0.035 + 0.6 * abs(vBindX); // leg openings rise toward the hips
  float hipBand = smoothstep(legLine - 0.008, legLine + 0.008, vBindY) * (1.0 - smoothstep(0.17, 0.185, vBindY));
  clothBottom = max(smoothstep(0.3, 0.5, vClothW.y), smoothstep(0.3, 0.5, vClothW.x) * step(vBindY, 0.19)) * hipBand * (1.0 - clothShoes);
}
float clothAmt = clamp(clothTop + clothBottom + clothShoes, 0.0, 1.0);
// stitched bands where garments end: collar / hem / cuffs on the shirt, waistband + hems on trousers
float topW = vClothW.x + vClothW.w * uLongSleeve;
float hemTop = 1.0 - smoothstep(0.52, 0.64, topW);
float waist = smoothstep(0.35, 0.5, vClothW.x) * smoothstep(0.45, 0.6, vClothW.y);
float hemBottom = 1.0 - smoothstep(0.55, 0.68, vClothW.y + vClothW.z);
vec3 topCol = uTop * (1.0 - 0.16 * hemTop * (1.0 - uSwim));
vec3 bottomCol = uBottom * (1.0 - 0.28 * waist * (1.0 - uSwim)) * (1.0 - 0.12 * hemBottom * (1.0 - uSwim));
float sole = 1.0 - smoothstep(0.022, 0.034, vBindY); // sneaker sole
vec3 shoeCol = mix(uShoes, vec3(0.93, 0.92, 0.9), sole);
vec3 clothCol = (topCol * clothTop + bottomCol * clothBottom + shoeCol * clothShoes) / max(clothAmt, 1e-4);
diffuseColor.rgb = mix(diffuseColor.rgb, clothCol, clothAmt);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, mix(0.9, 0.55, clothShoes), clothAmt);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 clothGeomNormal = normal;
#include <normal_fragment_maps>
normal = normalize(mix(normal, clothGeomNormal, clothAmt));`,
      );
  };
  material.customProgramCacheKey = () => 'bss-cloth-v1';
  material.needsUpdate = true;
}

const avgCache = new WeakMap<THREE.Texture, THREE.Color>();

/** Average colour (linear) of a texture's reasonably bright pixels — the reference for tinting. */
export function textureAverage(tex: THREE.Texture | null | undefined, fallback = '#a87250'): THREE.Color {
  if (!tex?.image) return new THREE.Color(fallback);
  const hit = avgCache.get(tex);
  if (hit) return hit;
  const c = new THREE.Color(fallback);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 48;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(tex.image as CanvasImageSource, 0, 0, 48, 48);
    const d = g.getImageData(0, 0, 48, 48).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] < 180) continue; // skip dark underwear / shadows
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
      n++;
    }
    if (n) c.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    /* tainted canvas etc. — keep fallback */
  }
  avgCache.set(tex, c);
  return c;
}

/** material.color so that texture × color ≈ `target` on average while keeping the texture's detail. */
export function tintColor(target: string, ref: THREE.Color): THREE.Color {
  const t = new THREE.Color(target);
  return new THREE.Color(t.r / Math.max(ref.r, 0.02), t.g / Math.max(ref.g, 0.02), t.b / Math.max(ref.b, 0.02));
}
