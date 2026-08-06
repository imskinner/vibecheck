/**
 * Claim verification, v2. PRD §7 hallucination check; kill criterion 3.
 *
 * v1 → v2: the first live run of this checker produced five "unsupported" verdicts that each
 * said, in the judge's own words, that the snapshot matched the claim's content exactly — and
 * failed it on stance. The judge had been shown the claim and its stance but not the ASSUMPTION
 * the stance is relative to, so it read `refutes` as "snapshot vs claim text" when it means
 * "claim vs assumption". v2 shows the assumption and separates the two questions, because they
 * are different failure classes with different consequences:
 *
 *   · content   — does the snapshot back what the claim asserts? A NO here is fabrication,
 *                 the kill-criterion number.
 *   · stance    — given the assumption, is the recorded direction right? A NO here is a
 *                 miscategorisation by the extractor: real, score-corrupting, but not invention.
 *
 * Prompts are code. Each section carries the failure mode it defends against.
 */

export const PROMPT_ID = 'verify-claim'
export const PROMPT_VERSION = 'v2'

/** Reading task. Pinned per §8. */
export const MODEL_ID = 'claude-sonnet-5'

/**
 * Defends against: plausibility standing in for verification. A fabricated claim is usually a
 * PLAUSIBLE claim; the question is whether these words back that assertion, never whether the
 * assertion sounds right.
 */
const ROLE = `You verify a claim that a research pipeline extracted from a text snapshot.

The claim was recorded ABOUT an assumption: its stance says whether the claim makes that
assumption more likely true (supports) or more likely false (refutes). You are shown all three —
assumption, claim, snapshot — and you answer two separate questions. Whether anything here is
plausible or true in the world is irrelevant throughout; only these words count.`

/**
 * Defends against: the v1 failure. Stance is claim-vs-ASSUMPTION; a snapshot that backs the
 * claim's content while the claim refutes the assumption is the system working correctly.
 */
const TWO_QUESTIONS = `QUESTION 1 — CONTENT. Does the snapshot actually contain or state what the
claim asserts? Judge the claim's text against the snapshot's words, ignoring stance entirely.
A claim whose content the snapshot does not back is a fabrication, whatever its stance.

QUESTION 2 — STANCE. Given the assumption, is the recorded direction right? A claim reporting
"users distrust third parties with their data" correctly REFUTES an assumption that users will
grant that trust — the snapshot backing the claim's content is not a stance error. Answer
'inverted' only when the claim, as evidenced, pushes the assumption the OPPOSITE way from its
recorded stance.`

/**
 * Defends against: punishing truncation as fabrication, in either question. A snapshot cut
 * before the relevant passage is a measurement gap; conflating it with invention corrupts the
 * kill-criterion number.
 */
const INSUFFICIENT = `If the snapshot is too truncated or fragmentary to answer a question, say
'insufficient' / 'unclear' for that question rather than guessing in either direction.`

export const SYSTEM_PROMPT = [ROLE, TWO_QUESTIONS, INSUFFICIENT].join('\n\n')

export function renderUserMessage(
  assumptionStatement: string,
  claim: { text: string; stance: string },
  snapshot: string,
): string {
  return [
    `THE ASSUMPTION: ${assumptionStatement}`,
    '',
    `THE CLAIM (recorded as '${claim.stance}' toward that assumption): ${claim.text}`,
    '',
    'THE SNAPSHOT THE CLAIM CITES:',
    snapshot,
    '',
    'Answer both questions.',
  ].join('\n')
}

export const VERIFY_CLAIM_TOOL = {
  name: 'emit_verification',
  description: 'Emit both verdicts. This is the only way to return output.',
  input_schema: {
    type: 'object',
    required: ['content', 'stance', 'reason'],
    properties: {
      content: {
        type: 'string',
        enum: ['supported', 'unsupported', 'insufficient'],
        description:
          'Does the snapshot back what the claim asserts? unsupported = the snapshot does not contain it — fabrication.',
      },
      stance: {
        type: 'string',
        enum: ['correct', 'inverted', 'unclear'],
        description:
          'Given the assumption, is the recorded direction right? inverted = the evidence pushes the assumption the opposite way.',
      },
      reason: { type: 'string', description: 'One sentence pointing at the words that decide it.' },
    },
  },
} as const
