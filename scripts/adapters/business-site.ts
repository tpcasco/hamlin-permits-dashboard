import type { Adapter, RawDoc } from '../types';
import { stableHash } from '../lib/normalize';

/** For projects that are approved or further along and have a known website: fetch home + menu/hours/location pages. */
const adapter: Adapter = {
  id: 'business-site',
  async run(ctx) {
    const { http, log, projects } = ctx;
    const docs: RawDoc[] = [];
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const targets = projects.filter((p) => p.business?.website && ['approved', 'construction', 'open'].includes(p.status) && p.meta.lastVerifiedAt < cutoff).slice(0, 10);
    for (const p of targets) {
      const base = p.business!.website!;
      const pages = [base, ...['menu', 'hours', 'locations', 'about', 'contact'].map((s) => new URL(`/${s}`, base).toString())];
      const parts: string[] = []; const images = new Set<string>();
      for (const url of pages) {
        try { const html = await http.getText(url, { retries: 0, timeoutMs: 12_000 }); const t = http.htmlToText(html, 5000); if (t.text.length > 200) { parts.push(`## ${url}\n${t.text}`); t.images.forEach((i) => images.add(i)); } } catch { /* optional page */ }
      }
      if (!parts.length) { log(`business-site: nothing readable for ${p.slug}`); continue; }
      docs.push({ id: `business-site-${stableHash(p.slug)}`, adapter: 'business-site', sourceKind: 'business-site', publisher: new URL(base).hostname, url: base, title: `${p.name} website`, fetchedAt: ctx.now, text: `Project: ${p.name}\n${parts.join('\n\n')}`.slice(0, 16_000), data: { slug: p.slug, images: [...images] } });
    }
    return docs;
  },
};
export default adapter;
