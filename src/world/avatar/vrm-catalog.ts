// Anime characters players can pick (VRoid sample models, CC0 — see public/models/vrm/LICENSE.txt).
// Body ids start with "vrm-" so the server's id check (letters, digits, - _ .) accepts them.

export interface VrmBody {
  id: string;
  label: string;
  file: string;
  /** Height in metres at avatar height 1.0. */
  height: number;
  gender: 'f' | 'm';
}

export const VRM_BODIES: VrmBody[] = [
  { id: 'vrm-vivi', label: '🌸 Vivi', file: 'vivi.vrm', height: 1.56, gender: 'f' },
  { id: 'vrm-victoria', label: '👱‍♀️ Victoria', file: 'victoria-rubin.vrm', height: 1.6, gender: 'f' },
  { id: 'vrm-vita', label: '💠 Vita', file: 'vita.vrm', height: 1.6, gender: 'f' },
  { id: 'vrm-shino', label: '🎀 Shino', file: 'sendagaya-shino.vrm', height: 1.62, gender: 'f' },
  { id: 'vrm-shibu', label: '🎀 Shibu', file: 'sendagaya-shibu.vrm', height: 1.58, gender: 'f' },
  { id: 'vrm-darkness', label: '🦇 Darkness', file: 'darkness-shibu.vrm', height: 1.6, gender: 'f' },
  { id: 'vrm-neko', label: '🐱 Neko', file: 'hairsample-female.vrm', height: 1.58, gender: 'f' },
  { id: 'vrm-fumiriya', label: '🧑 Fumiriya', file: 'sakurada-fumiriya.vrm', height: 1.74, gender: 'm' },
  { id: 'vrm-haru', label: '🧥 Haru', file: 'hairsample-male.vrm', height: 1.73, gender: 'm' },
];

const byId = new Map(VRM_BODIES.map((b) => [b.id, b]));
/** Retired characters (they were bare base bodies) → the closest dressed one. */
const RETIRED: Record<string, string> = { 'vrm-namsinh': 'vrm-haru', 'vrm-nusinh': 'vrm-shino' };
export const VRM_BY_ID = new Map<string, VrmBody>([...byId, ...Object.entries(RETIRED).map(([old, now]) => [old, byId.get(now)!] as [string, VrmBody])]);
export const vrmUrl = (b: VrmBody) => `/models/vrm/${b.file}`;
