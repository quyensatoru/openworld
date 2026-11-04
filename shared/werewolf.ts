// Ma Sói (werewolf) at the camp fire on floor 4: the server (worker/werewolf.ts) is the game master.
// Everyone gets a personal view: your own role, your pack if you are a wolf, everything once dead.

export type WolfRole = 'wolf' | 'alpha' | 'minion' | 'seer' | 'guard' | 'witch' | 'hunter' | 'cupid' | 'villager' | 'fool' | 'killer';
/** Who a role plays for. `lovers` is not a role team: a cross-team couple becomes their own side. */
export type WolfTeam = 'wolves' | 'village' | 'fool' | 'killer' | 'lovers';

export interface RoleMeta {
  name: string;
  emoji: string;
  team: 'wolves' | 'village' | 'fool' | 'killer';
  color: string;
  desc: string;
  night?: string;
}

export const ROLE_META: Record<WolfRole, RoleMeta> = {
  wolf: {
    name: 'Ma Sói',
    emoji: '🐺',
    team: 'wolves',
    color: '#e5566b',
    desc: 'Mỗi đêm cùng bầy sói chọn một người để cắn. Ban ngày giả làm dân lành, đừng để bị lộ!',
    night: 'Cả bầy thức dậy và chọn con mồi (bầy sói nghe được nhau).',
  },
  alpha: {
    name: 'Sói Đầu Đàn',
    emoji: '🐺👑',
    team: 'wolves',
    color: '#c2185b',
    desc: 'Một con sói, nhưng Tiên Tri soi bạn sẽ thấy “không phải sói”. Dẫn bầy và đánh lạc hướng cả làng.',
    night: 'Cả bầy thức dậy và chọn con mồi (bầy sói nghe được nhau).',
  },
  minion: {
    name: 'Kẻ Phản Bội',
    emoji: '🦊',
    team: 'wolves',
    color: '#ff7a3c',
    desc: 'Người thường nhưng theo phe Sói: bạn biết bầy sói là ai (chúng không biết bạn). Tiên Tri soi bạn ra “không phải sói”. Bảo vệ bầy sói bằng mọi giá — sói thắng là bạn thắng.',
  },
  seer: {
    name: 'Tiên Tri',
    emoji: '🔮',
    team: 'village',
    color: '#9b5cff',
    desc: 'Mỗi đêm soi một người để biết họ có phải Sói không (Sói Đầu Đàn và Kẻ Phản Bội vẫn hiện “không phải sói”).',
    night: 'Chọn một người để soi.',
  },
  guard: {
    name: 'Bảo Vệ',
    emoji: '🛡️',
    team: 'village',
    color: '#3f8cff',
    desc: 'Mỗi đêm bảo vệ một người khỏi bị cắn hoặc bị đâm (được tự bảo vệ mình), nhưng không được bảo vệ cùng một người hai đêm liên tiếp.',
    night: 'Chọn một người để bảo vệ đêm nay.',
  },
  witch: {
    name: 'Phù Thuỷ',
    emoji: '🧪',
    team: 'village',
    color: '#2fbf8f',
    desc: 'Một bình cứu (cứu người bị Sói cắn, trừ chính mình) và một bình độc. Mỗi bình dùng một lần, mỗi đêm tối đa một bình.',
    night: 'Biết ai bị cắn — cứu, đầu độc ai đó, hoặc không làm gì.',
  },
  hunter: {
    name: 'Thợ Săn',
    emoji: '🏹',
    team: 'village',
    color: '#f0a35e',
    desc: 'Khi bị cắn, bị đâm hoặc bị treo cổ, được bắn chết một người bất kỳ trước khi gục xuống.',
  },
  cupid: {
    name: 'Thần Tình Yêu',
    emoji: '💘',
    team: 'village',
    color: '#ff6fae',
    desc: 'Đêm đầu tiên bắn mũi tên ghép đôi hai người (có thể là chính bạn). Một người chết thì người kia chết theo. Nếu cặp đôi khác phe, họ thành phe riêng: thắng khi chỉ còn hai người họ.',
    night: 'Chọn hai người để ghép thành một cặp.',
  },
  villager: {
    name: 'Dân Làng',
    emoji: '🧑‍🌾',
    team: 'village',
    color: '#7cc4a4',
    desc: 'Không có năng lực đặc biệt, chỉ có cái miệng và cái đầu. Tìm ra Sói và treo cổ chúng!',
  },
  fool: {
    name: 'Thằng Ngố',
    emoji: '🤡',
    team: 'fool',
    color: '#ffd23f',
    desc: 'Phe thứ ba. Bạn thắng một mình nếu bị cả làng treo cổ! Hãy cư xử thật đáng ngờ — nhưng đừng lộ liễu quá. Bị sói cắn thì thua.',
  },
  killer: {
    name: 'Sát Nhân',
    emoji: '🔪',
    team: 'killer',
    color: '#8b0000',
    desc: 'Phe thứ ba. Mỗi đêm tự tay đâm một người. Sói cắn bạn không chết. Thắng khi bạn là người cuối cùng (còn lại 1 chọi 1).',
    night: 'Chọn một người để ra tay.',
  },
};

export const isWolf = (r: WolfRole | null | undefined) => r === 'wolf' || r === 'alpha';

export const TEAM_LABEL: Record<WolfTeam, string> = {
  wolves: '🐺 PHE SÓI THẮNG',
  village: '🏡 DÂN LÀNG THẮNG',
  fool: '🤡 THẰNG NGỐ THẮNG',
  killer: '🔪 SÁT NHÂN THẮNG',
  lovers: '💘 CẶP ĐÔI THẮNG',
};

export type WolfPhase = 'lobby' | 'starting' | 'reveal' | 'night' | 'witch' | 'dawn' | 'hunter' | 'day' | 'vote' | 'defense' | 'verdict' | 'end';

export const PHASE_LABEL: Record<WolfPhase, string> = {
  lobby: 'Chờ người chơi',
  starting: 'Sắp bắt đầu',
  reveal: 'Nhận vai',
  night: 'Ban đêm',
  witch: 'Ban đêm · Phù thuỷ',
  dawn: 'Bình minh',
  hunter: 'Thợ săn ngắm bắn',
  day: 'Thảo luận',
  vote: 'Bỏ phiếu',
  defense: 'Bào chữa',
  verdict: 'Phán quyết',
  end: 'Kết thúc',
};

/** Roles the host can switch on in custom mode (wolves and villagers are counted separately). */
export const SPECIALS = ['alpha', 'minion', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'fool', 'killer'] as const;
export type Special = (typeof SPECIALS)[number];

export interface WolfSettings {
  /** 'auto' picks wolves + special roles by table size; 'custom' uses the switches below. */
  mode: 'auto' | 'custom';
  /** Wolves in total (an Alpha counts as one of them). */
  wolves: number;
  roles: Record<Special, boolean>;
  /** Discussion time, seconds. */
  dayS: number;
  /** Show a dead player's role to everyone. */
  reveal: boolean;
  /** The dead and onlookers see everyone's role (off: they could pass it on in chat / out loud). */
  ghostsSee: boolean;
}

export const WOLF_DEFAULTS: WolfSettings = {
  mode: 'auto',
  wolves: 2,
  roles: { alpha: true, minion: true, seer: true, guard: true, witch: true, hunter: false, cupid: false, fool: true, killer: false },
  dayS: 150,
  reveal: true,
  ghostsSee: false,
};
export const WOLF_MIN = 5;
export const WOLF_MAX = 12;
export const DAY_CHOICES = [90, 120, 150, 180, 240, 300];

export interface WolfPlayer {
  id: string;
  name: string;
  seat: string;
  alive: boolean;
  /** Only when you may know it (yourself, your pack, revealed deaths, the end; the dead if allowed). */
  role: WolfRole | null;
  /** How they died (shown on their card). */
  cause?: 'wolf' | 'poison' | 'hang' | 'shot' | 'left' | 'stab' | 'heart';
  /** In love (shown to the couple, Cupid, at the end; the dead if allowed). */
  lover?: boolean;
}

export interface WolfLog {
  t: number;
  text: string;
  kind: 'night' | 'day' | 'death' | 'vote' | 'info' | 'win';
}

export type WolfVoice = 'all' | 'wolves' | 'ghosts' | 'listen' | 'accused' | 'lovers';

export interface WolfMe {
  inGame: boolean;
  alive: boolean;
  role: WolfRole | null;
  /** Wolves: the pack · Kẻ Phản Bội: the wolves (ids). */
  mates: string[];
  /** Your partner if Cupid paired you. */
  lover: string | null;
  /** Your night job right now, if any. */
  act: {
    kind: 'kill' | 'protect' | 'check' | 'witch' | 'shoot' | 'pair' | 'stab';
    targets: string[];
    chosen: string | null;
    /** cupid: the two picked */
    pair?: string[];
    done: boolean;
    /** witch: who the wolves attacked, and which bottles are left */
    victim?: string | null;
    save?: boolean;
    poison?: boolean;
    used?: 'save' | 'poison' | null;
  } | null;
  /** Wolves: each wolf's pick tonight. */
  pack?: Record<string, string>;
  /** Seer: what you have learnt. */
  seen: { id: string; wolf: boolean; day: number }[];
  /** Who hears you right now. */
  voice: WolfVoice;
}

export interface WolfView {
  phase: WolfPhase;
  day: number;
  /** Server ms when the phase ends (0 = no timer). */
  until: number;
  host: string | null;
  players: WolfPlayer[];
  /** People sitting at the fire before a game (lobby). */
  seated: { id: string; name: string; seat: string }[];
  settings: WolfSettings;
  log: WolfLog[];
  /** vote: voter → target id or 'skip' · verdict: voter → 'yes' | 'no' */
  votes: Record<string, string>;
  accused: string | null;
  skipDay: string[];
  winner: WolfTeam | null;
  /** Everyone who won (a team, a couple, the fool…). */
  winners: string[];
  me: WolfMe;
}

export type WolfMsg =
  | { a: 'start' }
  | { a: 'settings'; s: Partial<Omit<WolfSettings, 'roles'>> & { roles?: Partial<Record<Special, boolean>> } }
  | { a: 'act'; target: string | null; use?: 'save' | 'poison' | 'pass'; pair?: string[] }
  | { a: 'vote'; target: string }
  | { a: 'verdict'; yes: boolean }
  | { a: 'skipday' }
  | { a: 'abort' };

/** Roles for `n` players. Auto mode is tuned so the wolves have a fair chance at every size. */
export function rolesFor(n: number, s: WolfSettings): WolfRole[] {
  const roles: WolfRole[] = [];
  if (s.mode === 'auto') {
    const table: Record<number, WolfRole[]> = {
      5: ['wolf', 'minion', 'seer'],
      6: ['wolf', 'alpha', 'seer', 'guard', 'fool'],
      7: ['wolf', 'alpha', 'minion', 'seer', 'guard', 'fool'],
      8: ['wolf', 'alpha', 'minion', 'seer', 'guard', 'witch', 'fool'],
      9: ['wolf', 'alpha', 'minion', 'seer', 'guard', 'witch', 'cupid', 'fool'],
      10: ['wolf', 'wolf', 'alpha', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'fool'],
      11: ['wolf', 'wolf', 'alpha', 'minion', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'killer'],
      12: ['wolf', 'wolf', 'alpha', 'minion', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'fool', 'killer'],
    };
    roles.push(...(table[Math.max(5, Math.min(12, n))] ?? table[5]));
  } else {
    const wolves = Math.max(1, Math.min(Math.floor((n - 1) / 2), s.wolves));
    const alpha = s.roles.alpha ? 1 : 0;
    for (let i = 0; i < wolves - alpha; i++) roles.push('wolf');
    if (alpha) roles.push('alpha');
    const specials: WolfRole[] = (['seer', 'minion', 'guard', 'witch', 'fool', 'hunter', 'cupid', 'killer'] as Special[]).filter((r) => s.roles[r]);
    // keep at least one plain villager
    while (roles.length + specials.length > n - 1 && specials.length) specials.pop();
    roles.push(...specials);
  }
  while (roles.length < n) roles.push('villager');
  return roles.slice(0, n);
}
