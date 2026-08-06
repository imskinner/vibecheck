/**
 * Canvas extraction, v1. PRD §5.1.
 *
 * Freeform description (or pasted landing-page text) → structured IdeaCanvas. The output is shown
 * to the founder for correction before research runs — garbage-in is the #1 quality failure mode,
 * and this stage decides what "in" is.
 *
 * Prompts are code. Each section carries the failure mode it defends against.
 */

export const PROMPT_ID = 'extract-canvas'
export const PROMPT_VERSION = 'v1'

/** Extraction is a reading task; §8 assigns it the cheaper model. Pinned. */
export const MODEL_ID = 'claude-sonnet-5'

/**
 * Defends against: the model improving the idea while structuring it. A laundered canvas tests
 * the model's hypothesis instead of the founder's — every downstream stage would then validate
 * an idea nobody actually holds, and the correction step becomes theatre because the founder
 * cannot spot a subtle upgrade of their own thinking.
 */
const ROLE = `You extract the founder's idea into a structured canvas. You do not improve it.

Preserve their framing, their vocabulary, and their scope — including the parts you think are
mistaken. If their wedge is vague, the canvas says the vague thing; the founder corrects it, not
you. A cleaned-up canvas that tests a better idea than the founder actually has is a failure of
this stage, not a favour.`

/**
 * Defends against: plausible filler. An invented ICP or price point reads as extracted fact and
 * sends the entire pipeline off to research a fabrication. "not stated" is a finding — it tells
 * the founder their input is missing something load-bearing.
 */
const NOT_STATED = `When the input does not state a field, write exactly "not stated".

Never fill a gap with a plausible guess. If no price appears, the business model is "not stated" —
not "likely subscription". A canvas hole the founder can see beats an invention they cannot.`

/**
 * Defends against: hedged enumerations ("the ICP is X, or possibly Y, or maybe Z"), which
 * downstream stages cannot generate falsifiable assumptions against. One primary hypothesis per
 * field; the founder promotes an alternative by editing the canvas.
 */
const ONE_HYPOTHESIS = `Each field carries ONE primary hypothesis, not a list of candidates.

If the input names several audiences, pick the one it treats as primary and state only that.
The canvas is the hypothesis under test, and a hypothesis with three ICPs is not testable.`

/**
 * Defends against: flattery reaching Founder Fit. The unfair advantage is user-supplied by
 * design (see lib/canvas/types.ts) — the tool schema below has no field for it, so this stage
 * cannot volunteer one even when the input brags. Do not add the field.
 */
const NO_ADVANTAGE = `Never state or infer a founder advantage, even when the input claims one.
That field is supplied by the founder directly through a separate step, on purpose.`

export const SYSTEM_PROMPT = [ROLE, NOT_STATED, ONE_HYPOTHESIS, NO_ADVANTAGE].join('\n\n')

export function renderUserMessage(rawInput: string): string {
  return ['Extract the canvas from this idea description:', '', rawInput].join('\n')
}

export const EMIT_CANVAS_TOOL = {
  name: 'emit_canvas',
  description: 'Emit the structured canvas. This is the only way to return output.',
  input_schema: {
    type: 'object',
    required: ['problem', 'icp_hypothesis', 'wedge_hypothesis', 'business_model', 'stage'],
    properties: {
      problem: {
        type: 'string',
        description: 'The pain, in the founder\'s framing. "not stated" if the input never says.',
      },
      icp_hypothesis: {
        type: 'string',
        description: 'The single primary customer hypothesis. "not stated" if absent.',
      },
      wedge_hypothesis: {
        type: 'string',
        description: 'The narrow entry the founder believes in, vague if theirs is vague. "not stated" if absent.',
      },
      business_model: {
        type: 'string',
        description: 'How it makes money, with pricing if given. "not stated" if absent.',
      },
      stage: {
        type: 'string',
        description: 'Where the founder is: pre-build, prototype, launched, revenue. "not stated" if absent.',
      },
    },
  },
} as const
