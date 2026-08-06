import { describe, expect, it } from 'vitest'

import { mkAssumption } from '../scoring/test-factories'
import { createScriptedModelClient } from './model'
import { generateQueryTerms } from './query-terms'

const assumptions = () => [
  mkAssumption({ id: 'a1', category: 'problem' }),
  mkAssumption({ id: 'a2', category: 'access' }),
]

describe('generateQueryTerms', () => {
  it('maps usable queries by assumption id', async () => {
    const model = createScriptedModelClient([
      {
        queries: [
          { assumption_id: 'a1', searches: [['coding agent', 'forgets context'], ['claude code', 'memory']] },
          { assumption_id: 'a2', searches: [['indie hackers', 'cold dm'], ['founder outreach']] },
        ],
      },
    ])
    const result = await generateQueryTerms(assumptions(), { model })

    expect(result.terms.get('a1')).toEqual([
      ['coding agent', 'forgets context'],
      ['claude code', 'memory'],
    ])
    expect(result.fallbacks).toEqual([])
    expect(model.calls[0]!.request.modelId).toBe('claude-sonnet-5')
    expect(model.calls[0]!.request.userMessage).toContain('[a1]')
  })

  it('reports a fallback for every assumption the model skipped or mangled', async () => {
    // A bad query beats no research, but the degradation must be visible, not silent.
    const model = createScriptedModelClient([
      {
        queries: [
          { assumption_id: 'a1', searches: [['ok', 'query'], ['second', 'angle']] },
          { assumption_id: 'ghost', searches: [['for', 'nobody']] },
          { assumption_id: 'a2', searches: 'not an array' },
        ],
      },
    ])
    const result = await generateQueryTerms(assumptions(), { model })

    expect(result.terms.has('a1')).toBe(true)
    expect(result.terms.has('a2')).toBe(false)
    expect(result.fallbacks).toEqual([
      { assumptionId: 'a2', reason: 'model emitted no usable queries for this assumption' },
    ])
  })

  it('caps searches and terms rather than trusting the schema', async () => {
    const model = createScriptedModelClient([
      {
        queries: [
          {
            assumption_id: 'a1',
            searches: [
              ['one', 'two', 'three', 'four', 'five', 'six', 'seven'],
              ['a'], ['b'], ['c'], ['d'],
            ],
          },
        ],
      },
    ])
    const result = await generateQueryTerms([mkAssumption({ id: 'a1' })], { model })

    expect(result.terms.get('a1')).toHaveLength(3)
    expect(result.terms.get('a1')![0]).toHaveLength(5)
  })

  it('makes no call for an empty ledger', async () => {
    const model = createScriptedModelClient([])
    const result = await generateQueryTerms([], { model })

    expect(model.calls).toHaveLength(0)
    expect(result.terms.size).toBe(0)
  })

  it('keeps the first emission when the model repeats an id', async () => {
    const model = createScriptedModelClient([
      {
        queries: [
          { assumption_id: 'a1', searches: [['first', 'wins'], ['angle', 'two']] },
          { assumption_id: 'a1', searches: [['second', 'ignored'], ['angle', 'three']] },
        ],
      },
    ])
    const result = await generateQueryTerms([mkAssumption({ id: 'a1' })], { model })
    expect(result.terms.get('a1')![0]).toEqual(['first', 'wins'])
  })
})
