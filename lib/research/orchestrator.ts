/**
 * The research run: ledger → plan → adapters → claims. PRD §5.4.
 *
 * Deterministic orchestration code, not an agent. The only judgement in this file's control flow
 * is delegated: query terms come from the planner's injectable generator, and stance/confidence
 * come from the extraction stage. Everything here — ordering, deduplication, capping, failure
 * accounting — is a loop a test can pin down.
 *
 * Assumptions are researched sequentially in kill-shot order. Parallel fan-out is a performance
 * concern for M1+ (and the argument for a job runner, per §8); correctness does not depend on it,
 * and sequential runs are kinder to the free-tier APIs the safe adapter set uses.
 */

import type { Assumption, Claim, Ledger } from '../scoring/types'
import type { AdapterFailure, AdapterRegistry } from './adapters/registry'
import type { SourceDocument } from './adapters/types'
import { extractClaims, type RejectedExtraction } from './extract-claims'
import type { ModelClient } from './model'
import { planResearch, type PlanOptions, type ResearchPlan } from './planner'

export interface ResearchRunOptions {
  registry: AdapterRegistry
  model: ModelClient
  planOptions?: PlanOptions
  /** Extraction context is finite and weak documents dilute strong ones. Capped, and reported. */
  maxDocumentsPerAssumption?: number
  extractionModelId?: string
}

export interface AssumptionResearch {
  assumptionId: string
  rank: number
  /** Documents actually sent to extraction, after dedup and capping. */
  documents: number
  /** Documents discarded by the per-assumption cap. Reported so a cap never looks like coverage. */
  documentsDropped: number
  claims: Claim[]
  rejected: RejectedExtraction[]
  adapterFailures: AdapterFailure[]
  skippedAdapters: string[]
}

export interface ResearchRun {
  perAssumption: AssumptionResearch[]
  claims: Claim[]
  excluded: ResearchPlan['excluded']
  /** Adapter set at run time — part of what makes the immutable Report row reproducible. */
  adapterSet: ReturnType<AdapterRegistry['describe']>
}

const DEFAULT_MAX_DOCUMENTS = 15

/**
 * A document's identity for dedup. The same post returned by two query variants must not double
 * its evidential weight — extraction sees each document once per assumption.
 */
const documentKey = (d: SourceDocument): string => d.url ?? `${d.adapterId}|${d.text}`

export async function runResearch(ledger: Ledger, options: ResearchRunOptions): Promise<ResearchRun> {
  const maxDocuments = options.maxDocumentsPerAssumption ?? DEFAULT_MAX_DOCUMENTS
  const plan = planResearch(ledger, options.planOptions ?? {})
  const byId = new Map<string, Assumption>(ledger.assumptions.map((a) => [a.id, a]))

  const perAssumption: AssumptionResearch[] = []

  for (const task of plan.tasks) {
    const assumption = byId.get(task.assumptionId)
    if (!assumption) continue

    const documents = new Map<string, SourceDocument>()
    const adapterFailures: AdapterFailure[] = []
    const skippedAdapters = new Set<string>()

    for (const query of task.queries) {
      const outcome = await options.registry.searchAll(query, plan.adapterIds)
      for (const d of outcome.documents) {
        if (!documents.has(documentKey(d))) documents.set(documentKey(d), d)
      }
      adapterFailures.push(...outcome.failures)
      for (const id of outcome.skipped) skippedAdapters.add(id)
    }

    const all = [...documents.values()]
    const kept = all.slice(0, maxDocuments)

    const extraction =
      kept.length === 0
        ? { claims: [], rejected: [] }
        : await extractClaims(assumption, kept, {
            model: options.model,
            ...(options.extractionModelId === undefined ? {} : { modelId: options.extractionModelId }),
          })

    perAssumption.push({
      assumptionId: assumption.id,
      rank: task.rank,
      documents: kept.length,
      documentsDropped: all.length - kept.length,
      claims: extraction.claims,
      rejected: extraction.rejected,
      adapterFailures,
      skippedAdapters: [...skippedAdapters],
    })
  }

  return {
    perAssumption,
    claims: perAssumption.flatMap((p) => p.claims),
    excluded: plan.excluded,
    adapterSet: options.registry.describe(),
  }
}
