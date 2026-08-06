import { describe, expect, it } from 'vitest'

import { mkAssumption, mkLedger } from '../scoring/test-factories'
import { AdapterRegistry } from './adapters/registry'
import type { ResearchQuery, SourceAdapter, SourceDocument } from './adapters/types'
import { createScriptedModelClient, type ToolCallRequest } from './model'
import { runResearch } from './orchestrator'

const doc = (over: Partial<SourceDocument> = {}): SourceDocument => ({
  adapterId: 'stub',
  url: 'https://example.org/1',
  title: null,
  text: 'A founder describes the problem.',
  sourceType: 'public_post',
  publishedAt: '2021-01-01T00:00:00.000Z',
  retrievedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const stubAdapter = (
  id: string,
  search: (query: ResearchQuery) => Promise<SourceDocument[]>,
): SourceAdapter => ({
  id,
  compliance: 'public_api',
  legalNotes: 'test stub',
  sourceType: 'public_post',
  isEnabled: () => true,
  search,
})

/** Extraction that emits one supporting claim against document 0. */
const oneClaim = { claims: [{ document_index: 0, text: 'A claim.', stance: 'supports', confidence: 'medium' }] }

const ledger = () =>
  mkLedger([
    mkAssumption({ id: 'risky', category: 'access', impact: 5, uncertainty: 5, test_cost: 1 }),
    mkAssumption({ id: 'safe', category: 'problem', impact: 2, uncertainty: 2, test_cost: 3 }),
  ])

describe('runResearch', () => {
  it('researches assumptions in kill-shot order and attributes claims to the right one', async () => {
    const seen: string[] = []
    const registry = new AdapterRegistry().register(
      stubAdapter('stub', async (q) => {
        seen.push(q.assumptionId)
        return [doc({ url: `https://example.org/${q.assumptionId}` })]
      }),
    )
    const model = createScriptedModelClient([oneClaim, oneClaim])

    const run = await runResearch(ledger(), { registry, model })

    expect(seen).toEqual(['risky', 'safe'])
    expect(run.claims).toHaveLength(2)
    expect(run.claims.map((c) => c.assumption_id)).toEqual(['risky', 'safe'])
    // Provenance came from the documents each assumption actually retrieved.
    expect(run.claims[0]!.source_url).toBe('https://example.org/risky')
  })

  it('dedupes documents across queries before the model sees them', async () => {
    // The same post coming back from two query variants must not double its evidential weight —
    // extraction happens once per document, not once per (document, query) pair.
    const registry = new AdapterRegistry().register(
      stubAdapter('stub', async () => [doc(), doc()]),
    )
    const model = createScriptedModelClient((request: ToolCallRequest) => {
      expect(request.userMessage.match(/--- DOCUMENT \d+ ---/g)).toHaveLength(1)
      return oneClaim
    })

    const run = await runResearch(
      mkLedger([mkAssumption({ id: 'a1' })]),
      {
        registry,
        model,
        planOptions: { generateTerms: () => [['first'], ['second']] },
      },
    )

    expect(run.perAssumption[0]!.documents).toBe(1)
  })

  it('DEGRADES on adapter failure: records it and keeps going', async () => {
    const registry = new AdapterRegistry()
      .register(stubAdapter('healthy', async () => [doc({ adapterId: 'healthy' })]))
      .register(
        stubAdapter('revoked', async () => {
          throw new Error('403 terms changed')
        }),
      )
    const model = createScriptedModelClient([oneClaim, oneClaim])

    const run = await runResearch(ledger(), { registry, model })

    expect(run.claims.length).toBeGreaterThan(0)
    const failures = run.perAssumption.flatMap((p) => p.adapterFailures)
    expect(failures.some((f) => f.adapterId === 'revoked')).toBe(true)
  })

  it('makes no model call for an assumption with no documents', async () => {
    const registry = new AdapterRegistry().register(stubAdapter('empty', async () => []))
    const model = createScriptedModelClient([])

    const run = await runResearch(mkLedger([mkAssumption({ id: 'a1' })]), { registry, model })

    expect(model.calls).toHaveLength(0)
    expect(run.claims).toEqual([])
    expect(run.perAssumption[0]!.documents).toBe(0)
  })

  it('caps documents per assumption and says so', async () => {
    const many = Array.from({ length: 30 }, (_, i) => doc({ url: `https://example.org/${i}` }))
    const registry = new AdapterRegistry().register(stubAdapter('stub', async () => many))
    const model = createScriptedModelClient([oneClaim])

    const run = await runResearch(mkLedger([mkAssumption({ id: 'a1' })]), {
      registry,
      model,
      maxDocumentsPerAssumption: 12,
    })

    expect(run.perAssumption[0]!.documents).toBe(12)
    expect(run.perAssumption[0]!.documentsDropped).toBe(18)
  })

  it('carries the plan exclusions and the adapter snapshot for the Report row', async () => {
    const registry = new AdapterRegistry().register(stubAdapter('stub', async () => [doc()]))
    const model = createScriptedModelClient([oneClaim])
    const withResolved = mkLedger([
      mkAssumption({ id: 'open' }),
      mkAssumption({ id: 'settled', status: 'refuted' }),
    ])

    const run = await runResearch(withResolved, { registry, model })

    expect(run.excluded).toEqual([{ assumptionId: 'settled', reason: 'already resolved (refuted)' }])
    expect(run.adapterSet).toEqual([
      { id: 'stub', compliance: 'public_api', sourceType: 'public_post', enabled: true },
    ])
  })

  it('reports rejected extractions per assumption', async () => {
    const registry = new AdapterRegistry().register(stubAdapter('stub', async () => [doc()]))
    const model = createScriptedModelClient([
      { claims: [{ document_index: 99, text: 'phantom cite', stance: 'supports', confidence: 'high' }] },
    ])

    const run = await runResearch(mkLedger([mkAssumption({ id: 'a1' })]), { registry, model })

    expect(run.claims).toEqual([])
    expect(run.perAssumption[0]!.rejected).toHaveLength(1)
  })

  it('propagates a knowledge cutoff through to the adapters', async () => {
    const cutoffs: (string | undefined)[] = []
    const registry = new AdapterRegistry().register(
      stubAdapter('stub', async (q) => {
        cutoffs.push(q.notAfter)
        return []
      }),
    )
    const model = createScriptedModelClient([])

    await runResearch(mkLedger([mkAssumption({ id: 'a1' })]), {
      registry,
      model,
      planOptions: { notAfter: '2021-09-01' },
    })

    expect(cutoffs).toEqual(['2021-09-01'])
  })
})
