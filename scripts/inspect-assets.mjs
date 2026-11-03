// Lists what is inside the downloaded character packs (meshes, materials, bones, animation clips).
//   node scripts/inspect-assets.mjs [folder=assets-src]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] || 'assets-src';
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(glb|gltf)$/i.test(f)) files.push(p);
  }
})(root);
const others = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (!/\.(glb|gltf|bin|png|jpe?g|webp)$/i.test(f)) others.push(relative(root, p));
  }
})(root);

if (!files.length) {
  console.log(`No .glb/.gltf files under ${root}/. Other files: ${others.slice(0, 20).join(', ') || '(none)'}`);
  process.exit(1);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of files) {
  const doc = await io.read(file);
  const r = doc.getRoot();
  const size = (statSync(file).size / 1024).toFixed(0);
  console.log(`\n=== ${relative(root, file)} (${size} KB)`);
  const meshes = r.listNodes().filter((n) => n.getMesh());
  console.log(`meshes (${meshes.length}): ${meshes.map((n) => `${n.getName()}${n.getSkin() ? '*' : ''}`).join(', ')}`);
  console.log(`materials: ${r.listMaterials().map((m) => `${m.getName()}${m.getBaseColorTexture() ? '[tex]' : ''}`).join(', ')}`);
  const skins = r.listSkins();
  if (skins.length) console.log(`bones (${skins[0].listJoints().length}): ${skins[0].listJoints().map((j) => j.getName()).join(', ')}`);
  const anims = r.listAnimations();
  if (anims.length) {
    console.log(`animations (${anims.length}):`);
    for (const a of anims) {
      let dur = 0;
      for (const s of a.listSamplers()) dur = Math.max(dur, s.getInput()?.getMax([0])[0] ?? 0);
      process.stdout.write(`  ${a.getName()} (${dur.toFixed(2)}s)\n`);
    }
  }
}
if (others.length) console.log(`\nOther files: ${others.slice(0, 30).join(', ')}${others.length > 30 ? ' …' : ''}`);
