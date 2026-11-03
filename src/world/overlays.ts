// HTML name tags floating above avatars (CSS2DRenderer): name, status, mic, current task,
// pomodoro ring, chat bubble and emote pop-ups.
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EMOTE_EMOJI, STATUS_META, type Emote, type PlayerState } from '../../shared/protocol';

export class NameTag {
  readonly object: CSS2DObject;
  private el: HTMLDivElement;
  private nameEl: HTMLSpanElement;
  private dot: HTMLSpanElement;
  private mic: HTMLSpanElement;
  private task: HTMLDivElement;
  private bubble: HTMLDivElement;
  private ring: SVGCircleElement;
  private ringWrap: SVGSVGElement;
  private bubbleTimer: number | undefined;
  private pomo: PlayerState['pomo'] = null;

  constructor(isMe: boolean) {
    const el = document.createElement('div');
    el.className = `tag${isMe ? ' me' : ''}`;
    el.innerHTML = `
      <div class="tag-bubble"></div>
      <div class="tag-plate">
        <svg class="tag-pomo" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" class="bg"/><circle cx="10" cy="10" r="8" class="fg"/></svg>
        <span class="tag-dot"></span><span class="tag-name"></span><span class="tag-mic"></span><span class="tag-badge"></span>
      </div>
      <div class="tag-task"></div>`;
    this.el = el;
    this.bubble = el.querySelector('.tag-bubble')!;
    this.nameEl = el.querySelector('.tag-name')!;
    this.dot = el.querySelector('.tag-dot')!;
    this.mic = el.querySelector('.tag-mic')!;
    this.task = el.querySelector('.tag-task')!;
    this.ringWrap = el.querySelector('.tag-pomo')!;
    this.ring = el.querySelector('.tag-pomo .fg')!;
    this.object = new CSS2DObject(el);
    this.object.center.set(0.5, 1);
  }

  update(p: PlayerState, taskTitle: string | null) {
    this.nameEl.textContent = p.name;
    const meta = STATUS_META[p.status];
    this.dot.style.background = meta.color;
    this.dot.title = meta.label;
    this.mic.textContent = p.media.screen ? '🖥️' : p.media.mic ? '🎙️' : '';
    if (taskTitle) {
      this.task.textContent = `🔨 ${taskTitle}`;
      this.task.style.display = '';
    } else if (p.statusText) {
      this.task.textContent = p.statusText;
      this.task.style.display = '';
    } else this.task.style.display = 'none';
    this.pomo = p.pomo;
    this.ringWrap.style.display = p.pomo ? '' : 'none';
    this.ring.style.stroke = p.pomo?.mode === 'break' ? '#f0a35e' : '#e5566b';
    this.tickPomo(Date.now());
  }

  tickPomo(now: number) {
    if (!this.pomo) return;
    const total = this.pomo.endsAt - this.pomo.startedAt;
    const left = Math.max(0, this.pomo.endsAt - now);
    const c = 2 * Math.PI * 8;
    this.ring.style.strokeDasharray = `${c}`;
    this.ring.style.strokeDashoffset = `${c * (1 - left / total)}`;
  }

  setSpeaking(on: boolean) {
    this.el.classList.toggle('speaking', on);
  }

  setSelected(on: boolean) {
    this.el.classList.toggle('selected', on);
  }

  private badge: HTMLSpanElement | null = null;
  /** Small extra marker after the name (💀, 🗳️ 2, 🎤…); null clears it. */
  setBadge(text: string | null) {
    this.badge ??= this.el.querySelector('.tag-badge');
    if (!this.badge) return;
    this.badge.textContent = text ?? '';
    this.badge.style.display = text ? '' : 'none';
    this.el.classList.toggle('ghost', !!text && text.includes('💀'));
  }

  say(text: string) {
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.bubble.classList.remove('show'), Math.min(9000, 3500 + text.length * 60));
  }

  emote(e: Emote) {
    if (!EMOTE_EMOJI[e]) return;
    const pop = document.createElement('div');
    pop.className = 'tag-emote';
    pop.textContent = EMOTE_EMOJI[e];
    this.el.appendChild(pop);
    setTimeout(() => pop.remove(), 2200);
  }

  confetti() {
    const box = document.createElement('div');
    box.className = 'tag-confetti';
    const colors = ['#e5566b', '#f2c14e', '#3fb27f', '#6b8cff', '#b56fd0'];
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('i');
      s.style.background = colors[i % colors.length];
      s.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
      s.style.setProperty('--dy', `${-60 - Math.random() * 120}px`);
      s.style.setProperty('--r', `${Math.random() * 720}deg`);
      s.style.animationDelay = `${Math.random() * 0.15}s`;
      box.appendChild(s);
    }
    this.el.appendChild(box);
    setTimeout(() => box.remove(), 2000);
  }

  dispose() {
    clearTimeout(this.bubbleTimer);
    this.object.removeFromParent();
    this.el.remove();
  }
}
