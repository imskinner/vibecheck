import { describe, expect, it } from 'vitest'

import { mkAssumption } from '../scoring/test-factories'
import { killShotScore, rankKillShots } from './ranking'

const ids = (ranked: ReturnType<typeof rankKillShots>) => ranked.map((r) => r.assumption.id)

describe('killShotScore', () => {
  it('rewards impact, uncertainty, and cheapness to test', () => {
    expect(killShotScore(mkAssumption({ impact: 5, uncertainty: 5, test_cost: 1 }))).toBe(125)
    expect(killShotScore(mkAssumption({ impact: 1, uncertainty: 1, test_cost: 5 }))).toBe(1)
  })

  it('prefers the cheaper test when impact and uncertainty match', () => {
    const cheap = mkAssumption({ impact: 4, uncertainty: 4, test_cost: 1 })
    const expensive = mkAssumption({ impact: 4, uncertainty: 4, test_cost: 5 })
    expect(killShotScore(cheap)).toBeGreaterThan(killShotScore(expensive))
  })

  it('scores a well-understood assumption below an unknown one of equal impact', () => {
    const known = mkAssumption({ impact: 5, uncertainty: 1, test_cost: 2 })
    const unknown = mkAssumption({ impact: 5, uncertainty: 5, test_cost: 2 })
    expect(killShotScore(unknown)).toBeGreaterThan(killShotScore(known))
  })
})

describe('rankKillShots', () => {
  it('orders by score and assigns 1-based ranks', () => {
    const ranked = rankKillShots([
      mkAssumption({ id: 'low', impact: 2, uncertainty: 2, test_cost: 4 }),
      mkAssumption({ id: 'high', impact: 5, uncertainty: 5, test_cost: 1 }),
      mkAssumption({ id: 'mid', impact: 4, uncertainty: 3, test_cost: 3 }),
    ])

    expect(ids(ranked)).toEqual(['high', 'mid', 'low'])
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('excludes resolved assumptions — there is nothing left to go and find out', () => {
    const ranked = rankKillShots([
      mkAssumption({ id: 'settled-yes', impact: 5, uncertainty: 5, test_cost: 1, status: 'supported' }),
      mkAssumption({ id: 'settled-no', impact: 5, uncertainty: 5, test_cost: 1, status: 'refuted' }),
      mkAssumption({ id: 'open', impact: 1, uncertainty: 1, test_cost: 5, status: 'untested' }),
    ])
    expect(ids(ranked)).toEqual(['open'])
  })

  it('keeps mixed assumptions as candidates', () => {
    // Conflicting primary evidence is not a verdict, and is often the most urgent thing to resolve.
    const ranked = rankKillShots([mkAssumption({ id: 'conflicted', status: 'mixed' })])
    expect(ids(ranked)).toEqual(['conflicted'])
  })

  it('is stable under input permutation', () => {
    // Without a total order the plan would differ between a fresh run and a re-run over the same
    // stored ledger, and two Reports of one idea would disagree about what to test first.
    const assumptions = [
      mkAssumption({ id: 'b', impact: 4, uncertainty: 3, test_cost: 3 }),
      mkAssumption({ id: 'a', impact: 4, uncertainty: 3, test_cost: 3 }),
      mkAssumption({ id: 'c', impact: 4, uncertainty: 3, test_cost: 3 }),
    ]
    const forward = ids(rankKillShots(assumptions))
    const reversed = ids(rankKillShots([...assumptions].reverse()))

    expect(forward).toEqual(['a', 'b', 'c'])
    expect(reversed).toEqual(forward)
  })

  it('breaks a tied product in favour of the more fatal assumption', () => {
    // 5 × 2 × 3 and 2 × 5 × 3 both score 30. Being wrong about the first one costs more.
    const ranked = rankKillShots([
      mkAssumption({ id: 'low-impact', impact: 2, uncertainty: 5, test_cost: 3 }),
      mkAssumption({ id: 'high-impact', impact: 5, uncertainty: 2, test_cost: 3 }),
    ])
    expect(ranked.map((r) => r.killShotScore)).toEqual([30, 30])
    expect(ids(ranked)).toEqual(['high-impact', 'low-impact'])
  })

  it('applies a limit and handles an empty ledger', () => {
    const assumptions = Array.from({ length: 9 }, (_, i) =>
      mkAssumption({ id: `a${i}`, impact: 5, uncertainty: 5, test_cost: 1 }),
    )
    expect(rankKillShots(assumptions, 3)).toHaveLength(3)
    expect(rankKillShots([])).toEqual([])
    expect(rankKillShots([], 3)).toEqual([])
  })
})
