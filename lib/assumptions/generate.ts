/**
 * Canvas → assumption ledger. PRD §5.2.
 *
 * The first live LLM stage in the pipeline, and the one the σ<6 stability target ultimately hangs
 * on. Three rules are enforced in code rather than trusted to the prompt:
 *
 *   · `origin` and `status` are set here, never read from the model. A generator that could mark
 *     its own output 'supported' would bypass the entire evidence mechanism.
 *   · Statements that fail the falsifiability check are REGENERATED from scratch with the
 *     checker's complaints, never repaired in place, and never allowed into the ledger. A vague
 *     assumption is worse than a missing one — everything downstream scores against it.
 *   · Malformed emissions are rejected and reported, not coerced. Rejection counts are a
 *     prompt-quality signal the eval harness tracks.
 *
 * The lexical falsifiability check is the code half of PRD §5.2.1. The rubric-graded model pass
 * is the other half and is not built yet — until it is, "cannot detect a MISSING population" and
 * similar gaps documented in falsifiability.test.ts pass through this stage too.
 */

import type { IdeaCanvas } from '../canvas/types'
import type { ModelClient } from '../research/model'
import type { Assumption } from '../scoring/types'
import {
  parseEmittedAssumptions,
  partitionByFalsifiability,
  type RejectedEmission,
} from './emission'
import {
  EMIT_ASSUMPTIONS_TOOL,
  MODEL_ID,
  regenerationTool,
  renderRegenerationMessage,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './prompts/generate-assumptions.v1'

export type { RejectedEmission } from './emission'

export interface GenerateOptions {
  model: ModelClient
  /** Regeneration calls after the initial one. Each retries only the still-failing statements. */
  maxRegenerationRounds?: number
  makeAssumptionId?: (index: number) => string
  modelId?: string
}

export interface DiscardedStatement {
  statement: string
  failures: string[]
}

export interface GenerationResult {
  assumptions: Assumption[]
  /** Malformed emissions — wrong shape, not vague wording. */
  rejected: RejectedEmission[]
  /** Statements still unfalsifiable after the regeneration budget. Never enter the ledger. */
  discarded: DiscardedStatement[]
  regenerationRounds: number
  warnings: string[]
}

const MIN_ASSUMPTIONS = 5
const defaultId = (index: number) => `gen-a${index + 1}`

export async function generateAssumptions(
  canvas: IdeaCanvas,
  options: GenerateOptions,
): Promise<GenerationResult> {
  const modelId = options.modelId ?? MODEL_ID
  const maxRounds = options.maxRegenerationRounds ?? 2
  const makeId = options.makeAssumptionId ?? defaultId

  const rejected: RejectedEmission[] = []
  const warnings: string[] = []

  const initial = await options.model.callTool({
    modelId,
    system: SYSTEM_PROMPT,
    userMessage: renderUserMessage(canvas),
    tool: EMIT_ASSUMPTIONS_TOOL,
  })

  const parsed = parseEmittedAssumptions(initial, 'assumptions')
  rejected.push(...parsed.rejected)

  let { passing: kept, failing } = partitionByFalsifiability(parsed.valid)
  let rounds = 0

  while (failing.length > 0 && rounds < maxRounds) {
    rounds += 1
    const regen = await options.model.callTool({
      modelId,
      system: SYSTEM_PROMPT,
      userMessage: renderRegenerationMessage(
        canvas,
        kept.map((e) => e.statement),
        failing.map((f) => ({ statement: f.emitted.statement, reasons: f.reasons })),
      ),
      tool: regenerationTool(failing.length),
    })

    const reparsed = parseEmittedAssumptions(regen, 'assumptions')
    rejected.push(...reparsed.rejected)

    const next = partitionByFalsifiability(reparsed.valid)
    kept = [...kept, ...next.passing]
    // Only the fresh failures carry forward. The statements they replaced are gone either way —
    // regeneration is a rewrite, not an edit history.
    failing = next.failing
  }

  const discarded: DiscardedStatement[] = failing.map((f) => ({
    statement: f.emitted.statement,
    failures: f.reasons,
  }))

  const assumptions: Assumption[] = kept.map((e, index) => ({
    id: makeId(index),
    statement: e.statement,
    category: e.category,
    origin: 'canvas',
    impact: e.impact,
    uncertainty: e.uncertainty,
    test_cost: e.test_cost,
    status: 'untested',
    falsification_criterion: e.falsification_criterion,
  }))

  if (discarded.length > 0) {
    warnings.push(
      `${discarded.length} statement(s) discarded as unfalsifiable after ${rounds} regeneration round(s)`,
    )
  }
  if (!assumptions.some((a) => a.category === 'access')) {
    warnings.push(
      'no access assumption was generated — Market Access will report as uncovered, which is a gap, not a finding',
    )
  }
  if (assumptions.length < MIN_ASSUMPTIONS) {
    warnings.push(`only ${assumptions.length} assumption(s) survived; the target is ${MIN_ASSUMPTIONS}-9`)
  }

  return { assumptions, rejected, discarded, regenerationRounds: rounds, warnings }
}
