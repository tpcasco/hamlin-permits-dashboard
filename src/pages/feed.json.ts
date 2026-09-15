import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const entries = (await getCollection('changelog')).map((e) => e.data).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Hamlin Development Tracker',
    home_page_url: `${base}/`,
    feed_url: `${base}/feed.json`,
    description: 'Every status change, new opening date, new project, and new rendering in Hamlin & Horizon West, Winter Garden FL.',
    items: entries.map((c) => ({ id: c.id, url: c.projectSlug ? `${base}/projects/${c.projectSlug}` : `${base}/whats-new`, title: `${c.projectName}: ${c.summary}`, content_text: c.summary, date_published: c.date, tags: [c.kind] })),
  };
  return new Response(JSON.stringify(feed, null, 2), { headers: { 'Content-Type': 'application/feed+json; charset=utf-8' } });
};
