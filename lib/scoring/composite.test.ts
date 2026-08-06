import { describe, expect, it } from 'vitest'

import { scoreLedger } from './composite'
import { mkAssumption, mkClaims, mkCriterion, mkLedger } from './test-factories'

const primary = { source_type: 'primary_conversation' } as const

describe('scoreLedger', () => {
  it('reports 50 with a full-width band for an empty ledger, capped at 30', () => {
    const r = scoreLedger(mkLedger([], []))

    for (const key of ['severity', 'access', 'wedge', 'fit'] as const) {
      expect(r.subScores[key].value).toBe(50)
      expect(r.subScores[key].uncovered).toBe(true)
      expect(r.subScores[key].band).toBe(25)
    }
    expect(r.evidenceQuality).toBe(0)
    expect(r.weightedMean).toBe(50)
    expect(r.cap).toBe(30)
    expect(r.capBinding).toBe(true)
    expect(r.composite).toBe(30)
  })

  it('routes each assumption to its mapped sub-score', () => {
    const ledger = mkLedger([
      mkAssumption({ id: 'p', category: 'problem', status: 'supported' }),
      mkAssumption({ id: 'a', category: 'access', status: 'refuted' }),
      mkAssumption({ id: 'c', category: 'competition', status: 'supported' }),
      mkAssumption({ id: 'e', category: 'execution', status: 'refuted' }),
    ])
    const r = scoreLedger(ledger)

    expect(r.subScores.severity.value).toBe(90)
    expect(r.subScores.access.value).toBe(10)
    expect(r.subScores.wedge.value).toBe(90)
    expect(r.subScores.fit.value).toBe(10)
    for (const key of ['severity', 'access', 'wedge', 'fit'] as const) {
      expect(r.subScores[key].uncovered).toBe(false)
    }
  })

  it('THE HEADLINE BEHAVIOUR: flawless desk research with zero conversations cannot beat 30', () => {
    // PRD §5.8.5. If this test ever fails, the product no longer has a reason to exist.
    const ledger = mkLedger(
      [mkAssumption({ id: 'a1', category: 'access', impact: 5 })],
      mkClaims(10, { assumption_id: 'a1', source_type: 'public_post', confidence: 'high' }),
    )
    const r = scoreLedger(ledger)

    expect(r.subScores.access.value).toBeCloseTo(87.5, 4)
    expect(r.weightedMean).toBeGreaterThan(60)
    expect(r.evidenceQuality).toBe(0)
    expect(r.composite).toBe(30)
    expect(r.capBinding).toBe(true)
  })

  it('treats the cap as a ceiling, not a floor — a bad idea scores below 30', () => {
    // Easy to get wrong by implementing the cap as a clamp instead of a min.
    const ledger = mkLedger(
      [
        mkAssumption({ id: 'p', category: 'problem', impact: 5, status: 'refuted' }),
        mkAssumption({ id: 'a', category: 'access', impact: 5, status: 'refuted' }),
        mkAssumption({ id: 'c', category: 'competition', impact: 5, status: 'refuted' }),
        mkAssumption({ id: 'e', category: 'execution', impact: 5, status: 'refuted' }),
      ],
    )
    const r = scoreLedger(ledger)
    expect(r.evidenceQuality).toBe(0)
    expect(r.composite).toBeCloseTo(10)
    expect(r.capBinding).toBe(false)
  })

  it('releases the cap once primary evidence covers the load-bearing assumptions', () => {
    const a = mkAssumption({
      id: 'a1',
      category: 'access',
      impact: 5,
      status: 'supported',
      falsification_criterion: mkCriterion({ sample_size: 10 }),
    })
    const r = scoreLedger(mkLedger([a], mkClaims(10, { assumption_id: 'a1', ...primary })))

    expect(r.evidenceQuality).toBeCloseTo(100)
    expect(r.cap).toBeCloseTo(100)
    expect(r.capBinding).toBe(false)
    expect(r.composite).toBeCloseTo(0.3 * 50 + 0.3 * 90 + 0.25 * 50 + 0.15 * 50)
  })

  it('weights sub-scores per the specified mix', () => {
    const ledger = mkLedger([
      mkAssumption({ id: 'p', category: 'problem', status: 'supported' }),
      mkAssumption({ id: 'a', category: 'access', status: 'supported' }),
      mkAssumption({ id: 'c', category: 'competition', status: 'supported' }),
      mkAssumption({ id: 'e', category: 'execution', status: 'supported' }),
    ])
    expect(scoreLedger(ledger).weightedMean).toBeCloseTo(90)
  })

  it('weights within a sub-score by impact, so load-bearing assumptions dominate', () => {
    const ledger = mkLedger([
      mkAssumption({ id: 'big', category: 'problem', impact: 5, status: 'refuted' }),
      mkAssumption({ id: 'small', category: 'icp', impact: 1, status: 'supported' }),
    ])
    // (5×10 + 1×90) / 6
    expect(scoreLedger(ledger).subScores.severity.value).toBeCloseTo(140 / 6, 6)
  })

  it('narrows the confidence band as impact mass resolves', () => {
    const unresolved = mkLedger([
      mkAssumption({ id: 'r', category: 'problem', impact: 3, status: 'supported' }),
      mkAssumption({ id: 'u', category: 'icp', impact: 1, status: 'untested' }),
    ])
    expect(scoreLedger(unresolved).subScores.severity.band).toBeCloseTo(25 * 0.25, 6)

    const resolved = mkLedger([
      mkAssumption({ id: 'r', category: 'problem', impact: 3, status: 'supported' }),
      mkAssumption({ id: 'u', category: 'icp', impact: 1, status: 'refuted' }),
    ])
    expect(scoreLedger(resolved).subScores.severity.band).toBe(0)
  })

  it('counts a mixed assumption as unresolved', () => {
    const ledger = mkLedger([mkAssumption({ id: 'm', category: 'problem', status: 'mixed' })])
    expect(scoreLedger(ledger).subScores.severity.band).toBe(25)
  })

  it('emits one auditable contribution per assumption, carrying its claim ids', () => {
    const claims = mkClaims(3, { assumption_id: 'a1', ...primary })
    const ledger = mkLedger([mkAssumption({ id: 'a1', category: 'access' })], claims)
    const r = scoreLedger(ledger)

    expect(r.contributions).toHaveLength(1)
    const [c] = r.contributions
    expect(c!.assumption_id).toBe('a1')
    expect(c!.subScore).toBe('access')
    expect(c!.claimIds).toEqual(claims.map((x) => x.id))
    expect(c!.primaryClaimCount).toBe(3)
  })

  it('ignores claims pointing at assumptions that are not in the ledger', () => {
    // Defends against an orphaned claim silently inflating a score after an assumption is removed.
    const ledger = mkLedger(
      [mkAssumption({ id: 'a1', category: 'access' })],
      mkClaims(5, { assumption_id: 'ghost', ...primary }),
    )
    const r = scoreLedger(ledger)
    expect(r.subScores.access.value).toBe(50)
    expect(r.evidenceQuality).toBe(0)
  })
})
