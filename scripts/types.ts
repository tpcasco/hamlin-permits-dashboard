import type { Confidence, DatePrecision, Project, Source } from '../src/schemas/project';
import { z } from 'zod';

export type RunMode = 'run' | 'dry-run' | 'discover';

export interface RawDoc {
  id: string;
  adapter: string;
  sourceKind: Source['kind'];
  publisher: string;
  url: string;
  title: string;
  fetchedAt: string;
  publishedAt?: string;
  text: string;
  /** Adapter-specific structured payload (GIS attributes, permit rows) kept for traceability. */
  data?: unknown;
}

export interface AdapterContext {
  mode: RunMode;
  config: Record<string, any>;
  keywords: string[];
  http: typeof import('./lib/http');
  log: (msg: string) => void;
  /** Existing projects, so adapters that need targets (business sites) can find them. */
  projects: Project[];
  now: string;
}

export interface Adapter {
  id: string;
  run(ctx: AdapterContext): Promise<RawDoc[]>;
}

export const FACT_FIELDS = [
  'new-project', 'status', 'expectedCompletion', 'address', 'size', 'developer', 'contractor', 'category', 'type', 'description', 'alias',
  'permit', 'milestone', 'image', 'website', 'phone', 'social', 'offerings', 'priceRange', 'hours', 'menuHighlights', 'brandDescription',
] as const;

export const ExtractedFactSchema = z.object({
  projectName: z.string().min(1).describe('Canonical business or project name as the source uses it'),
  aliases: z.array(z.string()).default([]).describe('Other names the source uses for the same project'),
  field: z.enum(FACT_FIELDS),
  value: z.string().min(1).describe('The fact as a short string; for status use one of proposed|filed|approved|construction|open|closed|stalled|withdrawn; for hours use JSON array of {day,open,close}'),
  date: z.string().optional().describe('YYYY, YYYY-MM or YYYY-MM-DD when the fact is dated (status change date, expected opening, permit date)'),
  datePrecision: z.enum(['day', 'month', 'year', 'estimate']).optional(),
  dateLabel: z.string().optional().describe('Original wording when precision is estimate, e.g. "Summer 2026"'),
  quote: z.string().min(1).describe('Verbatim sentence from the source supporting this fact'),
  confidence: z.enum(['high', 'medium', 'low']),
  permit: z
    .object({ permitNumber: z.string(), jurisdiction: z.enum(['orange-county', 'winter-garden']), permitType: z.string(), status: z.string(), filedDate: z.string().optional(), issuedDate: z.string().optional(), url: z.string().optional() })
    .optional(),
  location: z.object({ address: z.string().optional(), description: z.string() }).optional().describe('Only for new-project'),
  newProject: z.object({ category: z.string(), type: z.enum(['commercial', 'residential', 'infrastructure', 'mixed']), summary: z.string(), description: z.string() }).optional(),
});
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

export const ExtractionResultSchema = z.object({
  relevant: z.boolean().describe('False when the document says nothing about Hamlin / Horizon West development'),
  facts: z.array(ExtractedFactSchema),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export interface FactWithSource extends ExtractedFact { sourceId: string; sourceKind: Source['kind']; publisher: string; url: string; publishedAt?: string }

export interface ImageCandidate { slug: string; url: string; credit: string; sourceUrl: string; alt: string }

export interface RunReport {
  runId: string;
  mode: RunMode;
  startedAt: string;
  docs: number;
  facts: number;
  projectsBefore: number;
  projectsAfter: number;
  changed: string[];
  created: string[];
  flagged: string[];
  errors: string[];
  costUsd: number;
}

export const SOURCE_TIER: Record<Source['kind'], number> = { permit: 4, gis: 4, 'business-site': 3, news: 2, social: 1, 'web-search': 1, legacy: 0 };
export const confidenceRank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
export const precisionRank: Record<DatePrecision, number> = { day: 4, month: 3, estimate: 2, year: 1 };
