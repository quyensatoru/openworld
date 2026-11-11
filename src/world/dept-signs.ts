// Hanging department signs over the desk clusters of floor 1 (and the library, the virtual
// employees' head office). Each shows how many virtual employees sit there and how many are busy.
import * as THREE from 'three';
import { DEPT_BY_ID, DEPT_SIGNS, type DeptId } from '../../shared/agents';
import { WALL_H } from '../../shared/map';

const W = 512;
const H = 144;
const BOARD_W = 1.35;
const BOARD_H = (BOARD_W * H) / W;

export interface DeptCount {
  here: number;
  working: number;
}

interface Sign {
  dept: DeptId;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  key: string;
}

export class DeptSigns {
  private signs: Sign[] = [];

  constructor(parent: THREE.Object3D) {
    const cable = new THREE.MeshBasicMaterial({ color: '#4b505c' });
    const cableGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 4);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#2d3142', roughness: 0.6, metalness: 0.3 });
    const y = WALL_H - 0.62;
    for (const s of DEPT_SIGNS) {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const g = new THREE.Group();
      g.name = `dept-sign-${s.dept}`;
      g.position.set(s.x, y, s.z);
      // a slim frame with the face printed on both sides (seen from both rows of desks)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.05, BOARD_H + 0.05, 0.03), frameMat);
      g.add(frame);
      const face = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      for (const side of [1, -1]) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), face);
        plane.position.z = side * 0.017;
        if (side < 0) plane.rotation.y = Math.PI;
        g.add(plane);
      }
      const len = WALL_H - y - BOARD_H / 2;
      for (const dx of [-BOARD_W * 0.38, BOARD_W * 0.38]) {
        const c = new THREE.Mesh(cableGeo, cable);
        c.scale.y = len;
        c.position.set(dx, BOARD_H / 2 + len / 2, 0);
        g.add(c);
      }
      parent.add(g);
      const sign: Sign = { dept: s.dept, canvas, tex, key: '' };
      this.signs.push(sign);
      this.draw(sign, { here: 0, working: 0 });
    }
  }

  update(counts: Partial<Record<DeptId, DeptCount>>) {
    for (const s of this.signs) this.draw(s, counts[s.dept] ?? { here: 0, working: 0 });
  }

  private draw(s: Sign, c: DeptCount) {
    const key = `${c.here}/${c.working}`;
    if (key === s.key) return;
    s.key = key;
    const d = DEPT_BY_ID.get(s.dept)!;
    const g = s.canvas.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    // board
    g.fillStyle = '#fbfaf7';
    round(g, 0, 0, W, H, 22);
    g.fill();
    g.fillStyle = d.color;
    round(g, 0, 0, 132, H, 22);
    g.fill();
    g.fillRect(100, 0, 32, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '64px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.fillText(d.icon, 66, H / 2 + 4);
    // name
    g.textAlign = 'left';
    g.fillStyle = '#2d3142';
    g.font = `800 ${d.name.length > 12 ? 36 : 44}px Inter, system-ui, sans-serif`;
    g.fillText(d.name, 156, 52);
    // who is in
    g.font = '600 26px Inter, system-ui, sans-serif';
    if (!c.here) {
      g.fillStyle = '#9aa3ad';
      g.fillText('🤖 chưa có nhân viên ảo', 156, 104);
    } else {
      g.fillStyle = c.working ? '#23895a' : '#6b7282';
      if (c.working) {
        g.beginPath();
        g.arc(166, 104, 8, 0, Math.PI * 2);
        g.fill();
      }
      g.fillText(`${c.working ? `${c.working} đang làm · ` : ''}${c.here} nhân viên ảo`, c.working ? 184 : 156, 104);
    }
    s.tex.needsUpdate = true;
  }
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
