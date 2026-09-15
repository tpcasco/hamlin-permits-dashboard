import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Project } from '../src/schemas/project';
import type { ImageCandidate } from './types';
import * as http from './lib/http';

const MAX_PER_RUN = Number(process.env.MAX_IMAGES_PER_RUN || 5);
const PROVIDER = (process.env.IMAGE_PROVIDER || (process.env.IMAGE_API_KEY?.startsWith('sk-') ? 'openai' : 'google')) as 'google' | 'openai';
const KEY = process.env.IMAGE_API_KEY || '';

export function imagesDir(root: string, slug: string) { return join(root, 'public', 'images', 'projects', slug); }

async function saveWebp(buf: Buffer, dir: string, name: string): Promise<{ file: string; width: number; height: number } | null> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || meta.width < 500) return null;
  mkdirSync(dir, { recursive: true });
  const out = await sharp(buf).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  writeFileSync(join(dir, name), out.data);
  return { file: name, width: out.info.width, height: out.info.height };
}

/** Try candidate official images first; fall back to one labeled AI concept per project, capped per run. */
export async function processImages(projects: Project[], candidates: ImageCandidate[], root: string, now: string, log: (m: string) => void): Promise<string[]> {
  const changed: string[] = []; let generated = 0;
  for (const c of candidates) {
    const p = projects.find((x) => x.slug === c.slug); if (!p) continue;
    if (p.images.some((i) => i.sourceUrl === c.sourceUrl || i.kind === 'official')) continue;
    try {
      const { buf, contentType } = await http.getBuffer(c.url, { timeoutMs: 30_000 });
      if (!/image\//.test(contentType) && !/\.(jpe?g|png|webp|avif)/i.test(c.url)) continue;
      const saved = await saveWebp(buf, imagesDir(root, p.slug), `official-${p.images.filter((i) => i.kind === 'official').length + 1}.webp`);
      if (!saved) continue;
      p.images = p.images.filter((i) => i.kind !== 'ai-concept' || !i.isHero).map((i) => ({ ...i, isHero: false }));
      p.images.unshift({ file: saved.file, kind: 'official', alt: c.alt, credit: c.credit, sourceUrl: c.sourceUrl, isHero: true, width: saved.width, height: saved.height });
      p.meta.updatedAt = now; changed.push(p.slug); log(`images: official image saved for ${p.slug}`);
    } catch (e) { log(`images: candidate failed for ${c.slug}: ${(e as Error).message}`); }
  }
  if (!KEY) { log('images: IMAGE_API_KEY not set; skipping AI concepts'); return changed; }
  for (const p of projects) {
    if (generated >= MAX_PER_RUN) break;
    if (p.images.length || p.meta.archived || p.status === 'open' || p.type === 'infrastructure') continue;
    try {
      const prompt = conceptPrompt(p);
      const buf = await generate(prompt);
      const saved = await saveWebp(buf, imagesDir(root, p.slug), 'ai-concept-1.webp');
      if (!saved) continue;
      p.images.push({ file: saved.file, kind: 'ai-concept', alt: `AI-generated concept of what ${p.name} could look like; not an official rendering`, credit: `AI concept (${PROVIDER})`, isHero: true, width: saved.width, height: saved.height, generatedAt: now, prompt });
      p.meta.updatedAt = now; changed.push(p.slug); generated++; log(`images: AI concept generated for ${p.slug}`);
    } catch (e) { log(`images: generation failed for ${p.slug}: ${(e as Error).message}`); }
  }
  return changed;
}

function conceptPrompt(p: Project): string {
  const size = p.size ? `${p.size.raw}` : '';
  return `Photorealistic exterior architectural concept of a new ${p.category.toLowerCase()} building in a modern master-planned suburban town center in Central Florida (Hamlin, Winter Garden): ${p.summary} ${size}. Daytime, clear sky, palm trees and live oaks, landscaped parking, contemporary Florida commercial architecture with stucco, stone and metal accents. No text, no signage, no logos, no people in focus. Wide angle, eye level.`;
}

async function generate(prompt: string): Promise<Buffer> {
  if (PROVIDER === 'openai') {
    // https://platform.openai.com/docs/api-reference/images/create
    const res = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.IMAGE_MODEL || 'gpt-image-1', prompt, size: '1536x1024', quality: 'medium', n: 1 }) });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { data: Array<{ b64_json?: string; url?: string }> };
    if (j.data[0]?.b64_json) return Buffer.from(j.data[0].b64_json, 'base64');
    if (j.data[0]?.url) return (await http.getBuffer(j.data[0].url)).buf;
    throw new Error('openai: no image in response');
  }
  // https://ai.google.dev/gemini-api/docs/imagen
  const model = process.env.IMAGE_MODEL || 'imagen-4.0-generate-001';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: '16:9', personGeneration: 'dont_allow' } }) });
  if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string }> };
  const b64 = j.predictions?.[0]?.bytesBase64Encoded; if (!b64) throw new Error('google: no image in response');
  return Buffer.from(b64, 'base64');
}

export function verifyImageFiles(projects: Project[], root: string): string[] {
  const missing: string[] = [];
  for (const p of projects) for (const i of p.images) if (!existsSync(join(imagesDir(root, p.slug), i.file))) missing.push(`${p.slug}/${i.file}`);
  return missing;
}
