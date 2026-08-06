/**
 * Red-team critic, v1. PRD §5.4, §5.4.1.
 *
 * The adversarial pass whose only instruction is to argue the idea is dead. Its output contract
 * is the most important design decision in the pipeline: IT EMITS ASSUMPTIONS, NEVER CLAIMS.
 * A correct red-team insight becomes an assumption, desk research goes and finds the receipt, and
 * the score moves through the front door. A wrong one fails to find support and stays untested
 * instead of becoming a scored artifact.
 *
 * Prompts are code. Each section carries the failure mode it defends against.
 */

import type { IdeaCanvas } from '../../../canvas/types'
import type { Assumption } from '../../../scoring/types'

export const PROMPT_ID = 'red-team'
export const PROMPT_VERSION = 'v1'

/**
 * Pinned. Adversarial critique is the reasoning-heavy stage §8 assigns the stronger model —
 * a weak red team is worse than none, because it launders the idea as "adversarially reviewed".
 */
export const MODEL_ID = 'claude-opus-5'

/**
 * Defends against: the structural sycophancy of single-shot reports. This stage exists because
 * models reflexively balance criticism with praise; the role permits no praise.
 */
const ROLE = `You are the red team. Your only job is to find the ways this idea is already dead.

Name the incumbent that already does this. Name why this ICP will not switch. Name the
distribution channel that is closed, the regulation that blocks it, the dependency that will be
revoked, the unit economics that cannot work. You are not asked to be balanced and you are not
asked whether the idea is good. The founder's own framing has blind spots; you cover the negative
space it cannot see.`

/**
 * Defends against: the red team writing evidence. It has no retrieval; anything it asserts as
 * fact is confabulation wearing a serious voice, and models invent incumbents and features
 * constantly. Phrased as assumptions, a wrong threat dies quietly in research instead of
 * subtracting points. This is the §5.4.1 contract, stated to the model in its own terms.
 */
const OUTPUT_CONTRACT = `You produce ASSUMPTIONS TO TEST, never facts, evidence, or citations.

You have not looked anything up. If you believe an incumbent already ships this, you must express
it as a testable assumption — "No incumbent scheduling tool ships X within 12 months" — never as
a statement that they do. Do not cite sources, statistics, or market sizes. Every threat you name
must arrive as a statement that research can go and check.`

/**
 * Defends against: restating the founder's own risks back at them. The red team's value is the
 * negative space — the ledger is shown so the model attacks what is NOT already on it.
 */
const NEGATIVE_SPACE = `The founder's current assumption ledger is listed below. Do not restate it.

Your job is what is missing: the death the founder has not thought to test. If the ledger already
covers competition, find the regulatory death. If it covers reach, find the switching-cost death.
Emit between 2 and 6 new assumptions — fewer, sharper threats beat a padded list.`

/**
 * Defends against: unfalsifiable doom ("the market is too crowded"), which is as useless as
 * unfalsifiable hope. Checked in code; failures are regenerated.
 */
const FALSIFIABILITY = `Every statement MUST be falsifiable, by the same three rules as any assumption:

1. A NAMED POPULATION — specific and countable, never "users" or "the market".
2. AN OBSERVABLE PREDICATE — past or present behaviour someone could witness or measure.
3. A THRESHOLD — a quantity such that a specific observation would contradict the statement.

"The space is too competitive" is unfalsifiable doom and will be rejected. "No incumbent booking
system ships automated backfill within 12 months" is a threat research can kill or confirm.`

/**
 * Defends against: every red-team rating arriving as 5/5. High impact and high uncertainty are
 * typical here BY CONSTRUCTION — an inflated rating adds nothing and corrupts kill-shot ranking.
 */
const CALIBRATION = `Rate honestly on the 1-5 scales. Red-team assumptions tend to be high impact and
high uncertainty because they are untested threats — but a threat you consider survivable must be
rated as one. An inflated rating does not make the threat more real; it sends the founder to test
the wrong thing first.`

/**
 * Defends against: silently disagreeing with the founder's confidence. If an existing assumption
 * is rated more certain than the red team believes, the mechanism is a proposed raise with a
 * reason — never a rewrite of the founder's ledger, and never a decrease (the red team's job is
 * doubt; lowering uncertainty is the synthesizer's business, on evidence).
 */
const UNCERTAINTY_RAISES = `If an EXISTING ledger assumption is rated less uncertain than you believe it
is, propose an uncertainty raise for it, with a one-sentence reason. Propose raises only — never
a decrease. Reference the assumption by its id exactly as listed.`

/**
 * Defends against: the model emitting a verdict. Scoring is deterministic and downstream; a
 * red-team "this idea scores 20" would be model opinion wearing arithmetic's clothes.
 */
const NO_SCORES = `Never output a score, a probability of failure, or an overall verdict on the idea.
You surface the ways it dies; whether it is dying is computed from evidence you do not have.`

export const SYSTEM_PROMPT = [
  ROLE,
  OUTPUT_CONTRACT,
  NEGATIVE_SPACE,
  FALSIFIABILITY,
  CALIBRATION,
  UNCERTAINTY_RAISES,
  NO_SCORES,
].join('\n\n')

export function renderUserMessage(canvas: IdeaCanvas, ledger: Assumption[]): string {
  return [
    'Red-team this idea. Find the deaths the ledger below does not cover.',
    '',
    `PROBLEM: ${canvas.problem}`,
    `ICP HYPOTHESIS: ${canvas.icp_hypothesis}`,
    `WEDGE HYPOTHESIS: ${canvas.wedge_hypothesis}`,
    `BUSINESS MODEL: ${canvas.business_model}`,
    `STAGE: ${canvas.stage}`,
    '',
    'CURRENT ASSUMPTION LEDGER:',
    ...ledger.map(
      (a) =>
        `- [${a.id}] (${a.category}, impact ${a.impact}, uncertainty ${a.uncertainty}) ${a.statement}`,
    ),
  ].join('\n')
}

/** Same regeneration-not-repair rule as the generator, stated against this stage's failures. */
export function renderRegenerationMessage(
  failed: { statement: string; reasons: string[] }[],
  keptStatements: string[],
): string {
  return [
    'Some of your red-team statements failed the falsifiability check and must be REPLACED.',
    'Write a completely new statement for each — do not patch the old wording. Unfalsifiable',
    'doom is as useless to the founder as unfalsifiable hope.',
    '',
    'FAILED STATEMENTS:',
    ...failed.flatMap((f) => [
      `- "${f.statement}"`,
      ...f.reasons.map((reason) => `    failed because: ${reason}`),
    ]),
    '',
    'Already emitted and kept — do not duplicate:',
    ...keptStatements.map((s) => `- "${s}"`),
    '',
    `Emit exactly ${failed.length} replacement(s) in new_assumptions. Propose no further uncertainty raises.`,
  ].join('\n')
}

const ASSUMPTION_ITEM_SCHEMA = {
  type: 'object',
  required: ['statement', 'category', 'impact', 'uncertainty', 'test_cost', 'falsification_criterion'],
  properties: {
    statement: {
      type: 'string',
      description: 'Named population + observable predicate + threshold. Rejected and regenerated otherwise.',
    },
    category: {
      type: 'string',
      enum: ['problem', 'icp', 'willingness_to_pay', 'access', 'competition', 'execution', 'timing'],
    },
    impact: { type: 'integer', minimum: 1, maximum: 5 },
    uncertainty: { type: 'integer', minimum: 1, maximum: 5 },
    test_cost: { type: 'integer', minimum: 1, maximum: 5 },
    falsification_criterion: {
      type: 'object',
      required: ['applies_to', 'observation', 'metric', 'comparator', 'threshold', 'sample_size'],
      properties: {
        applies_to: { type: 'string' },
        observation: { type: 'string' },
        metric: { type: 'string' },
        comparator: { type: 'string', enum: ['<', '<=', '>', '>='] },
        threshold: { type: 'number' },
        sample_size: { type: 'integer', minimum: 1 },
      },
    },
  },
} as const

/**
 * Note what this schema does NOT contain: any field for claims, sources, URLs, or evidence.
 * The red team's inability to write a claim is structural, exactly as extraction's inability to
 * fabricate a citation is. Do not add such a field.
 */
export const RED_TEAM_TOOL = {
  name: 'emit_red_team_findings',
  description:
    'Emit new assumptions covering deaths the ledger misses, and any uncertainty raises for existing assumptions. This is the only way to return output.',
  input_schema: {
    type: 'object',
    required: ['new_assumptions'],
    properties: {
      new_assumptions: { type: 'array', minItems: 2, maxItems: 6, items: ASSUMPTION_ITEM_SCHEMA },
      uncertainty_raises: {
        type: 'array',
        items: {
          type: 'object',
          required: ['assumption_id', 'uncertainty', 'reason'],
          properties: {
            assumption_id: { type: 'string', description: 'The id exactly as listed in the ledger.' },
            uncertainty: { type: 'integer', minimum: 1, maximum: 5, description: 'The proposed new rating. Raises only.' },
            reason: { type: 'string', description: 'One sentence on why the founder is more uncertain than they think.' },
          },
        },
      },
    },
  },
} as const

export function regenerationTool(count: number): {
  name: string
  description: string
  input_schema: unknown
} {
  return {
    name: RED_TEAM_TOOL.name,
    description: `Emit exactly ${count} replacement assumption(s) in new_assumptions. This is the only way to return output.`,
    input_schema: {
      type: 'object',
      required: ['new_assumptions'],
      properties: {
        new_assumptions: { type: 'array', minItems: count, maxItems: count, items: ASSUMPTION_ITEM_SCHEMA },
      },
    },
  }
}
