import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isActive } from '@/lib/projects';
import { openingEvent, buildIcs } from '@/lib/ics';

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const all = (await getCollection('projects')).map((e) => e.data).filter((p) => isActive(p) && p.status !== 'open');
  const events = all.map((p) => openingEvent(p, base)).filter((e): e is NonNullable<typeof e> => !!e);
  return new Response(buildIcs(events), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="hamlin-openings.ics"' } });
};
