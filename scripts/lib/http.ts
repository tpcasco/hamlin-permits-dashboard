import * as cheerio from 'cheerio';

const UA = 'HamlinDevelopmentTracker/1.0 (+https://github.com/tpcasco/hamlin-permits-dashboard; community permit tracker)';

export interface FetchOpts { timeoutMs?: number; retries?: number; headers?: Record<string, string>; method?: string; body?: string | URLSearchParams }

export async function fetchWithRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 20_000, retries = 2 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: opts.method ?? 'GET', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,application/json,*/*', ...opts.headers }, body: opts.body, signal: ac.signal, redirect: 'follow' });
      clearTimeout(t);
      if (res.status >= 500 && attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getText(url: string, opts?: FetchOpts): Promise<string> {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

export async function getJson<T = unknown>(url: string, opts?: FetchOpts): Promise<T> {
  const res = await fetchWithRetry(url, { ...opts, headers: { accept: 'application/json', ...opts?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

export async function getBuffer(url: string, opts?: FetchOpts): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? '' };
}

export function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** Extract readable article text from HTML, dropping nav/footer/script noise. */
export function htmlToText(html: string, maxChars = 14_000): { title: string; text: string; published?: string; images: string[] } {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg, [role="navigation"], .sidebar, .comments, .share, .related').remove();
  const title = ($('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text()).trim();
  const published = $('meta[property="article:published_time"]').attr('content') || $('time[datetime]').first().attr('datetime') || undefined;
  const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  const parts: string[] = [];
  root.find('h1, h2, h3, h4, p, li, td, th, blockquote, figcaption').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length > 2) parts.push(t);
  });
  const images = new Set<string>();
  const og = $('meta[property="og:image"]').attr('content'); if (og) images.add(og);
  root.find('img').each((_, el) => { const s = $(el).attr('src') || $(el).attr('data-src'); const w = Number($(el).attr('width') || 0); if (s && /^https?:/.test(s) && (w === 0 || w >= 400)) images.add(s); });
  return { title, text: dedupeLines(parts).join('\n').slice(0, maxChars), published: published?.slice(0, 10), images: [...images].slice(0, 6) };
}

function dedupeLines(lines: string[]): string[] { const seen = new Set<string>(); return lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true))); }

export interface FeedItem { title: string; link: string; published?: string; summary: string }
/** Minimal RSS 2.0 / Atom parser; enough for WordPress and newspaper feeds. */
export function parseFeed(xml: string): FeedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const items: FeedItem[] = [];
  $('item, entry').each((_, el) => {
    const $el = $(el);
    const link = $el.find('link').first().attr('href') || $el.find('link').first().text().trim();
    const dateRaw = $el.find('pubDate, published, updated, dc\\:date').first().text().trim();
    const published = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : undefined;
    const summary = cheerio.load($el.find('content\\:encoded, content, description, summary').first().text() || '').text().replace(/\s+/g, ' ').trim();
    items.push({ title: $el.find('title').first().text().trim(), link, published: published && published !== 'Invalid Date' ? published : undefined, summary });
  });
  return items.filter((i) => i.link);
}

export function matchesKeywords(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => t.includes(k.toLowerCase()));
}

export function absoluteUrl(href: string, base: string): string { try { return new URL(href, base).toString(); } catch { return href; } }
