/**
 * Competitive landscape stage. PRD §5.10.
 *
 * A REPORT artifact, never a score input. The hard rule, stated once and enforced by structure:
 * nothing in this module's output is consumed by lib/scoring, and the pipeline computes the score
 * BEFORE this stage runs. The Competitive Wedge sub-score continues to come only from assumptions
 * and claims — a model-judged quadrant position that moved a number would be exactly the
 * model-opinion-as-arithmetic the deterministic split exists to prevent.
 *
 * Claims-linkage is code-owned: an entry's `basis` is computed from whether its cited claim ids
 * actually exist in the ledger. The model cannot label its own recall as research — invalid ids
 * are stripped and reported, and an entry with none left is `inference`, rendered visually
 * distinct downstream per the §5.3 rule for model-originated content.
 */

import type { IdeaCanvas } from '../canvas/types'
import type { Ledger } from '../scoring/types'
import type { ModelClient } from './model'
import {
  EMIT_LANDSCAPE_TOOL,
  MODEL_ID,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './prompts/map-competitors.v1'

export const COMPETITOR_CATEGORIES = ['direct', 'adjacent', 'incumbent_feature', 'diy_substitute'] as const
export type CompetitorCategory = (typeof COMPETITOR_CATEGORIES)[number]

export const THREAT_LEVELS = ['critical', 'high', 'medium', 'low'] as const
export type ThreatLevel = (typeof THREAT_LEVELS)[number]

export interface CompetitorProfile {
  name: string
  what: string
  category: CompetitorCategory
  /** Ability AND motivation to occupy the wedge — never company size. */
  threat: ThreatLevel
  threatReason: string
  x: number
  y: number
  /** Ledger claim ids that ground this entry. Validated; invalid ids are stripped and reported. */
  claimIds: string[]
  /** Code-computed: 'claims' when at least one valid claim id remains, else 'inference'. */
  basis: 'claims' | 'inference'
}

export interface CompetitiveLandscape {
  axes: { xLabel: string; yLabel: string }
  ideaPosition: { x: number; y: number }
  competitors: CompetitorProfile[]
  /** Where the uncontested position is — or the honest statement that there is none. */
  emptySpace: string
}

export interface LandscapeResult {
  landscape: CompetitiveLandscape | null
  reason: string | null
  rejected: { reason: string; raw: unknown }[]
  warnings: string[]
}

export interface LandscapeOptions {
  model: ModelClient
  modelId?: string
}

const MAX_COMPETITORS = 12

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const clamp01 = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null

export async function mapCompetitors(
  canvas: IdeaCanvas,
  ledger: Ledger,
  options: LandscapeOptions,
): Promise<LandscapeResult> {
  const rejected: { reason: string; raw: unknown }[] = []
  const warnings: string[] = []

  let raw: unknown
  try {
    raw = await options.model.callTool({
      modelId: options.modelId ?? MODEL_ID,
      system: SYSTEM_PROMPT,
      userMessage: renderUserMessage(canvas, ledger),
      tool: EMIT_LANDSCAPE_TOOL,
      // The whole research record goes in and a 12-entry landscape comes out, with thinking
      // sharing the same budget. 16k truncated on the first live run; this stage gets headroom.
      maxTokens: 32_000,
    })
  } catch (error) {
    // The landscape is a report artifact — a failed call degrades the report, never the run.
    return {
      landscape: null,
      reason: `model call failed — ${error instanceof Error ? error.message : String(error)}`,
      rejected,
      warnings,
    }
  }

  if (!isObject(raw)) {
    return { landscape: null, reason: 'output was not an object', rejected, warnings }
  }

  const axesRaw = raw['axes']
  const xLabel = isObject(axesRaw) ? axesRaw['x_label'] : undefined
  const yLabel = isObject(axesRaw) ? axesRaw['y_label'] : undefined
  if (typeof xLabel !== 'string' || xLabel.trim() === '' || typeof yLabel !== 'string' || yLabel.trim() === '') {
    return { landscape: null, reason: 'axes are missing or unlabelled', rejected, warnings }
  }

  const ideaRaw = raw['idea_position']
  const ideaX = clamp01(isObject(ideaRaw) ? ideaRaw['x'] : undefined)
  const ideaY = clamp01(isObject(ideaRaw) ? ideaRaw['y'] : undefined)
  if (ideaX === null || ideaY === null) {
    return { landscape: null, reason: 'idea position is missing', rejected, warnings }
  }

  const emptySpace = raw['empty_space']
  if (typeof emptySpace !== 'string' || emptySpace.trim() === '') {
    return { landscape: null, reason: 'empty_space statement is missing', rejected, warnings }
  }

  const knownClaimIds = new Set(ledger.claims.map((c) => c.id))
  const seenNames = new Set<string>()
  const competitors: CompetitorProfile[] = []

  const items = Array.isArray(raw['competitors']) ? raw['competitors'] : []
  for (const item of items) {
    if (!isObject(item)) {
      rejected.push({ reason: 'competitor is not an object', raw: item })
      continue
    }
    const name = item['name']
    if (typeof name !== 'string' || name.trim() === '') {
      rejected.push({ reason: 'competitor has no name', raw: item })
      continue
    }
    if (seenNames.has(name.trim().toLowerCase())) {
      rejected.push({ reason: `duplicate competitor '${name.trim()}'`, raw: item })
      continue
    }
    const what = item['what']
    const threatReason = item['threat_reason']
    if (typeof what !== 'string' || what.trim() === '' || typeof threatReason !== 'string' || threatReason.trim() === '') {
      rejected.push({ reason: 'competitor is missing its description or threat reason', raw: item })
      continue
    }
    const category = item['category']
    if (!COMPETITOR_CATEGORIES.includes(category as never)) {
      rejected.push({ reason: `category '${String(category)}' is not valid`, raw: item })
      continue
    }
    const threat = item['threat']
    if (!THREAT_LEVELS.includes(threat as never)) {
      rejected.push({ reason: `threat '${String(threat)}' is not valid`, raw: item })
      continue
    }
    const x = clamp01(item['x'])
    const y = clamp01(item['y'])
    if (x === null || y === null) {
      rejected.push({ reason: 'competitor has no quadrant position', raw: item })
      continue
    }

    // Basis is code-owned. The model cannot dress recall as research: ids that do not exist in
    // the ledger are stripped and reported, and an entry with none left is inference.
    const citedIds = Array.isArray(item['claim_ids'])
      ? item['claim_ids'].filter((id): id is string => typeof id === 'string')
      : []
    const validIds = citedIds.filter((id) => knownClaimIds.has(id))
    const phantomCount = citedIds.length - validIds.length
    if (phantomCount > 0) {
      warnings.push(`'${name.trim()}' cited ${phantomCount} claim id(s) not in the ledger — stripped`)
    }

    seenNames.add(name.trim().toLowerCase())
    competitors.push({
      name: name.trim(),
      what: what.trim(),
      category: category as CompetitorCategory,
      threat: threat as ThreatLevel,
      threatReason: threatReason.trim(),
      x,
      y,
      claimIds: validIds,
      basis: validIds.length > 0 ? 'claims' : 'inference',
    })
    if (competitors.length === MAX_COMPETITORS) {
      const remaining = items.length - items.indexOf(item) - 1
      if (remaining > 0) warnings.push(`landscape capped at ${MAX_COMPETITORS}; ${remaining} entr(ies) dropped`)
      break
    }
  }

  if (competitors.length === 0) {
    return { landscape: null, reason: 'no valid competitors were emitted', rejected, warnings }
  }
  if (competitors.every((c) => c.basis === 'inference')) {
    warnings.push('every landscape entry is model inference — no entry is grounded in the research record')
  }

  return {
    landscape: {
      axes: { xLabel: xLabel.trim(), yLabel: yLabel.trim() },
      ideaPosition: { x: ideaX, y: ideaY },
      competitors,
      emptySpace: emptySpace.trim(),
    },
    reason: null,
    rejected,
    warnings,
  }
}
