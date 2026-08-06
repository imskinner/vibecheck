/**
 * Adapter registry. PRD §5.5.
 *
 * The one behaviour that matters here: killing an adapter must degrade output, never break the
 * run. A source that revokes access, rate-limits, or starts returning HTML instead of JSON is the
 * expected case, not the exceptional one — so `searchAll` never rejects. Failures are collected
 * and reported so a run can record which sources were unavailable, which is part of what makes a
 * Report reproducible.
 */

import type { ResearchQuery, SourceAdapter, SourceDocument } from './types'

export interface AdapterFailure {
  adapterId: string
  message: string
}

export interface SearchOutcome {
  documents: SourceDocument[]
  failures: AdapterFailure[]
  /** Adapters that were registered but disabled — usually a missing credential. */
  skipped: string[]
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>()

  register(adapter: SourceAdapter): this {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`adapter '${adapter.id}' is already registered`)
    }
    this.adapters.set(adapter.id, adapter)
    return this
  }

  get(id: string): SourceAdapter | undefined {
    return this.adapters.get(id)
  }

  all(): SourceAdapter[] {
    return [...this.adapters.values()]
  }

  enabled(): SourceAdapter[] {
    return this.all().filter((a) => {
      // A adapter that throws while reporting its own health is a disabled adapter, not a crash.
      try {
        return a.isEnabled()
      } catch {
        return false
      }
    })
  }

  /**
   * Snapshot of the adapter set for the Report row (PRD §5.9) — what was available at run time,
   * so a score computed six months ago remains interpretable.
   */
  describe(): { id: string; compliance: string; sourceType: string; enabled: boolean }[] {
    return this.all().map((a) => {
      let enabled = false
      try {
        enabled = a.isEnabled()
      } catch {
        enabled = false
      }
      return { id: a.id, compliance: a.compliance, sourceType: a.sourceType, enabled }
    })
  }

  async searchAll(query: ResearchQuery, adapterIds?: string[]): Promise<SearchOutcome> {
    const candidates = adapterIds
      ? adapterIds.map((id) => this.adapters.get(id)).filter((a): a is SourceAdapter => a !== undefined)
      : this.all()

    const documents: SourceDocument[] = []
    const failures: AdapterFailure[] = []
    const skipped: string[] = []

    const results = await Promise.allSettled(
      candidates.map(async (adapter) => {
        let enabled = false
        try {
          enabled = adapter.isEnabled()
        } catch {
          enabled = false
        }
        if (!enabled) return { adapter, documents: null }
        return { adapter, documents: await adapter.search(query) }
      }),
    )

    results.forEach((result, i) => {
      const adapter = candidates[i]!
      if (result.status === 'rejected') {
        failures.push({ adapterId: adapter.id, message: String(result.reason) })
        return
      }
      if (result.value.documents === null) {
        skipped.push(adapter.id)
        return
      }
      documents.push(...result.value.documents)
    })

    return { documents, failures, skipped }
  }
}
