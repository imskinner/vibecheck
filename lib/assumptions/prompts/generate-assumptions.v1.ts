/**
 * Assumption generation, v1. PRD §5.2.
 *
 * Prompts are code. Every instruction below sits behind a comment naming the failure mode it
 * defends against — an instruction whose failure mode nobody can name is an instruction nobody can
 * safely delete later, and this file will be edited by someone who was not here for the argument.
 *
 * The prompt is assembled from named sections rather than written as one literal so those comments
 * can exist at all. Changing any section requires an eval run (CLAUDE.md).
 *
 * NOT WIRED TO AN API. M0 has no LLM call anywhere in the codebase by design — the scoring
 * function's behaviour is pinned first. `npm run prompt:assumptions` renders this against a
 * hardcoded idea so it can be read and hand-tested. Wiring is M1.
 */

import type { IdeaCanvas } from '../../canvas/types'

export const PROMPT_ID = 'generate-assumptions'
export const PROMPT_VERSION = 'v1'

/**
 * Pinned, never "latest". An unpinned model makes every historical eval number uninterpretable
 * (PRD §8) and is recorded on the Report row. Assumption generation is the highest-leverage
 * reasoning stage in the pipeline, so it gets the strong model; revisit with eval data, not taste.
 */
export const MODEL_ID = 'claude-opus-5'

/**
 * Defends against: the register of every competitor in this category — an enthusiastic analyst
 * writing a report. That voice produces balanced-sounding prose and no testable claims.
 */
const ROLE = `You identify the assumptions that could kill a startup idea.

You are not writing a report, a summary, or an assessment. You are producing a list of specific
claims about the world that the founder currently believes, that they have not verified, and that
would be fatal if false. Nothing you write is for reassurance.`

/**
 * Defends against: exhaustive lists. Twenty assumptions cannot be ranked meaningfully and dilute
 * the kill-shot selection that the Discovery Pack depends on. Load-bearing means: if this is
 * false, the idea does not work — not "this would be good to know".
 */
const SCOPE = `Produce between 5 and 9 assumptions. Fewer is better than padding.

Include an assumption only if the idea fails when it is false. If the idea survives the assumption
being false, it is context, not an assumption, and you must leave it out.`

/**
 * Defends against: the single most common failure of this stage — statements that sound specific
 * and cannot be contradicted by any observation ("there is demand for X", "the market is growing").
 * These three properties are checked in code before your output is accepted, and a statement that
 * fails is regenerated from scratch rather than repaired.
 */
const FALSIFIABILITY = `Every statement MUST have all three of these properties:

1. A NAMED POPULATION. Specific and countable. "Freelance designers billing over $60/hr" is a
   population. "Users", "businesses", "teams", "founders" are not — they name no one.
2. AN OBSERVABLE PREDICATE. Something you could witness or measure. Past or present behaviour only.
3. A THRESHOLD. A quantity such that a specific observation would contradict the statement.

Test each statement by asking: what exact observation would prove this false? If you cannot name
one in a single sentence, the statement is not usable. Rewrite it from scratch — do not add
qualifiers to a vague statement, which produces a longer vague statement.

Good:  "Freelance designers billing over $60/hr lose more than 2 hours a week to file handoff"
Bad:   "Designers find file handoff frustrating"
Bad:   "There is meaningful demand for a better handoff tool"`

/**
 * Defends against: assumptions phrased as stated preference, which cannot be tested by interview.
 * Asking someone whether they would pay produces a yes and no information. Scoped deliberately:
 * forecasts about what a COMPANY will ship are observable and allowed.
 */
const MOM_TEST = `Phrase assumptions in terms of past behaviour, never stated intent.

"Would pay", "want", "are interested in", "see value in", "need" are all unusable — they describe
what someone says, not what they did. Ask instead what they have already paid for, already built,
already worked around, already cancelled.

This restriction applies to the customer. Predictions about what a competitor ships or how a
channel behaves are observable and are allowed.`

/**
 * Defends against: clustering every assumption in `problem`. Market Access is where products
 * actually die and models under-generate it, because problem assumptions are the easiest to write.
 * A ledger with no access assumption produces an uncovered Market Access sub-score, which is worse
 * than a wrong one — it looks like a finding and is a gap.
 */
const COVERAGE = `Spread assumptions across categories. Do not cluster them in 'problem'.

You MUST include at least one 'access' assumption — whether this specific population can be reached
repeatably and cheaply enough for the business model to work. This is the most commonly ignored
category and the most common cause of death. An idea with a real problem and no reachable channel
is dead.

Categories: problem, icp, willingness_to_pay, access, competition, execution, timing.`

/**
 * Defends against: thresholds drifting to match whatever the evidence turned out to be. The
 * criterion is fixed at creation and evaluated by code once the sample lands (PRD §5.2.2); the
 * founder never gets to reinterpret it afterwards, which is the entire mechanism that makes the
 * resulting score honest.
 */
const CRITERION = `Every assumption carries a falsification criterion, pre-registered now.

It must be answerable by a specific number of conversations with the named population, and it must
be a rule a stranger could apply to the results without judgement. Set sample_size to the number of
conversations actually required — usually between 4 and 12. A criterion needing 50 interviews is
not a criterion, it is a research project.

Example: metric "count who have paid for a workaround", comparator "<", threshold 4,
sample_size 10 — that is, fewer than 4 of 10 having paid refutes the assumption.`

/**
 * Defends against: every rating coming back 4 or 5, which destroys kill-shot ranking. The ranking
 * is impact × uncertainty × cheapness-to-test; if the ratings do not discriminate, the top-ranked
 * assumption is arbitrary and the Discovery Pack sends the founder to test the wrong thing.
 */
const CALIBRATION = `Rate each assumption on three 1–5 scales, and USE THE FULL RANGE.

impact       — if this is false, how dead is the idea? 5 = fatal, 1 = a setback.
uncertainty  — how little is currently known? 5 = pure guess, 1 = near-certain from public record.
test_cost    — 1 = one afternoon, 3 = a week, 5 = months.

If most of your ratings are 4 or 5, you have not discriminated and the output is unusable. Expect
a spread. Something in the list should be a 2.`

/**
 * Defends against: this stage inventing facts. It has no retrieval and no sources; anything it
 * asserts about the world is unverified. Claims are produced downstream by adapters that carry a
 * source_url and a retrieval snapshot — a fabricated fact entering here would bypass all of it.
 */
const NO_EVIDENCE = `Do not cite sources, statistics, company names as fact, or market sizes.

You have not looked anything up. You are generating hypotheses to be tested, not findings. If you
believe a specific incumbent already solves this, express it as an assumption to be checked
("no incumbent ships X within 12 months"), never as a statement of fact.`

/**
 * Defends against: the model emitting numbers that look like scores. Scoring is deterministic and
 * derived from this ledger (PRD §5.8); a model-authored score would silently bypass the Evidence
 * Quality cap, which is the product's entire premise.
 */
const NO_SCORES = `Never output a score, a rating out of 100, a confidence percentage, or a verdict
on whether the idea is good. Those are computed downstream from what you produce here.`

export const SYSTEM_PROMPT = [
  ROLE,
  SCOPE,
  FALSIFIABILITY,
  MOM_TEST,
  COVERAGE,
  CRITERION,
  CALIBRATION,
  NO_EVIDENCE,
  NO_SCORES,
].join('\n\n')

export function renderUserMessage(canvas: IdeaCanvas): string {
  const advantage = canvas.founder_unfair_advantage?.trim()
  return [
    'Generate the assumption ledger for this idea.',
    '',
    `PROBLEM: ${canvas.problem}`,
    `ICP HYPOTHESIS: ${canvas.icp_hypothesis}`,
    `WEDGE HYPOTHESIS: ${canvas.wedge_hypothesis}`,
    `BUSINESS MODEL: ${canvas.business_model}`,
    `STAGE: ${canvas.stage}`,
    // Absence is stated explicitly rather than omitted: a missing line invites the model to invent
    // an advantage, which would flatter Founder Fit on evidence that does not exist.
    `FOUNDER UNFAIR ADVANTAGE: ${advantage && advantage.length > 0 ? advantage : 'none stated by the founder — do not invent one'}`,
  ].join('\n')
}

/**
 * Forced tool call rather than free text. Defends against: prose wrapping, preamble, and the
 * markdown-fenced-JSON parsing failures that come with them.
 */
export const EMIT_ASSUMPTIONS_TOOL = {
  name: 'emit_assumptions',
  description: 'Emit the assumption ledger. This is the only way to return output.',
  input_schema: {
    type: 'object',
    required: ['assumptions'],
    properties: {
      assumptions: {
        type: 'array',
        minItems: 5,
        maxItems: 9,
        items: {
          type: 'object',
          required: [
            'statement',
            'category',
            'impact',
            'uncertainty',
            'test_cost',
            'falsification_criterion',
          ],
          properties: {
            statement: {
              type: 'string',
              description:
                'Named population + observable past-behaviour predicate + threshold. Regenerated if it fails any of the three.',
            },
            category: {
              type: 'string',
              enum: [
                'problem',
                'icp',
                'willingness_to_pay',
                'access',
                'competition',
                'execution',
                'timing',
              ],
            },
            impact: { type: 'integer', minimum: 1, maximum: 5 },
            uncertainty: { type: 'integer', minimum: 1, maximum: 5 },
            test_cost: { type: 'integer', minimum: 1, maximum: 5 },
            falsification_criterion: {
              type: 'object',
              required: [
                'applies_to',
                'observation',
                'metric',
                'comparator',
                'threshold',
                'sample_size',
              ],
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
        },
      },
    },
  },
} as const
