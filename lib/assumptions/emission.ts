/**
 * Shared validation for model-emitted assumptions. Used by the canvas generator and the red-team
 * critic, which emit the same item shape and are held to the same falsifiability bar.
 *
 * Malformed items are rejected with a reason, never coerced — rejection counts are a
 * prompt-quality signal the eval harness tracks per stage.
 */

import type { Assumption, FalsificationCriterion, Rating } from '../scoring/types'
import { ASSUMPTION_CATEGORIES, COMPARATORS } from '../scoring/types'
import { checkFalsifiability } from './falsifiability'

/** What a model is allowed to decide about an assumption. Everything else is owned by code. */
export interface EmittedAssumption {
  statement: string
  category: Assumption['category']
  impact: Rating
  uncertainty: Rating
  test_cost: Rating
  falsification_criterion: FalsificationCriterion
}

export interface RejectedEmission {
  reason: string
  raw: unknown
}

export interface FailingEmission {
  emitted: EmittedAssumption
  reasons: string[]
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isRating = (v: unknown): v is Rating =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5

export function parseCriterion(raw: unknown): FalsificationCriterion | null {
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

/**
 * Validates one array of emitted items. `field` names the array in the tool output — the
 * generator emits `assumptions`, the red team emits `new_assumptions`.
 */
export function parseEmittedAssumptions(
  raw: unknown,
  field: string,
): { valid: EmittedAssumption[]; rejected: RejectedEmission[] } {
  const valid: EmittedAssumption[] = []
  const rejected: RejectedEmission[] = []

  const items = isObject(raw) && Array.isArray(raw[field]) ? raw[field] : null
  if (items === null) return { valid, rejected: [{ reason: `output had no ${field} array`, raw }] }

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
    for (const ratingField of ['impact', 'uncertainty', 'test_cost'] as const) {
      if (!isRating(item[ratingField])) badRating = `${ratingField} must be an integer 1-5`
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

export function partitionByFalsifiability(emitted: EmittedAssumption[]): {
  passing: EmittedAssumption[]
  failing: FailingEmission[]
} {
  const passing: EmittedAssumption[] = []
  const failing: FailingEmission[] = []
  for (const e of emitted) {
    const check = checkFalsifiability(e.statement)
    if (check.ok) passing.push(e)
    else failing.push({ emitted: e, reasons: check.failures.map((f) => f.message) })
  }
  return { passing, failing }
}
