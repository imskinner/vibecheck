/**
 * Model-generated search terms for the planner. One batched call per run; the planner's
 * `generateTerms` hook stays synchronous by looking results up from the returned map.
 *
 * Assumptions the model skipped or mangled fall back to the lexical baseline — a bad query beats
 * no research, and the fallback is reported so a quiet degradation stays visible.
 */

import type { Assumption } from '../scoring/types'
import type { ModelClient } from './model'
import {
  EMIT_QUERIES_TOOL,
  MODEL_ID,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './prompts/generate-queries.v1'

export interface QueryTermsOptions {
  model: ModelClient
  modelId?: string
}

export interface QueryTermsResult {
  /** assumption id → query variants. Missing ids mean the caller should fall back. */
  terms: Map<string, string[][]>
  /** Ids that will use the lexical baseline, with why. */
  fallbacks: { assumptionId: string; reason: string }[]
}

const MAX_SEARCHES = 3
const MAX_TERMS = 5

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function parseSearches(raw: unknown): string[][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const searches: string[][] = []
  for (const search of raw.slice(0, MAX_SEARCHES)) {
    if (!Array.isArray(search)) return null
    const terms = search
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      .map((t) => t.trim())
      .slice(0, MAX_TERMS)
    if (terms.length === 0) return null
    searches.push(terms)
  }
  return searches
}

export async function generateQueryTerms(
  assumptions: Assumption[],
  options: QueryTermsOptions,
): Promise<QueryTermsResult> {
  const known = new Set(assumptions.map((a) => a.id))
  const terms = new Map<string, string[][]>()
  const fallbacks: { assumptionId: string; reason: string }[] = []

  if (assumptions.length === 0) return { terms, fallbacks }

  const raw = await options.model.callTool({
    modelId: options.modelId ?? MODEL_ID,
    system: SYSTEM_PROMPT,
    userMessage: renderUserMessage(assumptions),
    tool: EMIT_QUERIES_TOOL,
  })

  const items = isObject(raw) && Array.isArray(raw['queries']) ? raw['queries'] : []
  for (const item of items) {
    if (!isObject(item)) continue
    const id = item['assumption_id']
    if (typeof id !== 'string' || !known.has(id) || terms.has(id)) continue
    const searches = parseSearches(item['searches'])
    if (searches === null) continue
    terms.set(id, searches)
  }

  for (const a of assumptions) {
    if (!terms.has(a.id)) {
      fallbacks.push({ assumptionId: a.id, reason: 'model emitted no usable queries for this assumption' })
    }
  }

  return { terms, fallbacks }
}
