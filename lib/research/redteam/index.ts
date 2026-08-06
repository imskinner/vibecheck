/**
 * Red-team stage. PRD §5.4.1 — emits Assumption rows, never Claims.
 *
 * The contract is structural, not behavioural: the tool schema has no field a claim could arrive
 * through, this module's return type has no claim in it, and uncertainty raises are applied by
 * code that permits movement in one direction only. The prompt tells the model the same things,
 * but the prompt is not what enforces them.
 */

import type { IdeaCanvas } from '../../canvas/types'
import {
  parseEmittedAssumptions,
  partitionByFalsifiability,
  type RejectedEmission,
} from '../../assumptions/emission'
import type { Assumption, Ledger, Rating } from '../../scoring/types'
import type { ModelClient } from '../model'
import {
  MODEL_ID,
  RED_TEAM_TOOL,
  regenerationTool,
  renderRegenerationMessage,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './prompts/red-team.v1'

export interface RedTeamOptions {
  model: ModelClient
  maxRegenerationRounds?: number
  makeAssumptionId?: (index: number) => string
  modelId?: string
}

export interface UncertaintyRaise {
  assumptionId: string
  from: Rating
  to: Rating
  reason: string
}

export interface RejectedRaise {
  reason: string
  raw: unknown
}

export interface RedTeamResult {
  /** New threats, origin 'red_team', untested. High impact/uncertainty by construction. */
  assumptions: Assumption[]
  /** Validated upward-only raises. Apply with applyUncertaintyRaises — proposals, not mutations. */
  uncertaintyRaises: UncertaintyRaise[]
  rejected: RejectedEmission[]
  rejectedRaises: RejectedRaise[]
  discarded: { statement: string; failures: string[] }[]
  regenerationRounds: number
  warnings: string[]
}

const defaultId = (index: number) => `rt-a${index + 1}`

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function parseRaises(
  raw: unknown,
  existing: Map<string, Assumption>,
): { raises: UncertaintyRaise[]; rejected: RejectedRaise[] } {
  const raises: UncertaintyRaise[] = []
  const rejected: RejectedRaise[] = []

  const items = isObject(raw) && Array.isArray(raw['uncertainty_raises']) ? raw['uncertainty_raises'] : []
  for (const item of items) {
    if (!isObject(item)) {
      rejected.push({ reason: 'raise is not an object', raw: item })
      continue
    }
    const id = item['assumption_id']
    const target = typeof id === 'string' ? existing.get(id) : undefined
    if (!target) {
      rejected.push({ reason: `assumption_id '${String(id)}' is not in the ledger`, raw: item })
      continue
    }
    const to = item['uncertainty']
    if (typeof to !== 'number' || !Number.isInteger(to) || to < 1 || to > 5) {
      rejected.push({ reason: 'uncertainty must be an integer 1-5', raw: item })
      continue
    }
    if (to <= target.uncertainty) {
      // The one-way valve. The red team's job is doubt; lowering uncertainty is the synthesizer's
      // business, and it needs evidence to do it.
      rejected.push({
        reason: `raise must exceed the current rating (${target.uncertainty}); got ${to}`,
        raw: item,
      })
      continue
    }
    const reason = item['reason']
    if (typeof reason !== 'string' || reason.trim() === '') {
      rejected.push({ reason: 'raise has no reason', raw: item })
      continue
    }
    raises.push({
      assumptionId: target.id,
      from: target.uncertainty,
      to: to as Rating,
      reason: reason.trim(),
    })
  }

  return { raises, rejected }
}

export async function runRedTeam(
  canvas: IdeaCanvas,
  ledger: Assumption[],
  options: RedTeamOptions,
): Promise<RedTeamResult> {
  const modelId = options.modelId ?? MODEL_ID
  const maxRounds = options.maxRegenerationRounds ?? 2
  const makeId = options.makeAssumptionId ?? defaultId

  const rejected: RejectedEmission[] = []
  const warnings: string[] = []
  const existing = new Map(ledger.map((a) => [a.id, a]))
  const existingStatements = new Set(ledger.map((a) => a.statement.trim().toLowerCase()))

  const initial = await options.model.callTool({
    modelId,
    system: SYSTEM_PROMPT,
    userMessage: renderUserMessage(canvas, ledger),
    tool: RED_TEAM_TOOL,
  })

  const parsed = parseEmittedAssumptions(initial, 'new_assumptions')
  rejected.push(...parsed.rejected)
  const { raises, rejected: rejectedRaises } = parseRaises(initial, existing)

  // A restated ledger row is not a finding. Dropped before falsifiability so it cannot burn a
  // regeneration round either.
  const fresh = parsed.valid.filter((e) => !existingStatements.has(e.statement.toLowerCase()))
  const duplicates = parsed.valid.length - fresh.length
  if (duplicates > 0) warnings.push(`${duplicates} emission(s) restated the existing ledger and were dropped`)

  let { passing: kept, failing } = partitionByFalsifiability(fresh)
  let rounds = 0

  while (failing.length > 0 && rounds < maxRounds) {
    rounds += 1
    const regen = await options.model.callTool({
      modelId,
      system: SYSTEM_PROMPT,
      userMessage: renderRegenerationMessage(
        failing.map((f) => ({ statement: f.emitted.statement, reasons: f.reasons })),
        kept.map((e) => e.statement),
      ),
      tool: regenerationTool(failing.length),
    })

    const reparsed = parseEmittedAssumptions(regen, 'new_assumptions')
    rejected.push(...reparsed.rejected)

    const next = partitionByFalsifiability(
      reparsed.valid.filter((e) => !existingStatements.has(e.statement.toLowerCase())),
    )
    kept = [...kept, ...next.passing]
    failing = next.failing
  }

  const discarded = failing.map((f) => ({ statement: f.emitted.statement, failures: f.reasons }))
  if (discarded.length > 0) {
    warnings.push(
      `${discarded.length} red-team statement(s) discarded as unfalsifiable after ${rounds} regeneration round(s)`,
    )
  }
  if (kept.length === 0) {
    warnings.push('the red team produced no usable assumptions — the pass added nothing, which is itself worth noticing')
  }

  const assumptions: Assumption[] = kept.map((e, index) => ({
    id: makeId(index),
    statement: e.statement,
    category: e.category,
    origin: 'red_team',
    impact: e.impact,
    uncertainty: e.uncertainty,
    test_cost: e.test_cost,
    status: 'untested',
    falsification_criterion: e.falsification_criterion,
  }))

  return {
    assumptions,
    uncertaintyRaises: raises,
    rejected,
    rejectedRaises,
    discarded,
    regenerationRounds: rounds,
    warnings,
  }
}

/**
 * Applies red-team output to a ledger, immutably. New assumptions are appended; validated raises
 * move uncertainty upward. Nothing else on the founder's ledger is touched — the red team has no
 * write access to statements, categories, impacts, statuses, or claims.
 */
export function applyRedTeam(ledger: Ledger, result: RedTeamResult): Ledger {
  const raiseById = new Map(result.uncertaintyRaises.map((r) => [r.assumptionId, r]))
  return {
    assumptions: [
      ...ledger.assumptions.map((a) => {
        const raise = raiseById.get(a.id)
        return raise ? { ...a, uncertainty: raise.to } : a
      }),
      ...result.assumptions,
    ],
    claims: ledger.claims,
  }
}
