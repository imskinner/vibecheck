/**
 * Research planner. PRD §5.4.
 *
 * DETERMINISTIC CODE, NOT AN AGENT. Decomposing a ledger into per-assumption research tasks is a
 * loop, not a reasoning problem, and making it an agent would insert a variance source upstream of
 * everything — directly fighting the σ < 6 stability target in §7. Three agent roles exist in this
 * pipeline: researcher, synthesizer, red-team. The planner is not one of them.
 *
 * Search-term generation IS a judgement task and is injectable. The default below is a labelled
 * lexical baseline so the pipeline runs end to end without a model; the versioned query-generation
 * prompt replaces it without touching the decomposition.
 */

import { rankKillShots } from '../assumptions/ranking'
import type { Assumption, Ledger } from '../scoring/types'
import type { ResearchQuery } from './adapters/types'

/** Words that carry no search signal, plus the quantity language falsifiability requires. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
  'from', 'into', 'over', 'under', 'above', 'below', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'not', 'no', 'their', 'they',
  'them', 'it', 'its', 'as', 'per', 'least', 'most', 'more', 'less', 'fewer', 'within', 'each',
  'every', 'about', 'already', 'currently', 'who', 'which', 'what', 'when', 'where', 'how',
])

export interface ResearchTask {
  assumptionId: string
  statement: string
  /** 1-based kill-shot rank. The riskiest assumption is researched first. */
  rank: number
  queries: ResearchQuery[]
}

export interface ResearchPlan {
  tasks: ResearchTask[]
  /** Assumptions deliberately left out, with the reason. Never silently dropped. */
  excluded: { assumptionId: string; reason: string }[]
  adapterIds: string[] | undefined
}

export interface PlanOptions {
  /** Restrict to a subset of adapters. Undefined means every registered adapter. */
  adapterIds?: string[]
  /** Research only the top N kill-shots. Undefined researches every open assumption. */
  maxAssumptions?: number
  maxResultsPerQuery?: number
  /** Knowledge cutoff, propagated to every query so blind scoring holds end to end. */
  notAfter?: string
  /** Swap in the query-generation prompt here. Must be deterministic for a reproducible plan. */
  generateTerms?: (assumption: Assumption) => string[][]
}

/**
 * Lexical baseline. Deliberately dumb and deliberately labelled: it strips stopwords and numbers
 * and keeps what is left, in order. It is a placeholder for the query-generation prompt, not an
 * attempt at query understanding — the failure mode to avoid is quietly shipping this and
 * concluding the adapters are weak when the queries were.
 */
export function baselineTerms(assumption: Assumption): string[][] {
  const terms = assumption.statement
    .toLowerCase()
    .replace(/[^\w\s$%-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token))

  return [[...new Set(terms)].slice(0, 8)]
}

export function planResearch(ledger: Ledger, options: PlanOptions = {}): ResearchPlan {
  const generateTerms = options.generateTerms ?? baselineTerms
  const maxResults = options.maxResultsPerQuery ?? 10

  const ranked = rankKillShots(ledger.assumptions, options.maxAssumptions)
  const included = new Set(ranked.map((r) => r.assumption.id))

  const excluded = ledger.assumptions
    .filter((a) => !included.has(a.id))
    .map((a) => ({
      assumptionId: a.id,
      reason:
        a.status === 'supported' || a.status === 'refuted'
          ? `already resolved (${a.status})`
          : 'outside the requested kill-shot limit',
    }))

  const tasks = ranked.map(({ assumption, rank }): ResearchTask => ({
    assumptionId: assumption.id,
    statement: assumption.statement,
    rank,
    queries: generateTerms(assumption)
      .filter((terms) => terms.length > 0)
      .map((terms): ResearchQuery => ({
        assumptionId: assumption.id,
        terms,
        maxResults,
        ...(options.notAfter === undefined ? {} : { notAfter: options.notAfter }),
      })),
  }))

  return { tasks, excluded, adapterIds: options.adapterIds }
}
