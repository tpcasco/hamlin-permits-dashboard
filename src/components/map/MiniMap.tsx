import { useEffect, useRef, useState } from 'preact/hooks';
import type mapboxgl from 'mapbox-gl';
import { TOKEN, STYLE_MINI, loadMapbox, STATUS_COLORS } from './mapbox';

type Props = { lat: number; lng: number; name: string; status: string; confidence?: string; footprint?: string };

export default function MiniMap({ lat, lng, name, status, confidence = 'medium', footprint }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'no-token'>(TOKEN ? 'loading' : 'no-token');
  useEffect(() => {
    if (!TOKEN) return;
    let map: mapboxgl.Map | undefined;
    (async () => {
      const mb = await loadMapbox();
      if (!el.current) return;
      map = new mb.Map({ container: el.current, style: STYLE_MINI, center: [lng, lat], zoom: 16, pitch: 50, bearing: -15, interactive: true, cooperativeGestures: true, attributionControl: false });
      map.addControl(new mb.NavigationControl({ showCompass: false }), 'top-right');
      map.on('style.load', () => { try { map!.setConfigProperty('basemap', 'show3dObjects', true); } catch {} });
      map.on('load', () => {
        if (footprint) {
          map!.addSource('fp', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: JSON.parse(footprint) } });
          map!.addLayer({ id: 'fp-fill', type: 'fill', source: 'fp', paint: { 'fill-color': STATUS_COLORS[status], 'fill-opacity': 0.25 } });
          map!.addLayer({ id: 'fp-line', type: 'line', source: 'fp', paint: { 'line-color': STATUS_COLORS[status], 'line-width': 2 } });
        }
        const dot = document.createElement('div');
        dot.style.cssText = `width:18px;height:18px;border-radius:50%;background:${STATUS_COLORS[status]};border:3px solid #fff;box-shadow:0 0 0 ${confidence === 'low' ? 14 : 6}px ${STATUS_COLORS[status]}44;`;
        new mb.Marker({ element: dot }).setLngLat([lng, lat]).setPopup(new mb.Popup({ offset: 14 }).setText(name)).addTo(map!);
        map!.flyTo({ center: [lng, lat], zoom: 16.8, pitch: 55, duration: 1800 });
        setState('ok');
      });
    })();
    return () => map?.remove();
  }, []);
  return (
    <div class="mm" style={{ position: 'relative', height: 280 }}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} aria-label={`Map showing ${name}`} role="img" />
      {state !== 'ok' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-2)', fontSize: '.9rem', padding: 16, textAlign: 'center' }}>{state === 'no-token' ? 'Map preview needs a Mapbox token.' : 'Loading map…'}</div>}
    </div>
  );
}
