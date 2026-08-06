/**
 * Evidence Quality. PRD §5.8.4.
 *
 * EQ answers one question: do the assumptions that actually carry this idea have primary evidence
 * behind them? It is impact-weighted coverage, not a claim count and not a ratio — both of those
 * are trivially gamed by logging conversations against whichever assumption is cheapest to test.
 *
 * Only `primary_conversation` claims count. Desk research cannot raise EQ at all. That is the
 * mechanism behind the cap, and the reason the score is unflattering until the founder talks to
 * someone.
 */

import { DEFAULT_SAMPLE_SIZE } from './constants'
import type { Assumption, Claim, Ledger } from './types'

/** Fraction of the pre-registered sample size that has actually been collected, capped at 1. */
export function assumptionCoverage(assumption: Assumption, claims: Claim[]): number {
  const declared = assumption.falsification_criterion.sample_size
  // A generator emitting 0 or a negative sample size must not produce Infinity or NaN.
  const sampleSize = Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_SAMPLE_SIZE
  const primary = claims.filter((c) => c.source_type === 'primary_conversation').length
  return Math.min(1, primary / sampleSize)
}

export function evidenceQuality(ledger: Ledger): number {
  const byAssumption = groupClaims(ledger)

  let totalImpact = 0
  let coveredImpact = 0
  for (const assumption of ledger.assumptions) {
    totalImpact += assumption.impact
    coveredImpact += assumption.impact * assumptionCoverage(assumption, byAssumption.get(assumption.id) ?? [])
  }

  if (totalImpact === 0) return 0
  return 100 * (coveredImpact / totalImpact)
}

/**
 * Indexes claims by assumption. Claims pointing at an assumption that is not in the ledger are
 * dropped — an orphaned claim left over from a removed assumption must never quietly contribute.
 */
export function groupClaims(ledger: Ledger): Map<string, Claim[]> {
  const known = new Set(ledger.assumptions.map((a) => a.id))
  const grouped = new Map<string, Claim[]>()
  for (const claim of ledger.claims) {
    if (!known.has(claim.assumption_id)) continue
    const bucket = grouped.get(claim.assumption_id)
    if (bucket) bucket.push(claim)
    else grouped.set(claim.assumption_id, [claim])
  }
  return grouped
}
