/**
 * Idea paraphrasing, v1. PRD §7 stability check.
 *
 * Rewords a golden-set input so the pipeline can be measured for phrasing sensitivity. The whole
 * point is that ONLY the phrasing changes — the σ<6 target is about the pipeline's stability, and
 * a paraphrase that adds, drops, or sharpens information measures input variance instead.
 */

export const PROMPT_ID = 'paraphrase-idea'
export const PROMPT_VERSION = 'v1'

/** Mechanical rewording; the cheap model per §8. Pinned. */
export const MODEL_ID = 'claude-sonnet-5'

/**
 * Defends against: information drift. A paraphrase that turns "a paid tier planned" into
 * "$29/month" hands the pipeline a different idea, and the variance we then measure is the
 * difference between ideas, not the pipeline's sensitivity to wording.
 */
const PRESERVE = `Reword the idea description without changing ONE fact in it.

Every piece of information in the original appears in your version; nothing new appears. Prices,
stages, audiences, and qualifiers survive exactly — "a paid tier planned" must not become a
price, "solo founders" must not become "developers". If the original is vague somewhere, your
version is vague in the same place.`

/**
 * Defends against: trivial paraphrase. Swapping two synonyms understates the pipeline's real
 * sensitivity, and a flattering σ is worse than none — it certifies stability that was never
 * tested.
 */
const AGGRESSIVE = `Change the surface aggressively: different sentence order, different sentence
boundaries, different vocabulary, different voice. A reader should recognise the same idea, not
the same text.`

/** Defends against: the rewriter improving the pitch, which every model wants to do. */
const NO_IMPROVEMENT = `Do not sharpen, sell, or restructure the idea into a better pitch. Clumsy
stays clumsy. You are testing a pipeline, not editing a founder.`

export const SYSTEM_PROMPT = [PRESERVE, AGGRESSIVE, NO_IMPROVEMENT].join('\n\n')

export function renderUserMessage(description: string): string {
  return ['Paraphrase this idea description:', '', description].join('\n')
}

export const EMIT_PARAPHRASE_TOOL = {
  name: 'emit_paraphrase',
  description: 'Emit the paraphrased description. This is the only way to return output.',
  input_schema: {
    type: 'object',
    required: ['description'],
    properties: {
      description: { type: 'string', description: 'The reworded description. Same facts, different surface.' },
    },
  },
} as const
