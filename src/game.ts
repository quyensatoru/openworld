// Glue between the network, the 3D world, proximity RTC and the React store.
import type { AvatarConfig } from '../shared/avatar';
import { BUILD_ID } from '../shared/build';
import type { ArcadeMsg } from '../shared/arcade';
import { BAR, BAR_SCREEN, CINEMA_SCREEN, FLOOR_H, KARA_SCREEN, MIC_SPOTS, SEAT_BY_ID, ZONE_BY_ID, floorOf, groundAt, onStairs, type Seat } from '../shared/map';
import { FX_PRESETS, KARA_SCORE_MS, type KaraMsg, type KaraState, type MicFx } from '../shared/karaoke';
import { ROLE_META, type WolfMsg, type WolfView } from '../shared/werewolf';
import { DOOR_BY_ID, MOLE_BOARD, MOLE_KILL_RANGE, MOLE_REPORT_RANGE, MOLE_VENTS, MOLE_VENT_RANGE, STATION_BY_ID, VENT_BY_ID, VISION, doorMid, doorRect, meetingSpot, type MoleFx, type MoleMsg, type MoleView } from '../shared/mole';
import { Ambience, MUSIC_BPM } from './audio/ambience';
import { CinemaPlayer } from './cinema/player';
import { ClaudeScreens, isLive } from './world/claude-screen';
import {
  PICKER_EMOTES,
  WHEEL_PRIZES,
  WHEEL_SPIN_MS,
  parseYouTube,
  type ActivityEvent,
  type CinemaState,
  type Emote,
  type PlayerState,
  type Pomodoro,
  type Priority,
  type ServerMsg,
  type Status,
  type Task,
  type TaskColumn,
} from '../shared/protocol';
import { Net, wsUrl } from './net/socket';
import { loadPref, loadProfile, saveProfile, savePref } from './profile';
import { RelayMedia } from './rtc/relay';
import { getState, nameOf, playerById, serverNow, setState, toast, type FpLook, type FpsCap, type Quality } from './store';
import { askNotificationPermission, chime, flashTitle, notify } from './ui/notify';
import { World } from './world/engine';

interface SavedStatus {
  status: Status;
  text: string;
}

class Game {
  net: Net | null = null;
  world: World | null = null;
  rtc: RelayMedia | null = null;
  private zoneId = '';
  private pomoTimer: number | undefined;
  private videoEls = new Map<string, HTMLVideoElement>();
  private welcomed = false;
  cinema: CinemaPlayer | null = null;
  /** The bar's YouTube jukebox (loops; replaces the house music while it plays). */
  jukebox: CinemaPlayer | null = null;
  private screens = new ClaudeScreens();
  private ambience: Ambience | null = null;
  private fastTimer: number | undefined;
  private autoFirstPerson = false;
  private wasInCinema = false;
  private wasInBar = false;
  private pcSeated = false;
  /** Karaoke LED wall (YouTube, in sync for the room; listeners run a little behind the singers). */
  karaPlayer: CinemaPlayer | null = null;
  private singing = false;
  private karaVoice = { sid: '', sung: 0, heard: 0, sent: 0 };
  private karaCount = -1;
  private wasInKara = false;
  private spoken = 0;

  // ------------------------------------------------------------------ lifecycle
  start(container: HTMLElement) {
    if (this.world) return;
    if (!webglAvailable()) {
      setState({ glError: 'no-webgl' });
      return;
    }
    askNotificationPermission();
    let world: World;
    try {
      world = this.createWorld(container);
    } catch (err) {
      console.error('[3d] cannot start', err);
      setState({ glError: String((err as Error)?.message ?? err) });
      return;
    }
    this.startWith(world);
  }

  private createWorld(container: HTMLElement): World {
    return new World(
      container,
      {
        onLocalMove: (x, z, ry, anim) => {
          this.net?.send({ t: 'move', x: round(x), z: round(z), ry: round(ry), anim });
          this.rtc?.evaluate();
        },
        onSit: (seat) => this.onSit(seat),
        onStandUp: () => {
          if (this.pcSeated) {
            this.pcSeated = false;
            setState({ arcadeOpen: false });
            this.arcade({ a: 'snake:leave' });
            this.arcade({ a: 'caro:cancel' });
          }
          this.net?.send({ t: 'sit', seat: null });
          this.patchMe({ seat: null, anim: 'idle' });
          this.syncAutoStatus();
          if (this.autoFirstPerson) {
            this.autoFirstPerson = false;
            this.world?.setViewMode('third');
          }
          setTimeout(() => this.refreshScreens(), 0);
        },
        onInteract: (id) => this.interact(id),
        onSelect: (id) => setState({ selected: id }),
        onPrompt: (text) => {
          if (getState().prompt !== text) setState({ prompt: text });
        },
        onZoneChange: (zone) => {
          this.zoneId = zone;
          // the werewolf night hush only applies to players — never carry it out of the village
          if (zone !== 'wolfroom' && !getState().wolf?.me.inGame) this.micHold(false);
          this.patchMe({ zone });
          this.syncAutoStatus();
          this.rtc?.evaluate();
          this.updateTvs();
          this.onCinemaZone();
        },
        onEmoteKey: (i) => {
          const e = i < 0 ? 'jump' : PICKER_EMOTES[i];
          if (e) this.emote(e);
        },
        onSeatTaken: () => toast('Ghế này đã có người ngồi rồi 🙂', 'warn'),
        onFloorChange: (floor) => {
          setState({ floor });
          chime('near', 0.03);
          toast(
            [
              '🏢 Tầng 1 — Văn phòng',
              '⬆️ Tầng 2 — 🎬 Rạp phim bên trái · 🍸 BSS Bar bên phải · cầu thang lên tầng 3 ở góc phải',
              '🎮 Tầng 3 — phòng game BSS Net bên phải · cầu thang lên tầng 4 ở bên trái',
              '🎤 Tầng 4 — phòng Karaoke bên trái · 🐺 Làng Ma Sói bên phải · cầu thang lên tầng 5 ở góc phải',
              getState().touch ? '🕵️ Tầng 5 — Nội Gián: tới bảng trong sảnh, bấm nút ✋ để tham gia' : '🕵️ Tầng 5 — Nội Gián: bấm E ở bảng trong sảnh để tham gia',
            ][floor],
            'info',
            3500,
          );
        },
        inputBlocked: () => getState().arcadeOpen || !!getState().moleTask || getState().cctv,
        onGraphicsLost: (lost) => setState({ glLost: lost }),
        onLift: (phase, from, to) => {
          this.ambience?.ding();
          if (phase === 'start') toast(`🛗 Thang máy đang ${to > from ? 'lên' : 'xuống'} tầng ${to + 1}…`, 'info', 2200);
        },
        onLiftPanel: (f) => setState({ liftPanel: f }),
        taskTitle: (id) => (id ? getState().tasks[id]?.title ?? null : null),
        onViewMode: (mode) => setState({ viewMode: mode }),
        onOpenMonitor: (deskId) => {
          const s = getState();
          const id = s.me?.seat === deskId ? s.me.id : Object.values(s.players).find((p) => p.seat === deskId)?.id;
          if (id) setState({ screenOf: id });
        },
        onOpenTv: (zone) => this.openTv(zone),
        onStep: (_id: string, x: number, z: number, run: boolean, self: boolean): void => {
          const me = this.world?.positionOf(getState().me?.id ?? '');
          this.ambience?.step({ x: me?.x ?? x, z: me?.z ?? z, yaw: this.world?.cameraYaw ?? 0 }, x, z, run, self);
        },
      },
      getState().quality,
    );
  }

  private startWith(world: World) {
    this.world = world;
    world.interactLabel = (id) => this.moleLabel(id);
    world.setFpLook(getState().fpLook);
    world.setFpsCap(getState().fpsCap);
    world.serverClock = () => serverNow() / 1000;
    world.beatClock = () => (serverNow() / 1000) * (MUSIC_BPM / 60);

    const rtc = new RelayMedia({
      myId: () => getState().me?.id ?? null,
      me: () => getState().me,
      player: (id) => getState().players[id] ?? null,
      playerIds: () => Object.keys(getState().players),
      positionOf: (id) => world.positionOf(id),
      sendBinary: (data) => this.net?.sendBinary(data),
      onPeersChanged: () => this.syncPeers(),
      onSpeaking: (id, on) => {
        world.setSpeaking(id, on);
        if (id === getState().me?.id) setState({ meSpeaking: on });
        else this.syncPeers();
      },
      gainFor: (id) => {
        // karaoke: while someone sings, everyone else's chatter sits a bit lower
        const k = getState().kara;
        if (this.zoneId !== 'karaoke' || !k.now || !k.mics.length) return 1;
        return k.mics.some((m) => m.id === id) ? 1 : 0.6;
      },
      onPeerConnected: (id) => {
        if (!getState().media.mic) return;
        chime('near', 0.05);
        if (document.hidden) notify('Có người lại gần', `${nameOf(id)} đang ở cạnh bạn trong văn phòng`);
      },
    });
    rtc.onLocalMedia = (media, cam, screen) => {
      setState({ media, localCam: cam, localScreen: screen });
      this.net?.send({ t: 'media', media });
      this.patchMe({ media });
      world.setVoiceRing(media.mic);
      this.updateTvs();
    };
    this.rtc = rtc;

    const net = new Net(wsUrl());
    this.net = net;
    net.onOpen = () => {
      const profile = loadProfile();
      const me = getState().me;
      net.sendNow({ t: 'hello', cid: profile.cid, name: profile.name, avatar: profile.avatar!, ...(me ? { x: me.x, z: me.z, ry: me.ry } : {}) });
    };
    net.onBinary = (data) => rtc.onBinary(data);
    net.onStatus = (connected) => {
      setState({ connected });
      if (!connected) rtc.reset();
    };
    this.bindNet(net);
    net.connect();

    // cinema + ambience + live Claude screens
    const cinema = new CinemaPlayer(world, serverNow, { screen: CINEMA_SCREEN, setVideo: (on) => world.office.setCinemaVideo(on) });
    cinema.onTitle = (title) => this.net?.send({ t: 'cinema', action: 'title', title });
    cinema.onNeedsClick = () => toast(`🔇 Trình duyệt chặn tự phát tiếng — ${getState().touch ? 'chạm màn hình' : 'bấm chuột'} một lần để bật âm thanh phim.`, 'info', 6000);
    this.cinema = cinema;
    const jukebox = new CinemaPlayer(world, serverNow, { screen: BAR_SCREEN, setVideo: (on) => world.office.bar.setVideo(on), loop: true });
    jukebox.onTitle = (title) => this.net?.send({ t: 'jukebox', action: 'title', title });
    jukebox.onNeedsClick = () => toast(`🔇 Trình duyệt chặn tự phát tiếng — ${getState().touch ? 'chạm màn hình' : 'bấm chuột'} một lần để nghe nhạc.`, 'info', 6000);
    jukebox.setVolume(loadPref('jukeboxVolume', 70));
    this.jukebox = jukebox;
    const kara = new CinemaPlayer(world, serverNow, {
      screen: KARA_SCREEN,
      setVideo: (on) => world.office.setKaraVideo(on),
      // a singer's voice reaches the room ~0.25 s late: everyone else plays the video that much later
      lag: () => (this.singing || !getState().kara.mics.length ? 0 : 0.24),
      onError: (code) => {
        const now = getState().kara.now;
        if (now && this.zoneId === 'karaoke') this.kara({ a: 'broken', sid: now.song.sid });
        console.warn('[karaoke] video error', code);
      },
    });
    kara.onMeta = (title, dur) => {
      const now = getState().kara.now;
      if (now) this.kara({ a: 'meta', sid: now.song.sid, title, dur });
    };
    kara.onNeedsClick = () => toast(`🔇 Trình duyệt chặn tự phát tiếng — ${getState().touch ? 'chạm màn hình' : 'bấm chuột'} một lần để nghe nhạc karaoke.`, 'info', 6000);
    kara.setVolume(loadPref('karaVolume', 80));
    this.karaPlayer = kara;
    const amb = getState().ambience;
    this.ambience = new Ambience(amb.on, amb.volume);
    this.ambience.clock = () => serverNow() / 1000;
    world.office.bar.onWheelTick = () => this.ambience?.wheelTick();
    const unlock = () => {
      this.ambience?.start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.fastTimer = window.setInterval(() => this.fastTick(), 60);

    this.pomoTimer = window.setInterval(() => this.tickPomodoro(), 1000);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private fastFrame = 0;
  /** ~16 Hz: keyboard ambience, cinema sync, Claude screen spinners. */
  private fastTick() {
    const world = this.world;
    const s = getState();
    if (!world || !s.me) return;
    this.fastFrame++;
    const me = world.positionOf(s.me.id);
    if (!me) return;
    if (this.ambience && !document.hidden) {
      const typists: { id: string; x: number; z: number }[] = [];
      const all = [s.me, ...Object.values(s.players)];
      for (const p of all) {
        const seat = p.id === s.me.id ? world.localSeat : p.seat ? SEAT_BY_ID.get(p.seat) : null;
        if (!seat || (seat.kind !== 'desk' && seat.kind !== 'focus')) continue;
        const pos = world.positionOf(p.id);
        if (pos) typists.push({ id: p.id, x: pos.x, z: pos.z });
      }
      this.ambience.tick({ x: me.x, z: me.z, yaw: world.cameraYaw }, typists);
      if (this.fastFrame % 4 === 0) this.updateMusic(me);
      this.ambience.tickMusic();
    }
    // the arena screen in BSS Net animates between server frames (countdown, pulsing food)
    if (this.zoneId === 'netcafe' && this.fastFrame % 3 === 0) world.office.updateNetScreen(s.snake, serverNow());
    if (this.fastFrame % 24 === 0) {
      this.cinema?.sync();
      this.jukebox?.sync();
      this.karaPlayer?.sync();
    }
    if (floorOf(me.x) === 3) this.karaTick();
    if (floorOf(me.x) === 4 || getState().mole?.me.inGame) this.moleTick();
    if (this.fastFrame % 16 === 0 && getState().wolf) world.office.updateWolfBoard(getState().wolf, serverNow());
    if (this.fastFrame % 6 === 0) {
      const now = serverNow();
      for (const p of [s.me, ...Object.values(s.players)]) {
        if (!p.seat || !s.activity[p.id]) continue;
        const pos = world.positionOf(p.id);
        if (pos && Math.hypot(pos.x - me.x, pos.z - me.z) < 14 && isLive(s.activity[p.id], now)) this.screens.animate(p.id, p.name, s.activity[p.id], now);
      }
    }
  }

  /** Desk monitors show the Claude Code feed of whoever sits there. */
  private refreshScreens() {
    const world = this.world;
    const s = getState();
    if (!world || !s.me) return;
    const now = serverNow();
    const seated = new Map<string, PlayerState>();
    for (const p of [s.me, ...Object.values(s.players)]) {
      const seatId = p.id === s.me.id ? world.localSeat?.id ?? null : p.seat;
      if (seatId) seated.set(seatId, p);
    }
    for (const seat of SEAT_BY_ID.values()) {
      if (seat.kind !== 'desk' && seat.kind !== 'focus') continue;
      const p = seated.get(seat.id);
      world.office.setMonitorMaterial(seat.id, p ? this.screens.material(p.id, p.name, s.activity[p.id], now) : null);
    }
  }

  /** Bar music: full in the bar, muffled in the hall / cinema, silent downstairs. */
  private updateMusic(me: { x: number; z: number }) {
    const kind = ZONE_BY_ID.get(this.zoneId)?.kind;
    const c = getState().cinema;
    const jb = getState().jukebox;
    let level = 0;
    let cutoff = 18000;
    if (floorOf(me.x) === 1 && !onStairs(me.x, me.z)) {
      if (kind === 'bar') level = 1;
      else if (kind === 'cinema') {
        level = c && c.pausedAt == null ? 0 : 0.1;
        cutoff = 320;
      } else {
        const d = Math.hypot(me.x - (BAR.x0 + BAR.x1) / 2, me.z - BAR.z1);
        level = Math.max(0.1, Math.min(0.5, 0.6 - d / 30));
        cutoff = 650 + 2400 * Math.max(0, 1 - d / 8);
      }
    } else if (onStairs(me.x, me.z)) {
      level = 0.1 * (groundAt(me.x, me.z) / FLOOR_H);
      cutoff = 450;
    }
    // someone picked a song on the jukebox: it replaces the house music
    this.ambience?.setMusic(jb && jb.pausedAt == null ? 0 : level, cutoff);
  }

  private onCinemaZone() {
    const inside = this.zoneId === 'cinema';
    this.cinema?.setInside(inside);
    // the jukebox plays in the bar, and (quieter) in the upstairs hall
    const kind = ZONE_BY_ID.get(this.zoneId)?.kind;
    this.jukebox?.setLevel(kind === 'bar' ? 1 : 0.25);
    this.jukebox?.setInside(kind === 'bar' || this.zoneId === 'hall2');
    if ((kind === 'bar') !== this.wasInBar) {
      this.wasInBar = kind === 'bar';
      setState({ barPanel: this.wasInBar && !getState().jukebox });
    }
    const film = inside && !!getState().cinema && getState().cinema!.pausedAt == null;
    this.world?.setDim(film ? 1 : 0, ZONE_BY_ID.get(this.zoneId)?.kind === 'bar' ? 1 : 0);
    // floor 4: the karaoke room (dark, colourful) and the werewolf village (fire light / night)
    const inKara = this.zoneId === 'karaoke';
    this.karaPlayer?.setLevel(inKara ? 1 : 0.16);
    this.karaPlayer?.setInside(inKara || this.zoneId === 'hall4');
    if (inKara !== this.wasInKara) {
      this.wasInKara = inKara;
      if (!inKara) {
        setState({ karaZoom: false });
        this.world?.setScreenView(null);
      }
    }
    if (inKara) this.world?.setDim(0, 0.88, 'kara');
    else if (this.zoneId === 'wolfroom') {
      const ph = getState().wolf?.phase;
      const night = ph === 'night' || ph === 'witch' || ph === 'reveal';
      this.world?.setDim(0, night ? 1 : 0.62, night ? 'night' : 'camp');
    }
    if (this.zoneId.startsWith('f5-')) {
      const mv = getState().mole;
      const blackout = !!mv && mv.phase === 'play' && mv.lights > serverNow() && mv.me.inGame && mv.me.alive && mv.me.role === 'crew';
      // floor 5: lamps on = the room you're in is lit (everything else is under the shroud);
      // a blackout makes it nearly pitch black for employees
      this.world?.setDim(0, blackout ? 0.97 : 0.32, blackout ? 'night' : 'facility');
      this.world?.office.setF5Lamps(!(mv && mv.phase === 'play' && mv.lights > serverNow()));
    }
    this.ambience?.setQuietZone(inside || ZONE_BY_ID.get(this.zoneId)?.kind === 'focus' || inKara || this.zoneId === 'wolfroom');
    this.ambience?.setHum(this.zoneId.startsWith('f5-'));
    if (inside !== this.wasInCinema) {
      this.wasInCinema = inside;
      // entering: show the controls unless a film is already running (then keep them out of the way)
      setState({ cinemaPanel: inside && !(getState().cinema && getState().cinema!.pausedAt == null) });
    }
  }

  stop() {
    clearInterval(this.pomoTimer);
    clearInterval(this.fastTimer);
    this.cinema?.dispose();
    this.cinema = null;
    this.jukebox?.dispose();
    this.jukebox = null;
    this.karaPlayer?.dispose();
    this.karaPlayer = null;
    window.speechSynthesis?.cancel();
    this.ambience?.dispose();
    this.ambience = null;
    this.screens.dispose();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.net?.close();
    this.rtc?.dispose();
    this.world?.dispose();
    this.net = null;
    this.rtc = null;
    this.world = null;
    this.welcomed = false;
    setState({ me: null, players: {}, connected: false, peers: {} });
  }

  private onVisibility = () => {
    this.ambience?.setVisible(!document.hidden);
    if (!document.hidden) setState({ unread: getState().panel === 'chat' ? 0 : getState().unread });
  };

  // ------------------------------------------------------------------ network
  private bindNet(net: Net) {
    net.on('welcome', (m) => this.onWelcome(m));
    net.on('join', ({ p }) => {
      setState((s) => ({ players: { ...s.players, [p.id]: p }, team: { ...s.team, [p.id]: { id: p.id, name: p.name, avatar: p.avatar, lastSeen: Date.now(), desk: s.team[p.id]?.desk ?? null, today: s.team[p.id]?.today ?? null } } }));
      this.world?.upsertRemote(p);
      this.rtc?.evaluate(p.id);
      if (this.welcomed) {
        toast(`👋 ${p.name} vừa vào văn phòng`);
        chime('join', 0.05);
      }
    });
    net.on('leave', ({ id }) => {
      const p = getState().players[id];
      setState((s) => {
        const players = { ...s.players };
        delete players[id];
        const team = s.team[id] ? { ...s.team, [id]: { ...s.team[id], lastSeen: Date.now() } } : s.team;
        return { players, team, selected: s.selected === id ? null : s.selected };
      });
      this.world?.removePlayer(id);
      this.rtc?.onPlayerLeft(id);
      if (p) toast(`${p.name} đã rời văn phòng`);
      this.updateTvs();
    });
    net.on('upd', ({ id, patch }) => {
      const s = getState();
      if (s.me?.id === id) {
        setState({ me: { ...s.me, ...patch } });
      } else if (s.players[id]) {
        setState({ players: { ...s.players, [id]: { ...s.players[id], ...patch } } });
      }
      this.world?.applyPatch(id, patch);
      if ('status' in patch || 'zone' in patch || 'seat' in patch) this.rtc?.evaluate(id === s.me?.id ? undefined : id);
      if ('media' in patch || 'zone' in patch) this.updateTvs();
      if ('media' in patch) this.syncPeers();
      if ('seat' in patch || 'name' in patch) this.refreshScreens();
    });
    net.on('mv', ({ id, x, z, ry, anim }) => {
      this.world?.remoteMove(id, x, z, ry, anim);
      this.rtc?.evaluate(id);
    });
    net.on('chat', ({ m }) => {
      const s = getState();
      setState({ chat: [...s.chat.slice(-299), m] });
      const mine = m.from === s.me?.id;
      if (m.from !== 'system') this.world?.say(m.from, m.text);
      if (!mine) {
        const panelVisible = s.panel === 'chat' && !document.hidden;
        if (!panelVisible) setState({ unread: getState().unread + 1 });
        const myName = s.me?.name ?? '';
        if (myName && mentions(m.text, myName)) {
          chime('ping');
          toast(`💬 ${m.name} nhắc đến bạn: ${m.text}`, 'info', 7000);
          notify(`${m.name} nhắc đến bạn`, m.text);
          flashTitle('💬 Có người nhắc bạn');
        }
      }
    });
    net.on('emote', ({ id, e }) => {
      this.world?.emote(id, e);
      if (e === 'toast') this.onToast(id);
    });
    net.on('wheel', (m) => this.onWheel(m.by, m.name, m.prize, m.at));
    net.on('kara', ({ s }) => this.applyKara(s));
    net.on('karaReact', ({ id, e }) => this.onKaraReact(id, e));
    net.on('wolf', ({ v }) => this.applyWolf(v));
    net.on('mole', ({ v }) => this.applyMole(this.cleanMole(v)));
    net.on('moleFx', ({ fx }) => this.onMoleFx(fx));
    net.on('snake', ({ f }) => {
      setState({ snake: f });
      if (this.zoneId === 'netcafe') this.world?.office.updateNetScreen(f, serverNow());
    });
    net.on('caro', ({ g, queued }) => {
      const prev = getState().caro;
      setState({ caro: g, caroQueued: queued });
      const me = getState().me?.id;
      if (g && (!prev || prev.id !== g.id) && !g.winner) {
        const opp = g.x === me ? g.oName : g.xName;
        toast(`⭕ Ván caro mới với ${opp} — bạn cầm ${g.x === me ? 'X (đi trước)' : 'O'}`, 'info', 3500);
        chime('join', 0.06);
        if (!getState().arcadeOpen) setState({ arcadeOpen: true, arcadeTab: 'caro' });
      }
    });
    net.on('wave', ({ name }) => {
      chime('wave');
      toast(`👋 ${name} vẫy tay chào bạn!`, 'wave', 6000);
      notify('👋 Có người vẫy tay', `${name} đang vẫy tay chào bạn`);
      flashTitle(`👋 ${name} vẫy tay`);
    });
    net.on('task', ({ task, by }) => {
      const prev = getState().tasks[task.id];
      setState((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
      this.world?.setTasks(Object.values(getState().tasks));
      if (task.col === 'done' && prev && prev.col !== 'done') {
        this.world?.confetti(task.assignee && playerById(task.assignee) ? task.assignee : by);
        if (task.assignee === getState().me?.id || by === getState().me?.id) chime('done');
      }
    });
    net.on('taskDel', ({ id }) => {
      setState((s) => {
        const tasks = { ...s.tasks };
        delete tasks[id];
        return { tasks };
      });
      this.world?.setTasks(Object.values(getState().tasks));
    });
    net.on('today', ({ today }) => {
      setState({ today });
      this.updateWhiteboard();
    });
    net.on('team', ({ member }) =>
      setState((s) => ({ team: { ...s.team, [member.id]: { ...s.team[member.id], ...member, desk: member.desk ?? s.team[member.id]?.desk ?? null } } })),
    );
    net.on('cinema', ({ state, by, action }) => this.applyCinema(state, by, action));
    net.on('jukebox', ({ state, by, action }) => this.applyJukebox(state, by, action));
    net.on('activity', ({ id, ev }) => {
      setState((s) => ({ activity: { ...s.activity, [id]: [...(s.activity[id] ?? []), ev].slice(-25) } }));
      this.refreshScreens();
      if (ev.kind === 'notify' && id === getState().me?.id) chime('ping', 0.05);
    });
    net.on('activityToken', ({ token }) => setState({ activityToken: token }));
    net.on('kicked', ({ reason }) => {
      setState({ kicked: reason });
      this.rtc?.reset();
    });
    net.on('err', ({ msg }) => {
      toast(msg, 'warn');
      if (/ghế/i.test(msg)) this.world?.controller?.standUp();
    });
  }

  private onWelcome(m: Extract<ServerMsg, { t: 'welcome' }>) {
    // a (re)connect: drop any night hush from before; the fresh game view right after re-applies it
    this.micHold(false);
    const players: Record<string, PlayerState> = {};
    for (const p of m.players) players[p.id] = p;
    const team = Object.fromEntries(m.team.map((t) => [t.id, t]));
    const tasks = Object.fromEntries(m.tasks.map((t) => [t.id, t]));
    const reconnect = this.welcomed;
    const stale = Object.keys(getState().players).filter((id) => !players[id]);
    setState({
      me: m.you,
      players,
      tasks,
      chat: m.chat,
      team,
      today: m.today,
      officeName: m.office.name,
      serverOffset: m.serverTime - Date.now(),
      connected: true,
      kicked: null,
    });
    const world = this.world!;
    // drop remotes that vanished while we were offline
    for (const id of stale) world.removePlayer(id);
    // build ids are build timestamps: a newer server → reload; an older one → it is still switching over
    if (m.build && m.build > BUILD_ID) setState({ updateReady: true, serverStale: false });
    else if (m.build && m.build < BUILD_ID) setState({ serverStale: true, updateReady: false });
    else setState({ serverStale: false });
    world.setLocal(m.you);
    setState({ floor: floorOf(m.you.x) });
    for (const p of m.players) world.upsertRemote(p);
    world.setTasks(m.tasks);
    setState({ activity: m.activity as Record<string, ActivityEvent[]> });
    this.applyCinema(m.cinema, '', 'welcome');
    this.applyJukebox(m.jukebox ?? null, '', 'welcome');
    if (m.kara) this.applyKara(m.kara);
    this.zoneId = m.you.zone;
    this.rtc?.reset();

    // restore personal state the server does not keep across sessions
    const media = this.rtc?.media;
    if (media) this.net?.send({ t: 'media', media }); // also tells the room whether we can decode Opus voice
    const pomo = loadPref<Pomodoro | null>('pomo', null);
    if (pomo && pomo.endsAt > serverNow()) this.setPomo(pomo);
    const saved = loadPref<SavedStatus | null>('status', null);
    if (saved) this.net?.send({ t: 'status', status: saved.status, manual: true, text: saved.text });
    else this.syncAutoStatus();
    this.welcomed = true;
    this.onCinemaZone();
    setTimeout(() => this.refreshScreens(), 0);
    this.updateWhiteboard();
    this.updateTvs();
    this.rtc?.evaluate();
    if (!reconnect)
      toast(
        getState().touch
          ? `Chào mừng đến ${m.office.name}! Kéo cần gạt bên trái để đi, chạm vào ghế để ngồi, vuốt màn hình để xoay, chụm 2 ngón để thu phóng 🙌`
          : `Chào mừng đến ${m.office.name}! WASD để đi, click vào ghế để ngồi 🙌`,
        'success',
        6000,
      );
  }

  private patchMe(patch: Partial<PlayerState>) {
    const me = getState().me;
    if (me) setState({ me: { ...me, ...patch } });
  }

  // ------------------------------------------------------------------ status
  private autoStatus(): Status {
    const me = getState().me;
    if (!me) return 'online';
    if (me.pomo?.mode === 'focus') return 'focus';
    const seat = this.world?.localSeat;
    const zone = ZONE_BY_ID.get(this.zoneId);
    if (seat?.kind === 'desk') return 'working';
    if (seat?.kind === 'focus' || zone?.kind === 'focus') return 'focus';
    if (zone?.kind === 'meeting') return 'meeting';
    if (zone?.kind === 'pantry' || zone?.kind === 'lounge' || zone?.kind === 'cinema' || zone?.kind === 'bar' || zone?.kind === 'game' || zone?.kind === 'karaoke' || zone?.kind === 'wolf' || zone?.kind === 'mole') return 'break';
    return 'online';
  }

  private syncAutoStatus() {
    const me = getState().me;
    if (!me || me.statusManual) return;
    const s = this.autoStatus();
    if (s !== me.status) {
      this.net?.send({ t: 'status', status: s, manual: false });
      this.patchMe({ status: s });
    }
  }

  setStatus(status: Status | 'auto', text = '') {
    if (status === 'auto') {
      savePref('status', null);
      this.patchMe({ statusManual: false, statusText: '' });
      const s = this.autoStatus();
      this.net?.send({ t: 'status', status: s, manual: false, text: '' });
      this.patchMe({ status: s });
    } else {
      savePref('status', { status, text } satisfies SavedStatus);
      this.net?.send({ t: 'status', status, manual: true, text });
      this.patchMe({ status, statusManual: true, statusText: text });
    }
    this.rtc?.evaluate();
  }

  // ------------------------------------------------------------------ pomodoro
  startPomodoro(mode: 'focus' | 'break', minutes: number) {
    const now = serverNow();
    this.setPomo({ mode, startedAt: now, endsAt: now + minutes * 60_000 });
    chime('join', 0.06);
  }

  stopPomodoro() {
    this.setPomo(null);
  }

  private setPomo(pomo: Pomodoro | null, completed = false) {
    savePref('pomo', pomo);
    this.net?.send({ t: 'pomo', pomo, completed });
    this.patchMe({ pomo });
    this.syncAutoStatus();
    this.rtc?.evaluate();
  }

  private tickPomodoro() {
    const me = getState().me;
    if (!me?.pomo) return;
    if (serverNow() >= me.pomo.endsAt) {
      const wasFocus = me.pomo.mode === 'focus';
      this.setPomo(null, true);
      chime('pomo', 0.15);
      if (wasFocus) {
        toast('🍅 Hết phiên tập trung! Đứng dậy vươn vai, uống nước nhé.', 'success', 9000);
        notify('🍅 Hết giờ tập trung', 'Nghỉ 5 phút rồi quay lại nhé!');
      } else {
        toast('⏰ Hết giờ nghỉ, quay lại làm việc thôi!', 'info', 8000);
        notify('⏰ Hết giờ nghỉ', 'Bắt đầu phiên mới nào!');
      }
      flashTitle('🍅 Pomodoro xong!');
    }
  }

  // ------------------------------------------------------------------ seats & interactions
  private onSit(seat: Seat) {
    this.net?.send({ t: 'sit', seat: seat.id });
    this.patchMe({ seat: seat.id, anim: 'sit' });
    this.syncAutoStatus();
    setTimeout(() => this.refreshScreens(), 0);
    if (seat.kind === 'desk') toast(`Đã ngồi vào ${seat.label}. Chúc làm việc hiệu quả! 💻`, 'success', 3000);
    if (seat.kind === 'pc') {
      this.pcSeated = true;
      setState({ arcadeOpen: true });
    }
    if (seat.zone === 'bar' && seat.id.startsWith('bar-')) setTimeout(() => this.orderDrink(), 600);
    if (seat.kind === 'wolf') {
      setState({ wolfPanel: true });
      const v = getState().wolf;
      if (!v || v.phase === 'lobby') toast('🔥 Bạn đã ngồi vào đống lửa. Đủ 5 người thì ai đó bấm “Bắt đầu” nhé!', 'info', 4000);
    }
    if (seat.kind === 'cinema') {
      // a cinema seat feels like a cinema in first person
      if (this.world?.viewMode === 'third') {
        this.autoFirstPerson = true;
        this.world.setViewMode('first');
      }
      setState({ cinemaPanel: !getState().cinema });
      toast(`🍿 ${seat.label} — kéo chuột để nhìn quanh, phím V để đổi góc nhìn.`, 'info', 4000);
    }
  }

  // ------------------------------------------------------------------ meeting room TV
  /** Show whatever is being shared in that room enlarged (zoomable); otherwise zoom the view onto the TV. */
  openTv(zone: string) {
    const s = getState();
    if (s.me?.media.screen && s.localScreen && this.zoneId === zone) return setState({ bigScreen: 'me' });
    const sharer = Object.values(s.players).find((p) => p.zone === zone && p.media.screen && s.peers[p.id]?.screen);
    if (sharer) return setState({ bigScreen: sharer.id });
    if (this.zoneId === zone) {
      this.world?.lookAtTv(zone);
      toast('🔍 Đang nhìn TV — cuộn chuột để zoom, kéo chuột để nhìn quanh, phím V để thoát.', 'info', 5000);
    }
    if (Object.values(s.players).some((p) => p.zone === zone && p.media.screen)) toast('Đang kết nối tới người chia sẻ màn hình…', 'info');
    else toast('📺 Chưa ai chia sẻ màn hình. Bấm nút "Chia sẻ màn hình" (biểu tượng màn hình) để trình chiếu lên TV.', 'info', 5000);
  }

  // ------------------------------------------------------------------ cinema
  private applyCinema(state: CinemaState | null, by: string, action: string) {
    const prev = getState().cinema;
    setState({ cinema: state });
    // a film starts while you sit in the cinema → fold the controls away so they don't cover it
    if (state && state.pausedAt == null && (!prev || prev.pausedAt != null || prev.videoId !== state.videoId) && this.world?.localSeat?.kind === 'cinema') {
      setTimeout(() => setState({ cinemaPanel: false }), 1500);
    }
    this.cinema?.setState(state);
    this.world?.office.setMarqueeTitle(state ? state.title || 'một video YouTube' : null);
    this.onCinemaZone();
    const me = getState().me;
    if (by && by !== me?.id && this.zoneId === 'cinema' && action !== 'title') {
      const who = nameOf(by);
      const msg: Record<string, string> = { play: `🎬 ${who} bật phim mới`, pause: `⏸️ ${who} tạm dừng phim`, resume: `▶️ ${who} chiếu tiếp`, stop: `⏹️ ${who} tắt máy chiếu`, seek: `⏩ ${who} tua phim` };
      if (msg[action]) toast(msg[action], 'info', 2500);
    }
    void prev;
  }

  cinemaPlay(link: string): boolean {
    const yt = parseYouTube(link);
    if (!yt) {
      toast('Link YouTube không hợp lệ. Ví dụ: https://www.youtube.com/watch?v=…', 'warn');
      return false;
    }
    this.net?.send({ t: 'cinema', action: 'play', videoId: yt.id, at: yt.start });
    return true;
  }

  cinemaControl(action: 'pause' | 'resume' | 'stop') {
    this.net?.send({ t: 'cinema', action });
  }

  cinemaSeek(delta: number) {
    const pos = this.cinema?.position() ?? 0;
    this.net?.send({ t: 'cinema', action: 'seek', at: Math.max(0, pos + delta) });
  }

  setCinemaVolume(v: number) {
    this.cinema?.setVolume(v);
  }

  // ------------------------------------------------------------------ bar jukebox
  private applyJukebox(state: CinemaState | null, by: string, action: string) {
    setState({ jukebox: state });
    this.jukebox?.setState(state);
    const me = getState().me;
    if (by && by !== me?.id && ZONE_BY_ID.get(this.zoneId)?.kind === 'bar' && action !== 'title') {
      const who = nameOf(by);
      const msg: Record<string, string> = { play: `🎵 ${who} chọn bài mới`, pause: `⏸️ ${who} tạm dừng nhạc`, resume: `▶️ ${who} bật lại nhạc`, stop: `🎧 ${who} trả về nhạc của DJ` };
      if (msg[action]) toast(msg[action], 'info', 2500);
    }
  }

  jukeboxPlay(link: string): boolean {
    const yt = parseYouTube(link);
    if (!yt) {
      toast('Link YouTube không hợp lệ. Ví dụ: https://www.youtube.com/watch?v=…', 'warn');
      return false;
    }
    this.net?.send({ t: 'jukebox', action: 'play', videoId: yt.id, at: yt.start });
    return true;
  }

  jukeboxControl(action: 'pause' | 'resume' | 'stop') {
    this.net?.send({ t: 'jukebox', action });
  }

  jukeboxSeek(delta: number) {
    const pos = this.jukebox?.position() ?? 0;
    this.net?.send({ t: 'jukebox', action: 'seek', at: Math.max(0, pos + delta) });
  }

  setJukeboxVolume(v: number) {
    savePref('jukeboxVolume', v);
    this.jukebox?.setVolume(v);
  }

  // ------------------------------------------------------------------ settings bits
  toggleView() {
    const w = this.world;
    if (!w) return;
    this.autoFirstPerson = false;
    w.setViewMode(w.viewMode === 'first' ? 'third' : 'first');
  }

  setAmbience(on: boolean, volume: number) {
    savePref('ambience', { on, volume });
    setState({ ambience: { on, volume } });
    this.ambience?.start();
    this.ambience?.setEnabled(on);
    this.ambience?.setVolume(volume);
  }

  requestActivityToken() {
    this.net?.send({ t: 'activity:token' });
  }

  revokeActivityToken() {
    this.net?.send({ t: 'activity:revoke' });
  }

  private interact(id: string) {
    switch (id) {
      case 'kanban':
        setState({ kanbanOpen: true });
        break;
      case 'coffee':
        this.emote('coffee');
        this.ambience?.coffee();
        toast('☕ Một ly cà phê sữa đá cho tỉnh táo!', 'info', 3000);
        break;
      case 'popcorn':
        this.emote('coffee');
        toast('🍿 Bỏng ngô bơ caramel — chọn ghế rồi xem phim thôi!', 'info', 3000);
        break;
      case 'cinema':
        setState({ cinemaPanel: true });
        break;
      case 'bar': {
        this.orderDrink();
        break;
      }
      case 'wheel':
        this.spinWheel();
        break;
      case 'snack': {
        const combos = ['🍜 Mì tôm trứng + 🥤 Sting dâu', '🍜 Mì xào bò + 🧋 trà sữa', '🍢 Xúc xích nướng + 🥤 Pepsi', '🍜 Mì cay cấp 7 + 🧊 nước đá'];
        this.emote('coffee');
        toast(`${combos[Math.floor(Math.random() * combos.length)]} — đúng chất quán net!`, 'info', 3500);
        break;
      }
      case 'dj':
        this.emote('cheer');
        setState({ barPanel: true });
        toast('🎧 Bạn đang đứng sau bàn DJ — dán link YouTube ở bảng 🎵 để đổi nhạc cho cả bar!', 'info', 4000);
        break;
      case 'water':
        this.emote('coffee');
        toast('💧 Uống nước đầy đủ nhé!', 'info', 3000);
        break;
      case 'arcade':
        this.emote('dance');
        toast('🕹️ High score mới: 9.999 điểm!', 'info', 3000);
        break;
      case 'whiteboard':
        setState({ panel: 'today' });
        break;
      case 'kara-console':
        setState({ karaPanel: true, karaTab: 'search' });
        break;
      case 'wolf-board':
        setState({ wolfPanel: true });
        toast('🐺 Ngồi lên một gốc cây quanh đống lửa để vào ván. Đủ 5 người là bắt đầu được!', 'info', 4500);
        break;
      default:
        if (id.startsWith('mole-') || id.startsWith('st-')) this.moleInteract(id);
    }
  }

  /** Linh (the bartender) walks over and hands you a drink. */
  private orderDrink() {
    const drinks = ['🍹 Mojito bạc hà', '🍺 Bia thủ công', '🥤 Trà đào cam sả', '🍸 Cocktail "Deploy Friday"', '🧃 Nước ép dưa hấu', '☕ Espresso tonic', '🍋 Soda chanh muối'];
    const d = drinks[Math.floor(Math.random() * drinks.length)];
    const me = getState().me;
    const pos = me ? this.world?.positionOf(me.id) : null;
    this.world?.staff.serve(pos?.x ?? 92, serverNow() / 1000, `${d} của bạn đây! 🥂`);
    this.emote('coffee');
    toast(`Linh: "${d} của bạn đây, cạn ly nhé!" 🥂`, 'info', 3500);
  }

  /** Walk (running) to the office, the cinema or the bar — taking the stairs if it is on the other floor. */
  travel(to: 'office' | 'cinema' | 'bar' | 'netcafe' | 'karaoke' | 'wolfroom' | 'mole') {
    const w = this.world;
    if (!w?.controller || w.riding) return;
    const target = {
      office: { x: 20, z: 21.5 },
      cinema: { x: 72, z: 16.4 },
      bar: { x: 91.2, z: 16.4 },
      netcafe: { x: 151.2, z: 17.6 },
      karaoke: { x: 190.2, z: 17.4 },
      wolfroom: { x: 210.2, z: 16.8 },
      mole: { x: MOLE_BOARD.x, z: MOLE_BOARD.z + 1.6 },
    }[to];
    if (!w.route(target.x, target.z, undefined, true)) return;
    if (this.autoFirstPerson) {
      this.autoFirstPerson = false;
      w.setViewMode('third');
    }
    const cross = floorOf(target.x) !== floorOf(w.controller.x);
    toast(
      {
        office: '🏢 Đang về văn phòng',
        cinema: '🎬 Đang đi tới rạp phim',
        bar: '🍸 Đang đi tới BSS Bar',
        netcafe: '🎮 Đang lên phòng game BSS Net (tầng 3)',
        karaoke: '🎤 Đang lên phòng Karaoke (tầng 4)',
        wolfroom: '🐺 Đang lên Làng Ma Sói (tầng 4)',
        mole: '🕵️ Đang lên tầng 5 chơi Nội Gián',
      }[to] + (cross ? ' (đi cầu thang)…' : '…'),
      'info',
      2500,
    );
  }

  sitOnSeat(seatId: string) {
    const seat = SEAT_BY_ID.get(seatId);
    if (seat) this.world?.sitOn(seat);
  }

  goToPlayer(id: string) {
    this.world?.goToPlayer(id);
  }

  goTo(x: number, z: number) {
    this.world?.goTo(x, z);
  }

  // ------------------------------------------------------------------ social
  sendChat(text: string, ch: 'global' | 'zone') {
    const t = text.trim();
    if (!t) return;
    this.net?.send({ t: 'chat', ch, text: t });
  }

  emote(e: Emote) {
    const me = getState().me;
    if (!me) return;
    this.world?.emote(me.id, e);
    this.net?.send({ t: 'emote', e });
    if (e === 'toast') this.onToast(me.id);
  }

  // ------------------------------------------------------------------ party
  private toasts = new Map<string, number>();

  /**
   * Someone raised a glass. If somebody else close by did the same in the last few seconds, the
   * glasses clink (every client runs this for both emotes, so everyone sees it once). Alone at the
   * bar? The nearest staff member toasts back.
   */
  private onToast(id: string) {
    const w = this.world;
    const me = getState().me;
    if (!w || !me) return;
    const now = performance.now();
    const pos = w.positionOf(id);
    this.toasts.set(id, now);
    if (!pos) return;
    let partner: string | null = null;
    for (const [other, t] of this.toasts) {
      if (other === id || now - t > 3500) continue;
      const p = w.positionOf(other);
      if (p && Math.hypot(p.x - pos.x, p.z - pos.z) < 2.6) partner = other;
    }
    const mePos = w.positionOf(me.id);
    const near = mePos && Math.hypot(mePos.x - pos.x, mePos.z - pos.z) < 12;
    if (partner) {
      this.toasts.delete(id);
      this.toasts.delete(partner);
      if (near) this.ambience?.clink();
      w.confetti(id, false);
      w.confetti(partner, false);
      if (id === me.id || partner === me.id) toast(`🥂 Cạn ly cùng ${nameOf(id === me.id ? partner : id)}! Dô dô dô!`, 'success', 3500);
      return;
    }
    if (id === me.id) {
      const staff = w.staff.toastNear(pos.x, pos.z);
      if (staff) {
        this.ambience?.clink();
        w.confetti(me.id, false);
        toast(`🥂 ${staff} cạn ly với bạn! Dô!`, 'success', 3000);
      } else toast('🥂 Giơ ly lên rồi! Rủ ai đó đứng cạnh cùng bấm 🥂 (phím 9) để cạn ly.', 'info', 3500);
    }
  }

  /** BSS Net: send a game action. */
  arcade(m: ArcadeMsg) {
    this.net?.send({ t: 'arcade', m });
  }

  spinWheel() {
    this.net?.send({ t: 'wheel' });
  }

  private onWheel(by: string, name: string, prize: number, at: number) {
    const w = this.world;
    if (!w) return;
    w.office.bar.spinWheel(prize, at);
    const me = getState().me;
    const mine = by === me?.id;
    const pos = me ? w.positionOf(me.id) : null;
    const upstairs = !!pos && floorOf(pos.x) === 1;
    if (mine) toast('🎡 Vòng quay đang quay… hồi hộp quá!', 'info', 2500);
    window.setTimeout(() => {
      if (mine) {
        this.emote('cheer');
        toast(`🎡 Bạn quay trúng: ${WHEEL_PRIZES[prize]}`, 'success', 6000);
        chime('join', 0.08);
      } else if (upstairs) toast(`🎡 ${name} quay trúng: ${WHEEL_PRIZES[prize]}`, 'info', 4500);
      w.confetti(by, false);
    }, Math.max(0, at + WHEEL_SPIN_MS - serverNow()));
  }

  /** Save the current view as a framed PNG. */
  async takePhoto() {
    const w = this.world;
    if (!w) return;
    const zone = ZONE_BY_ID.get(this.zoneId)?.name ?? '';
    const when = new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
    const blob = await w.capture(`📍 ${zone} · ${when}`);
    this.ambience?.shutter();
    document.querySelector('.office')?.classList.add('photo-flash');
    window.setTimeout(() => document.querySelector('.office')?.classList.remove('photo-flash'), 450);
    if (!blob) return toast('Không chụp được ảnh 😢', 'warn');
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    a.download = `bss-office-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    a.href = URL.createObjectURL(blob);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('📸 Đã chụp — ảnh được tải về máy, khoe lên nhóm chat nhé!', 'success', 3500);
  }

  wave(id: string) {
    this.net?.send({ t: 'wave', to: id });
    this.emote('wave');
    toast(`Bạn đã vẫy tay với ${nameOf(id)} 👋`, 'info', 2500);
  }

  updateProfile(name: string, avatar: AvatarConfig) {
    const p = loadProfile();
    saveProfile({ ...p, name, avatar });
    this.net?.send({ t: 'profile', name, avatar });
    const me = getState().me;
    if (me) {
      this.patchMe({ name, avatar });
      this.world?.applyPatch(me.id, { name, avatar });
    }
  }

  // ------------------------------------------------------------------ karaoke
  kara(m: KaraMsg) {
    this.net?.send({ t: 'kara', m });
  }

  /** Search YouTube (through our worker) for karaoke versions. */
  async karaSearch(q: string) {
    const r = await fetch(`/api/yt-search?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return ((await r.json()) as { hits: import('../shared/karaoke').YtHit[] }).hits;
  }

  karaAdd(videoId: string, title = '', dur = 0) {
    this.kara({ a: 'add', videoId, title, dur });
    toast(`🎶 Đã thêm “${title || 'bài hát'}” vào danh sách`, 'success', 2500);
  }

  karaAddLink(link: string): boolean {
    const yt = parseYouTube(link);
    if (!yt) {
      toast('Link YouTube không hợp lệ. Ví dụ: https://www.youtube.com/watch?v=…', 'warn');
      return false;
    }
    this.karaAdd(yt.id);
    return true;
  }

  /** Take / give back a mic. Taking one turns your microphone on. */
  async karaMic(on: boolean) {
    if (on && !getState().media.mic) {
      await this.toggleMic();
      if (!getState().media.mic) return;
    }
    if (on) this.kara({ a: 'fx', fx: getState().myFx ?? FX_PRESETS[0].fx });
    this.kara({ a: 'mic', on });
  }

  setMyFx(fx: MicFx) {
    setState({ myFx: fx });
    savePref('karaFx', fx);
    this.applyMonitor();
    this.fxTimer ??= window.setTimeout(() => {
      this.fxTimer = undefined;
      this.kara({ a: 'fx', fx: getState().myFx! });
    }, 120);
  }
  private fxTimer: number | undefined;

  setKaraMonitor(on: boolean) {
    setState({ karaMonitor: on });
    savePref('karaMonitor2', on);
    this.applyMonitor();
  }

  setKaraMonitorVol(v: number) {
    setState({ karaMonitorVol: v });
    savePref('karaMonitorVol', v);
    this.applyMonitor();
  }

  /** Headphones (raw mic + hear yourself) or speakers (echo canceller on, no self-monitoring). */
  setKaraPhones(phones: boolean) {
    setState({ karaPhones: phones, karaAsk: false });
    savePref('karaPhones', phones);
    if (this.singing) void this.rtc?.setSinging(true, phones);
    this.applyMonitor();
    toast(phones ? '🎧 Chế độ tai nghe: bạn sẽ nghe giọng mình kèm echo/vang ngay trong tai nghe.' : '🔊 Chế độ loa ngoài: không phát lại giọng bạn (tránh hú). Mọi người trong phòng vẫn nghe bạn hát.', 'info', 4500);
  }

  /** Self-monitoring only with headphones. */
  private applyMonitor() {
    const s = getState();
    this.rtc?.setMonitor(s.karaPhones === true && s.karaMonitor, s.myFx ?? FX_PRESETS[0].fx, s.karaMonitorVol);
  }

  setKaraVolume(v: number) {
    savePref('karaVolume', v);
    this.karaPlayer?.setVolume(v);
  }

  /** Lyrics view: the LED wall fills the screen. */
  karaZoom(on: boolean) {
    setState({ karaZoom: on });
    this.world?.setScreenView(on ? KARA_SCREEN : null);
  }

  karaReact(e: string) {
    this.kara({ a: 'react', e });
  }

  private applyKara(s: KaraState) {
    const prev = getState().kara;
    setState({ kara: s });
    const w = this.world;
    const me = getState().me?.id;
    const now = s.now;
    this.karaPlayer?.setState(
      now ? { videoId: now.song.videoId, startAt: now.startAt, pausedAt: now.pausedAt, by: now.song.by, byName: now.song.byName, title: now.song.title, updatedAt: now.startAt } : null,
    );
    // who holds a mic: pose + voice effects for everyone listening
    const held = new Set(s.mics.map((m) => m.id));
    for (const m of prev.mics) {
      if (held.has(m.id)) continue;
      w?.setHold(m.id, null);
      if (m.id !== me) this.rtc?.setFx(m.id, null);
    }
    for (const m of s.mics) {
      w?.setHold(m.id, 'mic');
      if (m.id !== me) this.rtc?.setFx(m.id, m.fx);
    }
    if (w) {
      w.office.karaFx.mics = [!!s.mics[0], !!s.mics[1]];
      w.office.karaFx.playing = !!now && now.pausedAt == null;
    }
    const mine = !!me && held.has(me);
    if (mine !== this.singing) {
      this.singing = mine;
      void this.rtc?.setSinging(mine, getState().karaPhones === true);
      this.applyMonitor();
      if (mine && getState().karaPhones === null) setState({ karaAsk: true });
      if (mine) {
        // your song came up and you got the mic: switch the microphone on if it was off
        if (!getState().media.mic) void this.toggleMic();
        const i = s.mics.findIndex((m) => m.id === me);
        const spot = MIC_SPOTS[Math.max(0, i)];
        w?.walkAndFace(spot.x, spot.z, spot.ry);
        setState({ karaPanel: true, karaTab: 'mic' });
        toast('🎤 Bạn đang cầm mic! Lên sân khấu nào — chỉnh echo/vang ở thẻ "Mic".', 'success', 5000);
      } else if (this.zoneId === 'karaoke') toast('🎤 Đã trả mic', 'info', 2000);
    }
    // a new song: count-in on the wall; someone else's turn → a heads-up
    if (now && now.song.sid !== prev.now?.song.sid) {
      this.karaVoice = { sid: now.song.sid, sung: 0, heard: 0, sent: 0 };
      if (now.song.by === me && !mine && this.zoneId !== 'karaoke') toast(`🎤 Tới lượt bài của bạn: “${now.song.title || 'bài hát'}” — lên tầng 4 hát thôi!`, 'success', 6000);
    }
    // score
    if (s.last && s.last.at !== prev.last?.at && serverNow() - s.last.at < KARA_SCORE_MS && this.zoneId === 'karaoke') {
      this.ambience?.sfx('drumroll');
      window.setTimeout(() => this.ambience?.sfx('applause'), 1400);
    }
    this.karaCount = -1;
    this.drawKaraIdle();
  }

  private drawKaraIdle() {
    const s = getState().kara;
    const w = this.world;
    if (!w) return;
    const now = s.now;
    const lead = now && now.pausedAt == null ? Math.ceil((now.startAt - serverNow()) / 1000) : 0;
    const last = s.last && serverNow() - s.last.at < KARA_SCORE_MS + 4000 && !now ? s.last : null;
    w.office.drawKaraIdle({
      next: s.queue.map((q) => ({ title: q.title, who: q.byName })),
      last,
      count: now && lead > 0 ? { title: now.song.title || 'Bài hát', who: s.mics.map((m) => m.name).join(' & ') || now.song.byName, n: lead } : null,
    });
  }

  /** ~16 Hz while on floor 4: count-in on the wall, singing stats for the score. */
  private karaTick() {
    const s = getState().kara;
    const now = s.now;
    if (!now && this.fastFrame % 80 === 0) this.drawKaraIdle();
    if (now && now.pausedAt == null) {
      const lead = Math.ceil((now.startAt - serverNow()) / 1000);
      if (lead > 0 && lead !== this.karaCount) {
        this.karaCount = lead;
        this.drawKaraIdle();
        if (this.zoneId === 'karaoke' && lead <= 3) this.ambience?.sfx('tick');
      }
    }
    if (!this.singing || !now || now.pausedAt != null || serverNow() < now.startAt) return;
    const v = this.karaVoice;
    if (v.sid !== now.song.sid) Object.assign(v, { sid: now.song.sid, sung: 0, heard: 0, sent: 0 });
    const dt = 0.06;
    v.heard += dt;
    if ((this.rtc?.micRms ?? 0) > 0.022) v.sung += dt;
    if (v.heard - v.sent > 5) {
      v.sent = v.heard;
      this.kara({ a: 'voice', sid: v.sid, sung: Math.round(v.sung * 10) / 10, heard: Math.round(v.heard * 10) / 10 });
    }
  }

  private onKaraReact(id: string, e: string) {
    if (id === 'system') return toast(e, 'warn', 4500);
    this.world?.react(id, e);
    if (e === '👏' && this.zoneId === 'karaoke' && Math.random() < 0.6) this.ambience?.sfx('applause');
  }

  // ------------------------------------------------------------------ Ma Sói
  wolf(m: WolfMsg) {
    this.net?.send({ t: 'wolf', m });
  }

  setWolfSpeech(on: boolean) {
    setState({ wolfSpeech: on });
    savePref('wolfSpeech', on);
    if (!on) window.speechSynthesis?.cancel();
  }

  private wolfBadges = new Set<string>();

  private applyWolf(v: WolfView | null) {
    const prev = getState().wolf;
    setState({ wolf: v });
    const w = this.world;
    if (!w) return;
    // name tags: the dead, votes, the accused
    const badges = new Map<string, string>();
    if (v && v.phase !== 'lobby') {
      const count = new Map<string, number>();
      if (v.phase === 'vote') for (const t of Object.values(v.votes)) if (t !== 'skip') count.set(t, (count.get(t) ?? 0) + 1);
      for (const p of v.players) {
        if (!p.alive) badges.set(p.id, `💀${p.role ? ROLE_META[p.role].emoji : ''}`);
        else if (v.accused === p.id) badges.set(p.id, '⚖️');
        else if (count.get(p.id)) badges.set(p.id, `🗳️${count.get(p.id)}`);
        else if (v.phase === 'end' && p.role) badges.set(p.id, ROLE_META[p.role].emoji);
      }
    }
    for (const id of this.wolfBadges) if (!badges.has(id)) w.setBadge(id, null);
    for (const [id, b] of badges) w.setBadge(id, b);
    this.wolfBadges = new Set(badges.keys());
    w.office.updateWolfBoard(v, serverNow());
    // asleep at night: nobody alive can hear you, so don't even send
    this.micHold(!!v && v.me.inGame && v.me.voice === 'listen');
    const night = !!v && (v.phase === 'night' || v.phase === 'witch' || v.phase === 'reveal');
    w.office.wolfFx.setNight(night ? 1 : 0);
    if (this.zoneId === 'wolfroom') this.onCinemaZone();
    if (!v) return;
    const here = this.zoneId === 'wolfroom' || v.me.inGame;
    // sounds on phase changes
    if (here && v.phase !== prev?.phase) {
      if (v.phase === 'night') this.ambience?.sfx('howl');
      else if (v.phase === 'dawn') this.ambience?.sfx('dawn');
      else if (v.phase === 'vote' || v.phase === 'verdict') this.ambience?.sfx('gavel');
      else if (v.phase === 'reveal') this.ambience?.sfx('flip');
      else if (v.phase === 'end') this.ambience?.sfx(!v.me.inGame || v.winners.includes(getState().me?.id ?? '') ? 'win' : 'lose');
      if (v.phase === 'reveal' && v.me.role) {
        setState({ wolfPanel: true });
        notifyRole(v);
      }
    }
    // new deaths
    if (here && prev && v.players.some((p) => !p.alive && prev.players.find((q) => q.id === p.id)?.alive)) this.ambience?.sfx('death');
    // the game master reads new lines aloud
    const last = v.log.length ? v.log[v.log.length - 1].t : 0;
    if (here && getState().wolfSpeech && prev) {
      for (const l of v.log) if (l.t > this.spoken) speak(l.text);
    }
    this.spoken = Math.max(this.spoken, last);
  }

  // ------------------------------------------------------------------ Nội Gián (floor 5)
  mole(m: MoleMsg) {
    this.net?.send({ t: 'mole', m });
  }

  private moleBadges = new Set<string>();

  private staleWarned = false;
  /**
   * Make a game view safe to draw: during a deploy the server can briefly run an older build
   * (stations / fields this client doesn't know) — drop what we can't place instead of crashing.
   */
  private cleanMole(v: MoleView): MoleView {
    const stale = !Array.isArray(v.doors);
    if (stale && !this.staleWarned && v.phase !== 'lobby') {
      this.staleWarned = true;
      toast('⏳ Máy chủ đang chuyển sang bản mới — đợi vài giây, tải lại trang rồi bắt đầu lại ván nhé.', 'warn', 8000);
    }
    return {
      ...v,
      doors: (v.doors ?? []).filter((id) => DOOR_BY_ID.has(id)),
      hidden: v.hidden ?? [],
      cams: v.cams ?? 0,
      bodies: v.bodies ?? [],
      locks: (v.locks ?? []).filter((l) => DOOR_BY_ID.has(l.door)),
      me: {
        ...v.me,
        vent: v.me.vent && VENT_BY_ID.has(v.me.vent) ? v.me.vent : null,
        tasks: (v.me.tasks ?? []).filter((t) => STATION_BY_ID.has(t.st)),
      },
    };
  }

  private applyMole(v: MoleView) {
    const prev = getState().mole;
    setState({ mole: v });
    const w = this.world;
    if (!w) return;
    const me = getState().me?.id ?? '';
    const now = serverNow();
    w.office.f5.update(v, now);
    w.office.f5.drawBoard(v);
    const live = v.me.inGame && v.phase !== 'lobby' && v.phase !== 'starting' && v.phase !== 'end';
    // shut doors are walls (ghosts drift through them)
    const ghost = live && !v.me.alive;
    w.setExtraRects(ghost ? [] : v.doors.map((id) => DOOR_BY_ID.get(id)).filter((d) => !!d).map((d) => doorRect(d!)));
    w.setHidden(v.hidden);
    w.office.f5.setCamsWatched(v.cams > 0);
    // the camera screen closes when a meeting starts / you die / a game starts
    if (getState().cctv && v.me.inGame && v.phase !== 'lobby' && v.phase !== 'end' && (v.phase !== 'play' || (prev?.me.alive && !v.me.alive))) this.closeCams();
    // in a duct: sit at the hatch you're under, frozen, till you climb out
    if (v.me.vent !== (prev?.me.vent ?? null)) {
      const vent = v.me.vent ? VENT_BY_ID.get(v.me.vent) : null;
      if (vent) {
        w.setFrozen(false);
        w.teleport(vent.x, vent.z, 0);
        w.setFrozen(true);
        if (prev?.me.vent) this.ambience?.sfx('ventMove');
      } else if (v.phase === 'play') w.setFrozen(false);
    }
    this.applyMoleVision(v);
    // name tags: ghosts (for ghosts) and fellow moles
    const badges = new Map<string, string>();
    if (live || v.phase === 'end')
      for (const p of v.players) {
        if (!p.alive) badges.set(p.id, p.out === 'voted' ? '🚪' : '👻');
        else if (p.role === 'mole' && (v.me.role === 'mole' || v.phase === 'end' || !v.me.alive)) badges.set(p.id, '🕵️');
      }
    for (const id of this.moleBadges) if (!badges.has(id)) w.setBadge(id, null);
    for (const [id, b] of badges) w.setBadge(id, b);
    this.moleBadges = new Set(badges.keys());
    if (v.phase !== prev?.phase && v.me.inGame) {
      const i = v.players.findIndex((p) => p.id === me);
      if ((v.phase === 'roles' || v.phase === 'meeting') && i >= 0) {
        // everyone gathers round the meeting table (and stays there till the vote is over)
        setState({ moleTask: null });
        const spot = meetingSpot(i, v.players.length);
        w.setFrozen(false);
        w.teleport(spot.x, spot.z, spot.ry);
        w.setFrozen(true);
        if (this.world?.viewMode === 'first') this.world.setViewMode('third');
      }
      if (v.phase === 'play' || v.phase === 'end' || v.phase === 'lobby') w.setFrozen(false);
      if (v.phase === 'roles') {
        setState({ moleFakeDone: [] });
        this.ambience?.sfx('shh');
        window.setTimeout(() => this.ambience?.sfx('reveal'), 1500);
      }
      if (v.phase === 'meeting' && v.meeting) {
        setState({ moleSplash: { kind: v.meeting.reason, by: v.meeting.byName, body: v.meeting.body, at: Date.now() } });
        this.ambience?.sfx(v.meeting.reason === 'report' ? 'report' : 'meeting');
      }
      if (v.phase === 'result') this.ambience?.sfx(v.result?.out ? 'eject' : 'gavel');
      if (v.phase === 'end') this.ambience?.sfx(v.me.role === v.winner ? 'win' : 'lose');
      if (v.phase === 'roles') setState({ molePanel: true });
    }
    if (prev?.me.alive && !v.me.alive && v.me.inGame && v.phase === 'play') setState({ moleTask: null });
    if (live && v.phase === 'play') {
      if (!(prev?.lights ?? 0) && v.lights) {
        this.ambience?.sfx('powerdown');
        if (v.me.role === 'crew') toast('💡 Mất điện! Ra hộp cầu dao ở Phòng Server để bật lại.', 'warn', 5000);
      }
      if (!(prev?.crit ?? 0) && v.crit) this.ambience?.sfx('siren');
      const done = (x: MoleView | null) => x?.me.tasks.filter((t) => t.done).length ?? 0;
      if (done(v) > done(prev)) this.ambience?.sfx('task');
    }
    if (this.zoneId.startsWith('f5-')) this.onCinemaZone();
  }

  private onMoleFx(fx: MoleFx) {
    const near = (x: number, z: number, r: number) => {
      const me = getState().me;
      const pos = me ? this.world?.positionOf(me.id) : null;
      return !!pos && Math.hypot(pos.x - x, pos.z - z) < r;
    };
    if (fx.kind === 'door') {
      const d = DOOR_BY_ID.get(fx.door);
      if (!d) return;
      const m = doorMid(d);
      if (near(m.x, m.z, fx.locked ? 16 : 11)) this.ambience?.sfx(fx.locked ? 'doorLock' : 'door');
      return;
    }
    if (fx.kind === 'vent') {
      const v = VENT_BY_ID.get(fx.vent);
      if (!v) return;
      this.world?.office.f5.ventFx(fx.vent);
      if (near(v.x, v.z, 12) && (this.world?.canSee(v.x, v.z) ?? false)) this.ambience?.sfx('vent');
      else if (getState().mole?.me.vent) this.ambience?.sfx('vent');
      return;
    }
    if (fx.kind === 'killed') {
      setState({ moleSplash: { kind: 'killed', by: fx.by, at: Date.now() }, moleTask: null });
      this.ambience?.sfx('stab');
      window.setTimeout(() => this.ambience?.sfx('death'), 900);
    } else if (fx.kind === 'kill') {
      setState({ moleSplash: { kind: 'kill', body: fx.victim, at: Date.now() } });
      this.ambience?.sfx('kill');
    } else if (fx.kind === 'scan') {
      this.world?.office.f5.scan(fx.x, fx.z);
      const me = getState().me;
      const pos = me ? this.world?.positionOf(me.id) : null;
      if (pos && Math.hypot(pos.x - fx.x, pos.z - fx.z) < 10) this.ambience?.sfx('task');
    }
  }

  /** Typewriter tick (the verdict screen). */
  typeTick() {
    this.ambience?.sfx('type');
  }

  private seenBodies = new Set<string>();
  private lastTickSec = -1;
  /** ~16 Hz on floor 5: tension music, the "I just saw a body" sting, the last seconds ticking. */
  private moleTick() {
    const v = getState().mole;
    const w = this.world;
    if (!w) return;
    const now = serverNow();
    const playing = !!v && v.me.inGame && v.phase === 'play' && w.myFloor === 4;
    const emergency = playing && (v!.crit > now || (v!.lights > now && v!.me.role === 'crew' && v!.me.alive));
    this.ambience?.setTension(playing ? (emergency ? 2 : 1) : 0);
    this.ambience?.tickTension();
    if (!v || v.phase !== 'play') this.seenBodies.clear();
    else if (playing && v.me.alive) {
      const me = getState().me;
      const pos = me ? w.positionOf(me.id) : null;
      for (const b of v.bodies) {
        if (this.seenBodies.has(b.id) || !pos || Math.hypot(b.x - pos.x, b.z - pos.z) > 9 || !w.canSee(b.x, b.z)) continue;
        this.seenBodies.add(b.id);
        this.ambience?.sfx('body');
      }
    }
    if (v && v.me.inGame && (v.phase === 'meeting' || v.phase === 'vote')) {
      const left = Math.ceil((v.until - now) / 1000);
      if (left <= 10 && left > 0 && left !== this.lastTickSec) {
        this.lastTickSec = left;
        this.ambience?.sfx('tick');
      }
    }
  }

  /** Fog of war while playing on floor 5. */
  private applyMoleVision(v: MoleView | null) {
    const w = this.world;
    if (!w) return;
    if (!v || !v.me.inGame || v.phase !== 'play') return w.setVision(null);
    const ghost = !v.me.alive;
    const radius = v.me.role === 'mole' ? VISION.mole : v.lights > serverNow() ? VISION.dark : VISION.crew;
    w.setVision({ radius: ghost ? 99 : radius, seeAll: ghost, seeGhosts: ghost, ghosts: new Set(v.players.filter((p) => !p.alive).map((p) => p.id)) });
  }

  /** Current vision radius (for the fog overlay), or null when there is no fog. */
  moleFogRadius(): number | null {
    const v = getState().mole;
    if (!v || !v.me.inGame || v.phase !== 'play' || !v.me.alive || this.world?.myFloor !== 4) return null;
    return v.me.role === 'mole' ? VISION.mole : v.lights > serverNow() ? VISION.dark : VISION.crew;
  }

  /** Sit at the security desk and watch the cameras. */
  openCams() {
    const v = getState().mole;
    if (v && v.me.inGame && v.phase !== 'lobby' && v.phase !== 'end' && v.phase !== 'play') return;
    if (v?.me.vent || getState().cctv || !this.world) return;
    this.mole({ a: 'cams', on: true });
    setState({ cctv: true });
    this.world.setCctv(true);
    this.ambience?.sfx('flip');
  }

  closeCams() {
    if (!getState().cctv) return;
    this.mole({ a: 'cams', on: false });
    setState({ cctv: false });
    this.world?.setCctv(false);
  }

  /** The camera screen tells the world where its picture boxes are. */
  setCctvCells(fn: (() => Element[]) | null) {
    if (this.world) this.world.cctvCells = fn;
  }

  /** What the E prompt says for floor-5 things (null = no prompt here). */
  private moleLabel(id: string): string | null {
    const v = getState().mole;
    const live = !!v && v.phase !== 'lobby' && v.phase !== 'starting' && v.phase !== 'end';
    if (v?.me.vent) return null; // in a duct: the duct panel does the talking
    if (id.startsWith('mole-door:')) {
      if (live && (!v!.me.inGame || !v!.me.alive || v!.phase !== 'play')) return null;
      const door = id.slice(10);
      if (v?.locks.some((l) => l.door === door && l.until > serverNow())) return '🔒 Cửa đang bị khoá';
      return v?.doors.includes(door) ? '🚪 Mở cửa' : '🚪 Đóng cửa';
    }
    if (id.startsWith('mole-vent:')) {
      if (!v || v.phase !== 'play' || v.me.role !== 'mole' || !v.me.alive) return null;
      return '🕳️ Chui vào ống kỹ thuật';
    }
    return '';
  }

  private moleInteract(id: string) {
    const v = getState().mole;
    if (id === 'mole-board') return setState({ molePanel: true });
    if (id.startsWith('mole-door:')) {
      const door = id.slice(10);
      if (v?.locks.some((l) => l.door === door && l.until > serverNow())) return toast('🔒 Cửa đang bị khoá — đợi một lát.', 'warn', 2500);
      return this.mole({ a: 'door', door });
    }
    if (id.startsWith('mole-vent:')) {
      if (!v || v.phase !== 'play' || v.me.role !== 'mole' || !v.me.alive) return;
      return this.mole({ a: 'vent', vent: id.slice(10) });
    }
    if (id === 'mole-cams') return this.openCams();
    if (!v || !v.me.inGame || v.phase !== 'play') {
      if (id.startsWith('st-')) toast('🕵️ Nhiệm vụ chỉ làm được trong một ván Nội Gián — tham gia ở bảng trong sảnh tầng 5.', 'info', 4000);
      return;
    }
    if (id === 'mole-bell') {
      if (!v.me.alive) return toast('👻 Hồn ma không bấm chuông được.', 'info');
      if (v.me.bell <= 0) return toast('Bạn đã dùng hết lượt bấm chuông.', 'warn');
      return this.mole({ a: 'bell' });
    }
    if (id === 'mole-fuse') {
      if (!v.lights) return toast('💡 Điện vẫn bình thường.', 'info');
      return setState({ moleTask: { id: 'fuse', fake: false } });
    }
    if (id.startsWith('mole-crit')) {
      if (!v.crit) return toast('🖥️ Server đang chạy ổn định.', 'info');
      if (!v.me.alive) return toast('👻 Hồn ma không giữ được bảng điều khiển.', 'info');
      return setState({ moleTask: { id, fake: false } });
    }
    const st = STATION_BY_ID.get(id);
    if (!st) return;
    const mine = v.me.tasks.find((t) => t.st === id);
    if (v.me.role === 'mole') return setState({ moleTask: { id, fake: true } }); // pretend
    if (!mine) return toast('Không có việc của bạn ở đây — xem danh sách nhiệm vụ bên trái.', 'info', 3000);
    if (mine.done) return toast('✅ Việc này bạn làm xong rồi.', 'info');
    setState({ moleTask: { id, fake: false } });
  }

  /** A mini-game finished. */
  moleTaskDone() {
    const t = getState().moleTask;
    setState({ moleTask: null });
    if (!t) return;
    if (t.id === 'fuse') return this.mole({ a: 'fix' });
    if (!t.fake && t.id.startsWith('st-')) this.mole({ a: 'task', st: t.id });
    else if (t.fake) {
      this.ambience?.sfx('task');
      if (t.id.startsWith('st-')) setState({ moleFakeDone: [...new Set([...getState().moleFakeDone, t.id])] });
    }
  }

  /** The duct hatch a (living, playing) mole stands on, or null. */
  moleVentNear(): string | null {
    const v = getState().mole;
    const w = this.world;
    const me = getState().me;
    if (!v || !w || !me || v.me.role !== 'mole' || !v.me.alive || v.phase !== 'play' || v.me.vent) return null;
    const pos = w.positionOf(me.id);
    if (!pos) return null;
    let best: { id: string; d: number } | null = null;
    for (const vt of MOLE_VENTS) {
      const d = Math.hypot(vt.x - pos.x, vt.z - pos.z);
      if (d <= MOLE_VENT_RANGE && (!best || d < best.d)) best = { id: vt.id, d };
    }
    return best?.id ?? null;
  }

  /** Nearest living employee within reach (for a mole), or null. */
  moleTarget(): string | null {
    const v = getState().mole;
    const w = this.world;
    const me = getState().me;
    if (!v || !w || !me || v.me.role !== 'mole' || !v.me.alive || v.phase !== 'play' || v.me.vent) return null;
    const pos = w.positionOf(me.id);
    if (!pos) return null;
    let best: { id: string; d: number } | null = null;
    for (const p of v.players) {
      if (!p.alive || p.id === me.id || v.me.mates.includes(p.id)) continue;
      const q = w.positionOf(p.id);
      if (!q) continue;
      const d = Math.hypot(q.x - pos.x, q.z - pos.z);
      if (d <= MOLE_KILL_RANGE && (!best || d < best.d)) best = { id: p.id, d };
    }
    return best?.id ?? null;
  }

  /** A body close enough to report, or null. */
  moleBody(): string | null {
    const v = getState().mole;
    const me = getState().me;
    const pos = me ? this.world?.positionOf(me.id) : null;
    if (!v || !pos || !v.me.alive || v.phase !== 'play') return null;
    const b = v.bodies.find((x) => Math.hypot(x.x - pos.x, x.z - pos.z) <= MOLE_REPORT_RANGE);
    return b?.id ?? null;
  }

  // ------------------------------------------------------------------ media
  async toggleMic() {
    try {
      await this.rtc?.setMic(!getState().media.mic);
    } catch (err) {
      toast(mediaError(err, 'micro'), 'warn', 7000);
    }
  }

  async toggleCam() {
    try {
      await this.rtc?.setCam(!getState().media.cam);
    } catch (err) {
      toast(mediaError(err, 'camera'), 'warn', 7000);
    }
  }

  async toggleScreen() {
    try {
      await this.rtc?.setScreen(!getState().media.screen);
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotAllowedError') toast(mediaError(err, 'chia sẻ màn hình'), 'warn', 7000);
    }
  }

  private syncPeers() {
    const rtc = this.rtc;
    if (!rtc) return;
    const peers: Record<string, ReturnType<RelayMedia['peerViews']>[number]> = {};
    for (const v of rtc.peerViews()) peers[v.id] = v;
    setState({ peers });
    this.updateTvs();
  }

  /** Meeting-room TVs show whoever is sharing their screen in that room. */
  private updateTvs() {
    const world = this.world;
    if (!world) return;
    const s = getState();
    for (const zone of world.office.tvZones()) {
      // your own share: live video; someone else's: the latest relayed JPEG frame
      if (s.me?.media.screen && this.zoneId === zone && s.localScreen) {
        const el = this.videoEls.get(zone) ?? document.createElement('video');
        if (el.srcObject !== s.localScreen) {
          el.muted = true;
          el.playsInline = true;
          el.srcObject = s.localScreen;
          el.play().catch(() => {});
          this.videoEls.set(zone, el);
          world.office.setTvVideo(zone, el);
        }
        continue;
      }
      if (this.videoEls.has(zone)) {
        this.videoEls.get(zone)!.srcObject = null;
        this.videoEls.delete(zone);
        world.office.setTvVideo(zone, null);
      }
      const sharer = Object.values(s.players).find((p) => p.zone === zone && p.media.screen && s.peers[p.id]?.screen);
      world.office.setTvImage(zone, sharer ? s.peers[sharer.id].screen : null);
    }
  }

  // ------------------------------------------------------------------ tasks
  createTask(title: string, col: TaskColumn = 'todo', assignee: string | null = null, priority: Priority = 'normal', desc = '') {
    this.net?.send({ t: 'task:create', title, col, assignee, priority, desc });
  }

  updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'desc' | 'assignee' | 'priority'>>) {
    this.net?.send({ t: 'task:update', id, patch });
  }

  moveTask(id: string, col: TaskColumn, ord: number) {
    const t = getState().tasks[id];
    if (t) setState((s) => ({ tasks: { ...s.tasks, [id]: { ...t, col, ord } } }));
    this.net?.send({ t: 'task:move', id, col, ord });
  }

  deleteTask(id: string) {
    this.net?.send({ t: 'task:delete', id });
  }

  focusTask(id: string | null) {
    this.net?.send({ t: 'task:focus', id });
  }

  private updateWhiteboard() {
    const s = getState();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const done = Object.values(s.tasks).filter((t) => t.doneAt && t.doneAt >= startOfDay.getTime()).length;
    this.world?.office.updateWhiteboard({ online: Object.keys(s.players).length + (s.me ? 1 : 0), doneToday: done, officeName: s.officeName });
  }

  /** Ma Sói at night: a sleeping villager's mic sends nothing (shown on the mic button). */
  private micHold(on: boolean) {
    this.rtc?.setHold(on);
    if (getState().micHeld !== on) setState({ micHeld: on });
  }

  // ------------------------------------------------------------------ phone controls
  touchStick(x: number, y: number) {
    this.world?.setStick(x, y);
  }
  touchJump() {
    this.world?.jump();
  }
  /** The phone's "use" button = the E key. */
  touchUse() {
    this.world?.interact();
  }

  /** First-person look: sensitivity, smoothing, head bob (saved on this device). */
  setFpLook(v: Partial<FpLook>) {
    const next = { ...getState().fpLook, ...v };
    savePref('fpLook', next);
    setState({ fpLook: next });
    this.world?.setFpLook(next);
  }

  setQuality(q: Quality) {
    savePref('quality', q);
    setState({ quality: q });
    this.world?.setQuality(q);
  }

  setFpsCap(cap: FpsCap) {
    savePref('fpsCap', cap);
    setState({ fpsCap: cap });
    this.world?.setFpsCap(cap);
  }
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

function mentions(text: string, name: string): boolean {
  const t = normalize(text);
  const n = normalize(name);
  const first = n.split(/\s+/).pop() ?? n;
  return t.includes(`@${n}`) || t.includes(`@${n.replace(/\s+/g, '')}`) || new RegExp(`@${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(t) || t.includes('@all') || t.includes('@team');
}

function mediaError(err: unknown, what: string): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError') return `Trình duyệt đang chặn ${what}. Bấm vào biểu tượng ổ khoá trên thanh địa chỉ để cho phép nhé.`;
  if (name === 'NotFoundError') return `Không tìm thấy thiết bị ${what}.`;
  if (!window.isSecureContext) return `Cần mở bằng HTTPS để dùng ${what}.`;
  return `Không bật được ${what}: ${(err as Error)?.message ?? err}`;
}

/** Can this browser draw WebGL at all? (Chrome with graphics acceleration off / GPU blocked says no.) */
function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

let viVoice: SpeechSynthesisVoice | null | undefined;
/** Read a game-master line in Vietnamese (if the browser has a Vietnamese voice). */
function speak(text: string) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (viVoice === undefined) {
    const voices = synth.getVoices();
    if (!voices.length) {
      synth.onvoiceschanged = () => {
        viVoice = undefined;
      };
      return;
    }
    viVoice = voices.find((v) => v.lang.toLowerCase().startsWith('vi')) ?? null;
  }
  if (!viVoice) return;
  const clean = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.voice = viVoice;
  u.lang = viVoice.lang;
  u.rate = 1.02;
  u.pitch = 0.9;
  synth.speak(u);
}

function notifyRole(v: WolfView) {
  const r = v.me.role;
  if (!r) return;
  const meta = ROLE_META[r];
  const mates = v.me.mates.map((id) => v.players.find((p) => p.id === id)?.name).filter(Boolean);
  const extra = (r === 'wolf' || r === 'alpha') && mates.length ? `Đồng bọn: ${mates.join(', ')}` : r === 'minion' ? `Bầy sói: ${mates.join(', ')}` : meta.desc;
  toast(`${meta.emoji} Bạn là ${meta.name}! ${extra}`, meta.team === 'village' ? 'success' : 'warn', 8000);
}

export const game = new Game();
