import type { Adapter, RawDoc } from '../types';
import { HAMLIN_BBOX } from '../../src/schemas/project';
import { stableHash } from '../lib/normalize';

interface LayerInfo { id: number; name: string; type: string }

/** Orange County ArcGIS REST: discover layers whose names match keywords, then pull features inside the Hamlin bbox. */
const adapter: Adapter = {
  id: 'ocfl-gis',
  async run(ctx) {
    const { http, config, log } = ctx;
    const docs: RawDoc[] = [];
    const bbox = `${HAMLIN_BBOX.west},${HAMLIN_BBOX.south},${HAMLIN_BBOX.east},${HAMLIN_BBOX.north}`;
    for (const svc of config.services as string[]) {
      const base = `${config.base}/${svc}`;
      let layers: LayerInfo[] = [];
      try {
        const meta = await http.getJson<{ layers?: LayerInfo[] }>(`${base}?f=json`);
        layers = meta.layers ?? [];
        log(`ocfl-gis: ${svc} has ${layers.length} layers`);
        if (ctx.mode === 'discover') docs.push({ id: `ocfl-gis-layers-${stableHash(svc)}`, adapter: 'ocfl-gis', sourceKind: 'gis', publisher: config.publisher, url: base, title: `Layer list: ${svc}`, fetchedAt: ctx.now, text: layers.map((l) => `${l.id}: ${l.name}`).join('\n'), data: layers });
      } catch (e) { log(`ocfl-gis: ${svc} metadata failed: ${(e as Error).message}`); continue; }
      const wanted = (config.layers as number[] | undefined)?.length ? layers.filter((l) => (config.layers as number[]).includes(l.id)) : layers.filter((l) => (config.layerKeywords as string[]).some((k) => l.name.toLowerCase().includes(k)));
      for (const layer of wanted.slice(0, 8)) {
        try {
          const url = `${base}/${layer.id}/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=300&f=geojson`;
          const gj = await http.getJson<{ features?: Array<{ properties: Record<string, unknown>; geometry: any }> }>(url);
          const feats = gj.features ?? [];
          log(`ocfl-gis: layer ${layer.id} "${layer.name}" → ${feats.length} features in bbox`);
          if (!feats.length) continue;
          const recent = feats.slice(0, 120);
          const text = recent.map((f) => {
            const p = f.properties; const c = centroid(f.geometry);
            return Object.entries(p).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${fmt(v)}`).join('; ') + (c ? `; centroid: ${c[1].toFixed(5)},${c[0].toFixed(5)}` : '');
          }).join('\n');
          docs.push({ id: `ocfl-gis-${stableHash(`${svc}/${layer.id}`)}`, adapter: 'ocfl-gis', sourceKind: 'gis', publisher: config.publisher, url: `${base}/${layer.id}`, title: `Orange County GIS: ${layer.name}`, fetchedAt: ctx.now, text: `Layer "${layer.name}" (${feats.length} features in Hamlin area). Each line is one feature:\n${text}`.slice(0, 20_000), data: { layer, count: feats.length } });
        } catch (e) { log(`ocfl-gis: layer ${layer.id} failed: ${(e as Error).message}`); }
      }
    }
    return docs;
  },
};

function fmt(v: unknown): string { if (typeof v === 'number' && v > 1e11 && v < 2e12) return new Date(v).toISOString().slice(0, 10); return String(v).slice(0, 200); }
function centroid(g: any): [number, number] | null {
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
  if (!ring?.length) return null;
  const s = ring.reduce((a: number[], p: number[]) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [s[0] / ring.length, s[1] / ring.length];
}
export default adapter;
