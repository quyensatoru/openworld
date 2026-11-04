// A soft round shadow under each character, for battery saver (no shadow map there). The office light
// is almost straight overhead, so a person's real shadow is a blob at their feet anyway.
import * as THREE from 'three';

let mat: THREE.MeshBasicMaterial | null = null;
let geo: THREE.PlaneGeometry | null = null;

function material(): THREE.MeshBasicMaterial {
  if (mat) return mat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.7)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  mat = new THREE.MeshBasicMaterial({ map: tex, color: '#1d2230', transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return mat;
}

/** A flat soft shadow (lies on the ground at the parent's origin). */
export function blobShadow(size = 0.95): THREE.Mesh {
  geo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material());
  m.scale.set(size, 1, size * 0.85);
  m.position.y = 0.012;
  m.renderOrder = 1;
  m.name = 'blob-shadow';
  return m;
}
