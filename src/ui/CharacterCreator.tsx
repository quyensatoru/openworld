import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  ACCESSORIES,
  BUILDS,
  CLOTH_COLORS,
  HAIR_COLORS,
  SKIN_TONES,
  randomAvatar,
  sanitizeAvatar,
  type AvatarConfig,
} from "../../shared/avatar";
import {
  EMOTE_EMOJI,
  PICKER_EMOTES,
  LIMITS,
  type Emote,
} from "../../shared/protocol";
import { game } from "../game";
import { loadProfile, saveProfile } from "../profile";
import { avatars, type BodyOption } from "../world/avatar/manifest";
import type { Avatar } from "../world/avatar/types";

/** Small standalone 3D stage that shows one avatar on a turntable. */
class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private turn = new THREE.Group();
  private avatar: Avatar | null = null;
  private bodyKey = "";
  private raf = 0;
  private clock = new THREE.Clock();
  private spin = 0.35;
  private drag: number | null = null;
  private idleSpin = 0;
  private ro: ResizeObserver;
  private disposed = false;
  private seq = 0;

  constructor(private host: HTMLElement) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    host.appendChild(r.domElement);
    this.renderer = r;
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#d9cab5", 0.75));
    const key = new THREE.DirectionalLight("#fff3e3", 2.2);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top = 2;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#c9d6ff", 1.2);
    rim.position.set(-3, 2.5, -3);
    this.scene.add(rim);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.9, 0.08, 64),
      new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }),
    );
    disc.position.y = -0.04;
    disc.receiveShadow = true;
    this.scene.add(disc);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.88, 0.012, 8, 80),
      new THREE.MeshStandardMaterial({ color: "#6b8cff", roughness: 0.4 }),
    );
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    this.scene.add(this.turn);
    this.turn.rotation.y = -0.35;

    const el = r.domElement;
    el.addEventListener("pointerdown", (e) => {
      this.drag = e.clientX;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", (e) => {
      if (this.drag == null) return;
      this.turn.rotation.y += (e.clientX - this.drag) * 0.012;
      this.drag = e.clientX;
      this.idleSpin = 0;
    });
    el.addEventListener("pointerup", () => {
      this.drag = null;
      el.style.cursor = "grab";
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  private resize() {
    const w = this.host.clientWidth || 400;
    const h = this.host.clientHeight || 400;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the whole character in view on narrow screens
    const dist = Math.max(4.4, 4.4 / Math.min(1, this.camera.aspect * 1.25));
    this.camera.position.set(0, 1.25, dist);
    this.camera.lookAt(0, 0.92, 0);
    this.camera.updateProjectionMatrix();
  }

  private latest: AvatarConfig | null = null;
  private pendingKey: string | null = null;

  /** Body / build changes rebuild the avatar; everything else is applied in place. */
  async setConfig(cfg: AvatarConfig) {
    this.latest = cfg;
    const key = `${cfg.body}|${cfg.build}`;
    if (this.avatar && key === this.bodyKey && !this.pendingKey) {
      this.avatar.setConfig(cfg);
      return;
    }
    if (this.pendingKey === key) return; // already loading; the latest config is applied when it lands
    this.pendingKey = key;
    const seq = ++this.seq;
    const av = await avatars.create(cfg);
    if (this.disposed || seq !== this.seq) {
      av.dispose();
      return;
    }
    this.pendingKey = null;
    this.bodyKey = key;
    if (this.latest && this.latest !== cfg) av.setConfig(this.latest);
    if (this.avatar) {
      this.turn.remove(this.avatar.root);
      this.avatar.dispose();
    }
    this.avatar = av;
    this.turn.add(av.root);
    av.emote("wave");
  }

  emote(e: Emote) {
    this.avatar?.emote(e);
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    if (this.drag == null) {
      this.idleSpin = Math.min(1, this.idleSpin + dt * 0.3);
      this.turn.rotation.y += dt * this.spin * this.idleSpin * 0.5;
    }
    this.avatar?.update(dt, {
      speed: 0,
      anim: "idle",
      seatKind: null,
      lookAt: null,
      talking: false,
    });
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.avatar?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function Swatches({
  colors,
  value,
  onPick,
}: {
  colors: string[];
  value: string;
  onPick: (c: string) => void;
}) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch${c.toLowerCase() === value.toLowerCase() ? " on" : ""}`}
          style={{ background: c }}
          onClick={() => onPick(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}

export function CharacterCreator({
  mode,
  onDone,
}: {
  mode: "first" | "edit";
  onDone: () => void;
}) {
  const profile = loadProfile();
  const stageRef = useRef<HTMLDivElement>(null);
  const preview = useRef<Preview | null>(null);
  const [name, setName] = useState(profile.name);
  const [bodies, setBodies] = useState<BodyOption[]>(avatars.bodies());
  const [hairs, setHairs] = useState<BodyOption[]>(avatars.hairs());
  const [cfg, setCfg] = useState<AvatarConfig>(
    () => profile.avatar ?? randomAvatar([], []),
  );

  useEffect(() => {
    const p = new Preview(stageRef.current!);
    preview.current = p;
    let alive = true;
    avatars.init().then(() => {
      if (!alive) return;
      const b = avatars.bodies();
      const h = avatars.hairs();
      setBodies(b);
      setHairs(h);
      setCfg((c) => ({
        ...c,
        body: b.some((x) => x.id === c.body)
          ? c.body
          : b[Math.floor(Math.random() * b.length)].id,
        hair:
          !h.length || h.some((x) => x.id === c.hair)
            ? c.hair
            : h[Math.floor(Math.random() * Math.min(h.length, 6))].id,
      }));
    });
    return () => {
      alive = false;
      p.dispose();
    };
  }, []);

  useEffect(() => {
    preview.current?.setConfig(cfg);
  }, [cfg]);

  const set = (patch: Partial<AvatarConfig>) =>
    setCfg((c) => ({ ...c, ...patch }));
  const toggleAcc = (id: string) =>
    setCfg((c) => {
      const has = c.accessories.includes(id);
      let acc = has
        ? c.accessories.filter((a) => a !== id)
        : [...c.accessories, id];
      // only one of each kind
      if (!has && (id === "glasses" || id === "sunglasses"))
        acc = acc.filter(
          (a) => a === id || (a !== "glasses" && a !== "sunglasses"),
        );
      if (!has && (id === "cap" || id === "beanie"))
        acc = acc.filter((a) => a === id || (a !== "cap" && a !== "beanie"));
      return { ...c, accessories: acc };
    });

  const save = () => {
    const n = name.trim().slice(0, LIMITS.name);
    if (!n) return;
    const avatar = sanitizeAvatar(cfg);
    saveProfile({ ...loadProfile(), name: n, avatar });
    if (mode === "edit") game.updateProfile(n, avatar);
    onDone();
  };

  return (
    <div className={`creator${mode === "edit" ? " creator-edit" : ""}`}>
      <div className="creator-stage" ref={stageRef}>
        <div className="emote-row glass">
          {PICKER_EMOTES.map((e) => (
            <button
              key={e}
              type="button"
              title={e}
              onClick={() => preview.current?.emote(e)}
            >
              {EMOTE_EMOJI[e]}
            </button>
          ))}
        </div>
        <div className="hint glass">Kéo chuột để xoay nhân vật</div>
      </div>
      <div className="creator-panel glass">
        <header>
          <h2>
            {mode === "first" ? "Tạo nhân vật của bạn" : "Chỉnh nhân vật"}
          </h2>
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
            Mọi người trong văn phòng sẽ thấy bạn như thế này.
          </div>
        </header>
        <div className="creator-body scroll">
          <div className="field">
            <label>Tên hiển thị</label>
            <input
              className="input"
              value={name}
              maxLength={LIMITS.name}
              placeholder="VD: Quyền BE"
              autoFocus={mode === "first"}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          {bodies.length > 1 && (
            <div className="field">
              <label>Dáng người (tự phối đồ)</label>
              <div className="chips">
                {bodies
                  .filter((b) => b.group !== "anime")
                  .map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`chip${cfg.body === b.id ? " on" : ""}`}
                      onClick={() => set({ body: b.id })}
                    >
                      {b.label}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {bodies.some((b) => b.group === "anime") && (
            <div className="field">
              <label>✨ Nhân vật Anime (thiết kế sẵn)</label>
              <div className="chips">
                {bodies
                  .filter((b) => b.group === "anime")
                  .map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`chip${cfg.body === b.id ? " on" : ""}`}
                      onClick={() => set({ body: b.id })}
                    >
                      {b.label}
                    </button>
                  ))}
              </div>
              {!avatars.features(cfg.body).colors && (
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  Nhân vật anime có sẵn tóc, quần áo và biểu cảm (chớp mắt,
                  cười, nhép miệng khi nói). Lần đầu chọn cần vài giây để tải.
                </div>
              )}
            </div>
          )}
          {avatars.features(cfg.body).builds && (
            <div className="field">
              <label>Vóc dáng</label>
              <div className="chips">
                {BUILDS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`chip${cfg.build === b.id ? " on" : ""}`}
                    onClick={() => set({ build: b.id })}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {avatars.features(cfg.body).colors && (
            <>
              <div className="field">
                <label>Màu da</label>
                <Swatches
                  colors={SKIN_TONES}
                  value={cfg.skin}
                  onPick={(skin) => set({ skin })}
                />
              </div>
              {hairs.length > 0 && avatars.features(cfg.body).hairstyles && (
                <div className="field">
                  <label>Kiểu tóc</label>
                  <div className="chips">
                    {hairs.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className={`chip${cfg.hair === h.id ? " on" : ""}`}
                        onClick={() => set({ hair: h.id })}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="field">
                <label>Màu tóc</label>
                <Swatches
                  colors={HAIR_COLORS}
                  value={cfg.hairColor}
                  onPick={(hairColor) => set({ hairColor })}
                />
              </div>
              <div className="field">
                <label>Áo</label>
                {avatars.features(cfg.body).sleeves && (
                  <div className="chips" style={{ marginBottom: 10 }}>
                    <button
                      type="button"
                      className={`chip${cfg.sleeves !== "long" ? " on" : ""}`}
                      onClick={() => set({ sleeves: "short" })}
                    >
                      👕 Ngắn tay
                    </button>
                    <button
                      type="button"
                      className={`chip${cfg.sleeves === "long" ? " on" : ""}`}
                      onClick={() => set({ sleeves: "long" })}
                    >
                      🧥 Dài tay
                    </button>
                  </div>
                )}
                <Swatches
                  colors={CLOTH_COLORS}
                  value={cfg.top}
                  onPick={(top) => set({ top })}
                />
              </div>
              <div className="field">
                <label>Quần</label>
                <Swatches
                  colors={CLOTH_COLORS}
                  value={cfg.bottom}
                  onPick={(bottom) => set({ bottom })}
                />
              </div>
              <div className="field">
                <label>Giày</label>
                <Swatches
                  colors={CLOTH_COLORS}
                  value={cfg.shoes}
                  onPick={(shoes) => set({ shoes })}
                />
              </div>
              <div className="field">
                <label>Phụ kiện</label>
                <div className="chips">
                  {ACCESSORIES.filter(
                    (a) =>
                      a.id !== "beard" ||
                      (avatars.hasBeard &&
                        avatars.features(cfg.body).hairstyles),
                  ).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`chip${cfg.accessories.includes(a.id) ? " on" : ""}`}
                      onClick={() => toggleAcc(a.id)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="field">
            <label>Chiều cao · {Math.round(cfg.height * 170)} cm</label>
            <input
              type="range"
              min={0.92}
              max={1.08}
              step={0.01}
              value={cfg.height}
              onChange={(e) => set({ height: Number(e.target.value) })}
            />
          </div>
        </div>
        <footer>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setCfg((c) => ({
                ...randomAvatar(
                  bodies.map((b) => b.id),
                  hairs.map((h) => h.id),
                ),
                height: c.height,
              }))
            }
          >
            🎲 Ngẫu nhiên
          </button>
          {mode === "edit" && (
            <button type="button" className="btn" onClick={onDone}>
              Huỷ
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim()}
            onClick={save}
          >
            {mode === "first" ? "Vào văn phòng →" : "Lưu"}
          </button>
        </footer>
      </div>
    </div>
  );
}
