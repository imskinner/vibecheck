/**
 * Per-assumption support value. PRD §5.8.2.
 *
 * "Given the evidence attached to this assumption, how well does it hold?" — 0 is refuted, 100 is
 * established, and 50 means we know nothing. 50 is the honest answer to an absence of evidence,
 * which is why an untested assumption sits exactly there rather than at zero.
 */

import {
  CONFIDENCE_WEIGHT,
  CRITERION_PIN,
  MODEL_INFERENCE_MAX_SWING,
  NEUTRAL_SUPPORT,
  SATURATION_K,
  SOURCE_WEIGHT,
  STANCE_VALUE,
} from './constants'
import type { Assumption, Claim } from './types'

export interface SupportResult {
  value: number
  /** True when a resolved falsification criterion set this value rather than the evidence curve. */
  pinned: boolean
  /** Support points contributed by model_inference claims, after clamping. */
  inferenceSwing: number
  claimIds: string[]
  primaryClaimCount: number
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function claimWeight(claim: Claim): number {
  return SOURCE_WEIGHT[claim.source_type] * CONFIDENCE_WEIGHT[claim.confidence]
}

/**
 * Maps unbounded net evidence onto (0, 100), saturating. Net 0 → exactly neutral.
 * Deliberately sub-linear: the tenth agreeing source must be worth far less than the first,
 * or a wall of low-grade agreement reads as certainty.
 */
function saturate(net: number): number {
  return NEUTRAL_SUPPORT + NEUTRAL_SUPPORT * (net / (Math.abs(net) + SATURATION_K))
}

export function assumptionSupport(assumption: Assumption, claims: Claim[]): SupportResult {
  const claimIds = claims.map((c) => c.id)
  const primaryClaimCount = claims.filter((c) => c.source_type === 'primary_conversation').length

  // A resolved criterion outranks accumulated evidence — that is what pre-registering it buys.
  if (assumption.status === 'supported' || assumption.status === 'refuted') {
    return {
      value: CRITERION_PIN[assumption.status],
      pinned: true,
      inferenceSwing: 0,
      claimIds,
      primaryClaimCount,
    }
  }

  // Sourced evidence and model inference are accumulated separately so the latter can be clamped
  // against the value the former would have produced on its own. PRD §5.3 requires that inference
  // be capped in how much it can move a score; a low weight alone does not do that, because
  // enough inference claims still dominate the curve.
  let netSourced = 0
  let netInference = 0
  for (const claim of claims) {
    const contribution = STANCE_VALUE[claim.stance] * claimWeight(claim)
    if (claim.source_type === 'model_inference') netInference += contribution
    else netSourced += contribution
  }

  const sourcedValue = saturate(netSourced)
  const inferenceSwing = clamp(
    saturate(netSourced + netInference) - sourcedValue,
    -MODEL_INFERENCE_MAX_SWING,
    MODEL_INFERENCE_MAX_SWING,
  )

  return {
    value: clamp(sourcedValue + inferenceSwing, 0, 100),
    pinned: false,
    inferenceSwing,
    claimIds,
    primaryClaimCount,
  }
}
