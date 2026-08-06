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
import type { Assumption, FalsificationCriterion, Rating } from '../scoring/types'
import { ASSUMPTION_CATEGORIES, COMPARATORS } from '../scoring/types'
import { checkFalsifiability } from './falsifiability'
import {
  EMIT_ASSUMPTIONS_TOOL,
  MODEL_ID,
  regenerationTool,
  renderRegenerationMessage,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './prompts/generate-assumptions.v1'

export interface GenerateOptions {
  model: ModelClient
  /** Regeneration calls after the initial one. Each retries only the still-failing statements. */
  maxRegenerationRounds?: number
  makeAssumptionId?: (index: number) => string
  modelId?: string
}

export interface RejectedEmission {
  reason: string
  raw: unknown
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

/** What the model is allowed to decide. Everything else on Assumption is owned by this code. */
interface Emitted {
  statement: string
  category: Assumption['category']
  impact: Rating
  uncertainty: Rating
  test_cost: Rating
  falsification_criterion: FalsificationCriterion
}

const MIN_ASSUMPTIONS = 5
const defaultId = (index: number) => `gen-a${index + 1}`

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isRating = (v: unknown): v is Rating => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5

function parseCriterion(raw: unknown): FalsificationCriterion | null {
  if (!isObject(raw)) return null
  const { applies_to, observation, metric, comparator, threshold, sample_size } = raw
  if (typeof applies_to !== 'string' || applies_to.trim() === '') return null
  if (typeof observation !== 'string' || observation.trim() === '') return null
  if (typeof metric !== 'string' || metric.trim() === '') return null
  if (!COMPARATORS.includes(comparator as never)) return null
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return null
  if (typeof sample_size !== 'number' || !Number.isInteger(sample_size) || sample_size < 1) return null
  return {
    applies_to: applies_to.trim(),
    observation: observation.trim(),
    metric: metric.trim(),
    comparator: comparator as FalsificationCriterion['comparator'],
    threshold,
    sample_size,
  }
}

function parseEmission(raw: unknown): { valid: Emitted[]; rejected: RejectedEmission[] } {
  const valid: Emitted[] = []
  const rejected: RejectedEmission[] = []

  const items = isObject(raw) && Array.isArray(raw['assumptions']) ? raw['assumptions'] : null
  if (items === null) return { valid, rejected: [{ reason: 'output had no assumptions array', raw }] }

  for (const item of items) {
    if (!isObject(item)) {
      rejected.push({ reason: 'assumption is not an object', raw: item })
      continue
    }
    const statement = item['statement']
    if (typeof statement !== 'string' || statement.trim() === '') {
      rejected.push({ reason: 'statement is empty', raw: item })
      continue
    }
    const category = item['category']
    if (!ASSUMPTION_CATEGORIES.includes(category as never)) {
      rejected.push({ reason: `category '${String(category)}' is not valid`, raw: item })
      continue
    }
    let badRating: string | null = null
    for (const field of ['impact', 'uncertainty', 'test_cost'] as const) {
      if (!isRating(item[field])) badRating = `${field} must be an integer 1-5`
    }
    if (badRating) {
      rejected.push({ reason: badRating, raw: item })
      continue
    }
    const criterion = parseCriterion(item['falsification_criterion'])
    if (criterion === null) {
      rejected.push({ reason: 'falsification_criterion is malformed', raw: item })
      continue
    }
    valid.push({
      statement: statement.trim(),
      category: category as Assumption['category'],
      impact: item['impact'] as Rating,
      uncertainty: item['uncertainty'] as Rating,
      test_cost: item['test_cost'] as Rating,
      falsification_criterion: criterion,
    })
  }

  return { valid, rejected }
}

function partition(emitted: Emitted[]): { passing: Emitted[]; failing: { emitted: Emitted; reasons: string[] }[] } {
  const passing: Emitted[] = []
  const failing: { emitted: Emitted; reasons: string[] }[] = []
  for (const e of emitted) {
    const check = checkFalsifiability(e.statement)
    if (check.ok) passing.push(e)
    else failing.push({ emitted: e, reasons: check.failures.map((f) => f.message) })
  }
  return { passing, failing }
}

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

  const parsed = parseEmission(initial)
  rejected.push(...parsed.rejected)

  let { passing: kept, failing } = partition(parsed.valid)
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

    const reparsed = parseEmission(regen)
    rejected.push(...reparsed.rejected)

    const next = partition(reparsed.valid)
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
