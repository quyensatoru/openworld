// Rig-agnostic bone tweaks done in world space, so they work whatever the bone axis conventions are.
import * as THREE from 'three';

const _pq = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _id = new THREE.Quaternion();

/** Rotate `bone` by `angle` around a world-space axis (after the animation has been applied). */
export function rotateBoneWorld(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number): void {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_pq);
  bone.getWorldQuaternion(_bq);
  _dq.setFromAxisAngle(axisWorld, angle);
  _bq.premultiply(_dq);
  bone.quaternion.copy(_pq.invert().multiply(_bq));
  bone.updateMatrixWorld(true);
}

/** Swing `bone` so that the direction bone→child points toward `dirWorld` (blended by `w`). */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dirWorld: THREE.Vector3, w: number): void {
  if (!bone.parent || w <= 0) return;
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  const cur = _b.sub(_a);
  if (cur.lengthSq() < 1e-10) return;
  cur.normalize();
  _dq.setFromUnitVectors(cur, _a.copy(dirWorld).normalize());
  if (w < 1) _dq.slerp(_id, 1 - w); // (slerpQuaternions(_id, _dq, w) would alias _dq)
  bone.parent.getWorldQuaternion(_pq);
  bone.getWorldQuaternion(_bq);
  _bq.premultiply(_dq);
  bone.quaternion.copy(_pq.invert().multiply(_bq));
  bone.updateMatrixWorld(true);
}

export function findBone(root: THREE.Object3D, patterns: (string | RegExp)[]): THREE.Object3D | null {
  for (const p of patterns) {
    let found: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (found) return;
      if (!(o as THREE.Bone).isBone) return;
      if (typeof p === 'string' ? o.name === p : p.test(o.name)) found = o;
    });
    if (found) return found;
  }
  return null;
}

export function firstChildBone(bone: THREE.Object3D | null): THREE.Object3D | null {
  if (!bone) return null;
  return bone.children.find((c) => (c as THREE.Bone).isBone) ?? null;
}
