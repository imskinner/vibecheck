/**
 * Score movement between two snapshots. PRD §5.7, §5.8.
 *
 * This is what renders "your Market Access score moved 41 → 58 because of 3 new primary claims".
 * The attribution has to be exact, not narrated: removing the cited claims and rescoring must
 * reproduce the earlier numbers precisely (PRD §5.8.6 invariant 4).
 */

import { SUB_SCORE_KEYS, type ScoreResult, type SubScoreKey } from './types'

export interface ScoreMovement {
  compositeDelta: number
  evidenceQualityDelta: number
  capDelta: number
  subScoreDeltas: Record<SubScoreKey, number>
  /** Claim ids present in the later score but not the earlier one. */
  newClaimIds: string[]
  removedClaimIds: string[]
}

const claimIdsOf = (result: ScoreResult): Set<string> =>
  new Set(result.contributions.flatMap((c) => c.claimIds))

export function diffScores(before: ScoreResult, after: ScoreResult): ScoreMovement {
  const beforeIds = claimIdsOf(before)
  const afterIds = claimIdsOf(after)

  const subScoreDeltas = {} as Record<SubScoreKey, number>
  for (const key of SUB_SCORE_KEYS) {
    subScoreDeltas[key] = after.subScores[key].value - before.subScores[key].value
  }

  return {
    compositeDelta: after.composite - before.composite,
    evidenceQualityDelta: after.evidenceQuality - before.evidenceQuality,
    capDelta: after.cap - before.cap,
    subScoreDeltas,
    newClaimIds: [...afterIds].filter((id) => !beforeIds.has(id)),
    removedClaimIds: [...beforeIds].filter((id) => !afterIds.has(id)),
  }
}
