import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProjectsFileSchema, type Project } from '../../src/schemas/project';
import { mergeFacts, findMatch } from '../merge';
import type { FactWithSource } from '../types';

const projects: Project[] = ProjectsFileSchema.parse(JSON.parse(readFileSync('scripts/fixtures/projects.sample.json', 'utf8')));
const NOW = '2026-09-16T07:15:00.000Z';
const base = (over: Partial<FactWithSource>): FactWithSource => ({ projectName: 'Dutch Bros Coffee', aliases: [], field: 'status', value: 'open', quote: 'Dutch Bros opened its doors Tuesday.', confidence: 'high', sourceId: 'news-1', sourceKind: 'news', publisher: 'Horizon West News & Info', url: 'https://www.horizonwestinfo.com/dutch-bros-opens', publishedAt: '2026-07-14', ...over });
const run = (facts: FactWithSource[]) => mergeFacts(projects, facts, { now: NOW, runId: 'test' });

describe('findMatch', () => {
  it('matches brand variants and parentheticals', () => {
    expect(findMatch(projects, 'Dutch Bros')?.slug).toBe('dutch-bros-coffee');
    expect(findMatch(projects, 'Bank of America')?.slug).toBe('bank-of-america-hamlin-branch');
    expect(findMatch(projects, 'The Horizon West Library')?.slug).toBe('horizon-west-library');
  });
  it('does not match unrelated names', () => { expect(findMatch(projects, 'Trader Joe\'s')).toBeUndefined(); });
});

describe('status guardrails', () => {
  it('advances forward on a confident news source and clears the expected date', () => {
    const r = run([base({ date: '2026-07-14', datePrecision: 'day' })]);
    const p = r.projects.find((x) => x.slug === 'dutch-bros-coffee')!;
    expect(p.status).toBe('open'); expect(p.expectedCompletion).toBeUndefined();
    expect(p.statusHistory.at(-1)).toMatchObject({ status: 'open', date: '2026-07-14' });
    expect(p.meta.needsReview).not.toContain('scheduled-opening-passed');
    expect(r.changed.has('dutch-bros-coffee')).toBe(true);
  });
  it('refuses to move backwards on a single source and flags it instead', () => {
    const r = run([base({ projectName: 'Chipotle Mexican Grill', value: 'construction' })]);
    const p = r.projects.find((x) => x.slug === 'chipotle-mexican-grill-horizon-west')!;
    expect(p.status).toBe('open'); expect(p.meta.needsReview).toContain('status-conflict:construction'); expect(r.flagged.length).toBe(1);
  });
  it('moves backwards only when two independent publishers agree', () => {
    const r = run([base({ projectName: 'Chipotle Mexican Grill', value: 'construction' }), base({ projectName: 'Chipotle Mexican Grill', value: 'construction', sourceId: 'news-2', publisher: 'Orange Observer' })]);
    expect(r.projects.find((x) => x.slug === 'chipotle-mexican-grill-horizon-west')!.status).toBe('construction');
  });
  it('never deletes; archives only on high-confidence terminal status from a permit-tier source or two publishers', () => {
    const one = run([base({ value: 'withdrawn' })]);
    expect(one.projects.find((x) => x.slug === 'dutch-bros-coffee')!.meta.archived).toBe(false);
    const two = run([base({ value: 'withdrawn' }), base({ value: 'withdrawn', sourceId: 'p-1', publisher: 'Orange County Fast Track', sourceKind: 'permit' })]);
    const p = two.projects.find((x) => x.slug === 'dutch-bros-coffee')!;
    expect(p.meta.archived).toBe(true); expect(two.projects.length).toBe(projects.length);
  });
  it('ignores low-confidence status from a news source', () => {
    const r = run([base({ confidence: 'low' })]);
    expect(r.projects.find((x) => x.slug === 'dutch-bros-coffee')!.status).toBe('construction');
  });
});

describe('fields', () => {
  it('creates a new project only from a news-or-better source with full details', () => {
    const f = base({ projectName: 'Trader Joe\'s', field: 'new-project', value: 'new', newProject: { category: 'Retail', type: 'commercial', summary: 'Grocery store planned.', description: 'A Trader Joe\'s grocery store is planned at Hamlin Town Center.' }, location: { description: 'Hamlin Town Center, west of Publix' } });
    expect(run([f]).created).toEqual(['trader-jo-es'.replace('jo-es', 'joe-s')]);
    expect(run([{ ...f, sourceKind: 'web-search' }]).created).toEqual([]);
    expect(run([{ ...f, confidence: 'low' }]).created).toEqual([]);
  });
  it('stores business hours from news as low confidence and from the business site as high', () => {
    const hours = JSON.stringify([{ day: 'mon', open: '05:00', close: '22:00' }]);
    const news = run([base({ field: 'hours', value: hours })]).projects.find((x) => x.slug === 'dutch-bros-coffee')!;
    expect(news.business?.fieldConfidence.hours).toBe('low');
    const site = run([base({ field: 'hours', value: hours, sourceKind: 'business-site', publisher: 'dutchbros.com' })]).projects.find((x) => x.slug === 'dutch-bros-coffee')!;
    expect(site.business?.fieldConfidence.hours).toBe('high'); expect(site.business?.hours?.[0].open).toBe('05:00');
  });
  it('updates expected completion from a better source and records the source', () => {
    const r = run([base({ field: 'expectedCompletion', value: 'Opening in October', date: '2026-10', datePrecision: 'month' })]);
    const p = r.projects.find((x) => x.slug === 'dutch-bros-coffee')!;
    expect(p.expectedCompletion).toMatchObject({ date: '2026-10', precision: 'month', sourceIds: ['news-1'] });
    expect(p.sources.some((s) => s.id === 'news-1')).toBe(true);
  });
  it('collects image candidates instead of writing files', () => {
    const r = run([base({ field: 'image', value: 'https://www.horizonwestinfo.com/wp-content/uploads/dutch.jpg' })]);
    expect(r.images).toEqual([expect.objectContaining({ slug: 'dutch-bros-coffee', url: 'https://www.horizonwestinfo.com/wp-content/uploads/dutch.jpg' })]);
  });
  it('is pure: the input list is untouched', () => {
    const snapshot = JSON.stringify(projects); run([base({})]); expect(JSON.stringify(projects)).toBe(snapshot);
  });
});
