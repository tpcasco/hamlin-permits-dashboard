import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isActive, toClientRecord } from '@/lib/projects';
import { formatPrecise } from '@/lib/dates';

export const GET: APIRoute = async () => {
  const all = (await getCollection('projects')).map((e) => e.data).filter(isActive);
  const features = all
    .filter((p) => p.location.lat != null && p.location.lng != null)
    .map((p) => {
      const r = toClientRecord(p);
      return {
        type: 'Feature',
        id: p.slug,
        geometry: { type: 'Point', coordinates: [p.location.lng, p.location.lat] },
        properties: {
          slug: p.slug, name: p.name, status: p.status, category: p.category, type: p.type, icon: r.icon, summary: p.summary,
          lat: p.location.lat, lng: p.location.lng, geocodeConfidence: p.location.geocodeConfidence ?? 'medium',
          expectedLabel: p.expectedCompletion ? formatPrecise(p.expectedCompletion.date, p.expectedCompletion.precision, p.expectedCompletion.label) : null,
          openingWindow: r.openingWindow,
        },
      };
    });
  return new Response(JSON.stringify({ type: 'FeatureCollection', features }), { headers: { 'Content-Type': 'application/geo+json' } });
};
