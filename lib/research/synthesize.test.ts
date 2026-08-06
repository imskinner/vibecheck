import { describe, expect, it } from 'vitest'

import { scoreLedger } from '../scoring/composite'
import { mkAssumption, mkClaim, mkLedger } from '../scoring/test-factories'
import type { ResearchRun } from './orchestrator'
import { synthesizeHonestNegatives } from './synthesize'

const AT = '2026-01-01T00:00:00.000Z'

const perAssumption = (assumptionId: string, over: Partial<ResearchRun['perAssumption'][number]> = {}) => ({
  assumptionId,
  rank: 1,
  documents: 0,
  documentsDropped: 0,
  claims: [],
  rejected: [],
  adapterFailures: [],
  skippedAdapters: [],
  ...over,
})

const run = (per: ResearchRun['perAssumption']): ResearchRun => ({
  perAssumption: per,
  claims: per.flatMap((p) => p.claims),
  excluded: [],
  adapterSet: [],
})

describe('synthesizeHonestNegatives', () => {
  it('mints one context claim per researched-but-empty assumption', () => {
    const claims = synthesizeHonestNegatives(
      run([
        perAssumption('empty', { documents: 4 }),
        perAssumption('covered', { claims: [mkClaim({ assumption_id: 'covered' })] }),
      ]),
      { retrievedAt: AT },
    )

    expect(claims).toHaveLength(1)
    expect(claims[0]).toEqual({
      id: 'empty-nothing-found',
      assumption_id: 'empty',
      text: 'Desk research found no evidence either way: 4 retrieved document(s) yielded no claim about this assumption.',
      stance: 'context',
      source_url: null,
      source_type: 'model_inference',
      retrieved_at: AT,
      retrieved_text: null,
      confidence: 'low',
    })
  })

  it('says nothing about assumptions that were never researched', () => {
    // "Not yet researched" and "researched, nothing found" are the two states this stage exists
    // to distinguish. An excluded assumption gets no claim — that would be the lie.
    const claims = synthesizeHonestNegatives(run([perAssumption('researched')]), { retrievedAt: AT })
    expect(claims.map((c) => c.assumption_id)).toEqual(['researched'])
  })

  it('moves no score: the honest negative is worth exactly zero support', () => {
    const assumption = mkAssumption({ id: 'a1', category: 'access' })
    const bare = scoreLedger(mkLedger([assumption], []))
    const withNegative = scoreLedger(
      mkLedger([assumption], synthesizeHonestNegatives(run([perAssumption('a1')]), { retrievedAt: AT })),
    )

    expect(withNegative.subScores.access.value).toBe(bare.subScores.access.value)
    expect(withNegative.evidenceQuality).toBe(bare.evidenceQuality)
    expect(withNegative.composite).toBe(bare.composite)
  })

  it('distinguishes zero documents from documents that yielded nothing', () => {
    const [noDocs] = synthesizeHonestNegatives(run([perAssumption('a1', { documents: 0 })]), { retrievedAt: AT })
    const [emptyDocs] = synthesizeHonestNegatives(run([perAssumption('a1', { documents: 7 })]), { retrievedAt: AT })

    expect(noDocs!.text).toContain('the enabled sources')
    expect(emptyDocs!.text).toContain('7 retrieved document(s)')
  })

  it('takes its timestamp from the caller, not a clock', () => {
    const claims = synthesizeHonestNegatives(run([perAssumption('a1')]), { retrievedAt: '1999-12-31T00:00:00.000Z' })
    expect(claims[0]!.retrieved_at).toBe('1999-12-31T00:00:00.000Z')
  })
})
