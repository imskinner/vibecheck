import { describe, expect, it } from 'vitest'

import { mkAssumption, mkLedger } from '../scoring/test-factories'
import { baselineTerms, planResearch } from './planner'

const ledger = () =>
  mkLedger([
    mkAssumption({
      id: 'access',
      category: 'access',
      statement: 'At least 2 in 10 bookkeepers contacted through partner directories reply to a cold outreach',
      impact: 5,
      uncertainty: 5,
      test_cost: 1,
    }),
    mkAssumption({
      id: 'problem',
      category: 'problem',
      statement: 'Bookkeepers with 20+ client books spend more than 6 hours per month-end on manual matching',
      impact: 4,
      uncertainty: 3,
      test_cost: 3,
    }),
    mkAssumption({ id: 'settled', category: 'competition', impact: 5, uncertainty: 5, test_cost: 1, status: 'refuted' }),
  ])

describe('planResearch', () => {
  it('emits one task per open assumption, ordered by kill-shot rank', () => {
    const plan = planResearch(ledger())
    expect(plan.tasks.map((t) => t.assumptionId)).toEqual(['access', 'problem'])
    expect(plan.tasks.map((t) => t.rank)).toEqual([1, 2])
  })

  it('records why an assumption was left out rather than dropping it silently', () => {
    const plan = planResearch(ledger())
    expect(plan.excluded).toEqual([{ assumptionId: 'settled', reason: 'already resolved (refuted)' }])
  })

  it('distinguishes an assumption outside the limit from a resolved one', () => {
    const plan = planResearch(ledger(), { maxAssumptions: 1 })
    expect(plan.tasks.map((t) => t.assumptionId)).toEqual(['access'])
    expect(plan.excluded).toEqual(
      expect.arrayContaining([
        { assumptionId: 'problem', reason: 'outside the requested kill-shot limit' },
        { assumptionId: 'settled', reason: 'already resolved (refuted)' },
      ]),
    )
  })

  it('propagates the knowledge cutoff to every query', () => {
    // Blind scoring only holds if t0 reaches the adapters. A query without it can leak the future.
    const plan = planResearch(ledger(), { notAfter: '2021-09-01' })
    const queries = plan.tasks.flatMap((t) => t.queries)

    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) expect(query.notAfter).toBe('2021-09-01')
  })

  it('omits notAfter entirely when no cutoff is set', () => {
    const [query] = planResearch(ledger()).tasks[0]!.queries
    expect(query).not.toHaveProperty('notAfter')
  })

  it('is deterministic under input permutation', () => {
    const forward = planResearch(ledger())
    const reversed = planResearch(mkLedger([...ledger().assumptions].reverse()))
    expect(reversed).toEqual(forward)
  })

  it('accepts an injected term generator, which is where the prompt slots in', () => {
    const plan = planResearch(ledger(), {
      maxAssumptions: 1,
      generateTerms: () => [['first', 'query'], ['second', 'query']],
    })
    expect(plan.tasks[0]!.queries.map((q) => q.terms)).toEqual([
      ['first', 'query'],
      ['second', 'query'],
    ])
  })

  it('drops empty query variants a generator might produce', () => {
    const plan = planResearch(ledger(), { maxAssumptions: 1, generateTerms: () => [[], ['real']] })
    expect(plan.tasks[0]!.queries).toHaveLength(1)
  })
})

describe('baselineTerms', () => {
  it('keeps the domain words and discards the scaffolding', () => {
    const [terms] = baselineTerms(
      mkAssumption({
        statement: 'At least 2 in 10 bookkeepers contacted through partner directories reply to a cold outreach',
      }),
    )
    expect(terms).toEqual(['bookkeepers', 'contacted', 'through', 'partner', 'directories', 'reply', 'cold', 'outreach'])
  })

  it('deduplicates and caps the term count', () => {
    const [terms] = baselineTerms(
      mkAssumption({ statement: 'matching matching matching alpha beta gamma delta epsilon zeta eta theta' }),
    )
    expect(terms!.length).toBeLessThanOrEqual(8)
    expect(new Set(terms).size).toBe(terms!.length)
  })
})
