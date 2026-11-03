// WebSocket client with automatic reconnect and a typed message bus.

import type { ClientMsg, ServerMsg } from '../../shared/protocol';

type Handler<T extends ServerMsg['t']> = (msg: Extract<ServerMsg, { t: T }>) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: ServerMsg) => void>>();
  private queue: string[] = [];
  private retry = 0;
  private stopped = false;
  private ready = false; // true once the server sent `welcome` for this socket
  private pingTimer: number | undefined;
  onOpen: (() => void) | null = null;
  onStatus: ((connected: boolean) => void) | null = null;
  onBinary: ((data: ArrayBuffer) => void) | null = null;

  constructor(private url: string) {}

  connect(): void {
    this.stopped = false;
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus?.(true);
      this.ready = false;
      this.onOpen?.();
      clearInterval(this.pingTimer);
      // Answered by the DO's auto-response without waking it from hibernation.
      this.pingTimer = window.setInterval(() => this.sendRaw('{"t":"ping"}'), 25_000);
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.onBinary?.(ev.data);
        return;
      }
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.ready = true;
        for (const m of this.queue.splice(0)) ws.send(m);
      }
      this.handlers.get(msg.t)?.forEach((h) => h(msg));
    };
    ws.onclose = (ev) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      this.onStatus?.(false);
      if (this.stopped || ev.code === 4000 || ev.code === 4001) return;
      const delay = Math.min(10_000, 800 * 2 ** this.retry++) + Math.random() * 400;
      setTimeout(() => !this.stopped && this.connect(), delay);
    };
  }

  close(): void {
    this.stopped = true;
    clearInterval(this.pingTimer);
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Send immediately on an open socket (used for the `hello` handshake). */
  sendNow(msg: ClientMsg): void {
    if (this.open) this.ws!.send(JSON.stringify(msg));
  }

  send(msg: ClientMsg): void {
    const data = JSON.stringify(msg);
    if (this.open && this.ready) this.ws!.send(data);
    else if (msg.t !== 'move' && msg.t !== 'rtc' && msg.t !== 'ping') this.queue.push(data);
  }

  /** Media frames: dropped (not queued) when the socket is not ready. Skips when the socket is backed up. */
  sendBinary(data: ArrayBuffer | Uint8Array): void {
    if (this.open && this.ready && this.ws!.bufferedAmount < 2_000_000) this.ws!.send(data);
  }

  private sendRaw(data: string): void {
    if (this.open) this.ws!.send(data);
  }

  on<T extends ServerMsg['t']>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as (m: ServerMsg) => void);
    return () => set!.delete(handler as (m: ServerMsg) => void);
  }
}

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/ws`;
}
