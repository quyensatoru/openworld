// Shrinks VRM (glTF binary) avatars for the web without touching their VRM extension:
//  - textures: max 1024 px; opaque ones become JPEG, the rest stay PNG
//  - morph targets keep positions only (normals/tangents of 40+ face shapes are most of the mesh data)
//  - the binary chunk is rebuilt with only the buffer views still in use
// Usage: node scripts/prepare-vrm.mjs assets-src/vrm public/models/vrm
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [srcDir = 'assets-src/vrm', outDir = 'public/models/vrm'] = process.argv.slice(2);
const MAX = Number(process.env.VRM_TEX_MAX || 1024);
fs.mkdirSync(outDir, { recursive: true });

const pad4 = (n) => (n + 3) & ~3;

async function shrinkImage(buf) {
  const img = sharp(buf);
  const meta = await img.metadata();
  const big = Math.max(meta.width ?? 0, meta.height ?? 0) > MAX;
  let pipeline = big ? img.resize({ width: MAX, height: MAX, fit: 'inside' }) : img;
  let opaque = !meta.hasAlpha;
  if (meta.hasAlpha) {
    const st = await sharp(buf).stats();
    opaque = st.channels[3]?.min === 255;
  }
  if (opaque) {
    const out = await pipeline.removeAlpha().jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    return { data: out, mime: 'image/jpeg' };
  }
  if (!big && buf.length < 64 * 1024) return { data: buf, mime: 'image/png' };
  const out = await pipeline.png({ compressionLevel: 9, palette: true, quality: 92, effort: 8 }).toBuffer();
  return { data: out, mime: 'image/png' };
}

async function processFile(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const binLen = b.readUInt32LE(20 + jsonLen);
  const bin = b.subarray(binStart, binStart + binLen);

  // 1. morph targets: positions only
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      for (const t of prim.targets ?? []) {
        delete t.NORMAL;
        delete t.TANGENT;
      }
    }
  }

  // 2. which buffer views are still referenced (and by what)
  const usedAcc = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      for (const a of Object.values(prim.attributes)) usedAcc.add(a);
      if (prim.indices !== undefined) usedAcc.add(prim.indices);
      for (const t of prim.targets ?? []) for (const a of Object.values(t)) usedAcc.add(a);
    }
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices);
  for (const an of json.animations ?? []) for (const sm of an.samplers) (usedAcc.add(sm.input), usedAcc.add(sm.output));

  const usedView = new Set();
  json.accessors.forEach((a, i) => {
    if (!usedAcc.has(i)) return;
    if (a.bufferView !== undefined) usedView.add(a.bufferView);
    if (a.sparse) (usedView.add(a.sparse.indices.bufferView), usedView.add(a.sparse.values.bufferView));
  });
  const imageView = new Map(); // bufferView -> image index
  (json.images ?? []).forEach((im, i) => {
    if (im.bufferView !== undefined) (usedView.add(im.bufferView), imageView.set(im.bufferView, i));
  });

  // 3. new binary: kept views in order, images re-encoded
  const chunks = [];
  const remap = new Map();
  const views = [];
  let offset = 0;
  for (let i = 0; i < json.bufferViews.length; i++) {
    if (!usedView.has(i)) continue;
    const v = json.bufferViews[i];
    let data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    if (imageView.has(i)) {
      const im = json.images[imageView.get(i)];
      const r = await shrinkImage(Buffer.from(data));
      data = r.data;
      im.mimeType = r.mime;
    }
    const nv = { ...v, buffer: 0, byteOffset: offset, byteLength: data.length };
    if (imageView.has(i)) delete nv.byteStride;
    remap.set(i, views.length);
    views.push(nv);
    chunks.push(data);
    const padded = pad4(data.length);
    if (padded > data.length) chunks.push(Buffer.alloc(padded - data.length));
    offset += padded;
  }
  json.bufferViews = views;
  json.accessors.forEach((a) => {
    if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView) ?? a.bufferView;
    if (a.sparse) {
      a.sparse.indices.bufferView = remap.get(a.sparse.indices.bufferView);
      a.sparse.values.bufferView = remap.get(a.sparse.values.bufferView);
    }
  });
  for (const im of json.images ?? []) if (im.bufferView !== undefined) im.bufferView = remap.get(im.bufferView);
  // accessors that are no longer used keep pointing somewhere valid but are never read; drop their data link
  json.accessors.forEach((a, i) => {
    if (!usedAcc.has(i)) {
      delete a.bufferView;
      delete a.sparse;
      delete a.byteOffset;
    }
  });
  json.buffers = [{ byteLength: offset }];

  // 4. write GLB
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jp = pad4(jsonBuf.length);
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jp - jsonBuf.length, 0x20)]);
  const binBuf = Buffer.concat(chunks);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binBuf.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  const out = path.join(outDir, path.basename(file).toLowerCase().replace(/[^a-z0-9.]+/g, '-'));
  fs.writeFileSync(out, Buffer.concat([head, jh, jsonBuf, bh, binBuf]));
  console.log(`${path.basename(file)}: ${(b.length / 1e6).toFixed(1)} MB → ${(total / 1e6).toFixed(1)} MB  (${out})`);
}

for (const f of fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.vrm'))) await processFile(path.join(srcDir, f));
