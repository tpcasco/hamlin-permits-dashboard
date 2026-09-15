import { useEffect, useRef, useState } from 'preact/hooks';
import type mapboxgl from 'mapbox-gl';
import { TOKEN, STYLE_3D, DEFAULT_VIEW, loadMapbox, colorExpr, STATUS_COLORS } from './mapbox';

type Props = { height?: string; filterEvent?: string; focusSlug?: string; showList?: boolean; interactiveList?: boolean };
type Props2 = { properties: Record<string, any> };

const STATUS_LABEL: Record<string, string> = { proposed: 'Proposed', filed: 'Filed', approved: 'Approved', construction: 'Under construction', open: 'Open' };

export default function HamlinMap({ height = '62vh', filterEvent, focusSlug, showList = false }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [selected, setSelected] = useState<Record<string, any> | null>(null);
  const [features, setFeatures] = useState<Props2[]>([]);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!TOKEN) { setErr('no-token'); return; }
    let cancelled = false;
    (async () => {
      const mb = await loadMapbox();
      if (cancelled || !el.current) return;
      const map = new mb.Map({ container: el.current, style: STYLE_3D, ...DEFAULT_VIEW, attributionControl: true, cooperativeGestures: true });
      mapRef.current = map;
      map.addControl(new mb.NavigationControl({ visualizePitch: true }), 'top-right');
      map.addControl(new mb.GeolocateControl({ trackUserLocation: false }), 'top-right');
      map.on('error', (e) => { if (/token|Unauthorized|401|403/i.test(String(e.error?.message))) setErr('bad-token'); });
      map.on('style.load', () => {
        try { map.setConfigProperty('basemap', 'lightPreset', 'day'); map.setConfigProperty('basemap', 'show3dObjects', true); } catch {}
      });
      map.on('load', async () => {
        const res = await fetch('/projects.geojson');
        const gj = await res.json();
        setFeatures(gj.features);
        map.addSource('projects', { type: 'geojson', data: gj, cluster: true, clusterRadius: 44, clusterMaxZoom: 15, promoteId: 'slug' });
        map.addLayer({ id: 'clusters', type: 'circle', source: 'projects', filter: ['has', 'point_count'], paint: { 'circle-color': '#1d4ed8', 'circle-radius': ['step', ['get', 'point_count'], 18, 6, 24, 12, 30], 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff', 'circle-emissive-strength': 1 } });
        map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'projects', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] }, paint: { 'text-color': '#fff' } });
        map.addLayer({ id: 'pins-halo', type: 'circle', source: 'projects', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': colorExpr, 'circle-radius': 16, 'circle-opacity': ['case', ['==', ['get', 'geocodeConfidence'], 'low'], 0.18, 0.3], 'circle-emissive-strength': 1 } });
        map.addLayer({ id: 'pins', type: 'circle', source: 'projects', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': colorExpr, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 10], 'circle-stroke-width': ['case', ['==', ['get', 'geocodeConfidence'], 'low'], 1.5, 3], 'circle-stroke-color': '#ffffff', 'circle-opacity': ['case', ['==', ['get', 'geocodeConfidence'], 'low'], 0.75, 1], 'circle-emissive-strength': 1 } });
        map.addLayer({ id: 'labels', type: 'symbol', source: 'projects', filter: ['!', ['has', 'point_count']], minzoom: 14.5, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-optional': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.75)', 'text-halo-width': 1.4 } });
        map.on('click', 'clusters', (e) => {
          const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0] as any;
          const id = f?.properties?.cluster_id;
          (map.getSource('projects') as mapboxgl.GeoJSONSource).getClusterExpansionZoom(id, (er, zoom) => { if (!er && zoom != null) map.easeTo({ center: (f.geometry as any).coordinates, zoom }); });
        });
        map.on('click', 'pins', (e) => { const f = e.features?.[0] as any; if (f) { setSelected(f.properties!); map.easeTo({ center: (f.geometry as any).coordinates, offset: [0, -60] }); } });
        for (const l of ['pins', 'clusters']) { map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer')); map.on('mouseleave', l, () => (map.getCanvas().style.cursor = '')); }
        if (focusSlug) {
          const f = gj.features.find((x: any) => x.properties.slug === focusSlug);
          if (f) { map.jumpTo({ center: f.geometry.coordinates, zoom: 16.5 }); setSelected(f.properties); }
        }
        setReady(true);
      });
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Explore page filter → map filter.
  useEffect(() => {
    if (!filterEvent) return;
    const host = document.getElementById(filterEvent);
    if (!host) return;
    const handler = (e: Event) => {
      const slugs: string[] = (e as CustomEvent).detail.slugs;
      const map = mapRef.current; if (!map || !map.getSource('projects')) return;
      const filt = ['in', ['get', 'slug'], ['literal', slugs]] as any;
      for (const l of ['pins', 'pins-halo', 'labels']) map.setFilter(l, ['all', ['!', ['has', 'point_count']], filt]);
      map.resize();
    };
    host.addEventListener('explore:filter', handler);
    return () => host.removeEventListener('explore:filter', handler);
  }, [ready]);

  const flyTo = (f: Props2) => { const map = mapRef.current; if (!map) return; map.flyTo({ center: [f.properties.lng, f.properties.lat], zoom: 17, pitch: 60, speed: 0.9 }); setSelected(f.properties); };

  return (
    <div class="hm" style={{ '--h': height } as any}>
      <div class="hm-map" ref={el} role="region" aria-label="Interactive 3D map of Hamlin projects" />
      {err && (
        <div class="hm-fallback">
          <strong>{err === 'no-token' ? 'Map not configured yet' : 'Map could not load'}</strong>
          <p>{err === 'no-token' ? 'Add a public Mapbox token as PUBLIC_MAPBOX_TOKEN to turn on the 3D map.' : 'The Mapbox token was rejected. Check its URL restrictions.'} Browse the <a href="/explore">project list</a> instead.</p>
        </div>
      )}
      {!err && !ready && <div class="hm-loading" aria-hidden="true">Loading 3D map…</div>}
      <div class="hm-legend" aria-hidden="true">{Object.entries(STATUS_LABEL).map(([k, v]) => <span><i style={{ background: STATUS_COLORS[k] }} />{v}</span>)}</div>
      {selected && (
        <aside class="hm-panel" aria-live="polite">
          <button class="hm-close" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          <div class="hm-eyebrow">{selected.icon} {selected.category}</div>
          <h3>{selected.name}</h3>
          <div class="hm-row"><span class="chip" data-status={selected.status}>{STATUS_LABEL[selected.status] ?? selected.status}</span> {selected.expectedLabel && <span class="hm-exp">Opening {selected.expectedLabel}</span>}</div>
          <p class="hm-sum">{selected.summary}</p>
          {selected.geocodeConfidence === 'low' && <p class="hm-note">Approximate location</p>}
          <a class="btn btn-primary" href={`/projects/${selected.slug}`}>View project</a>
        </aside>
      )}
      {showList && features.length > 0 && (
        <details class="hm-list">
          <summary>Jump to a project ({features.length})</summary>
          <ul>{features.sort((a, b) => a.properties.name.localeCompare(b.properties.name)).map((f) => <li><button onClick={() => flyTo(f)}><i style={{ background: STATUS_COLORS[f.properties.status] }} />{f.properties.name}</button></li>)}</ul>
        </details>
      )}
      <style>{`
        .hm{position:relative;height:var(--h);min-height:320px;border-radius:var(--radius);overflow:hidden;background:#0b1220;border:1px solid var(--border)}
        .hm-map{position:absolute;inset:0}
        .hm-fallback,.hm-loading{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:24px;color:#e5e7eb;background:linear-gradient(160deg,#111a2e,#0b1220)}
        .hm-fallback p{max-width:38ch;margin:6px 0 0;color:#aab3c0}.hm-fallback a{color:#9dbcff}
        .hm-legend{position:absolute;left:10px;bottom:10px;display:flex;gap:8px;flex-wrap:wrap;background:rgba(10,14,24,.72);color:#fff;font-size:.72rem;font-weight:600;padding:6px 10px;border-radius:999px;backdrop-filter:blur(6px)}
        .hm-legend span{display:inline-flex;align-items:center;gap:4px}.hm-legend i{width:10px;height:10px;border-radius:50%;display:inline-block;border:2px solid #fff}
        .hm-panel{position:absolute;left:10px;right:10px;bottom:10px;background:var(--surface);color:var(--text);border-radius:14px;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.35);z-index:5}
        .hm-panel h3{margin:2px 0 6px;font-size:1.05rem}.hm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}.hm-exp{font-size:.85rem;font-weight:600}
        .hm-sum{font-size:.9rem;color:var(--text-2);margin:0 0 10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .hm-note{font-size:.75rem;color:var(--text-3);margin:0 0 8px}.hm-eyebrow{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);font-weight:700}
        .hm-close{position:absolute;right:10px;top:10px;border:0;background:var(--surface-2);color:var(--text);width:30px;height:30px;border-radius:50%;cursor:pointer}
        @media(min-width:900px){.hm-panel{left:auto;top:10px;bottom:auto;right:56px;width:320px}.hm-legend{bottom:14px}}
        .hm-list{position:absolute;top:10px;left:10px;background:var(--surface);color:var(--text);border-radius:12px;max-width:260px;max-height:70%;overflow:auto;z-index:4;font-size:.85rem;box-shadow:0 8px 24px rgba(0,0,0,.3)}
        .hm-list summary{padding:8px 12px;cursor:pointer;font-weight:600}.hm-list ul{list-style:none;margin:0;padding:0 6px 6px}.hm-list button{display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:transparent;color:var(--text);padding:6px;border-radius:8px;cursor:pointer}
        .hm-list button:hover{background:var(--surface-2)}.hm-list i{width:9px;height:9px;border-radius:50%;flex:none}
      `}</style>
    </div>
  );
}
