// Wedding outfits that work on any character (built-in bodies, the Quaternius men, VRoid models):
// like the hand props they are not parented to a bone (axes and scales differ between rigs) but
// placed every frame at the head / neck joint, in the avatar root's local space.
//   bride      — a long chiffon veil and a pearl tiara (the bouquet is a hand prop, see props.ts)
//   groom      — a black bow tie and a rose on the lapel
//   bridesmaid — a crown of little flowers
//   groomsman  — a bow tie and a small white buttonhole flower
import * as THREE from 'three';
import type { WedAttire } from '../../../shared/wedding';

export interface AttireParts {
  root: THREE.Group;
  head: THREE.Group | null;
  neck: THREE.Group | null;
}

const cache = new Map<WedAttire, { head: THREE.Group | null; neck: THREE.Group | null }>();
const mats = new Map<string, THREE.MeshStandardMaterial>();
function m(color: string, o: { rough?: number; metal?: number; opacity?: number; emissive?: string } = {}) {
  const key = `${color}|${o.rough}|${o.metal}|${o.opacity}|${o.emissive}`;
  let x = mats.get(key);
  if (!x) {
    x = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0, emissive: o.emissive ?? '#000000' });
    if (o.opacity !== undefined && o.opacity < 1) {
      x.transparent = true;
      x.opacity = o.opacity;
      x.depthWrite = false;
      x.side = THREE.DoubleSide;
    }
    mats.set(key, x);
  }
  return x;
}

function flowerRing(r: number, n: number, cols: string[], size: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(size, 1);
  const leaf = new THREE.ConeGeometry(size * 0.55, size * 2.4, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const f = new THREE.Mesh(geo, m(cols[i % cols.length], { rough: 0.8 }));
    f.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    g.add(f);
    const l = new THREE.Mesh(leaf, m('#7fa37a', { rough: 0.8 }));
    l.position.set(Math.sin(a + 0.25) * r, -size * 0.2, Math.cos(a + 0.25) * r);
    l.rotation.set(Math.PI / 2, 0, a);
    g.add(l);
  }
  return g;
}

function bowTie(color: string, s: number): THREE.Group {
  const g = new THREE.Group();
  const wing = new THREE.ConeGeometry(0.03 * s, 0.06 * s, 4);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(wing, m(color, { rough: 0.45 }));
    w.rotation.z = (sx * Math.PI) / 2;
    w.position.x = sx * 0.032 * s;
    g.add(w);
  }
  const knot = new THREE.Mesh(new THREE.BoxGeometry(0.022 * s, 0.024 * s, 0.018 * s), m(color, { rough: 0.45 }));
  g.add(knot);
  return g;
}

function boutonniere(petal: string, s: number): THREE.Group {
  const g = new THREE.Group();
  const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.024 * s, 1), m(petal, { rough: 0.75 }));
  g.add(bloom);
  for (const a of [-0.7, 0.6]) {
    const l = new THREE.Mesh(new THREE.ConeGeometry(0.012 * s, 0.05 * s, 4), m('#6f9a63', { rough: 0.8 }));
    l.position.set(Math.sin(a) * 0.02 * s, -0.02 * s, 0);
    l.rotation.z = a + Math.PI;
    g.add(l);
  }
  return g;
}

function build(kind: WedAttire) {
  let head: THREE.Group | null = null;
  let neck: THREE.Group | null = null;
  if (kind === 'bride') {
    head = new THREE.Group();
    // pearl tiara on top
    const tiara = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 6, 20, Math.PI), m('#f2f2f5', { rough: 0.2, metal: 0.8 }));
    tiara.rotation.set(-0.35, 0, 0);
    tiara.position.set(0, 0.0, 0.01);
    head.add(tiara);
    const pearl = new THREE.IcosahedronGeometry(0.011, 1);
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI;
      const p = new THREE.Mesh(pearl, m('#fffaf0', { rough: 0.25, emissive: '#2a2622' }));
      p.position.set(Math.cos(a) * 0.075, Math.sin(a) * 0.075 * 0.94 + 0.012, 0.01 - Math.sin(a) * 0.026);
      head.add(p);
    }
    // the veil: a long chiffon cone from the crown down the back
    const veil = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.33, 0.95, 20, 1, true, Math.PI * 0.5, Math.PI), m('#ffffff', { rough: 0.9, opacity: 0.5 }));
    veil.position.set(0, -0.47, -0.07);
    veil.rotation.x = -0.12;
    head.add(veil);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 8, Math.PI * 0.5, Math.PI, 0, Math.PI / 2), m('#ffffff', { rough: 0.9, opacity: 0.42 }));
    top.position.set(0, -0.02, -0.03);
    head.add(top);
  } else if (kind === 'groom' || kind === 'groomsman') {
    neck = new THREE.Group();
    const bow = bowTie(kind === 'groom' ? '#16161c' : '#2a3550', 1);
    bow.position.set(0, -0.045, 0.075);
    neck.add(bow);
    const flower = boutonniere(kind === 'groom' ? '#d43b5a' : '#ffffff', kind === 'groom' ? 1.1 : 0.85);
    flower.position.set(0.1, -0.17, 0.1);
    neck.add(flower);
  } else {
    head = new THREE.Group();
    const crown = flowerRing(0.095, 12, ['#ffd6de', '#ffffff', '#f6a9b9', '#fff3c4'], 0.018);
    crown.position.set(0, -0.03, 0);
    crown.rotation.x = -0.25;
    head.add(crown);
  }
  return { head, neck };
}

export function makeAttire(kind: WedAttire): AttireParts {
  let c = cache.get(kind);
  if (!c) cache.set(kind, (c = build(kind)));
  const root = new THREE.Group();
  root.name = `attire-${kind}`;
  const head = c.head ? c.head.clone() : null;
  const neck = c.neck ? c.neck.clone() : null;
  if (head) root.add(head);
  if (neck) root.add(neck);
  root.traverse((o) => {
    o.castShadow = false;
  });
  return { root, head, neck };
}

const v = new THREE.Vector3();
const s = new THREE.Vector3();

/**
 * Put the outfit on: the head piece on top of the head (`topOff` = from the head joint up to the
 * crown, measured once while standing), the neck piece at the collar. Upright in the root's space.
 */
export function placeAttire(a: AttireParts, root: THREE.Object3D, head: THREE.Object3D | null, neck: THREE.Object3D | null, topOff: number) {
  root.updateWorldMatrix(true, false);
  const sc = root.getWorldScale(s);
  const inv = 1 / (sc.y || 1);
  if (a.head && head) {
    head.getWorldPosition(v);
    root.worldToLocal(v);
    a.head.position.set(v.x, v.y + topOff * 0.88, v.z);
    a.head.scale.setScalar(inv);
  }
  if (a.neck && neck) {
    neck.getWorldPosition(v);
    root.worldToLocal(v);
    a.neck.position.copy(v);
    a.neck.scale.setScalar(inv);
  }
}
