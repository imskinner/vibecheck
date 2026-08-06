/**
 * The calibration surface. PRD §5.8.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────┐
 * │ CAP_FLOOR, CAP_SLOPE and SUB_SCORE_WEIGHTS are HARD CONSTRAINTS, not tuning knobs.       │
 * │ Weakening the cap to improve first-session conversion is explicitly forbidden (PRD §5.8, │
 * │ CLAUDE.md). If conversion is the problem, the answer is a preview of what the score      │
 * │ COULD become — never a softer cap. Changing these needs an explicit instruction.         │
 * └─────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Everything else here is calibration. The STRUCTURE is argued in the PRD; these particular
 * numbers are first-pass estimates and are expected to move once real ledgers exist. Moving them
 * requires an eval run (CLAUDE.md).
 */

import type {
  AssumptionCategory,
  ClaimConfidence,
  ClaimSourceType,
  ClaimStance,
  SubScoreKey,
} from './types'

/** PRD §5.8.1. Every category maps to exactly one sub-score; enforced by a test. */
export const CATEGORY_TO_SUB_SCORE: Record<AssumptionCategory, SubScoreKey> = {
  problem: 'severity',
  icp: 'severity',
  willingness_to_pay: 'severity',
  access: 'access',
  competition: 'wedge',
  timing: 'wedge',
  execution: 'fit',
}

/**
 * PRD §5.8.2. Ordering is the load-bearing part: a conversation outranks a company page outranks
 * a blog post. model_inference sits far below everything else — but note that the weight ALONE
 * does not cap anything (see MODEL_INFERENCE_MAX_SWING).
 */
export const SOURCE_WEIGHT: Record<ClaimSourceType, number> = {
  primary_conversation: 1.0,
  company_page: 0.8,
  funding_db: 0.8,
  review_site: 0.7,
  public_post: 0.6,
  news: 0.5,
  model_inference: 0.15,
}

export const CONFIDENCE_WEIGHT: Record<ClaimConfidence, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
}

export const STANCE_VALUE: Record<ClaimStance, number> = {
  supports: 1,
  refutes: -1,
  context: 0,
}

/**
 * Saturation constant for the support curve. Higher K = more evidence needed to move a support
 * value. Defends against: a pile of weak agreeing sources reading as certainty. The tenth
 * supporting blog post is worth far less than the first.
 */
export const SATURATION_K = 2.0

/** An assumption with no evidence sits exactly here. 50 = "no information". */
export const NEUTRAL_SUPPORT = 50

/**
 * PRD §5.3 requires model_inference claims be "capped in how much they can move a score".
 * A low weight is NOT a cap — enough inference claims still dominate the saturating curve. So the
 * aggregate swing they may contribute to any single assumption is clamped, in support points.
 *
 * Defends against: the synthesizer manufacturing consensus out of its own opinions.
 */
export const MODEL_INFERENCE_MAX_SWING = 8

/** PRD §5.8.2 — a resolved falsification criterion outranks accumulated evidence. */
export const CRITERION_PIN = {
  supported: 90,
  refuted: 10,
} as const

/** PRD §5.8.3 — band = ±BAND_COEFFICIENT × unresolved impact fraction. */
export const BAND_COEFFICIENT = 25

/** Used for coverage when an assumption's criterion omits a sample size. PRD §5.8.4. */
export const DEFAULT_SAMPLE_SIZE = 5

/**
 * PRD §5.8.5. Market Access carries equal top weight because it is where products actually die.
 * Founder Fit is lowest because it is substantially self-reported, and equal weighting would leak
 * self-flattery into the composite. Must sum to 1; enforced by a test.
 */
export const SUB_SCORE_WEIGHTS: Record<SubScoreKey, number> = {
  severity: 0.3,
  access: 0.3,
  wedge: 0.25,
  fit: 0.15,
}

/** HARD CONSTRAINT — see the header. composite = min(weightedMean, CAP_FLOOR + CAP_SLOPE × EQ). */
export const CAP_FLOOR = 30
export const CAP_SLOPE = 0.7
