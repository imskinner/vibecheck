/**
 * Claim verification, v1. PRD §7 hallucination check; kill criterion 3.
 *
 * Judges whether a stored snapshot actually supports the claim extracted from it. Verifies
 * against `retrieved_text`, never the live URL — checking the web years later measures link rot,
 * not the model (PRD §5.3).
 *
 * Prompts are code. Each section carries the failure mode it defends against.
 */

export const PROMPT_ID = 'verify-claim'
export const PROMPT_VERSION = 'v1'

/** Reading task. Pinned per §8. */
export const MODEL_ID = 'claude-sonnet-5'

/**
 * Defends against: plausibility standing in for verification. A fabricated claim is usually a
 * PLAUSIBLE claim — that is what makes fabrication dangerous — so a judge that asks "does this
 * sound right?" passes exactly the claims this check exists to catch.
 */
const ROLE = `You verify that a text snapshot supports a claim extracted from it.

The only question is whether THESE WORDS support THAT CLAIM. Whether the claim is plausible,
likely, or true in the world is irrelevant — a true claim the snapshot does not contain is a
failure here, because the pipeline cited this snapshot as its source.`

/**
 * Defends against: direction-blind verification. A snapshot about the topic that says the
 * OPPOSITE still "matches" topically; the stance is part of what was asserted.
 */
const STANCE = `The claim was recorded with a stance. Verify the direction, not just the topic.

If the claim says a founder reports losing hours and the snapshot shows them saying the loss is
trivial, the snapshot does not support the claim — it contradicts it. Topical overlap is not
support.`

/**
 * Defends against: punishing truncation as fabrication. Snapshots are bounded (~1500 chars); a
 * snapshot that got cut before the relevant passage is a measurement gap, not a lie, and folding
 * the two together makes the fabrication rate uninterpretable.
 */
const INSUFFICIENT = `If the snapshot is too truncated or fragmentary to judge either way, say
'insufficient' — do not guess in either direction. Insufficient is counted separately from
fabrication; conflating them corrupts the one number this check exists to produce.`

export const SYSTEM_PROMPT = [ROLE, STANCE, INSUFFICIENT].join('\n\n')

export function renderUserMessage(claim: { text: string; stance: string }, snapshot: string): string {
  return [
    `THE CLAIM (recorded as '${claim.stance}'): ${claim.text}`,
    '',
    'THE SNAPSHOT IT CITES:',
    snapshot,
    '',
    'Does the snapshot support the claim as recorded?',
  ].join('\n')
}

export const VERIFY_CLAIM_TOOL = {
  name: 'emit_verification',
  description: 'Emit the verification verdict. This is the only way to return output.',
  input_schema: {
    type: 'object',
    required: ['verdict', 'reason'],
    properties: {
      verdict: {
        type: 'string',
        enum: ['supported', 'unsupported', 'insufficient'],
        description:
          'supported = the snapshot contains what the claim asserts, in the asserted direction. ' +
          'unsupported = it does not, or contradicts it. insufficient = too truncated to judge.',
      },
      reason: { type: 'string', description: 'One sentence pointing at the words that decide it.' },
    },
  },
} as const
