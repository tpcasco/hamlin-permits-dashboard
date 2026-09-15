import type { Project } from '../src/schemas/project';
import { HAMLIN_BBOX, HAMLIN_CENTER } from '../src/schemas/project';
import * as http from './lib/http';
import { hasClaude, shortAnswer, prompt } from './lib/claude';
import { fetchParcelAt } from './adapters/ocpa-parcels';

const TOKEN = process.env.MAPBOX_SERVER_TOKEN || '';
export function hasGeocoder() { return !!TOKEN; }

interface Geo { lat: number; lng: number; confidence: 'high' | 'medium' | 'low'; from: string }

async function forward(q: string): Promise<Geo | null> {
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&proximity=${HAMLIN_CENTER.lng},${HAMLIN_CENTER.lat}&bbox=${HAMLIN_BBOX.west},${HAMLIN_BBOX.south},${HAMLIN_BBOX.east},${HAMLIN_BBOX.north}&country=us&limit=1&access_token=${TOKEN}`;
  const res = await http.getJson<{ features?: Array<{ properties: { coordinates: { longitude: number; latitude: number }; match_code?: { confidence?: string }; feature_type?: string } }> }>(url);
  const f = res.features?.[0]; if (!f) return null;
  const { longitude: lng, latitude: lat } = f.properties.coordinates;
  if (lng < HAMLIN_BBOX.west || lng > HAMLIN_BBOX.east || lat < HAMLIN_BBOX.south || lat > HAMLIN_BBOX.north) return null;
  const mc = f.properties.match_code?.confidence; const ft = f.properties.feature_type;
  const confidence: Geo['confidence'] = mc === 'exact' || mc === 'high' ? 'high' : ft === 'address' || mc === 'medium' ? 'medium' : 'low';
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), confidence, from: q };
}

/** Improve coordinates for projects that are missing them or were placed by a low-confidence guess. */
export async function geocodeProjects(projects: Project[], parcelBase: string | undefined, log: (m: string) => void, max = 15): Promise<string[]> {
  if (!TOKEN) { log('geocode: MAPBOX_SERVER_TOKEN not set; skipping'); return []; }
  const targets = projects.filter((p) => p.location.lat == null || p.location.geocodeConfidence === 'low' || (p.location.geocodeConfidence === 'medium' && p.location.address && p.location.geocodedFrom !== p.location.address)).slice(0, max);
  const changed: string[] = [];
  for (const p of targets) {
    try {
      let q = p.location.address ? `${p.location.address}, Winter Garden, FL 34787` : '';
      if (!q && hasClaude()) q = await shortAnswer(prompt('geocode-hint'), `${p.name}: ${p.location.description}`);
      if (!q) q = `${p.location.description}, Winter Garden, FL`;
      const g = await forward(q);
      if (!g) { log(`geocode: no result for ${p.slug} ("${q}")`); continue; }
      const better = p.location.lat == null || (p.location.geocodeConfidence === 'low' && g.confidence !== 'low') || (g.confidence === 'high' && p.location.geocodeConfidence !== 'high');
      if (!better) continue;
      p.location.lat = g.lat; p.location.lng = g.lng; p.location.geocodeConfidence = g.confidence; p.location.geocodedFrom = p.location.address ?? g.from;
      if (g.confidence !== 'low') p.meta.needsReview = p.meta.needsReview.filter((x) => x !== 'geocode-low-confidence');
      changed.push(p.slug); log(`geocode: ${p.slug} → ${g.lat},${g.lng} (${g.confidence})`);
      if (parcelBase && g.confidence !== 'low' && !p.location.footprint) {
        try { const parcel = await fetchParcelAt(parcelBase, g.lat, g.lng); if (parcel?.footprint) { p.location.footprint = parcel.footprint; p.location.parcelId = parcel.parcelId; log(`geocode: ${p.slug} footprint from parcel ${parcel.parcelId}`); } } catch (e) { log(`geocode: parcel lookup failed for ${p.slug}: ${(e as Error).message}`); }
      }
    } catch (e) { log(`geocode: ${p.slug} failed: ${(e as Error).message}`); }
  }
  return changed;
}
