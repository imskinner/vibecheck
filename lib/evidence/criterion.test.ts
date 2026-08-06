import { describe, expect, it } from 'vitest'

import { mkAssumption, mkClaims, mkCriterion } from '../scoring/test-factories'
import { evaluateCriterion } from './criterion'

const primary = { source_type: 'primary_conversation' } as const

// "If fewer than 4 of 10 say they've paid for a workaround, mark refuted." §5.6.5's example.
const assumption = () =>
  mkAssumption({
    id: 'a1',
    falsification_criterion: mkCriterion({ comparator: '<', threshold: 4, sample_size: 10 }),
  })

describe('evaluateCriterion', () => {
  it('stays untested below the pre-registered sample size', () => {
    const result = evaluateCriterion(assumption(), mkClaims(9, { assumption_id: 'a1', ...primary }))
    expect(result.resolved).toBe(false)
    expect(result.proposedStatus).toBe('untested')
    expect(result.explanation).toContain('9 of 10')
  })

  it('reports mixed when an incomplete sample conflicts', () => {
    const claims = [
      ...mkClaims(3, { assumption_id: 'a1', ...primary, stance: 'supports' }),
      ...mkClaims(2, { assumption_id: 'a1', ...primary, stance: 'refutes' }),
    ]
    const result = evaluateCriterion(assumption(), claims)
    expect(result.resolved).toBe(false)
    expect(result.proposedStatus).toBe('mixed')
  })

  it('refutes when the sample completes and the refutation condition is met', () => {
    // 3 of 10 paid — fewer than 4 — exactly the pre-registered kill.
    const claims = [
      ...mkClaims(3, { assumption_id: 'a1', ...primary, stance: 'supports' }),
      ...mkClaims(7, { assumption_id: 'a1', ...primary, stance: 'refutes' }),
    ]
    const result = evaluateCriterion(assumption(), claims)
    expect(result).toMatchObject({ resolved: true, proposedStatus: 'refuted', supportsCount: 3 })
    expect(result.explanation).toContain('refuted')
  })

  it('supports when the sample completes and the condition is not met', () => {
    const claims = [
      ...mkClaims(5, { assumption_id: 'a1', ...primary, stance: 'supports' }),
      ...mkClaims(5, { assumption_id: 'a1', ...primary, stance: 'refutes' }),
    ]
    expect(evaluateCriterion(assumption(), claims).proposedStatus).toBe('supported')
  })

  it('sits exactly on the boundary correctly', () => {
    // 4 of 10: "fewer than 4" is false → supported. Off-by-one here flips real verdicts.
    const claims = [
      ...mkClaims(4, { assumption_id: 'a1', ...primary, stance: 'supports' }),
      ...mkClaims(6, { assumption_id: 'a1', ...primary, stance: 'refutes' }),
    ]
    expect(evaluateCriterion(assumption(), claims).proposedStatus).toBe('supported')
  })

  it.each([
    ['<', 4, 'refuted'],
    ['<=', 3, 'refuted'],
    ['>', 2, 'refuted'],
    ['>=', 3, 'refuted'],
    ['>', 3, 'supported'],
    ['<', 3, 'supported'],
  ] as const)('evaluates comparator %s against threshold %i → %s', (comparator, threshold, expected) => {
    const a = mkAssumption({
      id: 'a1',
      falsification_criterion: mkCriterion({ comparator, threshold, sample_size: 5 }),
    })
    const claims = [
      ...mkClaims(3, { assumption_id: 'a1', ...primary, stance: 'supports' }),
      ...mkClaims(2, { assumption_id: 'a1', ...primary, stance: 'refutes' }),
    ]
    expect(evaluateCriterion(a, claims).proposedStatus).toBe(expected)
  })

  it('NEVER resolves on desk research, however much accumulates', () => {
    // The entire point of pre-registering a human sample size. 40 desk claims: still untested.
    const claims = [
      ...mkClaims(20, { assumption_id: 'a1', source_type: 'public_post', stance: 'supports' }),
      ...mkClaims(20, { assumption_id: 'a1', source_type: 'company_page', stance: 'supports' }),
    ]
    const result = evaluateCriterion(assumption(), claims)
    expect(result.resolved).toBe(false)
    expect(result.primaryCount).toBe(0)
  })

  it('excludes context-stance primary claims from the count', () => {
    const claims = [
      ...mkClaims(10, { assumption_id: 'a1', ...primary, stance: 'context' }),
      ...mkClaims(2, { assumption_id: 'a1', ...primary, stance: 'supports' }),
    ]
    const result = evaluateCriterion(assumption(), claims)
    expect(result.primaryCount).toBe(2)
    expect(result.resolved).toBe(false)
  })

  it('ignores claims attached to other assumptions', () => {
    const claims = mkClaims(10, { assumption_id: 'other', ...primary })
    expect(evaluateCriterion(assumption(), claims).primaryCount).toBe(0)
  })
})
