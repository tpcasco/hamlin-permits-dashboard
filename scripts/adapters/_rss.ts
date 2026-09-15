import type { Adapter, AdapterContext, RawDoc } from '../types';
import { stableHash } from '../lib/normalize';

/** Generic news adapter: RSS feeds (+ optional listing pages) filtered by keywords, article bodies fetched. */
export function rssAdapter(id: string, opts: { maxItems?: number } = {}): Adapter {
  return {
    id,
    async run(ctx: AdapterContext): Promise<RawDoc[]> {
      const { http, config, keywords, log } = ctx;
      const feeds: string[] = config.feeds ?? [];
      const pages: string[] = config.pages ?? [];
      const cutoff = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
      const candidates = new Map<string, { title: string; published?: string; summary: string }>();
      for (const f of feeds) {
        try {
          const xml = await http.getText(f);
          for (const it of http.parseFeed(xml)) {
            if (it.published && it.published < cutoff) continue;
            if (http.matchesKeywords(`${it.title} ${it.summary}`, keywords)) candidates.set(it.link, it);
          }
          log(`${id}: feed ok ${f}`);
        } catch (e) { log(`${id}: feed failed ${f}: ${(e as Error).message}`); }
      }
      for (const p of pages) {
        try {
          const html = await http.getText(p);
          const cheerio = await import('cheerio');
          const $ = cheerio.load(html);
          $('a[href]').each((_, a) => {
            const href = http.absoluteUrl($(a).attr('href')!, p); const t = $(a).text().trim();
            if (t.length > 20 && href.startsWith(new URL(p).origin) && http.matchesKeywords(t, keywords) && !candidates.has(href)) candidates.set(href, { title: t, summary: '' });
          });
          if (ctx.mode === 'discover') candidates.set(p, { title: `Listing page ${p}`, summary: '' });
        } catch (e) { log(`${id}: page failed ${p}: ${(e as Error).message}`); }
      }
      const docs: RawDoc[] = [];
      for (const [url, it] of [...candidates.entries()].slice(0, opts.maxItems ?? 20)) {
        try {
          const html = await http.getText(url);
          const art = http.htmlToText(html);
          docs.push({ id: `${id}-${stableHash(url)}`, adapter: id, sourceKind: 'news', publisher: config.publisher, url, title: art.title || it.title, fetchedAt: ctx.now, publishedAt: it.published ?? art.published, text: art.text, data: { images: art.images } });
        } catch (e) { log(`${id}: article failed ${url}: ${(e as Error).message}`); }
      }
      return docs;
    },
  };
}
