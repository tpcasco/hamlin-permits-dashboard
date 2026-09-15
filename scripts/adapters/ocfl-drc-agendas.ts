import type { Adapter, RawDoc } from '../types';
import { stableHash } from '../lib/normalize';

/** Development Review Committee agendas are PDFs linked from the county calendar; pull the newest few and keyword-filter. */
const adapter: Adapter = {
  id: 'ocfl-drc-agendas',
  async run(ctx) {
    const { http, config, keywords, log } = ctx;
    const cheerio = await import('cheerio');
    const docs: RawDoc[] = [];
    const pages = [config.base as string, 'https://www.orangecountyfl.net/PlanningDevelopment/DevelopmentReview.aspx'];
    const pdfs = new Map<string, string>();
    for (const p of pages) {
      try {
        const html = await http.getText(p); const $ = cheerio.load(html);
        $('a[href]').each((_, a) => { const href = http.absoluteUrl($(a).attr('href')!, p); const t = $(a).text().trim(); if (/CalFile\.aspx|\.pdf(\?|$)/i.test(href) && /agenda|drc|development review/i.test(`${t} ${href}`)) pdfs.set(href, t); });
      } catch (e) { log(`ocfl-drc-agendas: ${p}: ${(e as Error).message}`); }
    }
    log(`ocfl-drc-agendas: ${pdfs.size} agenda links`);
    const pdfParse = (await import('pdf-parse')).default as unknown as (b: Buffer) => Promise<{ text: string }>;
    for (const [url, label] of [...pdfs.entries()].slice(0, 4)) {
      try {
        const { buf, contentType } = await http.getBuffer(url, { timeoutMs: 40_000 });
        if (!/pdf/i.test(contentType) && buf.subarray(0, 4).toString() !== '%PDF') continue;
        const { text } = await pdfParse(buf);
        const paras = text.split(/\n\s*\n/).map((s) => s.replace(/\s+/g, ' ').trim());
        const hits = paras.filter((s) => http.matchesKeywords(s, keywords));
        if (!hits.length && ctx.mode !== 'discover') continue;
        docs.push({ id: `ocfl-drc-${stableHash(url)}`, adapter: 'ocfl-drc-agendas', sourceKind: 'permit', publisher: config.publisher, url, title: `DRC agenda: ${label || url}`, fetchedAt: ctx.now, text: (hits.length ? hits : paras.slice(0, 40)).join('\n').slice(0, 14_000) });
      } catch (e) { log(`ocfl-drc-agendas: ${url}: ${(e as Error).message}`); }
    }
    return docs;
  },
};
export default adapter;
