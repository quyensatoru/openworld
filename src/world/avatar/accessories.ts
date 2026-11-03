// Procedural head accessories (glasses, headphones, hats) placed in head-bone space.
import * as THREE from 'three';

export interface HeadDims {
  headCenterY: number; // head centre above the head joint
  headRadius: number;
  eyeY: number; // eye height above the head joint
  faceZ: number; // front of the face (local +z)
}

const dark = () => new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.35, metalness: 0.2 });

function add(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

export function buildAccessories(list: string[], d: HeadDims): THREE.Group {
  const g = new THREE.Group();
  const s = d.headRadius / 0.122; // scale everything from the reference head
  const R = d.headRadius;
  for (const id of list) {
    switch (id) {
      case 'glasses':
      case 'sunglasses': {
        const frame = id === 'sunglasses' ? dark() : new THREE.MeshStandardMaterial({ color: '#3b3f48', roughness: 0.4 });
        for (const sx of [-1, 1]) {
          add(g, new THREE.TorusGeometry(0.03 * s, 0.0045 * s, 8, 24), frame, sx * 0.043 * s, d.eyeY, d.faceZ + 0.006 * s);
          if (id === 'sunglasses') {
            const lens = add(g, new THREE.CircleGeometry(0.03 * s, 24), new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.1, metalness: 0.5 }), sx * 0.043 * s, d.eyeY, d.faceZ + 0.007 * s);
            lens.renderOrder = 1;
          } else {
            const lens = add(g, new THREE.CircleGeometry(0.029 * s, 24), new THREE.MeshStandardMaterial({ color: '#d6f0ff', transparent: true, opacity: 0.25, roughness: 0.05 }), sx * 0.043 * s, d.eyeY, d.faceZ + 0.006 * s);
            lens.renderOrder = 1;
          }
          const temple = add(g, new THREE.BoxGeometry(0.005 * s, 0.006 * s, 0.11 * s), frame, sx * 0.075 * s, d.eyeY + 0.004 * s, d.faceZ - 0.055 * s);
          temple.rotation.y = sx * 0.12;
        }
        add(g, new THREE.BoxGeometry(0.026 * s, 0.005 * s, 0.006 * s), frame, 0, d.eyeY + 0.008 * s, d.faceZ + 0.008 * s);
        break;
      }
      case 'headphones': {
        const m = new THREE.MeshStandardMaterial({ color: '#f2f2f5', roughness: 0.45 });
        const accent = new THREE.MeshStandardMaterial({ color: '#6b8cff', roughness: 0.5 });
        const band = add(g, new THREE.TorusGeometry(R * 1.12, 0.012 * s, 8, 32, Math.PI), m, 0, d.headCenterY, -0.005 * s);
        band.rotation.y = 0;
        for (const sx of [-1, 1]) {
          const cup = add(g, new THREE.CylinderGeometry(0.042 * s, 0.042 * s, 0.035 * s, 20), accent, sx * R * 1.08, d.headCenterY - 0.01 * s, 0);
          cup.rotation.z = Math.PI / 2;
        }
        break;
      }
      case 'cap': {
        const m = new THREE.MeshStandardMaterial({ color: '#e5566b', roughness: 0.75 });
        const top = add(g, new THREE.SphereGeometry(R * 1.07, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), m, 0, d.headCenterY + 0.012 * s, -0.004 * s);
        top.scale.set(1, 0.9, 1.04);
        const brim = add(g, new THREE.CylinderGeometry(0.085 * s, 0.085 * s, 0.008 * s, 28, 1, false, -Math.PI / 2, Math.PI), m, 0, d.headCenterY + 0.02 * s, d.faceZ - 0.035 * s);
        brim.scale.set(1.25, 1, 1.25);
        brim.rotation.x = 0.12;
        add(g, new THREE.SphereGeometry(0.012 * s, 10, 8), m, 0, d.headCenterY + R * 0.98, -0.004 * s);
        break;
      }
      case 'beanie': {
        const m = new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.95 });
        const top = add(g, new THREE.SphereGeometry(R * 1.09, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), m, 0, d.headCenterY + 0.01 * s, -0.004 * s);
        top.scale.set(1, 1.1, 1.04);
        const fold = add(g, new THREE.CylinderGeometry(R * 1.1, R * 1.12, 0.045 * s, 28, 1, true), m, 0, d.headCenterY + 0.025 * s, -0.004 * s);
        fold.scale.z = 1.04;
        add(g, new THREE.SphereGeometry(0.03 * s, 12, 10), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), 0, d.headCenterY + R * 1.18, -0.01 * s);
        break;
      }
    }
  }
  return g;
}
