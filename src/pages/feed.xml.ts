import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const entries = (await getCollection('changelog')).map((e) => e.data).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  return rss({
    title: 'Hamlin Development Tracker',
    description: 'Every status change, new opening date, new project, and new rendering in Hamlin & Horizon West, Winter Garden FL.',
    site: base,
    items: entries.map((c) => ({ title: `${c.projectName}: ${c.summary}`, description: c.summary, pubDate: new Date(c.date), link: c.projectSlug ? `${base}/projects/${c.projectSlug}` : `${base}/whats-new`, categories: [c.kind] })),
    customData: '<language>en-us</language>',
  });
};
