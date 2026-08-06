/**
 * Separation statistics. PRD §7, §7.2.
 *
 * The target metric is separation between known-dead and known-successful ideas — reported as
 * mean difference and overlap, not as an accuracy percentage.
 *
 * The sample-size floor is enforced here rather than left to the reader. At 5-vs-5 nothing is
 * detectable; you would need an effect size around d ≈ 2.0, and a scoring function that separates
 * dead from successful startups that cleanly means the golden set is wrong, not that the function
 * is right. Below the floor this returns `insufficient_n` and no numbers at all — the discipline
 * has to be a property of the tool, not something to remember when the numbers look tempting.
 */

export const MIN_N_FOR_SEPARATION = 20
export const MIN_PER_GROUP = 2

export type Outcome = 'died' | 'succeeded'

export interface ScoredEntry {
  id: string
  outcome: Outcome
  composite: number
}

export interface InsufficientN {
  status: 'insufficient_n'
  n: number
  nDied: number
  nSucceeded: number
  required: number
  reason: string
}

export interface Separation {
  status: 'ok'
  n: number
  nDied: number
  nSucceeded: number
  meanDied: number
  meanSucceeded: number
  meanDifference: number
  cohensD: number
  /**
   * Proportion of (died, succeeded) pairs where the dead idea scored at least as high as the
   * successful one. 0 is perfect separation; 0.5 is no signal at all.
   */
  overlap: number
}

export type SeparationReport = InsufficientN | Separation

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function variance(xs: number[], m: number): number {
  if (xs.length < 2) return 0
  return xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1)
}

export function separation(entries: ScoredEntry[]): SeparationReport {
  const died = entries.filter((e) => e.outcome === 'died').map((e) => e.composite)
  const succeeded = entries.filter((e) => e.outcome === 'succeeded').map((e) => e.composite)
  const n = died.length + succeeded.length

  if (n < MIN_N_FOR_SEPARATION || died.length < MIN_PER_GROUP || succeeded.length < MIN_PER_GROUP) {
    return {
      status: 'insufficient_n',
      n,
      nDied: died.length,
      nSucceeded: succeeded.length,
      required: MIN_N_FOR_SEPARATION,
      reason:
        n < MIN_N_FOR_SEPARATION
          ? `need at least ${MIN_N_FOR_SEPARATION} scored entries, have ${n}`
          : `need at least ${MIN_PER_GROUP} entries in each outcome group`,
    }
  }

  const meanDied = mean(died)
  const meanSucceeded = mean(succeeded)
  const pooledVariance =
    ((died.length - 1) * variance(died, meanDied) + (succeeded.length - 1) * variance(succeeded, meanSucceeded)) /
    (died.length + succeeded.length - 2)
  const pooledSd = Math.sqrt(pooledVariance)
  const meanDifference = meanSucceeded - meanDied

  let pairsOverlapping = 0
  for (const d of died) for (const s of succeeded) if (d >= s) pairsOverlapping++

  return {
    status: 'ok',
    n,
    nDied: died.length,
    nSucceeded: succeeded.length,
    meanDied,
    meanSucceeded,
    meanDifference,
    cohensD: pooledSd === 0 ? (meanDifference === 0 ? 0 : Infinity) : meanDifference / pooledSd,
    overlap: pairsOverlapping / (died.length * succeeded.length),
  }
}
