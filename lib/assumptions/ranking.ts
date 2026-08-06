/**
 * Kill-shot ranking. PRD §4 step 5.
 *
 * Top assumptions by impact × uncertainty × cheapness-to-test. This ordering decides what the
 * Discovery Pack sends the founder to go and test, which makes it the single place where a
 * miscalibrated rating does the most damage — an arbitrary ranking sends someone to spend a week
 * testing the wrong thing.
 *
 * Pure and deterministic, like scoring. No clock, no randomness, and a total order so that two
 * runs over the same ledger cannot disagree about what to test first.
 */

import type { Assumption, AssumptionStatus } from '../scoring/types'

/** Cheapness is the inverse of test_cost: an afternoon (1) is worth 5, months (5) is worth 1. */
const RATING_CEILING = 6

export interface RankedAssumption {
  assumption: Assumption
  killShotScore: number
  /** 1-based position after ranking. */
  rank: number
}

export function killShotScore(assumption: Assumption): number {
  return assumption.impact * assumption.uncertainty * (RATING_CEILING - assumption.test_cost)
}

/**
 * A resolved assumption is not a kill-shot candidate — its criterion has already been evaluated,
 * so there is nothing left to go and find out. `mixed` stays in: conflicting primary evidence is
 * not a verdict, and it is often the most urgent thing to resolve.
 */
const isCandidate = (status: AssumptionStatus) => status === 'untested' || status === 'mixed'

export function rankKillShots(assumptions: Assumption[], limit?: number): RankedAssumption[] {
  const ranked = assumptions
    .filter((a) => isCandidate(a.status))
    .map((assumption) => ({ assumption, killShotScore: killShotScore(assumption), rank: 0 }))
    .sort(compare)
    .map((entry, index) => ({ ...entry, rank: index + 1 }))

  return limit === undefined ? ranked : ranked.slice(0, limit)
}

/**
 * Total order. The tie-breaks matter: without them the result depends on input order, and the
 * plan would differ between a fresh run and a re-run over the same stored ledger.
 */
function compare(a: Omit<RankedAssumption, 'rank'>, b: Omit<RankedAssumption, 'rank'>): number {
  if (b.killShotScore !== a.killShotScore) return b.killShotScore - a.killShotScore
  // Prefer the more fatal one when the product ties — being wrong about it costs more.
  if (b.assumption.impact !== a.assumption.impact) return b.assumption.impact - a.assumption.impact
  if (b.assumption.uncertainty !== a.assumption.uncertainty) {
    return b.assumption.uncertainty - a.assumption.uncertainty
  }
  if (a.assumption.test_cost !== b.assumption.test_cost) {
    return a.assumption.test_cost - b.assumption.test_cost
  }
  return a.assumption.id < b.assumption.id ? -1 : a.assumption.id > b.assumption.id ? 1 : 0
}
