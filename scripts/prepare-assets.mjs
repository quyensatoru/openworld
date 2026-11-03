// Turns the downloaded Quaternius packs (assets-src/) into compact game files (public/models/).
//
//   npm run assets:prepare
//
// Reads scripts/assets.config.json (bodies, hairstyles, which animation clip plays which role).
// If that file does not exist yet, a best-effort guess is written first — check it and re-run.
// Output: anims.glb (only the clips we use), body-*.glb, hair.glb (all hairstyles merged),
// textures resized + WebP, geometry/animation meshopt-compressed, and manifest.json for the game.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, resample, textureCompress, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const SRC = process.env.ASSETS_SRC || 'assets-src';
const OUT = process.env.ASSETS_OUT || 'public/models';
const CONFIG = process.env.ASSETS_CONFIG || 'scripts/assets.config.json';

const ROLE_PATTERNS = {
  idle: [/^idle(_loop)?$/i, /^idle/i],
  talk: [/idle_?talk/i],
  walk: [/^walk(_loop)?$/i, /^walk/i],
  run: [/^jog_?fwd(_loop)?$/i, /^jog/i, /^run/i],
  sit: [/^sit(ting)?_?idle(_loop)?$/i],
  sitTalk: [/sit(ting)?_?talk/i],
  sitDown: [/sit(ting)?_?(enter|down)/i],
  standUp: [/sit(ting)?_?(exit|up)/i, /stand_?up/i],
  wave: [/wave/i],
  clap: [/clap/i],
  cheer: [/cheer|victory|celebrat/i],
  dance: [/dance/i],
};

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(glb|gltf)$/i.test(f) && !/_RM\.glb$/i.test(f)) out.push(p);
    }
  })(dir);
  return out;
}
function dropAnimation(a) {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function guessConfig() {
  const files = listFiles(SRC);
  if (!files.length) throw new Error(`Không thấy file .glb/.gltf nào trong ${SRC}/ — giải nén 2 bộ Quaternius vào đó trước.`);
  const info = [];
  for (const f of files) {
    const r = (await io.read(f)).getRoot();
    info.push({ file: relative('.', f), anims: r.listAnimations().map((a) => a.getName()), meshes: r.listNodes().filter((n) => n.getMesh()).map((n) => n.getName()), skinned: r.listSkins().length > 0 });
  }
  const animFile = [...info].sort((a, b) => b.anims.length - a.anims.length)[0];
  const clips = {};
  for (const [role, pats] of Object.entries(ROLE_PATTERNS)) {
    const hit = pats.map((p) => animFile.anims.find((n) => p.test(n))).find(Boolean);
    if (hit) clips[role] = hit;
  }
  const hairInfos = info.filter((i) => /hair/i.test(basename(i.file)));
  const bodies = info.filter((i) => i !== animFile && i.skinned && !/hair|eyebrow/i.test(basename(i.file)));
  return {
    animations: animFile.file,
    clips,
    bodies: bodies.map((b) => ({ id: slug(basename(b.file).replace(/\.(glb|gltf)$/i, '')), label: /female/i.test(b.file) ? 'Nữ' : /male/i.test(b.file) ? 'Nam' : basename(b.file), height: /female/i.test(b.file) ? 1.66 : 1.76, src: b.file })),
    hairFiles: hairInfos.filter((h) => !/beard/i.test(h.file)).map((h) => h.file),
    beardFile: hairInfos.find((h) => /beard/i.test(h.file))?.file,
    hair: hairInfos.filter((h) => !/beard/i.test(h.file)).map((h) => ({ id: slug(h.meshes[0] ?? basename(h.file)), label: h.meshes[0] ?? basename(h.file), node: h.meshes[0] })),
    materials: { skin: '^MI_Superhero', hair: '^MI_Hair' },
    clothing: true,
    walkSpeed: 1.0,
    runSpeed: 5.0,
    sitOffset: { y: 0.05, z: 0.3 },
    textureSize: 1024,
  };
}

async function finish(doc, out, textureSize) {
  await doc.transform(
    unpartition(),
    dedup(),
    prune({ keepAttributes: false }),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize], quality: 82, slots: /^(baseColor|normal|emissive)/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize / 2, textureSize / 2], quality: 80, slots: /^(metallicRoughness|occlusion)/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  await io.write(out, doc);
  return `${(statSync(out).size / 1024).toFixed(0)} KB`.padStart(9);
}

async function readMerged(files) {
  const doc = await io.read(files[0]);
  for (const f of files.slice(1)) mergeDocuments(doc, await io.read(f));
  const [main, ...rest] = doc.getRoot().listScenes();
  for (const s of rest) {
    for (const child of s.listChildren()) main.addChild(child);
    s.dispose();
  }
  for (const a of doc.getRoot().listAnimations()) dropAnimation(a);
  return doc;
}

async function main() {
  let cfg;
  if (existsSync(CONFIG)) cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  else {
    cfg = await guessConfig();
    writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
    console.log(`Đã đoán cấu hình → ${CONFIG}. Kiểm tra lại rồi chạy tiếp nếu cần.`);
  }
  const size = cfg.textureSize ?? 1024;
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 1) animation library: keep only the clips we use, drop the preview mannequin mesh.
  const used = new Set(Object.values(cfg.clips));
  const anim = await io.read(cfg.animations);
  for (const a of anim.getRoot().listAnimations()) if (!used.has(a.getName())) dropAnimation(a);
  for (const n of anim.getRoot().listNodes()) if (n.getMesh()) n.setMesh(null).setSkin(null);
  const missing = [...used].filter((n) => !anim.getRoot().listAnimations().some((a) => a.getName() === n));
  if (missing.length) throw new Error(`Không tìm thấy animation: ${missing.join(', ')}`);
  console.log(`anims.glb      ${await finish(anim, join(OUT, 'anims.glb'), size)}  (${used.size} clip)`);

  // 2) bodies (a body may carry its own animations: keep only the clips it uses)
  const bodies = [];
  for (const b of cfg.bodies) {
    const doc = await io.read(b.src);
    const keep = new Set(Object.values(b.clips ?? {}).map((c) => String(c).split('@')[0]));
    for (const a of doc.getRoot().listAnimations()) if (!keep.has(a.getName())) dropAnimation(a);
    const file = `body-${b.id}.glb`;
    console.log(`${file.padEnd(20)} ${await finish(doc, join(OUT, file), size)}${keep.size ? `  (${keep.size} clip)` : ''}`);
    const { src: _src, ...rest } = b;
    bodies.push({ ...rest, url: `/models/${file}` });
  }

  // 3) all hairstyles (+ beard) merged into one file so textures are shared
  let hairFile;
  const hairSources = [...(cfg.hairFiles ?? []), ...(cfg.beardFile ? [cfg.beardFile] : [])];
  if (hairSources.length) {
    const doc = await readMerged(hairSources);
    console.log(`hair.glb       ${await finish(doc, join(OUT, 'hair.glb'), size / 2)}  (${hairSources.length} mesh)`);
    hairFile = '/models/hair.glb';
  }

  const manifest = {
    version: 1,
    animations: '/models/anims.glb',
    clips: cfg.clips,
    bodies,
    hairFile,
    hair: cfg.hair ?? [],
    beardNode: cfg.beardNode,
    materials: cfg.materials ?? {},
    clothing: cfg.clothing ?? false,
    bones: cfg.bones ?? {},
    head: cfg.head ?? null,
    walkSpeed: cfg.walkSpeed ?? 1,
    runSpeed: cfg.runSpeed ?? 5,
    sitOffset: cfg.sitOffset ?? { y: 0, z: 0 },
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✅ ${OUT}/manifest.json — ${bodies.length} dáng người, ${manifest.hair.length} kiểu tóc, ${Object.keys(cfg.clips).length} animation`);
}

main().catch((err) => {
  console.error('❌', err.message ?? err);
  process.exit(1);
});
