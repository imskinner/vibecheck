/**
 * Synthesizer. PRD §5.3, narrowed scope.
 *
 * The only stage permitted to mint `model_inference` claims, and its M1 job is exactly one thing:
 * recording the honest negative — "we looked, and found nothing either way" — for assumptions
 * that were researched and came back empty. Without it, an empty evidence list is ambiguous
 * between "not yet researched" and "researched, nothing found", and a report that cannot tell
 * those apart invites the reader to assume the flattering one.
 *
 * DELIBERATELY NOT A MODEL CALL. Whether research found nothing is a fact about the run, already
 * sitting in the orchestrator's output. Asking a model to restate it would add a confabulation
 * surface to the one stage whose entire purpose is not inventing things. §5.3's other sanctioned
 * synthesizer function — connecting two already-sourced claims — is model work, is not built yet,
 * and lands here when it is.
 *
 * The minted claim is stance 'context', which contributes zero to the support curve by
 * construction (STANCE_VALUE.context = 0). It exists for the report and the audit trail, not for
 * the score — an honest negative that moved a number would be model opinion in disguise.
 */

import type { Claim } from '../scoring/types'
import type { ResearchRun } from './orchestrator'

export interface SynthesizeOptions {
  /** ISO timestamp of the run, stamped on minted claims. Injected — no ambient clock. */
  retrievedAt: string
  makeClaimId?: (assumptionId: string) => string
}

const defaultId = (assumptionId: string) => `${assumptionId}-nothing-found`

/**
 * Mints one honest-negative claim per researched-but-empty assumption. Assumptions excluded from
 * the plan get nothing — they were not researched, and a "no evidence" claim on them would be
 * a lie of exactly the kind the distinction exists to prevent.
 */
export function synthesizeHonestNegatives(run: ResearchRun, options: SynthesizeOptions): Claim[] {
  const makeId = options.makeClaimId ?? defaultId

  return run.perAssumption
    .filter((p) => p.claims.length === 0)
    .map((p): Claim => {
      const searched = p.documents > 0 ? `${p.documents} retrieved document(s)` : 'the enabled sources'
      return {
        id: makeId(p.assumptionId),
        assumption_id: p.assumptionId,
        text: `Desk research found no evidence either way: ${searched} yielded no claim about this assumption.`,
        stance: 'context',
        source_url: null,
        source_type: 'model_inference',
        retrieved_at: options.retrievedAt,
        retrieved_text: null,
        confidence: 'low',
      }
    })
}
