import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProjectsFileSchema, type Project } from '../../src/schemas/project';
import { validateProjects } from '../validate';

const projects: Project[] = ProjectsFileSchema.parse(JSON.parse(readFileSync('scripts/fixtures/projects.sample.json', 'utf8')));

describe('validateProjects', () => {
  it('accepts the fixture', () => { expect(validateProjects(projects).length).toBe(projects.length); });
  it('accepts the committed live data', () => { const live = JSON.parse(readFileSync('data/projects.json', 'utf8')); expect(validateProjects(live).length).toBe(live.length); });
  it('rejects a lost project', () => { expect(() => validateProjects(projects.slice(1), { previous: projects })).toThrow(/disappeared/); });
  it('rejects too many changes in one run', () => {
    const mutated = projects.map((p) => ({ ...p, description: p.description + ' (edited)' }));
    expect(() => validateProjects(mutated, { previous: projects })).toThrow(/suspicious/);
  });
  it('rejects coordinates outside Hamlin', () => {
    const bad = structuredClone(projects); bad[0].location.lat = 25.7; expect(() => validateProjects(bad)).toThrow(/schema/);
  });
  it('rejects an open project regressing', () => {
    const bad = structuredClone(projects); const p = bad.find((x) => x.status === 'open')!; p.status = 'construction'; p.statusHistory.push({ status: 'construction', date: '2026-09-01', datePrecision: 'day', sourceIds: ['legacy-tracker-2026-02'] });
    expect(() => validateProjects(bad, { previous: projects })).toThrow(/regressed/);
  });
  it('requires AI images to disclose themselves', () => {
    const bad = structuredClone(projects); bad[0].images.push({ file: 'x.webp', kind: 'ai-concept', alt: 'A building', isHero: true });
    expect(() => validateProjects(bad)).toThrow(/disclose/);
  });
});
