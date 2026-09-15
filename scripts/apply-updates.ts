/**
 * Manual update path (no Claude API): a Claude Code session researches sources with its own web search, writes the
 * findings as facts JSON (same shape as the automated extractor), and this script applies them through the exact
 * same merge guardrails, geocoding, validation, and changelog as the nightly pipeline.
 *
 *   npx tsx scripts/apply-updates.ts updates/2026-09-15.json [--verified=slug,slug] [--dry-run]
 *
 * File shape: { "sources": [{ id, url, title, publisher, kind, publishedAt? }], "facts": [ExtractedFact & { sourceId }] }
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ProjectsFileSchema, ChangelogFileSchema, PipelineStateSchema, SOURCE_KINDS } from '../src/schemas/project';
import { ExtractedFactSchema, type FactWithSource } from './types';
import { mergeFacts, markVerified } from './merge';
import { geocodeProjects } from './geocode';
import { processImages, verifyImageFiles } from './images';
import { validateProjects } from './validate';
import { buildChangelog, appendChangelog } from './changelog';

const UpdateFileSchema = z.object({
  sources: z.array(z.object({ id: z.string().min(1), url: z.string().url().optional(), title: z.string().min(1), publisher: z.string().min(1), kind: z.enum(SOURCE_KINDS), publishedAt: z.string().optional() })),
  facts: z.array(ExtractedFactSchema.extend({ sourceId: z.string().min(1) })),
  verified: z.array(z.string()).default([]),
  note: z.string().optional(),
});

const ROOT = process.cwd();
const file = process.argv[2];
if (!file) { console.error('usage: tsx scripts/apply-updates.ts <updates.json> [--verified=a,b] [--dry-run]'); process.exit(2); }
const dry = process.argv.includes('--dry-run');
const verifiedArg = process.argv.find((a) => a.startsWith('--verified='))?.slice(11).split(',').filter(Boolean) ?? [];
const now = new Date().toISOString();
const runId = `manual-${now.slice(0, 10)}`;
const log = (m: string) => console.log(m);
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

async function main() {
  const update = UpdateFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const srcMap = new Map(update.sources.map((s) => [s.id, s]));
  const facts: FactWithSource[] = update.facts.map((f) => {
    const s = srcMap.get(f.sourceId); if (!s) throw new Error(`fact references unknown source ${f.sourceId}`);
    return { ...f, sourceKind: s.kind, publisher: s.publisher, url: s.url ?? '', publishedAt: s.publishedAt };
  });
  const previous = ProjectsFileSchema.parse(readJson('data/projects.json'));
  const merged = mergeFacts(previous, facts, { now, runId, log });
  markVerified(merged.projects, [...update.verified, ...verifiedArg], now);
  await geocodeProjects(merged.projects, readJson('data/sources-registry.json').adapters['ocpa-parcels']?.base, log);
  await processImages(merged.projects, merged.images, ROOT, now, log);
  const valid = validateProjects(merged.projects, { previous, imageMissing: verifyImageFiles(merged.projects, ROOT), maxChangedRatio: Number(process.env.MAX_CHANGED_RATIO || 0.5) });
  const entries = buildChangelog(previous, valid, runId, now);
  const state = PipelineStateSchema.parse(readJson('data/pipeline-state.json'));
  state.lastRunId = runId; state.lastRunAt = now; state.lastSuccessAt = now; state.lastStatus = entries.length ? 'success' : 'no-changes'; state.costUsdLastRun = 0;
  console.log(`\n${entries.length} changelog entries, ${merged.changed.size} projects touched, ${merged.created.length} created, ${merged.flagged.length} flagged`);
  for (const e of entries) console.log(`  • ${e.projectName}: ${e.summary}`);
  for (const f of merged.flagged) console.log(`  ⚠ ${f}`);
  if (dry) { console.log('\n(dry run: nothing written)'); return; }
  writeFileSync(join(ROOT, 'data/projects.json'), JSON.stringify(valid, null, 2) + '\n');
  writeFileSync(join(ROOT, 'data/changelog.json'), JSON.stringify(appendChangelog(ChangelogFileSchema.parse(readJson('data/changelog.json')), entries), null, 2) + '\n');
  writeFileSync(join(ROOT, 'data/pipeline-state.json'), JSON.stringify(state, null, 2) + '\n');
  mkdirSync(join(ROOT, 'updates/applied'), { recursive: true });
  console.log('\nwritten: data/projects.json, data/changelog.json, data/pipeline-state.json');
}
main().catch((e) => { console.error(`FAILED (nothing written): ${(e as Error).message}`); process.exit(1); });
