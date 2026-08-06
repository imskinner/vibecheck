/**
 * Core domain types. PRD §5.2, §5.3, §5.8.
 *
 * These types are the SOURCE OF TRUTH for the schema — /db/schema.ts is aligned to this file,
 * never the reverse (PRD §8). Nothing here may import from drizzle, from a database driver, or
 * from anything that performs I/O. /evals must be able to run without a database.
 *
 * Deviation from PRD §5.2, deliberate: the PRD sketches `Assumption.evidence: Claim[]`. Scoring
 * takes a normalized `Ledger` (separate arrays joined on assumption_id) instead, so that the
 * function's input shape matches storage and no claim is represented twice. The nested form is a
 * view model, built at the edge.
 */

export type Rating = 1 | 2 | 3 | 4 | 5

export const ASSUMPTION_CATEGORIES = [
  'problem',
  'icp',
  'willingness_to_pay',
  'access',
  'competition',
  'execution',
  'timing',
] as const
export type AssumptionCategory = (typeof ASSUMPTION_CATEGORIES)[number]

/** PRD §5.4.1 — `red_team` assumptions are how the adversarial pass reaches the ledger. */
export const ASSUMPTION_ORIGINS = ['canvas', 'red_team', 'founder'] as const
export type AssumptionOrigin = (typeof ASSUMPTION_ORIGINS)[number]

export const ASSUMPTION_STATUSES = ['untested', 'supported', 'refuted', 'mixed'] as const
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number]

export const CLAIM_STANCES = ['supports', 'refutes', 'context'] as const
export type ClaimStance = (typeof CLAIM_STANCES)[number]

export const CLAIM_SOURCE_TYPES = [
  'primary_conversation',
  'public_post',
  'company_page',
  'funding_db',
  'news',
  'review_site',
  'model_inference',
] as const
export type ClaimSourceType = (typeof CLAIM_SOURCE_TYPES)[number]

export const CLAIM_CONFIDENCES = ['high', 'medium', 'low'] as const
export type ClaimConfidence = (typeof CLAIM_CONFIDENCES)[number]

export const COMPARATORS = ['<', '<=', '>', '>='] as const
export type Comparator = (typeof COMPARATORS)[number]

/**
 * PRD §5.2.2. Structured, not prose — prose thresholds do not survive contact with a model
 * re-reading them after the fact, which can rationalize any outcome. Fixed at assumption creation
 * time and never rewritten; the Discovery Pack renders it, it does not author it (PRD §5.6.5).
 */
export interface FalsificationCriterion {
  applies_to: string
  observation: string
  metric: string
  comparator: Comparator
  threshold: number
  sample_size: number
}

export interface Assumption {
  id: string
  statement: string
  category: AssumptionCategory
  origin: AssumptionOrigin
  impact: Rating
  uncertainty: Rating
  test_cost: Rating
  status: AssumptionStatus
  falsification_criterion: FalsificationCriterion
}

export interface Claim {
  id: string
  assumption_id: string
  text: string
  stance: ClaimStance
  source_url: string | null
  source_type: ClaimSourceType
  retrieved_at: string
  /** Bounded snapshot of the source passage. Internal-only; never rendered. PRD §5.3. */
  retrieved_text: string | null
  confidence: ClaimConfidence
}

export interface Ledger {
  assumptions: Assumption[]
  claims: Claim[]
}

export const SUB_SCORE_KEYS = ['severity', 'access', 'wedge', 'fit'] as const
export type SubScoreKey = (typeof SUB_SCORE_KEYS)[number]

export interface SubScore {
  /** 0–100. 50 means "no information", not "mediocre". */
  value: number
  /** ± points. Function of how much of this category's impact mass is unresolved. PRD §5.8.3. */
  band: number
  /** True when no assumption maps to this sub-score — 50 here is a placeholder, not a finding. */
  uncovered: boolean
  unresolvedImpactFraction: number
}

/** Per-assumption breakdown, retained so a score is auditable claim by claim (PRD §5.8). */
export interface AssumptionContribution {
  assumption_id: string
  category: AssumptionCategory
  origin: AssumptionOrigin
  subScore: SubScoreKey
  impact: Rating
  support: number
  /** True when the falsification criterion resolved and pinned the support value. */
  pinned: boolean
  /** Support points contributed by model_inference claims, after the swing clamp. */
  inferenceSwing: number
  claimIds: string[]
  primaryClaimCount: number
  coverage: number
}

export interface ScoreResult {
  subScores: Record<SubScoreKey, SubScore>
  /** 0–100. Driven only by primary_conversation coverage of high-impact assumptions. */
  evidenceQuality: number
  weightedMean: number
  /** 30 + 0.7 × EQ. */
  cap: number
  capBinding: boolean
  composite: number
  contributions: AssumptionContribution[]
}
