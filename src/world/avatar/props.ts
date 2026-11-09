// Small hand-held props (a champagne flute for toasts, a mug for coffee) that work on any rig:
// they are not parented to a bone (bone axes and scales differ between models) but placed every
// frame at the palm, upright, in the avatar root's local space.
import * as THREE from 'three';

let flute: THREE.Group | null = null;
let mug: THREE.Group | null = null;
let mic: THREE.Group | null = null;
let bouquet: THREE.Group | null = null;

function glassMat(color: string, opacity: number) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.1, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
}

export function makeProp(kind: 'flute' | 'mug' | 'mic' | 'bouquet'): THREE.Group {
  if (kind === 'bouquet') {
    if (!bouquet) {
      // the bride's bouquet: a dome of white and blush roses on a ribboned stem (held by the stem)
      bouquet = new THREE.Group();
      const cols = ['#ffffff', '#ffd6de', '#f6a9b9', '#fff3e4', '#ffffff', '#e98aa0'];
      const mats = cols.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }));
      const geo = new THREE.IcosahedronGeometry(0.036, 1);
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4;
        const r = i ? 0.04 + (i % 3) * 0.022 : 0;
        const f = new THREE.Mesh(geo, mats[i % mats.length]);
        f.position.set(Math.cos(a) * r, 0.2 - r * 0.45, Math.sin(a) * r);
        bouquet.add(f);
      }
      const leaf = new THREE.MeshStandardMaterial({ color: '#7fa37a', roughness: 0.8 });
      for (let i = 0; i < 5; i++) {
        const l = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 5), leaf);
        const a = (i / 5) * Math.PI * 2;
        l.position.set(Math.cos(a) * 0.09, 0.16, Math.sin(a) * 0.09);
        l.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
        bouquet.add(l);
      }
      const stems = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.16, 8), leaf);
      stems.position.y = 0.06;
      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 10), new THREE.MeshStandardMaterial({ color: '#fff7ef', roughness: 0.5 }));
      ribbon.position.y = 0.075;
      bouquet.add(stems, ribbon);
    }
    return bouquet.clone();
  }
  if (kind === 'mic') {
    if (!mic) {
      mic = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.015, 0.17, 14), new THREE.MeshStandardMaterial({ color: '#202028', roughness: 0.35, metalness: 0.3, emissive: '#15151c' }));
      handle.position.y = 0.085;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.021, 0.022, 16), new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.25, metalness: 0.8 }));
      ring.position.y = 0.175;
      // the grille stays readable in a dark room
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.038, 16, 12), new THREE.MeshStandardMaterial({ color: '#dfe4ea', roughness: 0.4, metalness: 0.7, emissive: '#5a5f68' }));
      head.position.y = 0.21;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), new THREE.MeshBasicMaterial({ color: '#39ff88' }));
      led.position.set(0, 0.12, 0.019);
      mic.add(handle, ring, head, led);
    }
    return mic.clone();
  }
  if (kind === 'flute') {
    if (!flute) {
      flute = new THREE.Group();
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.016, 0.11, 14, 1, true), glassMat('#e8f4ff', 0.45));
      bowl.position.y = 0.12;
      const wine = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.014, 0.07, 14), new THREE.MeshStandardMaterial({ color: '#f5c542', emissive: '#a8741a', emissiveIntensity: 0.35, roughness: 0.2 }));
      wine.position.y = 0.1;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 6), glassMat('#e8f4ff', 0.7));
      stem.position.y = 0.035;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.005, 14), glassMat('#e8f4ff', 0.7));
      flute.add(bowl, wine, stem, foot);
    }
    return flute.clone();
  }
  if (!mug) {
    mug = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.032, 0.09, 16), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.4 }));
    body.position.y = 0.045;
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.031, 16), new THREE.MeshStandardMaterial({ color: '#5b3a24', roughness: 0.3 }));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.088;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.4 }));
    handle.position.set(0.036, 0.045, 0);
    handle.rotation.z = -Math.PI / 2;
    mug.add(body, coffee, handle);
  }
  return mug.clone();
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();

/**
 * Put `prop` (a child of `root`) in the closed hand: its stem goes through the middle of the fist.
 * `grip`: finger joints (curled) whose average with the wrist is the fist centre; without them the
 * fist is estimated a hand's width past the wrist, along the forearm.
 */
export function placeInHand(prop: THREE.Object3D, root: THREE.Object3D, hand: THREE.Object3D, fore: THREE.Object3D | null | undefined, grip: THREE.Object3D[] = [], tilt = 0) {
  hand.getWorldPosition(a);
  if (grip.length) {
    for (const g of grip) a.add(g.getWorldPosition(c));
    a.multiplyScalar(1 / (grip.length + 1));
  } else if (fore) {
    fore.getWorldPosition(b);
    a.addScaledVector(b.sub(a).normalize(), -0.075);
  }
  a.y -= 0.045; // the fist closes around the stem, the bowl sits above it
  root.updateWorldMatrix(true, false);
  root.worldToLocal(a);
  prop.position.copy(a);
  // stay upright in world space whatever the root is doing
  prop.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()).invert());
  // lean the top toward the character's face (a mic points at the mouth)
  if (tilt) prop.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())), -tilt));
  const s = root.getWorldScale(b);
  prop.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
}
