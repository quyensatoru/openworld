import type * as THREE from 'three';
import type { AvatarConfig } from '../../../shared/avatar';
import type { SeatKind } from '../../../shared/map';
import type { AnimState, Emote } from '../../../shared/protocol';

export interface DriveState {
  speed: number; // horizontal speed in m/s (actual, after smoothing)
  anim: AnimState;
  seatKind: SeatKind | null;
  lookAt: THREE.Vector3 | null; // world-space point to glance at
  talking: boolean;
  /** Something held in the right hand for a while (karaoke mic). */
  hold?: 'mic' | null;
}

export interface Avatar {
  /** Add to the scene; the owner sets position (feet) and rotation.y (facing). */
  readonly root: THREE.Object3D;
  /** Approximate top-of-head height in metres (for name tags). */
  readonly height: number;
  update(dt: number, s: DriveState): void;
  emote(e: Emote): void;
  /** Fade out whatever emote is playing (e.g. stepping off the dance floor). */
  cancelEmote?(): void;
  setConfig(cfg: AvatarConfig): void;
  dispose(): void;
}
