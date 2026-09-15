import { STAGE_ORDER, type Project, type Source, type Status, type Confidence, type DatePrecision } from '../src/schemas/project';
import { SOURCE_TIER, confidenceRank, precisionRank, type FactWithSource, type ImageCandidate } from './types';
import { nameSimilarity, distanceMeters } from './lib/normalize';
import { slugify } from './lib/slug';
import { HAMLIN_CENTER } from '../src/schemas/project';

export interface MergeResult { projects: Project[]; created: string[]; changed: Set<string>; flagged: string[]; images: ImageCandidate[]; sourcesAdded: number }
export interface MergeOptions { now: string; runId: string; log?: (m: string) => void }

const STATUS_VALUES = new Set<string>(['proposed', 'filed', 'approved', 'construction', 'open', 'closed', 'stalled', 'withdrawn']);
const stageIdx = (s: Status) => (STAGE_ORDER as readonly string[]).indexOf(s);

export function findMatch(projects: Project[], name: string, aliases: string[] = [], permitNumber?: string): Project | undefined {
  if (permitNumber) { const byPermit = projects.find((p) => p.permits.some((x) => x.permitNumber === permitNumber)); if (byPermit) return byPermit; }
  const names = [name, ...aliases];
  let best: { p: Project; s: number } | undefined;
  for (const p of projects) {
    const candidates = [p.name, ...p.aliases];
    const s = Math.max(...names.flatMap((n) => candidates.map((c) => nameSimilarity(n, c))));
    if (!best || s > best.s) best = { p, s };
  }
  return best && best.s >= 0.6 ? best.p : undefined;
}

function sourceFor(f: FactWithSource): Source {
  return { id: f.sourceId, url: f.url && /^https?:/.test(f.url) ? f.url : undefined, title: f.url ? f.url.replace(/^https?:\/\//, '').slice(0, 120) : f.publisher, publisher: f.publisher, kind: f.sourceKind, retrievedAt: new Date().toISOString(), publishedAt: f.publishedAt };
}

function addSource(p: Project, f: FactWithSource): number { if (p.sources.some((s) => s.id === f.sourceId)) return 0; p.sources.push(sourceFor(f)); if (p.sources.length > 40) p.sources = p.sources.slice(-40); return 1; }
const tier = (f: FactWithSource) => SOURCE_TIER[f.sourceKind];
const fieldTier = (p: Project, sourceIds: string[]) => Math.max(0, ...sourceIds.map((id) => SOURCE_TIER[p.sources.find((s) => s.id === id)?.kind ?? 'legacy']));
function flag(p: Project, why: string) { if (!p.meta.needsReview.includes(why)) p.meta.needsReview.push(why); }
function unflag(p: Project, why: string) { p.meta.needsReview = p.meta.needsReview.filter((x) => x !== why); }

/** Apply extracted facts to the project list under the no-human-review guardrails. Pure: returns new objects. */
export function mergeFacts(existing: Project[], facts: FactWithSource[], opts: MergeOptions): MergeResult {
  const projects: Project[] = structuredClone(existing);
  const created: string[] = []; const changed = new Set<string>(); const flagged: string[] = []; const images: ImageCandidate[] = [];
  let sourcesAdded = 0;
  const log = opts.log ?? (() => {});
  const touch = (p: Project) => { p.meta.updatedAt = opts.now; changed.add(p.slug); };

  // Group by resolved project; create new projects first so later facts about them attach.
  const byProject = new Map<string, FactWithSource[]>();
  for (const f of facts) {
    let p = findMatch(projects, f.projectName, f.aliases, f.permit?.permitNumber);
    if (!p && f.field === 'new-project' && f.newProject && f.location && tier(f) >= 2 && f.confidence !== 'low') {
      const slug = slugify(f.projectName);
      if (projects.some((x) => x.slug === slug)) continue;
      p = {
        id: slug, slug, name: f.projectName, aliases: f.aliases, type: f.newProject.type, category: f.newProject.category, status: 'proposed', statusConfidence: 'low',
        statusHistory: [], location: { description: f.location.description, address: f.location.address }, summary: f.newProject.summary.slice(0, 200), description: f.newProject.description,
        permits: [], milestones: [], images: [], sources: [], meta: { createdAt: opts.now, updatedAt: opts.now, lastVerifiedAt: opts.now, confidence: 'low', archived: false, needsReview: ['new-unverified'] },
      } as Project;
      projects.push(p); created.push(slug); log(`merge: created ${slug} from ${f.publisher}`);
    }
    if (!p) { log(`merge: no match for "${f.projectName}" (${f.field}); dropped`); continue; }
    byProject.set(p.slug, [...(byProject.get(p.slug) ?? []), f]);
  }

  for (const [slug, fs] of byProject) {
    const p = projects.find((x) => x.slug === slug)!;
    for (const f of fs) sourcesAdded += addSource(p, f);
    // Status: forward-only unless two independent publishers agree on a step back.
    const statusFacts = fs.filter((f) => f.field === 'status' && STATUS_VALUES.has(f.value)).sort((a, b) => tier(b) - tier(a) || confidenceRank[b.confidence] - confidenceRank[a.confidence]);
    if (statusFacts.length) {
      const top = statusFacts[0]; const next = top.value as Status;
      const cur = p.status; const curI = stageIdx(cur); const nextI = stageIdx(next);
      const terminal = next === 'closed' || next === 'withdrawn' || next === 'stalled';
      const independent = new Set(statusFacts.filter((f) => f.value === next).map((f) => f.publisher)).size;
      let apply = false;
      if (terminal) apply = top.confidence === 'high' && tier(top) >= 2 && (independent >= 2 || tier(top) >= 4);
      else if (nextI > curI || curI === -1) apply = top.confidence !== 'low' || tier(top) >= 4;
      else if (nextI < curI) { apply = independent >= 2; if (!apply) { flag(p, `status-conflict:${next}`); flagged.push(`${slug}: source says ${next}, record says ${cur}`); } }
      if (apply && next !== cur) {
        p.status = next; p.statusConfidence = tier(top) >= 3 ? 'high' : top.confidence;
        p.statusHistory.push({ status: next, date: top.date ?? (top.publishedAt ?? opts.now).slice(0, 10), datePrecision: top.datePrecision ?? (top.date ? 'day' : 'day'), sourceIds: [top.sourceId] });
        p.statusHistory.sort((a, b) => a.date.localeCompare(b.date));
        p.milestones.push({ date: top.date ?? (top.publishedAt ?? opts.now).slice(0, 10), precision: top.datePrecision ?? 'day', title: next === 'open' ? 'Opened' : `Status: ${next}`, detail: top.quote.slice(0, 240), kind: next === 'open' ? 'opening' : 'status', sourceIds: [top.sourceId] });
        if (next === 'open') { unflag(p, 'scheduled-opening-passed'); p.expectedCompletion = undefined; }
        if (terminal) { p.meta.archived = true; p.meta.archivedReason = top.quote.slice(0, 200); }
        touch(p);
      } else if (apply && next === cur && top.date && !p.statusHistory.some((e) => e.status === cur && precisionRank[e.datePrecision] >= precisionRank[top.datePrecision ?? 'day'])) {
        // Same status, but a better-dated event than we had.
        p.statusHistory = p.statusHistory.filter((e) => e.status !== cur || e.datePrecision !== 'estimate');
        p.statusHistory.push({ status: cur, date: top.date, datePrecision: top.datePrecision ?? 'day', sourceIds: [top.sourceId] });
        p.statusHistory.sort((a, b) => a.date.localeCompare(b.date)); touch(p);
      }
    }
    // Expected completion: better tier, or equal tier and newer.
    const expFacts = fs.filter((f) => f.field === 'expectedCompletion' && f.date).sort((a, b) => tier(b) - tier(a) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    if (expFacts.length && p.status !== 'open') {
      const top = expFacts[0]; const curTier = p.expectedCompletion ? fieldTier(p, p.expectedCompletion.sourceIds) : -1;
      const newer = !p.expectedCompletion || tier(top) > curTier || (tier(top) === curTier && (top.publishedAt ?? opts.now) >= (p.sources.find((s) => p.expectedCompletion!.sourceIds.includes(s.id))?.publishedAt ?? '0'));
      if (newer && top.date !== p.expectedCompletion?.date) {
        p.expectedCompletion = { date: top.date!, precision: top.datePrecision ?? 'month', confidence: tier(top) >= 3 ? 'high' : top.confidence, label: top.dateLabel, sourceIds: [top.sourceId] };
        unflag(p, 'scheduled-opening-passed'); unflag(p, 'timeline-unknown'); touch(p);
      }
    }
    // Simple scalar fields with tier precedence.
    const scalar: Array<[string, (f: FactWithSource) => void, () => number]> = [
      ['address', (f) => { p.location.address = f.value; }, () => 0],
      ['developer', (f) => { p.developer = f.value; }, () => 0],
      ['contractor', (f) => { p.contractor = f.value; }, () => 0],
      ['category', (f) => { p.category = f.value; }, () => 4],
      ['description', (f) => { if (f.value.length > p.description.length * 0.8) p.description = f.value; }, () => 3],
    ];
    for (const [field, set, minTier] of scalar) {
      const top = fs.filter((f) => f.field === field && f.confidence !== 'low').sort((a, b) => tier(b) - tier(a))[0];
      if (top && tier(top) >= minTier()) { const before = JSON.stringify(p); set(top); if (JSON.stringify(p) !== before) touch(p); }
    }
    for (const f of fs.filter((f) => f.field === 'alias')) if (!p.aliases.includes(f.value) && f.value !== p.name) { p.aliases.push(f.value); touch(p); }
    const size = fs.find((f) => f.field === 'size' && /\d/.test(f.value));
    if (size && !p.size) { const m = size.value.replace(/,/g, '').match(/([\d.]+)\s*(sq ?ft|sf|acres?|units?|homes?)/i); if (m) { p.size = { value: Number(m[1]), unit: /sq|sf/i.test(m[2]) ? 'sqft' : /acre/i.test(m[2]) ? 'acres' : /unit/i.test(m[2]) ? 'units' : 'homes', raw: size.value }; touch(p); } }
    // Permits and milestones.
    for (const f of fs.filter((f) => f.field === 'permit' && f.permit)) {
      const pm = f.permit!; const ex = p.permits.find((x) => x.permitNumber === pm.permitNumber);
      if (ex) { if (ex.status !== pm.status || (pm.issuedDate && !ex.issuedDate)) { Object.assign(ex, { status: pm.status, issuedDate: pm.issuedDate ?? ex.issuedDate, filedDate: pm.filedDate ?? ex.filedDate }); ex.sourceIds.push(f.sourceId); touch(p); } }
      else { p.permits.push({ ...pm, url: pm.url && /^https?:/.test(pm.url) ? pm.url : undefined, sourceIds: [f.sourceId] }); touch(p); }
    }
    for (const f of fs.filter((f) => f.field === 'milestone' && f.date)) {
      if (!p.milestones.some((m) => m.date === f.date && m.title.toLowerCase() === f.value.toLowerCase())) { p.milestones.push({ date: f.date!, precision: f.datePrecision ?? 'day', title: f.value.slice(0, 120), detail: f.quote.slice(0, 240), kind: f.sourceKind === 'permit' ? 'permit' : 'news', sourceIds: [f.sourceId] }); touch(p); }
    }
    // Business fields: only trusted tiers get confidence high; others stored low (hidden on site).
    const bf = fs.filter((f) => ['website', 'phone', 'social', 'offerings', 'priceRange', 'hours', 'menuHighlights', 'brandDescription'].includes(f.field));
    if (bf.length) {
      p.business ??= { offerings: [], fieldSources: {}, fieldConfidence: {} };
      for (const f of bf.sort((a, b) => tier(a) - tier(b))) {
        const conf: Confidence = tier(f) >= 3 ? 'high' : f.field === 'website' && tier(f) >= 2 ? 'medium' : 'low';
        const curConf = p.business.fieldConfidence[f.field];
        if (curConf && confidenceRank[curConf] > confidenceRank[conf]) continue;
        try {
          switch (f.field) {
            case 'website': if (/^https?:\/\//.test(f.value)) p.business.website = f.value; else continue; break;
            case 'phone': p.business.phone = f.value; break;
            case 'social': { const u = f.value.match(/https?:\/\/\S+/)?.[0]; if (!u) continue; const key = /instagram/.test(u) ? 'instagram' : /facebook/.test(u) ? 'facebook' : /tiktok/.test(u) ? 'tiktok' : 'x'; p.business.socials = { ...p.business.socials, [key]: u }; break; }
            case 'offerings': p.business.offerings = [...new Set([...p.business.offerings, ...f.value.split(/[;,•·]/).map((s) => s.trim()).filter(Boolean)])].slice(0, 12); break;
            case 'priceRange': if (/^\${1,4}$/.test(f.value)) p.business.priceRange = f.value as any; else continue; break;
            case 'hours': { const arr = JSON.parse(f.value); if (!Array.isArray(arr)) continue; p.business.hours = arr.filter((h: any) => h && typeof h.day === 'string').map((h: any) => ({ day: h.day.slice(0, 3).toLowerCase(), open: h.open, close: h.close, closed: h.closed })); break; }
            case 'menuHighlights': p.business.menuHighlights = f.value.split(/[;,•·]/).map((s) => s.trim()).filter(Boolean).slice(0, 10); break;
            case 'brandDescription': p.business.brandDescription = f.value.slice(0, 600); break;
          }
        } catch { continue; }
        p.business.fieldConfidence[f.field] = conf; p.business.fieldSources[f.field] = [...new Set([...(p.business.fieldSources[f.field] ?? []), f.sourceId])]; touch(p);
      }
    }
    for (const f of fs.filter((f) => f.field === 'image')) { const u = f.value.match(/https?:\/\/\S+\.(?:jpe?g|png|webp|avif)(?:\?\S*)?/i)?.[0] ?? (/^https?:/.test(f.value) ? f.value : undefined); if (u) images.push({ slug, url: u, credit: f.publisher, sourceUrl: f.url, alt: `${p.name} rendering via ${f.publisher}` }); }
    // Verification bookkeeping: any fact from a source this run counts as a check.
    if (fs.some((f) => f.confidence !== 'low')) { p.meta.lastVerifiedAt = opts.now; unflag(p, 'new-unverified'); }
    if (p.meta.confidence === 'low' && p.sources.filter((s) => s.kind !== 'legacy').length >= 2) p.meta.confidence = 'medium';
  }
  // Untouched, distance sanity for created projects (must be near Hamlin once geocoded; enforced in validate).
  void HAMLIN_CENTER; void distanceMeters;
  return { projects, created, changed, flagged, images, sourcesAdded };
}

export function markVerified(projects: Project[], slugs: string[], now: string): void {
  for (const p of projects) if (slugs.includes(p.slug)) p.meta.lastVerifiedAt = now;
}

export type { Status, DatePrecision };
