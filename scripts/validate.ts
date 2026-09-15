import { readFileSync } from 'node:fs';
import { ProjectsFileSchema, type Project } from '../src/schemas/project';

export interface ValidationOptions { previous?: Project[]; maxChangedRatio?: number; imageMissing?: string[]; allowShrink?: boolean }

/** Schema plus business rules that stand in for a human reviewer. Throws with every problem listed. */
export function validateProjects(input: unknown, opts: ValidationOptions = {}): Project[] {
  const problems: string[] = [];
  const parsed = ProjectsFileSchema.safeParse(input);
  if (!parsed.success) { for (const i of parsed.error.issues.slice(0, 20)) problems.push(`schema ${i.path.join('.')}: ${i.message}`); throw new Error(problems.join('\n')); }
  const projects = parsed.data;
  const slugs = new Set<string>(); const ids = new Set<string>();
  for (const p of projects) {
    if (slugs.has(p.slug)) problems.push(`duplicate slug ${p.slug}`); slugs.add(p.slug);
    if (ids.has(p.id)) problems.push(`duplicate id ${p.id}`); ids.add(p.id);
    if (p.statusHistory.some((e, i) => i > 0 && e.date < p.statusHistory[i - 1].date)) problems.push(`${p.slug}: statusHistory not chronological`);
    if (!p.statusHistory.some((e) => e.status === p.status) && !p.meta.archived) problems.push(`${p.slug}: current status ${p.status} has no history event`);
    if ((p.location.lat == null) !== (p.location.lng == null)) problems.push(`${p.slug}: lat/lng must both be set`);
    for (const img of p.images) if (img.kind === 'ai-concept' && !/AI|concept/i.test(img.alt)) problems.push(`${p.slug}: AI image alt must disclose it is a concept`);
    if (p.images.filter((i) => i.isHero).length > 1) problems.push(`${p.slug}: more than one hero image`);
    for (const src of p.statusHistory.flatMap((e) => e.sourceIds)) if (!p.sources.some((s) => s.id === src)) problems.push(`${p.slug}: statusHistory references unknown source ${src}`);
  }
  if (opts.previous) {
    const prev = opts.previous;
    if (!opts.allowShrink && projects.length < prev.length) problems.push(`project count shrank ${prev.length} → ${projects.length}`);
    for (const old of prev) if (!slugs.has(old.slug)) problems.push(`project disappeared: ${old.slug}`);
    // Verification timestamps are bookkeeping, not content: exclude them from the change ratio.
    const fingerprint = (p: Project) => JSON.stringify({ ...p, meta: { ...p.meta, updatedAt: undefined, lastVerifiedAt: undefined } });
    const prevMap = new Map(prev.map((p) => [p.slug, fingerprint(p)]));
    const changed = projects.filter((p) => prevMap.has(p.slug) && prevMap.get(p.slug) !== fingerprint(p)).length + (projects.length - prev.length);
    const ratio = prev.length ? changed / prev.length : 0;
    if (ratio > (opts.maxChangedRatio ?? 0.3) && prev.length >= 10) problems.push(`suspicious: ${(ratio * 100).toFixed(0)}% of projects changed in one run (limit ${((opts.maxChangedRatio ?? 0.3) * 100).toFixed(0)}%)`);
    for (const p of projects) { const o = prev.find((x) => x.slug === p.slug); if (o && o.status === 'open' && p.status !== 'open' && !p.meta.archived) problems.push(`${p.slug}: regressed from open to ${p.status}`); }
  }
  if (opts.imageMissing?.length) problems.push(`missing image files: ${opts.imageMissing.join(', ')}`);
  if (problems.length) throw new Error(problems.join('\n'));
  return projects;
}

if (process.argv[1] && /validate\.ts$/.test(process.argv[1])) {
  try { const list = validateProjects(JSON.parse(readFileSync('data/projects.json', 'utf8'))); console.log(`OK: ${list.length} projects valid`); }
  catch (e) { console.error(String((e as Error).message)); process.exit(1); }
}
