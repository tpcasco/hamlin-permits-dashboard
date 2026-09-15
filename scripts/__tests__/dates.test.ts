import { describe, it, expect } from 'vitest';
import { parseLooseDate } from '../lib/dates';
import { formatPrecise } from '../../src/lib/dates';
import { normalizeName, nameSimilarity } from '../lib/normalize';
import { parseFeed, htmlToText } from '../lib/http';

describe('parseLooseDate', () => {
  it.each([
    ['Grand opening Mar 1, 2026', '2026-03-01', 'day'], ['Plans filed Aug 2025', '2025-08', 'month'], ['Opening early 2026', '2026-02', 'estimate'], ['Summer 2026', '2026-07', 'estimate'], ['Phases through 2026–2027+', '2027', 'estimate'], ['Opened 2025', '2025', 'year'],
  ])('%s', (input, date, precision) => { expect(parseLooseDate(input)).toMatchObject({ date, precision }); });
  it('returns null without a date', () => { expect(parseLooseDate('Coming soon')).toBeNull(); });
});

describe('formatPrecise', () => {
  it('respects precision', () => { expect(formatPrecise('2026-03-01', 'day')).toBe('Mar 1, 2026'); expect(formatPrecise('2026-03-01', 'month')).toBe('Mar 2026'); expect(formatPrecise('2026-07', 'estimate', 'summer 2026')).toBe('Summer 2026'); });
});

describe('names', () => {
  it('normalizes and compares', () => { expect(normalizeName('VyStar Credit Union (Hamlin Branch)')).toBe('vystar credit union'); expect(nameSimilarity('Lowe\'s', 'Lowe\'s Home Improvement')).toBeGreaterThan(0.8); expect(nameSimilarity('Wawa', 'Swig Dirty Soda')).toBe(0); });
});

describe('feeds and html', () => {
  it('parses RSS items', () => {
    const items = parseFeed('<rss><channel><item><title>Wawa coming to Hamlin</title><link>https://x.test/a</link><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Wawa filed plans.&lt;/p&gt;</description></item></channel></rss>');
    expect(items).toEqual([{ title: 'Wawa coming to Hamlin', link: 'https://x.test/a', published: '2026-09-01', summary: 'Wawa filed plans.' }]);
  });
  it('extracts article text and images', () => {
    const r = htmlToText('<html><head><title>T</title><meta property="og:image" content="https://x.test/i.jpg"></head><body><nav>skip</nav><article><h1>Headline</h1><p>Body text here.</p></article><footer>f</footer></body></html>');
    expect(r.title).toBe('Headline'); expect(r.text).toBe('Headline\nBody text here.'); expect(r.images).toEqual(['https://x.test/i.jpg']);
  });
});
