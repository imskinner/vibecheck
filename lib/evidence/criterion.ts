/**
 * Falsification-criterion arithmetic. PRD §5.2.2.
 *
 * Status resolution is deterministic, never a model judgement. The criterion was fixed when the
 * assumption was created; once enough primary conversations accumulate, this module evaluates it
 * and the verdict follows mechanically. The LLM's role at intake is limited to extracting claims
 * and proposing which assumption they attach to — the user approves the mapping, and this
 * arithmetic decides.
 *
 * READING A CRITERION: it states the observation that REFUTES. §5.6.5's example — "if fewer than
 * 4 of 10 say they've paid for a workaround, mark refuted" — is comparator '<', threshold 4:
 * when compare(observed_count, comparator, threshold) is true, the assumption is refuted;
 * when the sample is complete and it is false, supported. A red-team criterion reads the same
 * way: "no incumbent ships X" with comparator '>=', threshold 1 is refuted the moment one does.
 *
 * The observed count is the number of primary-conversation claims whose stance is `supports` —
 * the extraction stage records stance relative to the assumption as written, so one interviewee
 * satisfying the predicate arrives as exactly one supporting primary claim.
 */

import type { Assumption, AssumptionStatus, Claim, Comparator } from '../scoring/types'

export interface CriterionEvaluation {
  /** True once the pre-registered sample size has been reached. */
  resolved: boolean
  proposedStatus: AssumptionStatus
  /** Primary-conversation claims with a stance. Context claims and all desk research excluded. */
  primaryCount: number
  supportsCount: number
  refutesCount: number
  /** The arithmetic, in words, for the audit trail. */
  explanation: string
}

const COMPARE: Record<Comparator, (count: number, threshold: number) => boolean> = {
  '<': (c, t) => c < t,
  '<=': (c, t) => c <= t,
  '>': (c, t) => c > t,
  '>=': (c, t) => c >= t,
}

export function evaluateCriterion(assumption: Assumption, claims: Claim[]): CriterionEvaluation {
  const criterion = assumption.falsification_criterion

  // Only primary conversations count, and only ones that take a side. Desk research cannot
  // resolve a criterion no matter how much of it accumulates — that is the entire point of
  // pre-registering a human sample size.
  const primary = claims.filter(
    (c) =>
      c.assumption_id === assumption.id &&
      c.source_type === 'primary_conversation' &&
      c.stance !== 'context',
  )
  const supportsCount = primary.filter((c) => c.stance === 'supports').length
  const refutesCount = primary.length - supportsCount

  if (primary.length < criterion.sample_size) {
    const proposedStatus: AssumptionStatus =
      supportsCount > 0 && refutesCount > 0 ? 'mixed' : 'untested'
    return {
      resolved: false,
      proposedStatus,
      primaryCount: primary.length,
      supportsCount,
      refutesCount,
      explanation:
        `${primary.length} of ${criterion.sample_size} pre-registered conversations logged` +
        (proposedStatus === 'mixed' ? `; they conflict (${supportsCount} support, ${refutesCount} refute)` : '') +
        ' — criterion not yet evaluated',
    }
  }

  const refuted = COMPARE[criterion.comparator](supportsCount, criterion.threshold)
  return {
    resolved: true,
    proposedStatus: refuted ? 'refuted' : 'supported',
    primaryCount: primary.length,
    supportsCount,
    refutesCount,
    explanation:
      `${criterion.metric}: observed ${supportsCount} of ${primary.length}; ` +
      `refutation condition "${criterion.comparator} ${criterion.threshold}" is ${refuted ? 'met' : 'not met'} ` +
      `→ ${refuted ? 'refuted' : 'supported'}`,
  }
}
