// Avatar customisation data shared by client (rendering, creator UI) and server (validation).

export interface AvatarConfig {
  body: string; // body model id from the character manifest
  hair: string; // hairstyle id ('none' = bald)
  skin: string; // #rrggbb
  hairColor: string;
  top: string;
  bottom: string;
  shoes: string;
  sleeves: 'short' | 'long';
  build: 'slim' | 'regular' | 'athletic';
  accessories: string[]; // see ACCESSORIES
  height: number; // uniform scale 0.92..1.08
  /** Bar staff only (never sent by players: sanitizeAvatar drops it). */
  outfit?: 'clothes' | 'swim';
  /** Bar staff only: model figure (narrow shoulders, slim limbs, small waist) and smooth skin. */
  look?: 'model';
}

export const ACCESSORIES = [
  { id: 'glasses', label: 'Kính cận' },
  { id: 'sunglasses', label: 'Kính râm' },
  { id: 'headphones', label: 'Tai nghe' },
  { id: 'cap', label: 'Mũ lưỡi trai' },
  { id: 'beanie', label: 'Mũ len' },
  { id: 'beard', label: 'Râu' },
] as const;

export const SKIN_TONES = ['#ffe0c7', '#f6cfae', '#eab48f', '#d59a6f', '#b97b52', '#8d5a3b', '#62402a'];
export const HAIR_COLORS = ['#1f1a17', '#3b2a20', '#6b4426', '#a8723f', '#d9b26f', '#e8d8b0', '#b8b8bd', '#a23b3b', '#5a7bd6', '#d46aa6'];
export const CLOTH_COLORS = [
  '#f4f1ea', '#2d3142', '#4f6d7a', '#7fa7c9', '#9bc1a6', '#3d8a6a', '#f2c14e', '#f08a5d',
  '#e5566b', '#b56fd0', '#6b8cff', '#a3b18a', '#5c4b8a', '#e889b0', '#333333', '#ffffff',
];

export const DEFAULT_AVATAR: AvatarConfig = {
  body: 'default',
  hair: 'default',
  skin: SKIN_TONES[1],
  hairColor: HAIR_COLORS[1],
  top: CLOTH_COLORS[3],
  bottom: CLOTH_COLORS[1],
  shoes: CLOTH_COLORS[14],
  sleeves: 'short',
  build: 'regular',
  accessories: [],
  height: 1,
};

export const BUILDS = [
  { id: 'slim', label: 'Mảnh khảnh' },
  { id: 'regular', label: 'Cân đối' },
  { id: 'athletic', label: 'Lực lưỡng' },
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-zA-Z0-9_.-]{1,40}$/;
const ACC_IDS = new Set<string>(ACCESSORIES.map((a) => a.id));

export function sanitizeAvatar(input: unknown): AvatarConfig {
  const a = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const color = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const id = (v: unknown, d: string) => (typeof v === 'string' && ID.test(v) ? v : d);
  const acc = Array.isArray(a.accessories)
    ? [...new Set(a.accessories.filter((x): x is string => typeof x === 'string' && ACC_IDS.has(x)))].slice(0, 3)
    : [];
  const h = typeof a.height === 'number' && Number.isFinite(a.height) ? a.height : 1;
  return {
    body: id(a.body, DEFAULT_AVATAR.body),
    hair: id(a.hair, DEFAULT_AVATAR.hair),
    skin: color(a.skin, DEFAULT_AVATAR.skin),
    hairColor: color(a.hairColor, DEFAULT_AVATAR.hairColor),
    top: color(a.top, DEFAULT_AVATAR.top),
    bottom: color(a.bottom, DEFAULT_AVATAR.bottom),
    shoes: color(a.shoes, DEFAULT_AVATAR.shoes),
    sleeves: a.sleeves === 'long' ? 'long' : 'short',
    build: a.build === 'slim' || a.build === 'athletic' ? a.build : 'regular',
    accessories: acc,
    height: Math.min(1.08, Math.max(0.92, h)),
  };
}

export function randomAvatar(bodies: string[], hairs: string[]): AvatarConfig {
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
  return {
    body: bodies.length ? pick(bodies) : 'default',
    hair: hairs.length ? pick(hairs) : 'default',
    skin: pick(SKIN_TONES),
    hairColor: pick(HAIR_COLORS),
    top: pick(CLOTH_COLORS),
    bottom: pick(CLOTH_COLORS),
    shoes: pick(['#2d3142', '#333333', '#ffffff', '#8b5e3c', '#f4f1ea']),
    sleeves: Math.random() < 0.5 ? 'short' : 'long',
    build: Math.random() < 0.5 ? 'slim' : 'regular',
    accessories: Math.random() < 0.3 ? ['glasses'] : [],
    height: 0.96 + Math.random() * 0.08,
  };
}
