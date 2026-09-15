import type { Adapter, RawDoc } from '../types';
import { stableHash } from '../lib/normalize';

/** Developer site: crawl the listed pages plus same-origin links that look like tenant/news pages. */
const adapter: Adapter = {
  id: 'hamlinfl',
  async run(ctx) {
    const { http, config, log } = ctx;
    const seeds: string[] = config.pages ?? ['https://hamlinfl.com/'];
    const seen = new Set<string>(); const docs: RawDoc[] = [];
    const queue = [...seeds];
    while (queue.length && docs.length < 15) {
      const url = queue.shift()!; if (seen.has(url)) continue; seen.add(url);
      try {
        const html = await http.getText(url);
        const art = http.htmlToText(html, 10_000);
        docs.push({ id: `hamlinfl-${stableHash(url)}`, adapter: 'hamlinfl', sourceKind: 'business-site', publisher: config.publisher, url, title: art.title, fetchedAt: ctx.now, text: art.text, data: { images: art.images } });
        const cheerio = await import('cheerio'); const $ = cheerio.load(html);
        $('a[href]').each((_, a) => { const h = http.absoluteUrl($(a).attr('href')!, url); if (h.startsWith(new URL(url).origin) && /shop|dine|news|coming|tenant|directory|leasing|retail|restaurant|blog/i.test(h) && !seen.has(h)) queue.push(h.split('#')[0]); });
      } catch (e) { log(`hamlinfl: ${url}: ${(e as Error).message}`); }
    }
    return docs;
  },
};
export default adapter;
