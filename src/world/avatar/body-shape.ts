// Body build variants (slim / regular / athletic) made from one base mesh: every vertex is pulled
// toward the bone segments it is skinned to, by a per-bone factor. Done once per body + build
// in bind space, so skinning stays exact (no non-uniform bone scaling, no shear).
import * as THREE from 'three';
import type { AvatarConfig } from '../../../shared/avatar';

type Build = AvatarConfig['build'] | 'model';

// 1 = untouched; lower = thinner around that bone.
const FACTORS: Record<Build, [RegExp, number][]> = {
  slim: [
    [/^upperarm_[lr]$/, 0.74],
    [/^lowerarm_[lr]$/, 0.8],
    [/^thigh_[lr]$/, 0.82],
    [/^calf_[lr]$/, 0.86],
    [/^spine_0[23]$/, 0.84],
    [/^spine_01$/, 0.86],
    [/^pelvis$/, 0.9],
    [/^clavicle_[lr]$/, 0.8],
    [/^neck_01$/, 0.86],
  ],
  regular: [
    [/^upperarm_[lr]$/, 0.85],
    [/^lowerarm_[lr]$/, 0.89],
    [/^thigh_[lr]$/, 0.9],
    [/^calf_[lr]$/, 0.93],
    [/^spine_0[23]$/, 0.91],
    [/^spine_01$/, 0.92],
    [/^pelvis$/, 0.95],
    [/^clavicle_[lr]$/, 0.88],
    [/^neck_01$/, 0.92],
  ],
  athletic: [],
  // the base female body is a "superhero": slim it into a model's figure, keeping bust and hips
  model: [
    [/^upperarm_[lr]$/, 0.62],
    [/^lowerarm_[lr]$/, 0.7],
    [/^clavicle_[lr]$/, 0.66],
    [/^neck_01$/, 0.78],
    [/^spine_03$/, 0.9],
    [/^spine_02$/, 0.78],
    [/^spine_01$/, 0.74],
    [/^pelvis$/, 0.97],
    [/^thigh_[lr]$/, 0.84],
    [/^calf_[lr]$/, 0.76],
  ],
};

const CHILD: [RegExp, (name: string) => string][] = [
  [/^upperarm_([lr])$/, (n) => n.replace('upperarm', 'lowerarm')],
  [/^lowerarm_([lr])$/, (n) => n.replace('lowerarm', 'hand')],
  [/^thigh_([lr])$/, (n) => n.replace('thigh', 'calf')],
  [/^calf_([lr])$/, (n) => n.replace('calf', 'foot')],
  [/^clavicle_([lr])$/, (n) => n.replace('clavicle', 'upperarm')],
  [/^pelvis$/, () => 'spine_01'],
  [/^spine_01$/, () => 'spine_02'],
  [/^spine_02$/, () => 'spine_03'],
  [/^spine_03$/, () => 'neck_01'],
  [/^neck_01$/, () => 'Head'],
];

const cache = new Map<string, THREE.BufferGeometry>();

export function shapedGeometry(mesh: THREE.SkinnedMesh, build: Build): THREE.BufferGeometry {
  const base: THREE.BufferGeometry = mesh.userData.baseGeometry ?? mesh.geometry;
  mesh.userData.baseGeometry = base;
  const rules = FACTORS[build] ?? [];
  if (!rules.length) return base;
  const key = `${base.uuid}|${build}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const bones = mesh.skeleton.bones;
  const inv = mesh.skeleton.boneInverses;
  const jointPos = inv.map((m) => new THREE.Vector3().setFromMatrixPosition(m.clone().invert()));
  const index = new Map(bones.map((b, i) => [b.name, i]));
  const segs = bones.map((b, i) => {
    const rule = rules.find(([re]) => re.test(b.name));
    if (!rule) return null;
    const child = CHILD.find(([re]) => re.test(b.name));
    const j = child ? index.get(child[1](b.name)) : undefined;
    if (j === undefined) return null;
    return { a: jointPos[i], b: jointPos[j], k: 1 - rule[1] };
  });

  const pos = base.getAttribute('position');
  const si = base.getAttribute('skinIndex');
  const sw = base.getAttribute('skinWeight');
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  const c = new THREE.Vector3();
  const seg = new THREE.Line3();
  const idx = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.bindMatrix);
    idx[0] = si.getX(i);
    idx[1] = si.getY(i);
    idx[2] = si.getZ(i);
    idx[3] = si.getW(i);
    w[0] = sw.getX(i);
    w[1] = sw.getY(i);
    w[2] = sw.getZ(i);
    w[3] = sw.getW(i);
    d.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const s = segs[idx[k]];
      if (!s || w[k] <= 0) continue;
      seg.set(s.a, s.b).closestPointToPoint(v, true, c);
      d.addScaledVector(c.sub(v), w[k] * s.k);
    }
    v.add(d).applyMatrix4(mesh.bindMatrixInverse);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  const geo = base.clone();
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  cache.set(key, geo);
  return geo;
}
