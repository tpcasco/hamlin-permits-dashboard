import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProjectsFileSchema, type Project } from '../../src/schemas/project';
import { buildChangelog } from '../changelog';

const prev: Project[] = ProjectsFileSchema.parse(JSON.parse(readFileSync('data/projects.json', 'utf8')));

describe('buildChangelog', () => {
  it('is empty when nothing changed', () => { expect(buildChangelog(prev, prev, 'r', '2026-09-16T00:00:00.000Z')).toEqual([]); });
  it('describes a status change, a date change and a new project in plain words', () => {
    const next = structuredClone(prev);
    const d = next.find((p) => p.slug === 'dutch-bros-coffee')!; d.status = 'open'; d.statusHistory.push({ status: 'open', date: '2026-07-14', datePrecision: 'day', sourceIds: [] });
    const w = next.find((p) => p.slug === 'wawa')!; w.expectedCompletion = { date: '2027-03', precision: 'month', confidence: 'medium', sourceIds: [] };
    next.push({ ...structuredClone(prev[0]), id: 'x', slug: 'x', name: 'X Store' });
    const entries = buildChangelog(prev, next, 'r', '2026-09-16T00:00:00.000Z');
    expect(entries.map((e) => e.kind).sort()).toEqual(['date-change', 'new', 'status-change']);
    expect(entries.find((e) => e.kind === 'status-change')?.summary).toMatch(/Now open \(Jul 14, 2026\)/);
    expect(entries.find((e) => e.kind === 'date-change')?.summary).toMatch(/set to Mar 2027/);
  });
});
