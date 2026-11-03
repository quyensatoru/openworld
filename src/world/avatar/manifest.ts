// Loads /models/manifest.json (written by scripts/prepare-assets.mjs) and creates avatars.
// Without a manifest every avatar falls back to the procedural character.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { AvatarConfig } from '../../../shared/avatar';
import { GltfAvatar, type GltfResources } from './gltf-avatar';
import { PROCEDURAL_HAIR, ProceduralAvatar } from './procedural';
import type { Avatar } from './types';
import { VRM_BODIES, VRM_BY_ID, vrmUrl } from './vrm-catalog';
import { VrmAvatar } from './vrm-avatar';

export type ClipRole =
  | 'idle'
  | 'talk'
  | 'sitTalk'
  | 'walk'
  | 'run'
  | 'sit'
  | 'sitDown'
  | 'standUp'
  | 'wave'
  | 'clap'
  | 'cheer'
  | 'dance'
  | 'think'
  | 'heart'
  | 'laugh'
  | 'coffee'
  | 'jump';

export interface CharacterManifest {
  version: 1;
  animations: string; // GLB holding the animation clips
  clips: Partial<Record<ClipRole, string>>; // role -> clip name inside that file
  bodies: BodyEntry[];
  hairFile?: string; // optional GLB with hair meshes
  hair: { id: string; label: string; node?: string; nodes?: string[] }[];
  hairNodePattern?: string; // regex: hair meshes embedded in body files (hidden unless chosen)
  beardNode?: string; // node in hairFile used by the 'beard' accessory
  clothing?: boolean; // paint shirt/trousers/shoes over underwear-only base bodies
  materials: MaterialSlots; // regex on material names
  bones: Partial<Record<'head' | 'neck' | 'hips' | 'lUpperArm' | 'rUpperArm' | 'lForeArm' | 'rForeArm' | 'lHand' | 'rHand', string>>;
  head?: { centerY: number; radius: number; eyeY: number; faceZ: number } | null; // metres from the head joint; auto-measured when absent
  walkSpeed: number; // m/s the walk clip was authored for (at 1.74 m height)
  runSpeed: number;
  sitOffset?: { y: number; z: number };
}

export type MaterialSlots = Partial<Record<'skin' | 'hair' | 'top' | 'top2' | 'bottom' | 'shoes', string>>;

/** One selectable person. Bodies may bring their own clips/materials (e.g. dressed low-poly characters). */
export interface BodyEntry {
  id: string;
  label: string;
  url: string;
  height?: number;
  clips?: Partial<Record<ClipRole, string>>; // "clipName" or "clipName@start-end" (seconds) inside this body file
  clothing?: boolean;
  hairstyles?: boolean; // can wear the shared hairstyles
  builds?: boolean; // slim / regular / athletic variants
  materials?: MaterialSlots;
  walkSpeed?: number;
  runSpeed?: number;
  sitOffset?: { y: number; z: number };
}

export interface BodyOption {
  id: string;
  label: string;
  /** 'anime': a ready-made VRoid character (no colour / hair options). */
  group?: 'classic' | 'anime';
}

class AvatarFactory {
  manifest: CharacterManifest | null = null;
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private gltfs = new Map<string, Promise<GLTF>>();
  private clips = new Map<ClipRole, THREE.AnimationClip>();
  private bodyClips = new Map<string, Map<ClipRole, THREE.AnimationClip>>();
  private bodyStats = new Map<string, { height: number; minY: number }>();
  private hairGltf: GLTF | null = null;
  private ready: Promise<void> | null = null;

  init(): Promise<void> {
    this.ready ??= this.load().catch((err) => {
      console.warn('[avatars] using procedural characters:', err?.message ?? err);
      this.manifest = null;
    });
    return this.ready;
  }

  private async load() {
    const res = await fetch('/models/manifest.json', { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('no manifest');
    const m = (await res.json()) as CharacterManifest;
    const anims = await this.gltf(m.animations);
    this.clips = pickClips(anims.animations, m.clips);
    if (m.hairFile) this.hairGltf = await this.gltf(m.hairFile);
    // Preload bodies so creating an avatar is instant.
    await Promise.all(m.bodies.map((b) => this.gltf(b.url)));
    this.manifest = m;
  }

  private gltf(url: string): Promise<GLTF> {
    let p = this.gltfs.get(url);
    if (!p) {
      p = this.loader.loadAsync(url);
      this.gltfs.set(url, p);
    }
    return p;
  }

  bodies(): BodyOption[] {
    const classic: BodyOption[] = this.manifest ? this.manifest.bodies.map((b) => ({ id: b.id, label: b.label, group: 'classic' })) : [{ id: 'default', label: 'Mặc định', group: 'classic' }];
    return [...classic, ...VRM_BODIES.map((b) => ({ id: b.id, label: b.label, group: 'anime' as const }))];
  }

  /** What the creator can customise for a given body. */
  features(bodyId: string): { hairstyles: boolean; builds: boolean; sleeves: boolean; colors: boolean } {
    if (VRM_BY_ID.has(bodyId)) return { hairstyles: false, builds: false, sleeves: false, colors: false };
    const b = this.manifest?.bodies.find((x) => x.id === bodyId);
    const clothing = b?.clothing ?? !!this.manifest?.clothing;
    return { hairstyles: !this.manifest || (b?.hairstyles ?? true), builds: !!this.manifest && (b?.builds ?? true), sleeves: !this.manifest || clothing, colors: true };
  }

  hairs(): BodyOption[] {
    if (!this.manifest) return PROCEDURAL_HAIR;
    return this.manifest.hair.map((h) => ({ id: h.id, label: h.label }));
  }

  get hasBeard(): boolean {
    return !!this.manifest?.beardNode;
  }

  get usesModels(): boolean {
    return this.manifest != null;
  }

  async create(cfg: AvatarConfig): Promise<Avatar> {
    const vrm = VRM_BY_ID.get(cfg.body);
    if (vrm) {
      try {
        return await VrmAvatar.load(vrmUrl(vrm), vrm.height * cfg.height);
      } catch (err) {
        console.warn('[avatars] VRM failed, falling back', err);
        cfg = { ...cfg, body: vrm.gender === 'm' ? 'male' : 'female' };
      }
    }
    await this.init();
    const m = this.manifest;
    if (!m) return new ProceduralAvatar(cfg);
    const body = m.bodies.find((b) => b.id === cfg.body) ?? m.bodies[0];
    try {
      const gltf = await this.gltf(body.url);
      let stats = this.bodyStats.get(body.url);
      if (!stats) {
        const box = new THREE.Box3().setFromObject(gltf.scene, true);
        stats = { height: Math.max(0.1, box.max.y - box.min.y), minY: box.min.y };
        this.bodyStats.set(body.url, stats);
      }
      let clips = this.clips;
      if (body.clips) {
        clips = this.bodyClips.get(body.url) ?? pickClips(gltf.animations, body.clips);
        this.bodyClips.set(body.url, clips);
      }
      const res: GltfResources = { manifest: m, entry: body, body: gltf, bodyTargetHeight: body.height ?? 1.74, hair: this.hairGltf, clips, bodyHeight: stats.height, bodyMinY: stats.minY };
      return new GltfAvatar(res, { ...cfg, body: body.id });
    } catch (err) {
      console.error('[avatars] failed to build model avatar', err);
      return new ProceduralAvatar(cfg);
    }
  }
}

/** Map roles to clips; "Name@0.6-8.3" cuts a sub-range (seconds) out of a longer clip. */
function pickClips(all: THREE.AnimationClip[], spec: Partial<Record<ClipRole, string>>): Map<ClipRole, THREE.AnimationClip> {
  const out = new Map<ClipRole, THREE.AnimationClip>();
  for (const [role, raw] of Object.entries(spec) as [ClipRole, string][]) {
    const [name, range] = raw.split('@');
    let clip = all.find((c) => c.name === name);
    if (!clip) {
      console.warn(`[avatars] clip "${name}" for ${role} not found`);
      continue;
    }
    if (range) {
      const [a, b] = range.split('-').map(Number);
      clip = THREE.AnimationUtils.subclip(clip, `${name}#${role}`, Math.round(a * 30), Math.round(b * 30), 30);
    }
    out.set(role, role === 'walk' || role === 'run' ? inPlace(clip) : clip);
  }
  return out;
}

/** Remove horizontal root motion (if the clip has any) so it plays in place — the game moves the character. */
function inPlace(src: THREE.AnimationClip): THREE.AnimationClip {
  let clip = src;
  for (const [i, track] of src.tracks.entries()) {
    if (!track.name.endsWith('.position')) continue;
    const bone = track.name.slice(0, -'.position'.length).toLowerCase();
    if (!/(root|hips|pelvis)$/.test(bone)) continue;
    const v = track.values;
    const n = v.length;
    const travel = Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]);
    if (travel < 0.25) continue; // already in place: keep the natural hip sway
    if (clip === src) clip = src.clone();
    const out = clip.tracks[i].values;
    for (let k = 0; k < out.length; k += 3) {
      out[k] = v[0];
      out[k + 2] = v[2];
    }
  }
  return clip;
}

export const avatars = new AvatarFactory();
