import { describe, expect, it } from 'vitest'

import { loadGoldenSet } from '../../evals/golden-set/load'
import { checkFalsifiability } from './falsifiability'

const rules = (statement: string) => checkFalsifiability(statement).failures.map((f) => f.rule)

describe('checkFalsifiability', () => {
  it('accepts a statement naming a population, a behaviour and a threshold', () => {
    const result = checkFalsifiability(
      'Freelance designers billing over $60/hr lose more than 2 hours a week to file handoff',
    )
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('rejects the canonical vague assumption', () => {
    const result = checkFalsifiability('There is demand for this product')
    expect(result.ok).toBe(false)
    expect(result.failures.map((f) => f.rule)).toEqual(
      expect.arrayContaining(['observable_predicate', 'threshold']),
    )
  })

  it('cannot detect a MISSING population, only a vague one', () => {
    // Documented limitation, pinned so nobody mistakes a pass here for a rubric pass. "There is
    // demand for this product" names no population at all, and no lexical rule catches an absence.
    // This is precisely the half of §5.2.1 the model rubric pass covers, arriving with the
    // generator at M1. Neither half is sufficient alone.
    expect(rules('There is demand for this product')).not.toContain('named_population')
  })

  describe('named population', () => {
    it('rejects an unqualified population noun', () => {
      expect(rules('Users lose more than 2 hours a week to this')).toContain('named_population')
      expect(rules('Companies pay at least $500 a month for this today')).toContain('named_population')
    })

    it('accepts one narrowed by a preceding modifier', () => {
      expect(rules('B2B founders already pay at least $29 a month for a drafting tool')).not.toContain(
        'named_population',
      )
    })

    it('accepts one narrowed by a following clause', () => {
      expect(
        rules('Founders who post to LinkedIn weekly spend more than 3 hours a week drafting'),
      ).not.toContain('named_population')
    })

    it('does not treat an article as a qualifier', () => {
      expect(rules('The users spend more than 2 hours a week on this')).toContain('named_population')
    })
  })

  describe('observable predicate', () => {
    it.each([
      'Independent clinics would pay $80 a month for this',
      'At least 4 in 10 bookkeepers want a faster reconciliation flow',
      'More than half of surveyed owners are interested in automating intake',
      'At least 6 of 10 practices plan to replace their booking system this year',
    ])('rejects stated intent: %s', (statement) => {
      expect(rules(statement)).toContain('observable_predicate')
    })

    it('accepts a forecast about a third party, which is observable', () => {
      // Mom Test bans the ICP's self-reported intent, not predictions about what a company ships.
      expect(
        rules('No incumbent scheduling tool ships built-in AI drafting within 12 months'),
      ).not.toContain('observable_predicate')
    })

    it('accepts past behaviour phrasing of the same underlying question', () => {
      expect(rules('At least 4 in 10 clinic owners already pay above $80 a month for scheduling')).toEqual([])
    })
  })

  describe('threshold', () => {
    it('rejects a statement with no quantity', () => {
      expect(rules('Independent physiotherapy clinics lose revenue to no-shows')).toContain('threshold')
    })

    it('rejects a capability claim with no quantity', () => {
      // The shape that slipped through the first fixture pass: sounds concrete, measures nothing.
      expect(rules('The founder can support clinic onboarding without in-person visits')).toContain('threshold')
      expect(rules('Bookkeepers can be reached repeatably through partner directories')).toContain('threshold')
    })

    it('accepts a numeric threshold', () => {
      expect(rules('Independent physiotherapy clinics lose more than 8% of booked revenue to no-shows')).toEqual([])
    })

    it('accepts a worded quantifier without digits', () => {
      expect(rules('No incumbent booking system bundles automated waitlist backfill')).not.toContain('threshold')
    })
  })
})

describe('golden-set fixtures obey the rule the generator will be held to', () => {
  // If a hand-authored fixture cannot pass the falsifiability check, the check is wrong or the
  // fixture is — and either way it must not sit in the repo as an example to copy.
  const { entries } = loadGoldenSet()
  const statements = entries.flatMap(({ entry }) =>
    (entry.layer2?.assumptions ?? []).map((a) => [`${entry.id}/${a.id}`, a.statement] as const),
  )

  it('has fixtures to check', () => {
    expect(statements.length).toBeGreaterThan(0)
  })

  it.each(statements)('%s is falsifiable', (_id, statement) => {
    const result = checkFalsifiability(statement)
    expect(result.failures).toEqual([])
  })
})
