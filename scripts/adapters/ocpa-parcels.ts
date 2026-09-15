import type { Adapter } from '../types';
import * as http from '../lib/http';

/** Orange County Property Appraiser parcels: used by the geocode step to attach a footprint polygon. Not a doc producer. */
const adapter: Adapter = { id: 'ocpa-parcels', async run(ctx) { if (ctx.mode === 'discover') { const l = await findParcelLayer(ctx.config.base); ctx.log(`ocpa-parcels: parcel layer = ${l ?? 'not found'}`); } return []; } };
export default adapter;

let cachedLayer: number | null | undefined;
export async function findParcelLayer(base: string): Promise<number | null> {
  if (cachedLayer !== undefined) return cachedLayer;
  try {
    const meta = await http.getJson<{ layers?: Array<{ id: number; name: string }> }>(`${base}?f=json`);
    const l = (meta.layers ?? []).find((x) => /parcel/i.test(x.name)) ?? null;
    cachedLayer = l?.id ?? null;
  } catch { cachedLayer = null; }
  return cachedLayer;
}

export async function fetchParcelAt(base: string, lat: number, lng: number): Promise<{ parcelId?: string; footprint?: any } | null> {
  const layer = await findParcelLayer(base);
  if (layer == null) return null;
  const url = `${base}/${layer}/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
  const gj = await http.getJson<{ features?: Array<{ properties: Record<string, unknown>; geometry: any }> }>(url);
  const f = gj.features?.[0];
  if (!f) return null;
  const idKey = Object.keys(f.properties).find((k) => /parcel.?id|pid|parcelno|parcel_no/i.test(k));
  const geom = f.geometry;
  if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
    const simplified = simplify(geom);
    return { parcelId: idKey ? String(f.properties[idKey]) : undefined, footprint: simplified };
  }
  return { parcelId: idKey ? String(f.properties[idKey]) : undefined };
}

/** Keep polygons small: round to 6 decimals, drop very dense rings. */
function simplify(g: any) {
  const r = (ring: number[][]) => (ring.length > 400 ? ring.filter((_, i) => i % Math.ceil(ring.length / 400) === 0 || i === ring.length - 1) : ring).map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.coordinates.map(r) } : { type: 'MultiPolygon', coordinates: g.coordinates.map((p: number[][][]) => p.map(r)) };
}
