# Hamlin Development Tracker

A community site for Hamlin / Horizon West (Winter Garden, FL): what is being built, where, when it opens, how long each stage takes, and a deep dive on every business. Static Astro site, JSON data in git, refreshed every night by an automated pipeline.

## How it works

```
data/projects.json  ──build──▶  Astro static site (Vercel)
        ▲
        │ nightly commit (GitHub Actions)
scripts/refresh.ts: adapters → Claude extraction → merge guardrails → geocode → images → validate → changelog
```

- **Site**: `src/` (Astro 7 + Preact islands). Pages: home with 3D Mapbox map, explore, project deep dives, map, timeline, coming soon, stats, what's new, how permits work, subscribe, status. Endpoints: `feed.xml`, `feed.json`, `openings.ics`, `projects/<slug>.ics`, `projects.geojson`.
- **Data**: `data/projects.json` validated by `src/schemas/project.ts` at build time. A bad commit fails the build and the last good deploy stays live.
- **Pipeline**: `scripts/` (see `scripts/refresh.ts`). Sources in `data/sources-registry.json`; flip `enabled` to turn one off without code changes.

## Local development

```bash
npm install
npm run dev          # http://localhost:4321
npm test             # merge / validate / changelog rules
npm run validate     # data/projects.json against the schema and business rules
npx astro check      # types
npm run build
```

Copy `.env.example` to `.env` and set `PUBLIC_MAPBOX_TOKEN` to see the map locally.

## Deploy (Vercel)

1. Import the GitHub repo in Vercel (framework preset: Astro, output `dist/`).
2. Environment variable `PUBLIC_MAPBOX_TOKEN` = a Mapbox **public** token restricted to your domain (Mapbox dashboard → Tokens → URL restrictions). Optional `PUBLIC_SITE_URL` = your production URL (used for feeds and share links).
3. Production deploys from `main`; every push by the nightly job redeploys automatically.

## Nightly refresh (GitHub Actions)

Workflow: `.github/workflows/refresh.yml`, 03:15 ET daily, plus manual `workflow_dispatch` with a `mode` input.

Repository **secrets**:

| Secret | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | extraction and web-search verification |
| `MAPBOX_SERVER_TOKEN` | geocoding (a secret token, not the public one) |
| `IMAGE_API_KEY` | AI concept images (Google Imagen by default, or OpenAI) |

Repository **variables** (optional): `CLAUDE_MODEL` (default `claude-opus-5`; `claude-sonnet-5` is ~60% cheaper), `IMAGE_PROVIDER` (`google` | `openai`), `MAX_IMAGES_PER_RUN` (5), `MAX_RECONCILE_PER_RUN` (12), `COST_CAP_USD` (8), `PUBLIC_MAPBOX_TOKEN`.

Modes:

- `run` (default): full refresh, commits to `main` only if validation passes and something changed.
- `dry-run`: full refresh written to `scratch/dry-run/`, nothing committed. Output uploaded as a workflow artifact.
- `discover`: fetch only. Dumps what every source returns to `scratch/discover/` so adapters can be tuned against real responses. **Run this first** after enabling the workflow; the county and city portals could not be reached from the development sandbox, so the Fast Track and BS&A adapters are best-effort until verified here.

Guardrails (no human approval step, so these stand in for one): projects are never deleted, only archived on high-confidence terminal news from two publishers or a permit-tier source; status moves forward automatically but backward only when two independent publishers agree; source precedence permit/GIS > business site > news > web search; business hours, prices, and menus are hidden unless they came from the business's own site; every fact carries a supporting quote and source; a run that changes more than 30% of projects, loses a project, or fails schema validation aborts without committing and opens an issue labeled `pipeline`.

Cost: roughly $3.50–4.50 per night on Opus 5 (about $120/month); `claude-sonnet-5` cuts that by around 60%. Mapbox stays inside the free tier. AI images run about $0.04 each, capped per run.

## Data model

See `src/schemas/project.ts`. Highlights: `statusHistory` with per-event date precision (`day` | `month` | `year` | `estimate`), `expectedCompletion` with confidence, `location.footprint` parcel polygons, `business.*` with per-field sources and confidence, `images[].kind` (`official` | `photo` | `ai-concept`), `meta.needsReview` flags, and an append-only `data/changelog.json` that powers What's new and the feeds.

## Reporting a correction

Every project page has a "Report an error" link that opens a prefilled GitHub issue.
