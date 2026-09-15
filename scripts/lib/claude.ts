import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
const FALLBACK_MODEL = process.env.CLAUDE_FALLBACK_MODEL || 'claude-opus-4-8';
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 }, 'claude-opus-4-8': { in: 5, out: 25 }, 'claude-sonnet-5': { in: 2, out: 10 }, 'claude-haiku-4-5': { in: 1, out: 5 }, 'claude-fable-5-1': { in: 10, out: 50 },
};
const COST_CAP = Number(process.env.COST_CAP_USD || 8);

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  return (client ??= new Anthropic());
}
export function hasClaude(): boolean { return !!process.env.ANTHROPIC_API_KEY; }

export const cost = { usd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
function track(usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined, model: string) {
  if (!usage) return;
  const p = PRICES[model] ?? PRICES['claude-opus-5'];
  const inTok = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  cost.inputTokens += usage.input_tokens ?? 0; cost.outputTokens += usage.output_tokens ?? 0; cost.calls++;
  cost.usd += (inTok * p.in + (usage.output_tokens ?? 0) * p.out) / 1_000_000;
}
export function assertUnderCap(): void {
  if (cost.usd > COST_CAP) throw new Error(`Cost cap reached: $${cost.usd.toFixed(2)} > $${COST_CAP}`);
}

export const prompt = (name: string) => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');

function textOf(content: Array<{ type: string; text?: string }>): string { return content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n'); }

/** Structured extraction: system prompt is cached, the schema is enforced server-side, and the JSON is re-validated locally. */
export async function extractStructured<T extends z.ZodTypeAny>(opts: { system: string; user: string; schema: T; effort?: 'low' | 'medium' | 'high'; maxTokens?: number }): Promise<z.infer<T>> {
  assertUnderCap();
  const c = getClient();
  const res = await c.beta.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: FALLBACK_MODEL }],
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort ?? 'medium', format: zodOutputFormat(opts.schema) },
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: opts.user }],
  } as any);
  track(res.usage as any, res.model ?? MODEL);
  if (res.stop_reason === 'refusal') throw new Error('Claude declined the extraction request');
  if (res.stop_reason === 'max_tokens') throw new Error('Extraction output truncated (max_tokens)');
  const raw = textOf(res.content as any);
  return opts.schema.parse(JSON.parse(raw));
}

/** Free-text research with the server-side web search tool restricted to trusted domains. Handles pause_turn. */
export async function researchWithWebSearch(opts: { system: string; user: string; allowedDomains: string[]; maxUses?: number }): Promise<{ text: string; citations: string[] }> {
  assertUnderCap();
  const c = getClient();
  const messages: any[] = [{ role: 'user', content: opts.user }];
  const params: any = {
    model: MODEL,
    max_tokens: 6000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: FALLBACK_MODEL }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: opts.maxUses ?? 5, allowed_domains: opts.allowedDomains.slice(0, 20) }],
  };
  let res = await c.beta.messages.create({ ...params, messages });
  track(res.usage as any, res.model ?? MODEL);
  let guard = 0;
  while (res.stop_reason === 'pause_turn' && guard++ < 4) {
    messages.push({ role: 'assistant', content: res.content });
    res = await c.beta.messages.create({ ...params, messages });
    track(res.usage as any, res.model ?? MODEL);
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude declined the research request');
  const citations = new Set<string>();
  for (const block of res.content as any[]) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) for (const r of block.content) if (r.url) citations.add(r.url);
    if (block.type === 'text' && Array.isArray(block.citations)) for (const ci of block.citations) if (ci.url) citations.add(ci.url);
  }
  return { text: textOf(res.content as any), citations: [...citations] };
}

/** Tiny helper for one-line answers (geocode hints). */
export async function shortAnswer(system: string, user: string): Promise<string> {
  assertUnderCap();
  const c = getClient();
  const res = await c.beta.messages.create({ model: MODEL, max_tokens: 300, betas: ['server-side-fallback-2026-06-01'], fallbacks: [{ model: FALLBACK_MODEL }], thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: user }] } as any);
  track(res.usage as any, res.model ?? MODEL);
  return textOf(res.content as any).trim().replace(/^["']|["']$/g, '');
}
