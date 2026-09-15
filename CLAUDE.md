# Hamlin Development Tracker — working notes for Claude Code

Static Astro site + JSON data in `data/`. **Data updates are done manually from a Claude Code session, not by the API pipeline** (the owner does not want API billing). The GitHub Actions workflow only runs on manual dispatch.

## How to run a data update ("update the Hamlin tracker")

1. Read `data/projects.json` and note projects flagged in `meta.needsReview` (especially `scheduled-opening-passed`) and anything with `lastVerifiedAt` older than 30 days.
2. Research with web search. Trusted sources: horizonwestinfo.com, horizonwesthappenings.com, horizonwestmagazine.com, orangeobserver.com, growthspotter.com, orlandosentinel.com, bizjournals.com/orlando, hamlinfl.com, fasttrack.ocfl.net, bsaonline.com (uid 3123), orangecountyfl.net. Search "<business> Hamlin", "<business> Horizon West", and "Hamlin Town Center new" / "Horizon West coming soon <month year>" for new projects. Direct fetches of the county, city, and some local news sites are blocked from the sandbox; search snippets and reachable articles are fine. Every fact needs a real supporting quote and URL.
3. Write `updates/YYYY-MM-DD.json` with `sources` and `facts` (schema: `scripts/apply-updates.ts` header; field list in `scripts/types.ts`). Status values: proposed | filed | approved | construction | open | closed | stalled | withdrawn. Dates: YYYY-MM-DD / YYYY-MM / YYYY, with `datePrecision`; seasons use the first month and precision `estimate` plus `dateLabel`. Use `new-project` with `newProject` + `location` for anything not yet tracked. List slugs you checked but found nothing new for under `verified`.
4. Dry run, then apply:
   ```bash
   npx tsx scripts/apply-updates.ts updates/YYYY-MM-DD.json --dry-run
   npx tsx scripts/apply-updates.ts updates/YYYY-MM-DD.json
   npm test && npm run build
   ```
   The merge guardrails apply exactly as in the automated path (never delete, forward-only status unless two publishers agree, business hours/prices only from the business's own site). If validation rejects the run, fix the facts file; do not edit `data/projects.json` by hand.
5. Commit `data/`, `updates/`, and any `public/images/projects/**` with a message like `data: manual update YYYY-MM-DD`, push, and summarize the changelog entries to the owner.

Optional per run: `MAPBOX_SERVER_TOKEN` in the environment lets the apply step geocode low-confidence locations; `IMAGE_API_KEY` lets it generate labeled AI concept images. Both are skipped when unset.

## Checks before any push

`npm test`, `npx astro check`, `npm run build`. Do not commit `scratch/` or `dist/`.
