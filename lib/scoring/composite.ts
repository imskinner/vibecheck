/**
 * Sub-scores, the Evidence Quality cap, and the composite. PRD §5.8.3 / §5.8.5.
 *
 * The whole module is a pure function of the ledger — no clock, no I/O, no randomness. A model
 * never produces a number here; it produces the structured inputs this arithmetic runs on. That
 * split is what makes score movements attributable to specific claims and what keeps a paraphrase
 * from moving the arithmetic. See PRD §5.8.
 */

import {
  BAND_COEFFICIENT,
  CAP_FLOOR,
  CAP_SLOPE,
  CATEGORY_TO_SUB_SCORE,
  NEUTRAL_SUPPORT,
  SUB_SCORE_WEIGHTS,
} from './constants'
import { assumptionCoverage, evidenceQuality, groupClaims } from './evidence-quality'
import { assumptionSupport } from './support'
import {
  SUB_SCORE_KEYS,
  type AssumptionContribution,
  type AssumptionStatus,
  type Ledger,
  type ScoreResult,
  type SubScore,
  type SubScoreKey,
} from './types'

/** `mixed` counts as unresolved: conflicting primary claims is not a verdict. */
const isResolved = (status: AssumptionStatus) => status === 'supported' || status === 'refuted'

export function scoreLedger(ledger: Ledger): ScoreResult {
  const byAssumption = groupClaims(ledger)

  const contributions: AssumptionContribution[] = ledger.assumptions.map((assumption) => {
    const claims = byAssumption.get(assumption.id) ?? []
    const support = assumptionSupport(assumption, claims)
    return {
      assumption_id: assumption.id,
      category: assumption.category,
      origin: assumption.origin,
      subScore: CATEGORY_TO_SUB_SCORE[assumption.category],
      impact: assumption.impact,
      support: support.value,
      pinned: support.pinned,
      inferenceSwing: support.inferenceSwing,
      claimIds: support.claimIds,
      primaryClaimCount: support.primaryClaimCount,
      coverage: assumptionCoverage(assumption, claims),
    }
  })

  const statusById = new Map(ledger.assumptions.map((a) => [a.id, a.status]))
  const subScores = {} as Record<SubScoreKey, SubScore>
  for (const key of SUB_SCORE_KEYS) {
    subScores[key] = computeSubScore(
      contributions.filter((c) => c.subScore === key),
      statusById,
    )
  }

  const weightedMean = SUB_SCORE_KEYS.reduce(
    (total, key) => total + SUB_SCORE_WEIGHTS[key] * subScores[key].value,
    0,
  )

  const eq = evidenceQuality(ledger)
  const cap = CAP_FLOOR + CAP_SLOPE * eq
  const composite = Math.min(weightedMean, cap)

  return {
    subScores,
    evidenceQuality: eq,
    weightedMean,
    cap,
    capBinding: cap < weightedMean,
    composite,
    contributions,
  }
}

function computeSubScore(
  contributions: AssumptionContribution[],
  statusById: Map<string, AssumptionStatus>,
): SubScore {
  // No assumption maps here. 50 is a placeholder for "not investigated", flagged as such so the
  // report can say so rather than presenting an average nobody computed.
  if (contributions.length === 0) {
    return {
      value: NEUTRAL_SUPPORT,
      band: BAND_COEFFICIENT,
      uncovered: true,
      unresolvedImpactFraction: 1,
    }
  }

  let totalImpact = 0
  let weightedSupport = 0
  let unresolvedImpact = 0
  for (const c of contributions) {
    totalImpact += c.impact
    weightedSupport += c.impact * c.support
    if (!isResolved(statusById.get(c.assumption_id) ?? 'untested')) unresolvedImpact += c.impact
  }

  const unresolvedImpactFraction = totalImpact === 0 ? 1 : unresolvedImpact / totalImpact

  return {
    value: totalImpact === 0 ? NEUTRAL_SUPPORT : weightedSupport / totalImpact,
    band: BAND_COEFFICIENT * unresolvedImpactFraction,
    uncovered: false,
    unresolvedImpactFraction,
  }
}
