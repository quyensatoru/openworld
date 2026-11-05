// Shrinks VRM (glTF binary) avatars for the web without touching their VRM extension:
//  - textures: max 1024 px; opaque ones become JPEG, the rest stay PNG
//  - morph targets keep positions only (normals/tangents of 40+ face shapes are most of the mesh data)
//  - primitives of a mesh that share a material become one (VRoid hair is ~80 primitives over the
//    same vertices with 3 materials: each one cost a geometry, a vertex clean-up and a merge at load
//    time — the game stuttered for every character that came in). Mesh indices don't change, so the
//    VRM extension (expressions, first person) still points at the right meshes.
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
  let bin = b.subarray(binStart, binStart + binLen);

  // 0. one primitive per material in each mesh (same vertices: only the index lists are joined)
  const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array };
  const extra = [];
  let extraAt = pad4(bin.length);
  const readIndices = (ai) => {
    const a = json.accessors[ai];
    const v = json.bufferViews[a.bufferView];
    const T = COMP[a.componentType];
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = new T(a.count);
    const src = Buffer.from(bin.subarray(start, start + a.count * T.BYTES_PER_ELEMENT));
    for (let i = 0; i < a.count; i++) out[i] = T === Uint8Array ? src[i] : T === Uint16Array ? src.readUInt16LE(i * 2) : src.readUInt32LE(i * 4);
    return out;
  };
  let joined = 0;
  for (const mesh of json.meshes ?? []) {
    const groups = new Map();
    for (const prim of mesh.primitives) {
      const key = prim.indices === undefined ? Symbol() : JSON.stringify([prim.material, prim.mode ?? 4, prim.attributes, prim.targets ?? null]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(prim);
    }
    const prims = [];
    for (const g of groups.values()) {
      if (g.length === 1) {
        prims.push(g[0]);
        continue;
      }
      const parts = g.map((p) => readIndices(p.indices));
      const count = parts.reduce((n, x) => n + x.length, 0);
      let max = 0;
      for (const x of parts) for (const i of x) if (i > max) max = i;
      const wide = max > 65535;
      const data = Buffer.alloc(count * (wide ? 4 : 2));
      let k = 0;
      for (const x of parts) for (const i of x) wide ? data.writeUInt32LE(i, 4 * k++) : data.writeUInt16LE(i, 2 * k++);
      json.bufferViews.push({ buffer: 0, byteOffset: extraAt, byteLength: data.length, target: 34963 });
      json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: wide ? 5125 : 5123, count, type: 'SCALAR' });
      extra.push(Buffer.alloc(extraAt - (bin.length + extra.reduce((n, e) => n + e.length, 0))), data);
      extraAt = pad4(extraAt + data.length);
      prims.push({ ...g[0], indices: json.accessors.length - 1 });
      joined += g.length - 1;
    }
    mesh.primitives = prims;
  }
  if (extra.length) bin = Buffer.concat([bin, ...extra]);

  // 0b. no spring-bone "center": three-vrm then wraps that node's matrixWorld.elements in a Proxy,
  //     which makes every matrix multiply in three.js polymorphic (slow, ~50 MB/s of garbage and a
  //     GC stutter every couple of seconds for everyone in the office). Springs run in world space
  //     like the other characters'.
  for (const g of json.extensions?.VRM?.secondaryAnimation?.boneGroups ?? []) g.center = -1;

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
  console.log(`${path.basename(file)}: ${(b.length / 1e6).toFixed(1)} MB → ${(total / 1e6).toFixed(1)} MB, ${joined} primitives joined  (${out})`);
}

for (const f of fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.vrm'))) await processFile(path.join(srcDir, f));
