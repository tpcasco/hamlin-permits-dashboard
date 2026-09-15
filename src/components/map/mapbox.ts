import type mapboxgl from 'mapbox-gl';
import { HAMLIN_CENTER } from '@/schemas/project';

export const TOKEN: string = (import.meta.env.PUBLIC_MAPBOX_TOKEN as string | undefined) ?? '';
export const STYLE_3D = 'mapbox://styles/mapbox/standard-satellite';
export const STYLE_MINI = 'mapbox://styles/mapbox/standard';
export const STATUS_COLORS: Record<string, string> = {
  proposed: '#a78bfa', filed: '#60a5fa', approved: '#2dd4bf', construction: '#fbbf24', open: '#4ade80', closed: '#9ca3af', stalled: '#9ca3af', withdrawn: '#9ca3af',
};

let mod: Promise<typeof mapboxgl> | null = null;
/** Lazy-load mapbox-gl and its CSS only when a map actually mounts. */
export function loadMapbox(): Promise<typeof mapboxgl> {
  if (!mod) {
    mod = Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')]).then(([m]) => {
      const mb = (m as unknown as { default: typeof mapboxgl }).default ?? (m as unknown as typeof mapboxgl);
      mb.accessToken = TOKEN;
      return mb;
    });
  }
  return mod;
}

export const DEFAULT_VIEW = { center: [HAMLIN_CENTER.lng, HAMLIN_CENTER.lat] as [number, number], zoom: 14.2, pitch: 58, bearing: -20 };

export const colorExpr = ['match', ['get', 'status'], ...Object.entries(STATUS_COLORS).flat(), '#9ca3af'] as unknown as mapboxgl.ExpressionSpecification;
