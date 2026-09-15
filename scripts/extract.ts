import type { Project } from '../src/schemas/project';
import { ExtractionResultSchema, type FactWithSource, type RawDoc } from './types';
import { extractStructured, researchWithWebSearch, prompt } from './lib/claude';
import { formatPrecise } from '../src/lib/dates';

const CONCURRENCY = Number(process.env.EXTRACT_CONCURRENCY || 3);

/** Run structured extraction over every raw doc; a failing doc is logged and skipped. */
export async function extractFacts(docs: RawDoc[], log: (m: string) => void): Promise<FactWithSource[]> {
  const system = prompt('extract');
  const out: FactWithSource[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < docs.length) {
      const doc = docs[i++];
      try {
        const user = `Source: ${doc.publisher}\nTitle: ${doc.title}\nURL: ${doc.url}\nPublished: ${doc.publishedAt ?? 'unknown'}\nKind: ${doc.sourceKind}\n\n---\n${doc.text}`;
        const res = await extractStructured({ system, user, schema: ExtractionResultSchema, effort: 'medium' });
        if (!res.relevant) { log(`extract: ${doc.id} not relevant`); continue; }
        for (const f of res.facts) out.push({ ...f, sourceId: doc.id, sourceKind: doc.sourceKind, publisher: doc.publisher, url: doc.url, publishedAt: doc.publishedAt });
        log(`extract: ${doc.id} → ${res.facts.length} facts`);
      } catch (e) { log(`extract: ${doc.id} failed: ${(e as Error).message}`); }
    }
  }));
  return out;
}

/** Pick projects that deserve a web-search verification pass tonight. */
export function pickForReconcile(projects: Project[], max: number, now = new Date()): Project[] {
  const staleCut = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const today = now.toISOString().slice(0, 10);
  const score = (p: Project) => {
    let s = 0;
    if (p.meta.needsReview.includes('scheduled-opening-passed')) s += 5;
    if (p.expectedCompletion && p.expectedCompletion.date <= today && p.status !== 'open') s += 5;
    if (p.status === 'construction') s += 2;
    if (p.meta.needsReview.includes('timeline-unknown')) s += 1;
    if (p.meta.lastVerifiedAt < staleCut) s += 2;
    if (p.meta.archived || ['closed', 'withdrawn'].includes(p.status)) s = -1;
    return s + (staleCut > p.meta.lastVerifiedAt ? 0 : -3);
  };
  return projects.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.p.meta.lastVerifiedAt.localeCompare(b.p.meta.lastVerifiedAt)).slice(0, max).map((x) => x.p);
}

/** Two calls per project: research with web search (citations), then structured extraction of the note. */
export async function reconcileProjects(projects: Project[], trustedDomains: string[], log: (m: string) => void): Promise<{ facts: FactWithSource[]; verified: string[] }> {
  const research = prompt('reconcile');
  const extract = prompt('extract');
  const facts: FactWithSource[] = [];
  const verified: string[] = [];
  for (const p of projects) {
    try {
      const record = `Name: ${p.name}\nAliases: ${p.aliases.join(', ') || '-'}\nCategory: ${p.category}\nStatus on record: ${p.status}\nExpected opening on record: ${p.expectedCompletion ? formatPrecise(p.expectedCompletion.date, p.expectedCompletion.precision, p.expectedCompletion.label) : 'unknown'}\nLocation: ${p.location.address ?? ''} ${p.location.description}\nDeveloper: ${p.developer ?? '-'}\nLast verified: ${p.meta.lastVerifiedAt.slice(0, 10)}\nSummary: ${p.summary}`;
      const note = await researchWithWebSearch({ system: research, user: record, allowedDomains: trustedDomains, maxUses: 5 });
      verified.push(p.slug);
      if (/no newer information found/i.test(note.text) && note.citations.length === 0) { log(`reconcile: ${p.slug} nothing new`); continue; }
      const res = await extractStructured({ system: extract, user: `Source: web research note (citations are the real sources)\nProject: ${p.name}\nCitations: ${note.citations.join(' ')}\n\n---\n${note.text}`, schema: ExtractionResultSchema, effort: 'medium' });
      for (const f of res.facts) facts.push({ ...f, projectName: f.projectName || p.name, sourceId: `web-${p.slug}-${Date.now().toString(36)}`, sourceKind: 'web-search', publisher: note.citations[0] ? new URL(note.citations[0]).hostname : 'web search', url: note.citations[0] ?? `https://www.google.com/search?q=${encodeURIComponent(p.name + ' Hamlin')}`, publishedAt: undefined });
      log(`reconcile: ${p.slug} → ${res.facts.length} facts from ${note.citations.length} citations`);
    } catch (e) { log(`reconcile: ${p.slug} failed: ${(e as Error).message}`); }
  }
  return { facts, verified };
}
