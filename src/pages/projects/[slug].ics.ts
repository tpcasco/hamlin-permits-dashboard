import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { openingEvent, buildIcs } from '@/lib/ics';

export async function getStaticPaths() {
  const all = (await getCollection('projects')).map((e) => e.data);
  return all.filter((p) => p.expectedCompletion).map((p) => ({ params: { slug: p.slug }, props: { project: p } }));
}

export const GET: APIRoute = async ({ props, site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const ev = openingEvent(props.project, base);
  return new Response(buildIcs(ev ? [ev] : []), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
