/**
 * Evidence intake extraction, v1. PRD §5.7.
 *
 * Conversation notes / transcript → primary-conversation claims mapped to assumptions. This is
 * the stage that feeds Evidence Quality, so it is the most attractive fabrication target in the
 * product: a claim minted here lifts the cap. The structural guarantees live in intake.ts — the
 * model cannot set a source type, and every claim must carry a quote that literally appears in
 * the transcript. The prompt's job is the judgement calls the structure cannot make.
 *
 * Prompts are code. Each section carries the failure mode it defends against.
 */

import type { Assumption } from '../../scoring/types'

export const PROMPT_ID = 'extract-evidence'
export const PROMPT_VERSION = 'v1'

/** Reading task, cheaper model per §8. Pinned. */
export const MODEL_ID = 'claude-sonnet-5'

/**
 * Defends against: scoring the founder's spin instead of the interviewee's account. Founders
 * write summaries like "she basically said she'd pay" — what the interviewee said was "maybe".
 * The evidence is the account, not the gloss.
 */
const ROLE = `You extract what interviewees actually said from a founder's conversation notes.

Record the interviewee's account, not the founder's interpretation of it. If the notes say
"she basically confirmed she'd pay" but the quoted words are "maybe, if it did X", the evidence
is the maybe. Where the founder's summary and the interviewee's words disagree, the words win.`

/**
 * Defends against: intent laundered into behaviour. The criterion arithmetic counts people who
 * DID the thing; "would pay" satisfies no metric. Mom Test, applied at extraction time.
 */
const PAST_BEHAVIOUR = `Distinguish past behaviour from stated intent, and record the stance
accordingly. An interviewee who HAS paid for a workaround supports a paid-for-a-workaround
assumption. One who says they WOULD is context — enthusiasm is not an observation, and the
pre-registered thresholds count observations.`

/**
 * Defends against: one enthusiastic interview arriving as five claims. The criterion counts
 * PEOPLE against a sample size; double-counting a person games the threshold.
 */
const ONE_PER_PERSON = `Emit at most ONE claim per interviewee per assumption.

If the same person supports an assumption three ways, that is one claim with the best quote.
Different interviewees are separate claims. Name them as the notes do ("Interviewee 2", "Dana",
"the second call") in the claim text.`

/**
 * Defends against: paraphrase drift. The quote is what the fabrication check verifies and what
 * the founder sees when they audit a status change; a reworded quote breaks both.
 */
const QUOTE = `Every claim carries a QUOTE: the interviewee's words, copied verbatim from the
notes. Copy the exact characters — the system rejects any quote it cannot find in the transcript.
The claim text paraphrases; the quote does not.`

/**
 * Defends against: manufacturing coverage. Most conversations touch two or three assumptions,
 * not all of them, and an intake that finds evidence for everything is inventing mappings.
 */
const EMPTY_IS_VALID = `Map claims only to assumptions the conversation actually bears on.

Emitting nothing for most assumptions is the normal case. A mapping that needs an argument is a
mapping to leave out — the founder approves these, and a stretched mapping they approve in bulk
poisons the score they came for.`

export const SYSTEM_PROMPT = [ROLE, PAST_BEHAVIOUR, ONE_PER_PERSON, QUOTE, EMPTY_IS_VALID].join('\n\n')

export function renderUserMessage(transcript: string, assumptions: Assumption[]): string {
  return [
    'THE ASSUMPTION LEDGER:',
    ...assumptions.map((a) => `[${a.id}] ${a.statement}`),
    '',
    'THE CONVERSATION NOTES:',
    transcript,
    '',
    'Extract primary-conversation claims. Reference assumptions by id; quote verbatim.',
  ].join('\n')
}

/**
 * Note what the schema does NOT contain: source_type, source_url, retrieved_at. Provenance is
 * code-owned in intake.ts — this stage cannot mint anything but a primary conversation, exactly
 * as extraction cannot fabricate a citation. Do not add those fields.
 */
export const EMIT_EVIDENCE_TOOL = {
  name: 'emit_evidence',
  description: 'Emit primary-conversation claims extracted from the notes. An empty list is valid.',
  input_schema: {
    type: 'object',
    required: ['claims'],
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          required: ['assumption_id', 'text', 'stance', 'confidence', 'quote'],
          properties: {
            assumption_id: { type: 'string', description: 'The id exactly as listed in the ledger.' },
            text: {
              type: 'string',
              description: 'One sentence: who reported what. "Interviewee 2 has paid $30/mo for X since March."',
            },
            stance: { type: 'string', enum: ['supports', 'refutes', 'context'] },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'high = first-hand and specific; medium = paraphrased or second-hand; low = vague.',
            },
            quote: {
              type: 'string',
              description: "The interviewee's words, verbatim from the notes. Rejected if not found there.",
            },
          },
        },
      },
    },
  },
} as const
