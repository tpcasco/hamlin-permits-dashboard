import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ClientRecord } from '@/lib/projects';

type Props = { records: ClientRecord[]; categories: string[]; initial?: Partial<State>; showMapToggle?: boolean };
type State = { status: string[]; category: string[]; window: string; q: string; sort: string; view: 'list' | 'map'; images: boolean };

const STATUS_OPTS = [
  ['construction', 'Under construction'], ['approved', 'Approved'], ['filed', 'Filed'], ['proposed', 'Proposed'], ['open', 'Open'],
] as const;
const WINDOW_OPTS = [['', 'Any time'], ['this-month', 'This month'], ['next-3-months', 'Next 3 months'], ['next-6-months', 'Next 6 months'], ['this-year', 'This year'], ['later', '2027+'], ['unknown', 'Unknown']] as const;
const SORT_OPTS = [['updated', 'Recently updated'], ['opening', 'Opening soonest'], ['stage', 'Furthest along'], ['name', 'Name A–Z']] as const;
const STAGE = ['proposed', 'filed', 'approved', 'construction', 'open'];

function readState(): State {
  const p = new URLSearchParams(location.search);
  return {
    status: p.get('status')?.split(',').filter(Boolean) ?? [],
    category: p.get('category')?.split(',').filter(Boolean) ?? [],
    window: p.get('window') ?? '',
    q: p.get('q') ?? '',
    sort: p.get('sort') ?? 'updated',
    view: p.get('view') === 'map' ? 'map' : 'list',
    images: p.get('images') === '1',
  };
}
function writeState(s: State) {
  const p = new URLSearchParams();
  if (s.status.length) p.set('status', s.status.join(','));
  if (s.category.length) p.set('category', s.category.join(','));
  if (s.window) p.set('window', s.window);
  if (s.q) p.set('q', s.q);
  if (s.sort !== 'updated') p.set('sort', s.sort);
  if (s.view === 'map') p.set('view', 'map');
  if (s.images) p.set('images', '1');
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

export function applyFilters(records: ClientRecord[], s: State): ClientRecord[] {
  const q = s.q.trim().toLowerCase();
  let out = records.filter((r) =>
    (!s.status.length || s.status.includes(r.status)) &&
    (!s.category.length || s.category.includes(r.category)) &&
    (!s.window || r.openingWindow === s.window) &&
    (!s.images || r.hasImages) &&
    (!q || [r.name, ...r.aliases, r.developer, r.category, r.summary, r.locationDescription].join(' ').toLowerCase().includes(q)),
  );
  switch (s.sort) {
    case 'name': out = out.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'stage': out = out.sort((a, b) => STAGE.indexOf(b.status) - STAGE.indexOf(a.status) || a.name.localeCompare(b.name)); break;
    case 'opening': out = out.sort((a, b) => (a.status === 'open' ? 1 : 0) - (b.status === 'open' ? 1 : 0) || (a.expected?.date ?? '9999').localeCompare(b.expected?.date ?? '9999')); break;
    default: out = out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return out;
}

export default function FilterBar({ records, categories, showMapToggle = true }: Props) {
  const [s, setS] = useState<State>({ status: [], category: [], window: '', q: '', sort: 'updated', view: 'list', images: false });
  const [ready, setReady] = useState(false);
  useEffect(() => { setS(readState()); setReady(true); }, []);
  useEffect(() => { if (ready) writeState(s); }, [s, ready]);

  const result = useMemo(() => applyFilters(records, s), [records, s]);
  const visible = new Set(result.map((r) => r.slug));

  // Show/hide server-rendered cards so the list stays crawlable and instant.
  useEffect(() => {
    if (!ready) return;
    const order = new Map(result.map((r, i) => [r.slug, i]));
    document.querySelectorAll<HTMLElement>('[data-project-card]').forEach((el) => {
      const slug = el.dataset.projectCard!;
      el.hidden = !visible.has(slug);
      el.style.order = String(order.get(slug) ?? 9999);
    });
    const list = document.getElementById('project-list');
    const map = document.getElementById('explore-map');
    if (list) list.hidden = s.view === 'map';
    if (map) { map.hidden = s.view !== 'map'; map.dispatchEvent(new CustomEvent('explore:filter', { detail: { slugs: [...visible] } })); }
    document.getElementById('result-count')!.textContent = `${result.length} of ${records.length} projects`;
  }, [result, s.view, ready]);

  const toggle = (key: 'status' | 'category', v: string) => setS((x) => ({ ...x, [key]: x[key].includes(v) ? x[key].filter((y) => y !== v) : [...x[key], v] }));
  const reset = () => setS({ status: [], category: [], window: '', q: '', sort: 'updated', view: s.view, images: false });
  const active = s.status.length + s.category.length + (s.window ? 1 : 0) + (s.q ? 1 : 0) + (s.images ? 1 : 0);

  return (
    <div class="fb" role="search">
      <div class="fb-row">
        <input class="fb-q" type="search" placeholder="Search projects, developers, streets…" value={s.q} onInput={(e) => setS({ ...s, q: (e.target as HTMLInputElement).value })} aria-label="Search projects" />
        <select class="fb-sel" value={s.sort} onChange={(e) => setS({ ...s, sort: (e.target as HTMLSelectElement).value })} aria-label="Sort">
          {SORT_OPTS.map(([v, l]) => <option value={v}>{l}</option>)}
        </select>
        {showMapToggle && (
          <div class="fb-view" role="group" aria-label="View">
            <button class={s.view === 'list' ? 'on' : ''} onClick={() => setS({ ...s, view: 'list' })} aria-pressed={s.view === 'list'}>List</button>
            <button class={s.view === 'map' ? 'on' : ''} onClick={() => setS({ ...s, view: 'map' })} aria-pressed={s.view === 'map'}>Map</button>
          </div>
        )}
      </div>
      <div class="fb-row fb-chips" aria-label="Status filters">
        {STATUS_OPTS.map(([v, l]) => <button class={`fchip s-${v} ${s.status.includes(v) ? 'on' : ''}`} onClick={() => toggle('status', v)} aria-pressed={s.status.includes(v)}>{l}</button>)}
        <span class="sep" aria-hidden="true" />
        <select class="fb-sel" value={s.window} onChange={(e) => setS({ ...s, window: (e.target as HTMLSelectElement).value })} aria-label="Opening window">
          {WINDOW_OPTS.map(([v, l]) => <option value={v}>{v ? `Opening: ${l}` : 'Opening: any time'}</option>)}
        </select>
        <select class="fb-sel" value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) toggle('category', v); (e.target as HTMLSelectElement).value = ''; }} aria-label="Add category filter">
          <option value="">+ Category</option>
          {categories.map((c) => <option value={c} disabled={s.category.includes(c)}>{c}</option>)}
        </select>
        <label class="fchip"><input type="checkbox" checked={s.images} onChange={(e) => setS({ ...s, images: (e.target as HTMLInputElement).checked })} /> Has renderings</label>
        {s.category.map((c) => <button class="fchip on" onClick={() => toggle('category', c)} aria-label={`Remove ${c} filter`}>{c} ✕</button>)}
        {active > 0 && <button class="fchip clear" onClick={reset}>Clear ({active})</button>}
      </div>
      <p id="result-count" class="small muted" aria-live="polite">{records.length} projects</p>
      <style>{`
        .fb{display:flex;flex-direction:column;gap:8px;margin:0 0 10px}
        .fb-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .fb-q{flex:1 1 220px;min-width:0;padding:.6rem .9rem;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit}
        .fb-sel{padding:.5rem .8rem;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:.88rem;max-width:100%}
        .fb-view{display:inline-flex;border:1px solid var(--border);border-radius:999px;overflow:hidden;background:var(--surface)}
        .fb-view button{border:0;background:transparent;padding:.5rem .9rem;font-weight:600;color:var(--text-2);cursor:pointer}
        .fb-view button.on{background:var(--accent);color:#fff}
        .fchip{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .75rem;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text-2);font-size:.82rem;font-weight:600;cursor:pointer}
        .fchip.on{background:var(--text);color:var(--bg);border-color:var(--text)}
        .fchip.s-construction.on{background:var(--construction);border-color:var(--construction);color:#1a1200}
        .fchip.s-approved.on{background:var(--approved);border-color:var(--approved);color:#fff}
        .fchip.s-filed.on{background:var(--filed);border-color:var(--filed);color:#fff}
        .fchip.s-proposed.on{background:var(--proposed);border-color:var(--proposed);color:#fff}
        .fchip.s-open.on{background:var(--open);border-color:var(--open);color:#fff}
        .fchip.clear{border-style:dashed}
        .sep{width:1px;height:22px;background:var(--border)}
        #result-count{margin:0}
      `}</style>
    </div>
  );
}
