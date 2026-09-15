/**
 * One-time migration of the original single-file dashboard into data/projects.json.
 * Deterministic: no model calls. Free-text timelines are parsed into dated status events;
 * locations get rough anchor coordinates flagged low-confidence for the nightly geocoder to replace.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { ProjectsFileSchema, type DatePrecision, type ProjectInput, type Status } from '../src/schemas/project';
import { slugify } from './lib/slug';
import { parseLooseDate } from './lib/dates';

interface Legacy {
  name: string; type: string; status: string; size: string; location: string;
  developer: string; timeline: string; description: string; category: string;
}

const html = readFileSync('legacy/hamlin-permits-dashboard.html', 'utf8');
const arr = html.match(/const PROJECTS = (\[[\s\S]*?\n\]);/);
if (!arr) throw new Error('PROJECTS array not found in legacy HTML');
const legacy = vm.runInNewContext(arr[1]) as Legacy[];

const NOW = new Date().toISOString();
const LEGACY_SOURCE = {
  id: 'legacy-tracker-2026-02',
  title: 'Original Hamlin Area Development Tracker (Feb 2026 snapshot)',
  publisher: 'Hamlin Development Tracker',
  kind: 'legacy' as const,
  retrievedAt: '2026-02-25T15:30:00.000Z',
  publishedAt: '2026-02-25',
};

/** Rough anchors around Hamlin Town Center; every match is flagged geocodeConfidence: low. */
const ANCHORS: Array<{ re: RegExp; lat: number; lng: number }> = [
  { re: /hamlin groves trail/i, lat: 28.4232, lng: -81.6205 },
  { re: /hartzog/i, lat: 28.4185, lng: -81.6335 },
  { re: /avalon rd|avalon road/i, lat: 28.436, lng: -81.633 },
  { re: /new independence/i, lat: 28.4325, lng: -81.6195 },
  { re: /lake hancock|lakefront|waterfront|popstroke/i, lat: 28.4248, lng: -81.6135 },
  { re: /sr[ -]?429|429/i, lat: 28.433, lng: -81.616 },
  { re: /porter rd|porter road/i, lat: 28.4115, lng: -81.626 },
  { re: /regional park|library/i, lat: 28.4165, lng: -81.6295 },
  { re: /silverleaf/i, lat: 28.4425, lng: -81.6425 },
  { re: /ovation|westhaven/i, lat: 28.4485, lng: -81.6355 },
  { re: /orange.*lake|lake county|toll road|516/i, lat: 28.4395, lng: -81.6575 },
  { re: /hamlin/i, lat: 28.4262, lng: -81.6215 },
];

function anchorFor(location: string, name: string) {
  const hit = ANCHORS.find((a) => a.re.test(location)) ?? ANCHORS.find((a) => a.re.test(name));
  return hit ? { lat: hit.lat, lng: hit.lng } : { lat: 28.428, lng: -81.62 };
}

function parseSize(raw: string): ProjectInput['size'] | undefined {
  const m = raw.replace(/,/g, '').match(/([\d.]+)\s*(sq ?ft|sf|acres?|units?|homes?|miles?)/i);
  if (!m) return undefined;
  const u = m[2].toLowerCase();
  const unit = /sq|sf/.test(u) ? 'sqft' : /acre/.test(u) ? 'acres' : /unit/.test(u) ? 'units' : /home/.test(u) ? 'homes' : 'miles';
  return { value: Number(m[1]), unit, raw };
}

const STATUS_MAP: Record<string, Status> = { proposed: 'proposed', filed: 'filed', approved: 'approved', construction: 'construction', open: 'open' };

/** Turn "Construction started Oct 2025 — Est. completion May 2026" into events + expected completion. */
function parseTimeline(timeline: string, status: Status) {
  const events: NonNullable<ProjectInput['statusHistory']> = [];
  let expected: ProjectInput['expectedCompletion'];
  let groundbreaking: { date: string; precision: DatePrecision; label: string } | undefined;
  const needsReview: string[] = [];
  const segments = timeline.split(/\s+[—–]\s+|;\s+/);

  for (const seg of segments) {
    const d = parseLooseDate(seg);
    const s = seg.toLowerCase();
    const isFuture = /est\.|estimated|expected|opening (early|spring|summer|fall|late|date)|opening in|opening \w+ \d{4}|completion|coming|scheduled|grand opening|opens/.test(s) && !/^opened/.test(s);
    if (/^opened|opened /.test(s) && d) events.push({ status: 'open', date: d.date, datePrecision: d.precision, sourceIds: [LEGACY_SOURCE.id] });
    else if (/construction (started|began|underway)|under construction|site clearing|buildout underway|built/.test(s) && d && !isFuture)
      events.push({ status: 'construction', date: d.date, datePrecision: d.precision, sourceIds: [LEGACY_SOURCE.id] });
    else if (/approved/.test(s) && d) events.push({ status: 'approved', date: d.date, datePrecision: d.precision, sourceIds: [LEGACY_SOURCE.id] });
    else if (/pre-application|proposed/.test(s) && d) events.push({ status: 'proposed', date: d.date, datePrecision: d.precision, sourceIds: [LEGACY_SOURCE.id] });
    else if (/filed|in permitting|permits in process|entity registered/.test(s) && d)
      events.push({ status: 'filed', date: d.date, datePrecision: d.precision, sourceIds: [LEGACY_SOURCE.id] });
    else if (/plans/.test(s) && d && !isFuture) events.push({ status: 'proposed', date: d.date, datePrecision: d.precision, sourceIds: [LEGACY_SOURCE.id] });

    const isGroundbreaking = /break ground|groundbreaking|construction (to |is )?(start|begin|expected)|start(s)? construction/.test(s);
    if (isGroundbreaking && d) {
      groundbreaking = { date: d.date, precision: d.precision, label: d.label ?? seg.trim() };
    } else if (isFuture && d && status !== 'open') {
      expected = { date: d.date, precision: d.precision, confidence: d.precision === 'day' ? 'medium' : 'low', label: d.label ?? seg.trim(), sourceIds: [LEGACY_SOURCE.id] };
    }
  }

  // The current status always gets an event, even if undated, so the stepper has an anchor.
  if (!events.some((e) => e.status === status)) {
    const d = parseLooseDate(timeline);
    const usable = d && d.date !== expected?.date && (d.precision === 'day' || d.precision === 'month') && d.date <= '2026-02-25';
    events.push({
      status,
      date: usable ? d.date : '2026-02',
      datePrecision: usable ? d.precision : 'estimate',
      note: usable ? undefined : 'Stage confirmed in Feb 2026 snapshot; start date not stated',
      sourceIds: [LEGACY_SOURCE.id],
    });
  }
  // A scheduled opening that has already passed is not evidence it opened: flag it for the nightly verifier.
  if (expected && expected.date < new Date().toISOString().slice(0, 10) && status !== 'open') needsReview.push('scheduled-opening-passed');
  if (/tbd|coming soon/i.test(timeline)) needsReview.push('timeline-unknown');

  events.sort((a, b) => a.date.localeCompare(b.date));
  return { events, expected, needsReview, groundbreaking };
}

const CATEGORY_FIX: Record<string, string> = { 'Fitness / Recreation': 'Fitness / Recreation' };

const projects: ProjectInput[] = legacy.map((l) => {
  const slug = slugify(l.name);
  const status = STATUS_MAP[l.status] ?? 'proposed';
  const { events, expected, needsReview, groundbreaking } = parseTimeline(l.timeline, status);
  const coords = anchorFor(l.location, l.name);
  const addressMatch = l.location.match(/^\d{3,6}\s+[^(]+/);
  const summary = l.description.split(/(?<=\.)\s/)[0].slice(0, 200);
  return {
    id: slug,
    slug,
    name: l.name,
    aliases: [],
    type: l.type as ProjectInput['type'],
    category: CATEGORY_FIX[l.category] ?? l.category,
    status,
    statusConfidence: 'medium',
    statusHistory: events,
    expectedCompletion: expected,
    location: {
      address: addressMatch ? addressMatch[0].trim() : undefined,
      description: l.location,
      lat: coords.lat,
      lng: coords.lng,
      geocodeConfidence: 'low',
      geocodedFrom: 'legacy-anchor',
    },
    size: parseSize(l.size),
    developer: l.developer || undefined,
    summary,
    description: l.description,
    permits: [],
    milestones: [
      ...events.map((e) => ({
        date: e.date, precision: e.datePrecision, kind: e.status === 'open' ? ('opening' as const) : ('status' as const),
        title: e.status === 'open' ? 'Opened' : e.status === 'construction' ? 'Construction underway' : e.status === 'approved' ? 'Plans approved' : e.status === 'filed' ? 'Plans filed' : 'Plans proposed',
        detail: l.timeline, sourceIds: [LEGACY_SOURCE.id],
      })),
      ...(groundbreaking ? [{ date: groundbreaking.date, precision: groundbreaking.precision, kind: 'other' as const, title: 'Expected groundbreaking', detail: groundbreaking.label, sourceIds: [LEGACY_SOURCE.id] }] : []),
    ],
    images: [],
    sources: [LEGACY_SOURCE],
    meta: {
      createdAt: '2026-02-25T15:30:00.000Z', updatedAt: NOW, lastVerifiedAt: '2026-02-25T15:30:00.000Z',
      confidence: 'medium', archived: false, needsReview: ['geocode-low-confidence', ...needsReview], legacyId: slug,
    },
  };
});

const parsed = ProjectsFileSchema.safeParse(projects);
if (!parsed.success) {
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}
writeFileSync('data/projects.json', JSON.stringify(parsed.data, null, 2) + '\n');
console.log(`Migrated ${parsed.data.length} projects → data/projects.json`);
for (const p of parsed.data) {
  console.log(`- ${p.slug.padEnd(40)} ${p.status.padEnd(12)} hist=${p.statusHistory.map((e) => `${e.status}@${e.date}`).join(',')} exp=${p.expectedCompletion?.date ?? '-'} flags=${p.meta.needsReview.filter((f) => f !== 'geocode-low-confidence').join('|') || '-'}`);
}
