import type { ChangelogEntry, Project } from '../src/schemas/project';
import { STATUS_LABEL } from '../src/lib/projects';
import { formatPrecise } from '../src/lib/dates';

const CAP = 500;

/** Templated, human-readable diff between two snapshots. Never uses a model. */
export function buildChangelog(prev: Project[], next: Project[], runId: string, now: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  const prevMap = new Map(prev.map((p) => [p.slug, p]));
  const mk = (p: Project, kind: ChangelogEntry['kind'], summary: string, diff: ChangelogEntry['diff'] = [], sourceIds: string[] = []): ChangelogEntry => ({ id: `${now.slice(0, 10)}-${p.slug}-${kind}-${out.length}`, date: now, runId, projectId: p.id, projectSlug: p.slug, projectName: p.name, kind, summary, diff, sourceIds });
  for (const p of next) {
    const o = prevMap.get(p.slug);
    if (!o) { out.push(mk(p, 'new', `New project tracked: ${p.category.toLowerCase()} at ${p.location.description}.`, [], p.sources.map((s) => s.id))); continue; }
    if (o.status !== p.status) {
      const ev = p.statusHistory.filter((e) => e.status === p.status).at(-1);
      out.push(mk(p, p.meta.archived && !o.meta.archived ? 'archived' : 'status-change', p.status === 'open' ? `Now open${ev ? ` (${formatPrecise(ev.date, ev.datePrecision)})` : ''}.` : `${STATUS_LABEL[o.status]} → ${STATUS_LABEL[p.status]}.`, [{ field: 'status', from: o.status, to: p.status }], ev?.sourceIds ?? []));
    }
    const od = o.expectedCompletion?.date, nd = p.expectedCompletion?.date;
    if (od !== nd && nd) out.push(mk(p, 'date-change', `Expected opening ${od ? `moved from ${formatPrecise(od, o.expectedCompletion!.precision, o.expectedCompletion!.label)} to` : 'set to'} ${formatPrecise(nd, p.expectedCompletion!.precision, p.expectedCompletion!.label)}.`, [{ field: 'expectedCompletion.date', from: od, to: nd }], p.expectedCompletion!.sourceIds));
    const fields: Array<[string, (x: Project) => unknown, string]> = [
      ['location.address', (x) => x.location.address, 'Address updated'], ['size', (x) => x.size?.raw, 'Size updated'], ['developer', (x) => x.developer, 'Developer updated'],
      ['business.website', (x) => x.business?.website, 'Website added'], ['business.hours', (x) => JSON.stringify(x.business?.hours ?? null), 'Hours added'], ['business.priceRange', (x) => x.business?.priceRange, 'Price range added'],
      ['business.offerings', (x) => JSON.stringify(x.business?.offerings ?? []), 'Offerings updated'], ['permits', (x) => x.permits.length, 'Permit records updated'], ['description', (x) => x.description, 'Description updated'],
    ];
    const diffs = fields.filter(([, get]) => JSON.stringify(get(o)) !== JSON.stringify(get(p)));
    if (diffs.length) out.push(mk(p, 'field-update', diffs.map(([, , label]) => label).join('; ') + '.', diffs.map(([field, get]) => ({ field, from: get(o), to: get(p) }))));
    const newImgs = p.images.filter((i) => !o.images.some((x) => x.file === i.file));
    if (newImgs.length) out.push(mk(p, 'image-added', newImgs[0].kind === 'ai-concept' ? 'AI concept image added (labeled; not an official rendering).' : `Official rendering added${newImgs[0].credit ? ` (credit: ${newImgs[0].credit})` : ''}.`));
  }
  return out;
}

export function appendChangelog(existing: ChangelogEntry[], entries: ChangelogEntry[]): ChangelogEntry[] {
  return [...entries, ...existing].slice(0, CAP);
}
