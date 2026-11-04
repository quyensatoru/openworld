// Characters arrive split into many small pieces: the dressed bodies are ~190 primitives over 5–9
// materials, VRoid hair is ~100 primitives over 3. Every piece is its own draw call (twice with
// shadows) and its own skeleton update, so a room with ten people meant thousands of draw calls.
// Pieces that share a material, a skeleton and a place in the tree become one mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Outlined = THREE.Material & { isOutline?: boolean };

/** VRoid outlines are a second material over the same triangles; we never draw them (see VrmAvatar). */
function dropOutline(m: THREE.SkinnedMesh) {
  if (!Array.isArray(m.material)) return;
  const [surface, ...rest] = m.material as Outlined[];
  if (!surface || !rest.length || !rest.every((x) => x.isOutline)) return;
  const g = m.geometry;
  // both groups cover the whole index range: drawing it once is the surface
  if (!g.groups.every((gr) => gr.start === 0)) return;
  g.clearGroups();
  m.material = surface;
  rest.forEach((x) => x.dispose());
}

function attrKey(g: THREE.BufferGeometry): string {
  return Object.entries(g.attributes)
    .map(([n, a]) => `${n}:${a.itemSize}:${(a.array as ArrayLike<number> & { constructor: { name: string } }).constructor.name}:${a.normalized ? 1 : 0}`)
    .sort()
    .join(',');
}

/** Merge same-material skinned pieces in place. Pieces with morph targets (faces) are left alone. */
export function mergeSkinnedPieces(root: THREE.Object3D, outlines = false): { before: number; after: number } {
  const buckets = new Map<string, THREE.SkinnedMesh[]>();
  let before = 0;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    before++;
    if (outlines) dropOutline(m);
    const g = m.geometry;
    if (Array.isArray(m.material) || g.groups.length > 1) return;
    if (Object.keys(g.morphAttributes).length || m.morphTargetInfluences?.length) return;
    if (!m.parent || !m.skeleton) return;
    const key = [
      m.parent.id,
      (m.material as THREE.Material).id,
      m.skeleton.bones.map((b) => b.id).join('.'),
      m.bindMatrix.elements.map((e) => e.toFixed(5)).join(','),
      m.matrix.elements.map((e) => e.toFixed(5)).join(','),
      g.index ? 'i' : 'n',
      attrKey(g),
      m.castShadow ? 1 : 0,
      m.visible ? 1 : 0,
    ].join('|');
    const list = buckets.get(key);
    if (list) list.push(m);
    else buckets.set(key, [m]);
  });
  let removed = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const merged = mergeGeometries(
      list.map((m) => m.geometry),
      false,
    );
    if (!merged) continue;
    const first = list[0];
    const out = new THREE.SkinnedMesh(merged, first.material);
    out.name = first.name;
    out.position.copy(first.position);
    out.quaternion.copy(first.quaternion);
    out.scale.copy(first.scale);
    out.castShadow = first.castShadow;
    out.receiveShadow = first.receiveShadow;
    out.frustumCulled = first.frustumCulled;
    out.renderOrder = first.renderOrder;
    out.bind(first.skeleton, first.bindMatrix);
    first.parent!.add(out);
    for (const m of list) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    removed += list.length - 1;
  }
  // attached skinned meshes refresh bindMatrixInverse in updateMatrixWorld — without this, measuring
  // the model before its first frame (the avatar's height!) puts the new meshes in the wrong space
  if (removed) root.updateMatrixWorld(true);
  return { before, after: before - removed };
}
