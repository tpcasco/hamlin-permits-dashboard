import { STAGE_ORDER, type Project, type Stage, type Status } from '@/schemas/project';
import categories from '../../data/categories.json';
import { toDate, daysBetween } from './dates';

export type CategoryMeta = { icon: string; color: string; typicalDays: Record<string, number> };
const CATEGORIES = categories as Record<string, CategoryMeta>;

export const STATUS_LABEL: Record<Status, string> = {
  proposed: 'Proposed', filed: 'Filed', approved: 'Approved', construction: 'Under construction', open: 'Open',
  closed: 'Closed', stalled: 'Stalled', withdrawn: 'Withdrawn',
};
export const STATUS_SHORT: Record<Status, string> = { ...STATUS_LABEL, construction: 'Building' };
export const STATUS_COLOR: Record<Status, string> = {
  proposed: '#7c3aed', filed: '#2563eb', approved: '#0d9488', construction: '#d97706', open: '#16a34a',
  closed: '#6b7280', stalled: '#9ca3af', withdrawn: '#9ca3af',
};
export const STATUS_HELP: Record<Status, string> = {
  proposed: 'Announced or in pre-application. Nothing filed with the county or city yet.',
  filed: 'Plans or permits have been submitted and are under review.',
  approved: 'Plans approved. Site work can begin once building permits are issued.',
  construction: 'Crews are on site. Watch this space.',
  open: 'Open for business or in use.',
  closed: 'Closed after opening.',
  stalled: 'No activity reported for a long time.',
  withdrawn: 'Application withdrawn or denied.',
};

export const TYPE_LABEL: Record<Project['type'], string> = { commercial: 'Commercial', residential: 'Residential', infrastructure: 'Infrastructure', mixed: 'Mixed-use' };

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORIES[category] ?? CATEGORIES.Other;
}

export function stageIndex(status: Status): number {
  return (STAGE_ORDER as readonly string[]).indexOf(status);
}

export function isActive(p: Project): boolean {
  return !p.meta.archived && !['closed', 'withdrawn'].includes(p.status);
}

/** Date the project entered a given stage, from its history (earliest event with that status). */
export function stageDate(p: Project, stage: Stage) {
  return p.statusHistory.filter((e) => e.status === stage).sort((a, b) => a.date.localeCompare(b.date))[0];
}

export function currentStageEvent(p: Project) {
  return p.statusHistory.filter((e) => e.status === p.status).sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function daysInCurrentStage(p: Project, now = new Date()): number | null {
  const e = currentStageEvent(p);
  if (!e || p.status === 'open') return null;
  if (e.datePrecision === 'estimate' || e.datePrecision === 'year') return null;
  return Math.max(0, daysBetween(toDate(e.date), now));
}

export type StageTransition = 'filed-approved' | 'approved-construction' | 'construction-open';
export const TRANSITIONS: Array<{ key: StageTransition; from: Stage; to: Stage; label: string }> = [
  { key: 'filed-approved', from: 'filed', to: 'approved', label: 'Filed → Approved' },
  { key: 'approved-construction', from: 'approved', to: 'construction', label: 'Approved → Construction' },
  { key: 'construction-open', from: 'construction', to: 'open', label: 'Construction → Open' },
];

/** Measured durations for this project (only when both dates are day/month precision). */
export function stageDurations(p: Project): Partial<Record<StageTransition, number>> {
  const out: Partial<Record<StageTransition, number>> = {};
  for (const t of TRANSITIONS) {
    const a = stageDate(p, t.from);
    const b = stageDate(p, t.to);
    if (a && b && a.datePrecision !== 'estimate' && b.datePrecision !== 'estimate' && a.datePrecision !== 'year' && b.datePrecision !== 'year') {
      out[t.key] = Math.max(0, daysBetween(toDate(a.date), toDate(b.date)));
    }
  }
  return out;
}

export function typicalDays(category: string, t: StageTransition): number {
  return categoryMeta(category).typicalDays[t];
}

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Median measured duration across projects, falling back to the category's typical value. */
export function typicalOrMeasured(all: Project[], category: string, t: StageTransition): { days: number; measured: boolean } {
  const measured = all.filter((p) => p.category === category).map((p) => stageDurations(p)[t]).filter((d): d is number => typeof d === 'number');
  const m = median(measured);
  return m !== null && measured.length >= 3 ? { days: m, measured: true } : { days: typicalDays(category, t), measured: false };
}

export type OpeningWindow = 'open' | 'this-month' | 'next-3-months' | 'next-6-months' | 'this-year' | 'later' | 'unknown';
export function openingWindow(p: Project, now = new Date()): OpeningWindow {
  if (p.status === 'open') return 'open';
  const e = p.expectedCompletion;
  if (!e) return 'unknown';
  const days = daysBetween(now, toDate(e.date));
  if (days < 0 && e.precision === 'estimate') return 'unknown';
  if (days <= 31) return 'this-month';
  if (days <= 92) return 'next-3-months';
  if (days <= 183) return 'next-6-months';
  if (toDate(e.date).getUTCFullYear() === now.getUTCFullYear()) return 'this-year';
  return 'later';
}
export const OPENING_WINDOW_LABEL: Record<OpeningWindow, string> = {
  open: 'Already open', 'this-month': 'This month', 'next-3-months': 'Next 3 months', 'next-6-months': 'Next 6 months', 'this-year': 'Later this year', later: '2027 and beyond', unknown: 'Date unknown',
};

export function heroImage(p: Project) {
  return p.images.find((i) => i.isHero) ?? p.images[0];
}

export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function nearby(p: Project, all: Project[], limit = 4, maxMiles = 1): Array<{ project: Project; miles: number }> {
  if (p.location.lat == null || p.location.lng == null) return [];
  const here = { lat: p.location.lat, lng: p.location.lng };
  return all
    .filter((o) => o.id !== p.id && o.location.lat != null && o.location.lng != null && isActive(o))
    .map((o) => ({ project: o, miles: haversineMiles(here, { lat: o.location.lat!, lng: o.location.lng! }) }))
    .filter((x) => x.miles <= maxMiles)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit);
}

export type SortKey = 'updated' | 'opening' | 'name' | 'stage';
export function sortProjects(list: Project[], key: SortKey): Project[] {
  const copy = [...list];
  switch (key) {
    case 'name': return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'stage': return copy.sort((a, b) => stageIndex(b.status) - stageIndex(a.status) || a.name.localeCompare(b.name));
    case 'opening': return copy.sort((a, b) => (a.expectedCompletion?.date ?? '9999').localeCompare(b.expectedCompletion?.date ?? '9999') || a.name.localeCompare(b.name));
    default: return copy.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
  }
}

/** Compact record shipped to the browser for client-side filtering/search and the map. */
export function toClientRecord(p: Project) {
  const hero = heroImage(p);
  return {
    id: p.id, slug: p.slug, name: p.name, aliases: p.aliases, type: p.type, category: p.category, status: p.status,
    summary: p.summary, developer: p.developer ?? '', locationDescription: p.location.description,
    lat: p.location.lat ?? null, lng: p.location.lng ?? null, geocodeConfidence: p.location.geocodeConfidence ?? null,
    expected: p.expectedCompletion ? { date: p.expectedCompletion.date, precision: p.expectedCompletion.precision, label: p.expectedCompletion.label ?? null } : null,
    openingWindow: openingWindow(p), updatedAt: p.meta.updatedAt, daysInStage: daysInCurrentStage(p),
    hero: hero ? { file: hero.file, kind: hero.kind, alt: hero.alt } : null, hasImages: p.images.length > 0,
    color: STATUS_COLOR[p.status], icon: categoryMeta(p.category).icon,
  };
}
export type ClientRecord = ReturnType<typeof toClientRecord>;
