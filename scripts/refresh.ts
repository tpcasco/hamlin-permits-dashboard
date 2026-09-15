/**
 * Nightly refresh orchestrator. Modes:
 *   run       fetch → extract → reconcile → merge → geocode → images → validate → write (CI commits)
 *   dry-run   same, but writes to scratch/dry-run/ and never touches data/
 *   discover  fetch only; dumps raw docs per adapter to scratch/discover/ for adapter development
 * Flags: --mode=<mode> --only=<adapter,adapter> --no-claude
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectsFileSchema, ChangelogFileSchema, PipelineStateSchema, type Project, type PipelineState } from '../src/schemas/project';
import type { RawDoc, RunMode, RunReport, AdapterContext } from './types';
import { ADAPTERS } from './adapters/index';
import * as http from './lib/http';
import { extractFacts, pickForReconcile, reconcileProjects } from './extract';
import { mergeFacts, markVerified } from './merge';
import { geocodeProjects } from './geocode';
import { processImages, verifyImageFiles } from './images';
import { validateProjects } from './validate';
import { buildChangelog, appendChangelog } from './changelog';
import { cost, hasClaude } from './lib/claude';

const ROOT = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? 'true'] : [a, 'true']; }));
const mode = (args.mode as RunMode) || (args['dry-run'] ? 'dry-run' : args.discover ? 'discover' : 'run');
const only = args.only ? String(args.only).split(',') : null;
const useClaude = args['no-claude'] !== 'true' && hasClaude();
const now = new Date().toISOString();
const runId = `${now.slice(0, 10)}-${now.slice(11, 16).replace(':', '')}`;
const lines: string[] = [];
const log = (m: string) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${m}`; lines.push(l); console.log(l); };

const registry = JSON.parse(readFileSync(join(ROOT, 'data/sources-registry.json'), 'utf8'));
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const outDir = mode === 'run' ? ROOT : join(ROOT, 'scratch', mode);
const write = (rel: string, data: unknown) => { const p = join(outDir, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(t));
}

async function main() {
  const report: RunReport = { runId, mode, startedAt: now, docs: 0, facts: 0, projectsBefore: 0, projectsAfter: 0, changed: [], created: [], flagged: [], errors: [], costUsd: 0 };
  const previous: Project[] = ProjectsFileSchema.parse(readJson('data/projects.json'));
  const state: PipelineState = PipelineStateSchema.parse(existsSync(join(ROOT, 'data/pipeline-state.json')) ? readJson('data/pipeline-state.json') : {});
  report.projectsBefore = previous.length;
  log(`refresh ${runId} mode=${mode} projects=${previous.length} claude=${useClaude}`);

  // 1. Fetch
  const docs: RawDoc[] = [];
  const adapters = ADAPTERS.filter((a) => registry.adapters[a.id]?.enabled !== false && (!only || only.includes(a.id)));
  await Promise.all(adapters.map(async (a) => {
    const ctx: AdapterContext = { mode, config: registry.adapters[a.id] ?? {}, keywords: registry.keywords, http, log, projects: previous, now };
    const t0 = Date.now();
    try {
      const got = await withTimeout(a.run(ctx), 240_000, a.id);
      docs.push(...got);
      state.adapters[a.id] = { ...state.adapters[a.id], lastOkAt: now, docsLastRun: got.length, lastError: undefined };
      log(`adapter ${a.id}: ${got.length} docs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (mode === 'discover') write(`discover/${a.id}.json`, got);
    } catch (e) {
      const msg = (e as Error).message; report.errors.push(`${a.id}: ${msg}`);
      state.adapters[a.id] = { ...state.adapters[a.id], docsLastRun: 0, lastError: msg, lastErrorAt: now };
      log(`adapter ${a.id} FAILED: ${msg}`);
    }
  }));
  report.docs = docs.length;
  if (mode === 'discover') { write('discover/_summary.json', { runId, docs: docs.map((d) => ({ id: d.id, adapter: d.adapter, title: d.title, url: d.url, chars: d.text.length })), errors: report.errors }); write('data/pipeline-state.json', state); log('discover complete'); return; }

  // 2. Extract + 3. Reconcile
  let facts = useClaude ? await extractFacts(docs, log) : [];
  let verified: string[] = [];
  if (useClaude) {
    const targets = pickForReconcile(previous, Number(process.env.MAX_RECONCILE_PER_RUN || 12));
    log(`reconcile: ${targets.length} projects: ${targets.map((p) => p.slug).join(', ')}`);
    const r = await reconcileProjects(targets, registry.trustedDomains, log);
    facts = facts.concat(r.facts); verified = r.verified;
  } else log('extract/reconcile skipped (no Claude)');
  report.facts = facts.length;
  write('run/facts.json', facts);

  // 4. Merge
  const merged = mergeFacts(previous, facts, { now, runId, log });
  markVerified(merged.projects, verified, now);
  report.created = merged.created; report.flagged = merged.flagged;

  // 5. Geocode + 6. Images
  const geoChanged = await geocodeProjects(merged.projects, registry.adapters['ocpa-parcels']?.base, log);
  const imgChanged = await processImages(merged.projects, merged.images, outDir === ROOT ? ROOT : outDir, now, log);
  if (outDir !== ROOT) mkdirSync(join(outDir, 'public/images/projects'), { recursive: true });
  for (const s of [...merged.changed, ...geoChanged, ...imgChanged]) if (!report.changed.includes(s)) report.changed.push(s);

  // 7. Validate (throws → nothing written)
  const missing = verifyImageFiles(merged.projects, outDir === ROOT ? ROOT : outDir).filter((m) => outDir === ROOT || !m.includes('official'));
  const valid = validateProjects(merged.projects, { previous, imageMissing: outDir === ROOT ? missing : [], maxChangedRatio: Number(process.env.MAX_CHANGED_RATIO || 0.3) });

  // 8. Changelog + write
  const entries = buildChangelog(previous, valid, runId, now);
  const changelog = appendChangelog(ChangelogFileSchema.parse(readJson('data/changelog.json')), entries);
  report.projectsAfter = valid.length; report.costUsd = Number(cost.usd.toFixed(3));
  state.lastRunId = runId; state.lastRunAt = now; state.lastSuccessAt = now; state.lastStatus = entries.length ? 'success' : 'no-changes'; state.costUsdLastRun = report.costUsd;
  write('data/projects.json', valid); write('data/changelog.json', changelog); write('data/pipeline-state.json', state); write('run/report.json', report);
  log(`done: ${entries.length} changelog entries, ${report.changed.length} projects touched, ${report.created.length} created, ${report.flagged.length} flagged, cost $${report.costUsd}`);
}

main().catch((e) => {
  log(`FATAL: ${(e as Error).message}`);
  try { const state = PipelineStateSchema.parse(existsSync(join(ROOT, 'data/pipeline-state.json')) ? readJson('data/pipeline-state.json') : {}); state.lastRunId = runId; state.lastRunAt = now; state.lastStatus = 'failed'; if (mode === 'run') write('data/pipeline-state.json', state); } catch {}
  mkdirSync(join(ROOT, 'scratch'), { recursive: true }); writeFileSync(join(ROOT, 'scratch', 'refresh.log'), lines.join('\n'));
  process.exit(1);
}).then(() => { mkdirSync(join(ROOT, 'scratch'), { recursive: true }); writeFileSync(join(ROOT, 'scratch', 'refresh.log'), lines.join('\n')); });
