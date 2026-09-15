import type { Project, Status } from '@/schemas/project';
import { STAGE_ORDER } from '@/schemas/project';
import { isActive, stageDurations, TRANSITIONS, median, daysInCurrentStage, typicalDays, type StageTransition } from './projects';

export function countByStatus(list: Project[]): Record<Status, number> {
  const out = Object.fromEntries([...STAGE_ORDER, 'closed', 'stalled', 'withdrawn'].map((s) => [s, 0])) as Record<Status, number>;
  for (const p of list) out[p.status]++;
  return out;
}

export function countBy<K extends string>(list: Project[], key: (p: Project) => K): Array<{ key: K; count: number }> {
  const m = new Map<K, number>();
  for (const p of list) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

export function openedInYear(list: Project[], year: number): Project[] {
  return list.filter((p) => p.statusHistory.some((e) => e.status === 'open' && e.date.startsWith(String(year))));
}

export function durationStats(list: Project[]) {
  const byCategory = new Map<string, Record<StageTransition, number[]>>();
  for (const p of list) {
    const d = stageDurations(p);
    const bucket = byCategory.get(p.category) ?? { 'filed-approved': [], 'approved-construction': [], 'construction-open': [] };
    for (const t of TRANSITIONS) if (d[t.key] != null) bucket[t.key].push(d[t.key]!);
    byCategory.set(p.category, bucket);
  }
  return [...byCategory.entries()].map(([category, b]) => ({
    category,
    transitions: TRANSITIONS.map((t) => ({ ...t, median: median(b[t.key]), samples: b[t.key].length, typical: typicalDays(category, t.key) })),
  }));
}

export function longestInStage(list: Project[], limit = 5) {
  return list
    .filter((p) => isActive(p) && p.status !== 'open')
    .map((p) => ({ project: p, days: daysInCurrentStage(p) ?? 0 }))
    .sort((a, b) => b.days - a.days)
    .slice(0, limit);
}

export function openingsByQuarter(list: Project[]): Array<{ quarter: string; count: number }> {
  const m = new Map<string, number>();
  for (const p of list) for (const e of p.statusHistory) {
    if (e.status !== 'open' || e.datePrecision === 'year') continue;
    const [y, mo] = e.date.split('-');
    const q = `${y} Q${Math.ceil(Number(mo ?? '1') / 3)}`;
    m.set(q, (m.get(q) ?? 0) + 1);
  }
  return [...m.entries()].map(([quarter, count]) => ({ quarter, count })).sort((a, b) => a.quarter.localeCompare(b.quarter));
}
