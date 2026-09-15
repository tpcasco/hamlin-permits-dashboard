import { z } from 'zod';

/** Lifecycle stages shown on the status stepper, in order. */
export const STAGE_ORDER = ['proposed', 'filed', 'approved', 'construction', 'open'] as const;
/** Every status a project can carry (stepper stages plus terminal/off-ramp states). */
export const STATUSES = [...STAGE_ORDER, 'closed', 'stalled', 'withdrawn'] as const;
export const PROJECT_TYPES = ['commercial', 'residential', 'infrastructure', 'mixed'] as const;
export const CONFIDENCE = ['high', 'medium', 'low'] as const;
export const DATE_PRECISION = ['day', 'month', 'year', 'estimate'] as const;
export const IMAGE_KINDS = ['official', 'photo', 'ai-concept'] as const;
export const SOURCE_KINDS = ['permit', 'gis', 'news', 'business-site', 'social', 'web-search', 'legacy'] as const;
export const JURISDICTIONS = ['orange-county', 'winter-garden'] as const;
export const PRICE_RANGES = ['$', '$$', '$$$', '$$$$'] as const;
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type Status = (typeof STATUSES)[number];
export type Stage = (typeof STAGE_ORDER)[number];
export type Confidence = (typeof CONFIDENCE)[number];
export type DatePrecision = (typeof DATE_PRECISION)[number];

/** Hamlin / Horizon West bounding box (lng/lat). Coordinates outside are rejected. */
export const HAMLIN_BBOX = { west: -81.72, south: 28.36, east: -81.52, north: 28.5 } as const;
export const HAMLIN_CENTER = { lng: -81.62, lat: 28.428 } as const;

export const IsoDate = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, 'Expected YYYY, YYYY-MM or YYYY-MM-DD');

export const SourceSchema = z.object({
  id: z.string().min(1),
  url: z.url().optional(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  kind: z.enum(SOURCE_KINDS),
  retrievedAt: z.iso.datetime(),
  publishedAt: IsoDate.optional(),
});

export const StatusEventSchema = z.object({
  status: z.enum(STATUSES),
  date: IsoDate,
  datePrecision: z.enum(DATE_PRECISION),
  note: z.string().optional(),
  sourceIds: z.array(z.string()).default([]),
});

export const ExpectedCompletionSchema = z.object({
  date: IsoDate,
  precision: z.enum(DATE_PRECISION),
  confidence: z.enum(CONFIDENCE),
  label: z.string().optional(),
  sourceIds: z.array(z.string()).default([]),
});

const Position = z.tuple([z.number(), z.number()]);
export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(Position)),
});
export const MultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(Position))),
});

export const LocationSchema = z.object({
  address: z.string().optional(),
  description: z.string().min(1),
  lat: z.number().min(HAMLIN_BBOX.south).max(HAMLIN_BBOX.north).optional(),
  lng: z.number().min(HAMLIN_BBOX.west).max(HAMLIN_BBOX.east).optional(),
  geocodeConfidence: z.enum(CONFIDENCE).optional(),
  geocodedFrom: z.string().optional(),
  parcelId: z.string().optional(),
  footprint: z.union([PolygonSchema, MultiPolygonSchema]).optional(),
});

export const SizeSchema = z.object({
  value: z.number().positive(),
  unit: z.enum(['sqft', 'acres', 'units', 'homes', 'miles', 'seats']),
  raw: z.string(),
});

export const HoursSchema = z.object({
  day: z.enum(DAYS),
  open: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  close: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closed: z.boolean().optional(),
});

export const BUSINESS_FIELDS = [
  'offerings', 'priceRange', 'hours', 'menuHighlights', 'website', 'phone', 'socials', 'brandDescription',
] as const;

export const BusinessSchema = z.object({
  brandDescription: z.string().optional(),
  offerings: z.array(z.string()).default([]),
  priceRange: z.enum(PRICE_RANGES).optional(),
  hours: z.array(HoursSchema).optional(),
  menuHighlights: z.array(z.string()).optional(),
  website: z.url().optional(),
  phone: z.string().optional(),
  socials: z
    .object({ instagram: z.url().optional(), facebook: z.url().optional(), x: z.url().optional(), tiktok: z.url().optional() })
    .optional(),
  fieldSources: z.record(z.string(), z.array(z.string())).default({}),
  fieldConfidence: z.record(z.string(), z.enum(CONFIDENCE)).default({}),
});

export const PermitSchema = z.object({
  permitNumber: z.string().min(1),
  jurisdiction: z.enum(JURISDICTIONS),
  permitType: z.string().min(1),
  description: z.string().optional(),
  filedDate: IsoDate.optional(),
  issuedDate: IsoDate.optional(),
  status: z.string().min(1),
  url: z.url().optional(),
  sourceIds: z.array(z.string()).default([]),
});

export const MilestoneSchema = z.object({
  date: IsoDate,
  precision: z.enum(DATE_PRECISION),
  title: z.string().min(1),
  detail: z.string().optional(),
  kind: z.enum(['permit', 'news', 'status', 'opening', 'other']),
  sourceIds: z.array(z.string()).default([]),
});

export const ImageSchema = z.object({
  file: z.string().min(1),
  kind: z.enum(IMAGE_KINDS),
  alt: z.string().min(1),
  credit: z.string().optional(),
  sourceUrl: z.url().optional(),
  isHero: z.boolean().default(false),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  generatedAt: z.iso.datetime().optional(),
  prompt: z.string().optional(),
});

export const MetaSchema = z.object({
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastVerifiedAt: z.iso.datetime(),
  confidence: z.enum(CONFIDENCE),
  archived: z.boolean().default(false),
  archivedReason: z.string().optional(),
  needsReview: z.array(z.string()).default([]),
  legacyId: z.string().optional(),
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  type: z.enum(PROJECT_TYPES),
  category: z.string().min(1),
  subcategory: z.string().optional(),
  status: z.enum(STATUSES),
  statusConfidence: z.enum(CONFIDENCE),
  statusHistory: z.array(StatusEventSchema).default([]),
  expectedCompletion: ExpectedCompletionSchema.optional(),
  location: LocationSchema,
  size: SizeSchema.optional(),
  developer: z.string().optional(),
  contractor: z.string().optional(),
  architect: z.string().optional(),
  summary: z.string().min(1).max(200),
  description: z.string().min(1),
  business: BusinessSchema.optional(),
  permits: z.array(PermitSchema).default([]),
  milestones: z.array(MilestoneSchema).default([]),
  images: z.array(ImageSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  meta: MetaSchema,
});

export const ChangelogEntrySchema = z.object({
  id: z.string().min(1),
  date: z.iso.datetime(),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  projectSlug: z.string().min(1),
  projectName: z.string().min(1),
  kind: z.enum(['new', 'status-change', 'date-change', 'field-update', 'image-added', 'archived']),
  summary: z.string().min(1),
  diff: z.array(z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() })).default([]),
  sourceIds: z.array(z.string()).default([]),
});

export const ProjectsFileSchema = z.array(ProjectSchema);
export const ChangelogFileSchema = z.array(ChangelogEntrySchema);

export const PipelineStateSchema = z.object({
  lastRunId: z.string().optional(),
  lastRunAt: z.iso.datetime().optional(),
  lastSuccessAt: z.iso.datetime().optional(),
  lastStatus: z.enum(['success', 'failed', 'no-changes', 'never']).default('never'),
  adapters: z
    .record(
      z.string(),
      z.object({
        lastOkAt: z.iso.datetime().optional(),
        lastError: z.string().optional(),
        lastErrorAt: z.iso.datetime().optional(),
        docsLastRun: z.number().int().nonnegative().default(0),
      }),
    )
    .default({}),
  costUsdLastRun: z.number().nonnegative().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type StatusEvent = z.infer<typeof StatusEventSchema>;
export type Business = z.infer<typeof BusinessSchema>;
export type Permit = z.infer<typeof PermitSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type ProjectImage = z.infer<typeof ImageSchema>;
export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;
export type PipelineState = z.infer<typeof PipelineStateSchema>;
