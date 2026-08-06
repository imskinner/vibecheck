/**
 * Competitive landscape, v1. PRD §5.10.
 *
 * Maps who already occupies or contests the wedge: named players, their threat to THIS idea, and
 * a positioning quadrant on axes chosen for this wedge specifically. The output is a REPORT
 * artifact — it never feeds the deterministic score (the Competitive Wedge sub-score continues to
 * come only from assumptions and claims). Placements grounded in research claims cite them;
 * placements from model knowledge are labelled inference by code and rendered distinct per §5.3.
 *
 * Prompts are code. Each section carries the failure mode it defends against.
 */

import type { IdeaCanvas } from '../../canvas/types'
import type { Claim, Ledger } from '../../scoring/types'

export const PROMPT_ID = 'map-competitors'
export const PROMPT_VERSION = 'v1'

/** Synthesis-adjacent judgement over the whole research record — the stronger model, per §8. */
export const MODEL_ID = 'claude-opus-5'

/**
 * Defends against: the flattering map. A landscape drawn to leave the idea in open water is the
 * competitive version of sycophancy, and it is the default failure of asking a model where an
 * idea "fits". The brief is the red team's, applied to positioning.
 */
const ROLE = `You map the competitive landscape around one idea's wedge — as the person trying to
prove the wedge is already taken.

Include the players a hopeful founder would leave off: the incumbent whose free tier quietly
covers this, the platform one changelog entry away, the open-source project, and the strongest
competitor of all — the way people already cope (a spreadsheet, an intern, doing nothing).`

/**
 * Defends against: fabricated specificity. The research record is in front of you; a competitor
 * it mentions is evidence, a competitor from memory is your recollection. Both are welcome, but
 * they must not look the same — cite claim ids where they exist, cite nothing where they do not,
 * and the system labels each entry accordingly. Never invent a company, a funding figure, or a
 * feature to make an entry look researched.
 */
const EVIDENCE_FIRST = `Ground entries in the research record wherever it mentions a competitor —
cite the claim ids. You may add well-known players the record missed, citing nothing; those are
labelled as your inference and shown differently. What you must never do is dress recall as
research: no invented companies, no guessed funding numbers, no features you are not sure shipped.`

/**
 * Defends against: generic axes. "Price vs quality" separates nobody and says nothing; the
 * inspiration for a good pair is the axes that make the wedge's emptiness FALSIFIABLE — whose
 * data you sit on, format-vs-detect, self-serve vs sold. If every player lands in one half, the
 * axes failed.
 */
const AXES = `Choose the two axes that best separate these players FOR THIS WEDGE — the pair that
makes "is this space actually empty" a checkable question. Name them concretely (not "value" or
"quality"). Place every competitor and the idea itself at 0–100 on each. If your axes put
everyone in the same half, they are the wrong axes; choose again.`

/**
 * Defends against: threat-by-size. The inspiration definition, kept verbatim in spirit: a
 * $200M platform with no motive to enter is less dangerous than a funded startup one pivot away.
 */
const THREAT = `Threat means ability AND motivation to occupy this wedge — never company size.
critical: could take the wedge with a shipped feature or already contests it.
high: has the assets and a visible motive.
medium: adjacent; would need a real pivot.
low: coexists or is a channel, not a rival.
One sentence of reason each, specific to this wedge.`

/**
 * Defends against: the model emitting a verdict. Whether the wedge survives is what the
 * assumptions exist to test; the landscape informs which assumption to test first, not the score.
 */
const NO_SCORES = `Never output a score, a survival probability, or an overall verdict. State
where the empty space is — or that there is none — and which entries contest it.`

export const SYSTEM_PROMPT = [ROLE, EVIDENCE_FIRST, AXES, THREAT, NO_SCORES].join('\n\n')

const claimLine = (c: Claim) => `[${c.id}] (${c.source_type}) ${c.text}`

export function renderUserMessage(canvas: IdeaCanvas, ledger: Ledger): string {
  return [
    'Map the competitive landscape for this idea.',
    '',
    `PROBLEM: ${canvas.problem}`,
    `ICP: ${canvas.icp_hypothesis}`,
    `WEDGE: ${canvas.wedge_hypothesis}`,
    `BUSINESS MODEL: ${canvas.business_model}`,
    '',
    'THE RESEARCH RECORD (cite claim ids from here where they ground an entry):',
    ...ledger.claims.filter((c) => c.source_type !== 'model_inference').map(claimLine),
  ].join('\n')
}

export const EMIT_LANDSCAPE_TOOL = {
  name: 'emit_competitive_landscape',
  description: 'Emit the competitive landscape. This is the only way to return output.',
  input_schema: {
    type: 'object',
    required: ['axes', 'idea_position', 'competitors', 'empty_space'],
    properties: {
      axes: {
        type: 'object',
        required: ['x_label', 'y_label'],
        properties: {
          x_label: { type: 'string', description: 'Concrete, wedge-specific. Not "value".' },
          y_label: { type: 'string' },
        },
      },
      idea_position: {
        type: 'object',
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', minimum: 0, maximum: 100 },
          y: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
      competitors: {
        type: 'array',
        minItems: 3,
        maxItems: 12,
        items: {
          type: 'object',
          required: ['name', 'what', 'category', 'threat', 'threat_reason', 'x', 'y', 'claim_ids'],
          properties: {
            name: { type: 'string' },
            what: { type: 'string', description: 'One line: what it is and whose data/workflow it owns.' },
            category: {
              type: 'string',
              enum: ['direct', 'adjacent', 'incumbent_feature', 'diy_substitute'],
            },
            threat: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            threat_reason: { type: 'string', description: 'Ability and motivation, specific to this wedge.' },
            x: { type: 'number', minimum: 0, maximum: 100 },
            y: { type: 'number', minimum: 0, maximum: 100 },
            claim_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Claim ids from the record that ground this entry. Empty if from your knowledge.',
            },
          },
        },
      },
      empty_space: {
        type: 'string',
        description: 'Where the uncontested position is — or the honest statement that there is none.',
      },
    },
  },
} as const
