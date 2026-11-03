// Converts FBX characters (e.g. Quaternius "Animated Men") to GLB using three.js FBXLoader + GLTFExporter
// inside headless Chrome (served by the running `npm run dev`), and prints what is inside each file.
//   node scripts/convert-fbx.mjs <out-dir> <file.fbx>...
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:5173';
const [outDir, ...files] = process.argv.slice(2);
if (!outDir || !files.length) {
  console.error('usage: node scripts/convert-fbx.mjs <out-dir> <file.fbx>...');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const root = resolve('.');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[page]', String(e)));
await page.goto(`${BASE}/api/session`);
for (const f of files) {
  const url = '/' + relative(root, resolve(f)).split('/').map(encodeURIComponent).join('/');
  const res = await page.evaluate(async (url) => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');
    const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
    const obj = await new FBXLoader().loadAsync(url);
    const info = { anims: [], bones: [], meshes: [], materials: new Set(), height: 0 };
    obj.traverse((o) => {
      if (o.isBone) info.bones.push(o.name);
      if (o.isMesh) {
        info.meshes.push(o.name);
        for (const m of [].concat(o.material)) info.materials.add(`${m.name}#${m.color?.getHexString?.() ?? ''}${m.map ? '[tex]' : ''}`);
      }
    });
    const box = new THREE.Box3().setFromObject(obj, true);
    info.height = +(box.max.y - box.min.y).toFixed(3);
    info.anims = obj.animations.map((a) => `${a.name} (${a.duration.toFixed(2)}s)`);
    const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: obj.animations });
    const bytes = new Uint8Array(glb);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { info: { ...info, materials: [...info.materials] }, b64: btoa(bin) };
  }, url);
  const out = join(outDir, basename(f).replace(/\.fbx$/i, '.glb'));
  writeFileSync(out, Buffer.from(res.b64, 'base64'));
  console.log(`\n=== ${basename(f)} → ${out} (${(res.b64.length * 0.75 / 1024).toFixed(0)} KB)`);
  console.log('height:', res.info.height);
  console.log('meshes:', res.info.meshes.join(', '));
  console.log('materials:', res.info.materials.join(', '));
  console.log('bones:', res.info.bones.join(', '));
  console.log('animations:', res.info.anims.join(', '));
}
await browser.close();
