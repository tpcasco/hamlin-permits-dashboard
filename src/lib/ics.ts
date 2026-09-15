import { createEvents, type EventAttributes } from 'ics';
import type { Project } from '@/schemas/project';
import { toDate } from './dates';

export function openingEvent(p: Project, site: string): EventAttributes | null {
  const e = p.expectedCompletion;
  if (!e) return null;
  const d = toDate(e.date);
  const title = e.precision === 'day' ? `${p.name} opens` : `${p.name} expected to open (${e.precision === 'estimate' ? e.label ?? 'estimate' : 'approx.'})`;
  return {
    uid: `${p.slug}-opening@hamlin-tracker`,
    start: [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()],
    duration: { days: 1 },
    title,
    description: `${p.summary}\n\nStatus: ${p.status}. Date precision: ${e.precision}, confidence: ${e.confidence}.\n${site}/projects/${p.slug}`,
    location: p.location.address ?? p.location.description,
    url: `${site}/projects/${p.slug}`,
    calName: 'Hamlin openings',
    productId: 'hamlin-development-tracker',
  };
}

export function buildIcs(events: EventAttributes[]): string {
  const { error, value } = createEvents(events);
  if (error) throw error;
  return value ?? '';
}
