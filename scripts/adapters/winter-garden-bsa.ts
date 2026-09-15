import type { Adapter, RawDoc } from '../types';
import { stableHash } from '../lib/normalize';

/** City of Winter Garden permits on BS&A Online. Public search, HTML only; URL pattern verified via discover mode. */
const adapter: Adapter = {
  id: 'winter-garden-bsa',
  async run(ctx) {
    const { http, config, log } = ctx;
    const cheerio = await import('cheerio');
    const docs: RawDoc[] = [];
    const home = `${config.base}/Home/MunicipalityHome?uid=${config.uid}`;
    try {
      const html = await http.getText(home);
      const $ = cheerio.load(html);
      const links = $('a[href]').map((_, a) => `${$(a).text().trim()} → ${http.absoluteUrl($(a).attr('href')!, home)}`).get().filter((l) => /search|permit|building|record/i.test(l));
      if (ctx.mode === 'discover') docs.push({ id: 'winter-garden-bsa-home', adapter: 'winter-garden-bsa', sourceKind: 'permit', publisher: config.publisher, url: home, title: 'BS&A municipality home (discovery)', fetchedAt: ctx.now, text: links.join('\n') });
    } catch (e) { log(`winter-garden-bsa: home failed: ${(e as Error).message}`); }
    for (const term of (config.searchTerms as string[]).slice(0, 4)) {
      const url = `${config.base}/SiteSearch/SiteSearchDetails?SearchFocus=All%20Records&SearchCategory=Address&SearchText=${encodeURIComponent(term)}&uid=${config.uid}`;
      try {
        const html = await http.getText(url);
        const $ = cheerio.load(html);
        const rows: string[] = [];
        $('table tr, .search-result, .result-row, li.result').each((_, el) => { const t = $(el).text().replace(/\s+/g, ' ').trim(); if (t.length > 20 && /permit|BP|20\d\d/i.test(t)) rows.push(t); });
        log(`winter-garden-bsa: "${term}" → ${rows.length} rows`);
        if (rows.length || ctx.mode === 'discover') docs.push({ id: `winter-garden-bsa-${stableHash(term)}`, adapter: 'winter-garden-bsa', sourceKind: 'permit', publisher: config.publisher, url, title: `Winter Garden permit search: ${term}`, fetchedAt: ctx.now, text: rows.length ? `Winter Garden building records matching "${term}":\n${rows.slice(0, 150).join('\n')}` : http.htmlToText(html).text.slice(0, 4000) });
      } catch (e) { log(`winter-garden-bsa: "${term}" failed: ${(e as Error).message}`); }
    }
    return docs;
  },
};
export default adapter;
