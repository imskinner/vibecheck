/**
 * Postgres schema. PRD §5.9, §8.
 *
 * This file is DOWNSTREAM of /lib/scoring/types.ts. Those types are the source of truth; the
 * columns here are aligned to them, never the reverse. schema.test.ts enforces that the union
 * members stay in sync, so a new claim source type cannot land in one place and not the other.
 *
 * Enum-typed `text` columns plus CHECK constraints, not Postgres enums: source_type, category,
 * status and origin will churn, and `ALTER TYPE ... ADD VALUE` is transactionally awkward and
 * generates unpleasant migrations (PRD §8).
 */

import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

import {
  ASSUMPTION_CATEGORIES,
  ASSUMPTION_ORIGINS,
  ASSUMPTION_STATUSES,
  CLAIM_CONFIDENCES,
  CLAIM_SOURCE_TYPES,
  CLAIM_STANCES,
} from '../lib/scoring/types'

const INPUT_TYPES = ['url', 'description', 'chat', 'file'] as const
const REPORT_STATUSES = ['running', 'completed', 'failed'] as const

/**
 * The mutable working object. Research must not run before `canvas_confirmed_at` is set —
 * garbage-in is the #1 quality failure mode (PRD §5.1) and this column is the enforcement point.
 */
export const ideas = pgTable('ideas', {
  id: text('id').primaryKey(),
  inputType: text('input_type', { enum: INPUT_TYPES }).notNull(),
  rawInput: text('raw_input').notNull(),
  /** Structured canvas from PRD §5.1: problem, icp_hypothesis, wedge_hypothesis, business_model… */
  canvas: jsonb('canvas'),
  canvasConfirmedAt: timestamp('canvas_confirmed_at', { withTimezone: true }),
  /** Knowledge cutoff for blind scoring. Set for golden-set entries; null for live user ideas. */
  t0: timestamp('t0', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * One immutable row per pipeline run. Never updated in place — a re-run is a new row. Without the
 * pinned model ids the golden set silently drifts the next time a provider ships an update, and
 * every historical eval number becomes uninterpretable (PRD §5.9).
 */
export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    /** The canvas exactly as it was at run time. */
    canvasSnapshot: jsonb('canvas_snapshot').notNull(),
    /** Adapter ids, compliance, and enabled state at run time. PRD §5.5. */
    adapterSet: jsonb('adapter_set').notNull(),
    /** { stage: promptVersion } — prompts are versioned .ts files. */
    promptVersions: jsonb('prompt_versions').notNull(),
    /** { stage: modelId } — pinned, never "latest". */
    modelIds: jsonb('model_ids').notNull(),
    /**
     * CompetitiveLandscape (PRD §5.10) — a report artifact, never a score input. Stored on the
     * immutable run because landscape claims decay in weeks; the date it was drawn is part of it.
     */
    landscape: jsonb('landscape'),
    status: text('status', { enum: REPORT_STATUSES }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('reports_idea_idx').on(t.ideaId)],
)

export const assumptions = pgTable(
  'assumptions',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    /** Which run generated it. Null for founder-entered assumptions. */
    reportId: text('report_id').references(() => reports.id, { onDelete: 'set null' }),
    statement: text('statement').notNull(),
    category: text('category', { enum: ASSUMPTION_CATEGORIES }).notNull(),
    /** `red_team` is how the adversarial pass reaches the ledger. It never writes claims. §5.4.1 */
    origin: text('origin', { enum: ASSUMPTION_ORIGINS }).notNull(),
    impact: integer('impact').notNull(),
    uncertainty: integer('uncertainty').notNull(),
    testCost: integer('test_cost').notNull(),
    status: text('status', { enum: ASSUMPTION_STATUSES }).notNull().default('untested'),
    /** Structured FalsificationCriterion, fixed at creation and never rewritten. PRD §5.2.2. */
    falsificationCriterion: jsonb('falsification_criterion').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assumptions_idea_idx').on(t.ideaId),
    check('assumptions_impact_range', sql`${t.impact} between 1 and 5`),
    check('assumptions_uncertainty_range', sql`${t.uncertainty} between 1 and 5`),
    check('assumptions_test_cost_range', sql`${t.testCost} between 1 and 5`),
  ],
)

export const claims = pgTable(
  'claims',
  {
    id: text('id').primaryKey(),
    assumptionId: text('assumption_id')
      .notNull()
      .references(() => assumptions.id, { onDelete: 'cascade' }),
    /** Which adapter produced this. Null for primary_conversation and model_inference. PRD §5.5. */
    adapterId: text('adapter_id'),
    text: text('text').notNull(),
    stance: text('stance', { enum: CLAIM_STANCES }).notNull(),
    sourceUrl: text('source_url'),
    sourceType: text('source_type', { enum: CLAIM_SOURCE_TYPES }).notNull(),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    /** Bounded snapshot the fabrication check verifies against. Internal-only. PRD §5.3. */
    retrievedText: text('retrieved_text'),
    confidence: text('confidence', { enum: CLAIM_CONFIDENCES }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('claims_assumption_idx').on(t.assumptionId),
    /**
     * The provenance rule at the database level: a desk-research claim without a source_url is
     * decoration, not evidence (PRD §5.3), and must not be storable in the first place. Only
     * conversations and inference are legitimately source-less.
     */
    check(
      'claims_require_source_url',
      sql`${t.sourceType} in ('primary_conversation', 'model_inference') or ${t.sourceUrl} is not null`,
    ),
  ],
)

/**
 * Append-only. One row per scoring event, from a full run or from evidence intake. Carries the
 * movement diff and the claim ids responsible, which is what renders "your Market Access score
 * moved 41 → 58 because of 3 new primary claims" (PRD §5.7) and what makes invariant 4 checkable.
 */
export const scoreSnapshots = pgTable(
  'score_snapshots',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    /** Null when the snapshot came from evidence intake rather than a pipeline run. */
    reportId: text('report_id').references(() => reports.id, { onDelete: 'set null' }),
    priorSnapshotId: text('prior_snapshot_id'),
    /** Record<SubScoreKey, SubScore> — value, band, uncovered, unresolvedImpactFraction. */
    subScores: jsonb('sub_scores').notNull(),
    evidenceQuality: doublePrecision('evidence_quality').notNull(),
    weightedMean: doublePrecision('weighted_mean').notNull(),
    cap: doublePrecision('cap').notNull(),
    capBinding: boolean('cap_binding').notNull(),
    composite: doublePrecision('composite').notNull(),
    /** The exact claim set this score was computed from. */
    claimIds: jsonb('claim_ids').notNull(),
    /** ScoreMovement against prior_snapshot_id. Null for the first snapshot. */
    movement: jsonb('movement'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('score_snapshots_idea_idx').on(t.ideaId)],
)
