// Finding an old piece of work again in "Văn phòng của bạn": one person's own channel, one thread per
// request. Searched on the server (the browser only holds the newest lines of the channel), with
// the same rules for everyone — pure, so the test can call it too.
import type { ChatMsg, Task } from './protocol';
import { settled } from './protocol';

export type ThreadFilter = 'all' | 'running' | 'done';

/** One thread a search found. */
export interface ThreadHit {
  /** the opener's id (what the browser opens) */
  root: string;
  name: string;
  text: string;
  ts: number;
  /** the newest line in it */
  last: number;
  replies: number;
  /** titles of the cards the work made */
  titles: string[];
  /** its latest 📋 report, if any */
  report?: string;
  /** work still out: a card not finished, or Tổng quản still on it */
  running: boolean;
}

export const THREAD_FIND = { q: 80, hits: 30, report: 220 };

/** Lower case, no Vietnamese marks: "Kết quả" finds "ket qua" and the other way round. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/**
 * Threads of one channel matching `q` (every word, in the opener, a card title or a 📋 report) and
 * the filter, newest activity first. An empty `q` lists them all (by the filter).
 * `open` = roots Tổng quản is still working on (deciding, asking, or waiting to report).
 */
export function findThreads(msgs: ChatMsg[], tasks: Iterable<Task>, open: Set<string>, rawQ: string, filter: ThreadFilter, reportPrefix: string): ThreadHit[] {
  const words = fold(String(rawQ ?? '').slice(0, THREAD_FIND.q)).split(/\s+/).filter(Boolean);
  const byRoot = new Map<string, { opener?: ChatMsg; kids: ChatMsg[] }>();
  for (const m of msgs) {
    const key = m.root ?? m.id;
    const e = byRoot.get(key) ?? { kids: [] };
    if (m.root) e.kids.push(m);
    else e.opener = m;
    byRoot.set(key, e);
  }
  const cards = new Map<string, Task[]>();
  for (const t of tasks) if (t.thread) cards.set(t.thread, [...(cards.get(t.thread) ?? []), t]);
  const hits: ThreadHit[] = [];
  for (const [root, { opener, kids }] of byRoot) {
    if (!opener) continue; // the opener was pruned: nothing to show it by
    const work = cards.get(root) ?? [];
    const running = open.has(root) || work.some((t) => !settled(t));
    if ((filter === 'running' && !running) || (filter === 'done' && running)) continue;
    const reports = kids.filter((k) => k.text.startsWith(reportPrefix));
    const titles = work.sort((a, b) => a.createdAt - b.createdAt).map((t) => t.title);
    const hay = fold([opener.text, ...titles, ...reports.map((r) => r.text)].join('\n'));
    if (!words.every((w) => hay.includes(w))) continue;
    const report = reports[reports.length - 1]?.text;
    hits.push({
      root,
      name: opener.name,
      text: opener.text,
      ts: opener.ts,
      last: Math.max(opener.ts, ...kids.map((k) => k.ts)),
      replies: kids.length,
      titles: titles.slice(0, 4),
      ...(report ? { report: report.length > THREAD_FIND.report ? `${report.slice(0, THREAD_FIND.report)}…` : report } : {}),
      running,
    });
  }
  return hits.sort((a, b) => b.last - a.last).slice(0, THREAD_FIND.hits);
}
