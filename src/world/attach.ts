import type * as THREE from 'three';

/**
 * Keep a character in the scene graph only while it is drawn. three.js walks every object in the
 * scene each frame and recomputes its matrix, hidden or not: a VRoid character is 200+ bones, and
 * everyone in the office (other floors too) was paid for on every frame.
 */
export function attach(obj: THREE.Object3D, parent: THREE.Object3D, on: boolean) {
  if (on) {
    if (obj.parent !== parent) parent.add(obj);
  } else if (obj.parent) obj.parent.remove(obj);
}
