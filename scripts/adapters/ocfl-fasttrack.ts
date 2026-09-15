import type { Adapter, RawDoc } from '../types';
import { stableHash } from '../lib/normalize';

/**
 * Orange County Fast Track (ASP.NET WebForms). No API. Strategy: load the permit search page, replay its form with a search
 * term in the address field, and parse any results table. Brittle by nature; discover mode records the form so the
 * selectors can be tuned from the workflow artifact without guessing.
 */
const adapter: Adapter = {
  id: 'ocfl-fasttrack',
  async run(ctx) {
    const { http, config, log } = ctx;
    const cheerio = await import('cheerio');
    const searchUrl = `${config.base}PermitsAllTypes.aspx`;
    const docs: RawDoc[] = [];
    let html: string;
    try { html = await http.getText(searchUrl); } catch (e) { log(`ocfl-fasttrack: search page failed: ${(e as Error).message}`); return docs; }
    const $ = cheerio.load(html);
    const form = $('form').first();
    const fields: Record<string, string> = {};
    form.find('input[name]').each((_, el) => { fields[$(el).attr('name')!] = $(el).attr('value') ?? ''; });
    const addressField = Object.keys(fields).find((n) => /address|street|txtsearch|search/i.test(n));
    const submit = Object.keys(fields).find((n) => /btnsearch|search/i.test(n) && /btn|button|submit/i.test(n));
    if (ctx.mode === 'discover') docs.push({ id: 'ocfl-fasttrack-form', adapter: 'ocfl-fasttrack', sourceKind: 'permit', publisher: config.publisher, url: searchUrl, title: 'Fast Track permit search form (discovery)', fetchedAt: ctx.now, text: `Form action: ${form.attr('action')}\nAddress field guess: ${addressField}\nSubmit guess: ${submit}\nFields:\n${Object.keys(fields).join('\n')}\n\nPage text:\n${http.htmlToText(html).text.slice(0, 3000)}`, data: { fields: Object.keys(fields) } });
    if (!addressField) { log('ocfl-fasttrack: could not identify the address input; see discover output'); return docs; }
    for (const term of (config.searchTerms as string[]).slice(0, 6)) {
      try {
        const body = new URLSearchParams({ ...fields, [addressField]: term, ...(submit ? { [submit]: 'Search' } : {}) });
        const res = await http.fetchWithRetry(new URL(form.attr('action') || searchUrl, searchUrl).toString(), { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        const rhtml = await res.text();
        const $$ = cheerio.load(rhtml);
        const rows: string[] = [];
        $$('table tr').each((_, tr) => { const cells = $$(tr).find('td').map((_, td) => $$(td).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean); if (cells.length >= 3) rows.push(cells.join(' | ')); });
        log(`ocfl-fasttrack: "${term}" → ${rows.length} rows`);
        if (rows.length) docs.push({ id: `ocfl-fasttrack-${stableHash(term)}`, adapter: 'ocfl-fasttrack', sourceKind: 'permit', publisher: config.publisher, url: searchUrl, title: `Fast Track permit search: ${term}`, fetchedAt: ctx.now, text: `Permit search results for "${term}" (one permit per line: columns as shown on the county site):\n${rows.slice(0, 150).join('\n')}` });
      } catch (e) { log(`ocfl-fasttrack: "${term}" failed: ${(e as Error).message}`); }
    }
    return docs;
  },
};
export default adapter;
