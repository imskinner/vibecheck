/**
 * Test-only builders. Kept beside the scoring code because the tests ARE the specification of
 * this module and should read like it. Not imported by anything that ships.
 */

import type {
  Assumption,
  Claim,
  FalsificationCriterion,
  Ledger,
  Rating,
} from './types'

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

/** Reset between tests that assert on generated ids. */
export function resetIds(): void {
  seq = 0
}

export function mkCriterion(over: Partial<FalsificationCriterion> = {}): FalsificationCriterion {
  return {
    applies_to: 'freelance designers billing over $60/hr',
    observation: 'ask about the last time they hit this problem',
    metric: 'count who have paid for a workaround',
    comparator: '<',
    threshold: 4,
    sample_size: 10,
    ...over,
  }
}

export function mkAssumption(over: Partial<Assumption> = {}): Assumption {
  return {
    id: over.id ?? nextId('a'),
    statement: 'Freelance designers billing over $60/hr lose more than 2h/week to file handoff',
    category: 'problem',
    origin: 'canvas',
    impact: 3 as Rating,
    uncertainty: 3 as Rating,
    test_cost: 2 as Rating,
    status: 'untested',
    falsification_criterion: mkCriterion(),
    ...over,
  }
}

export function mkClaim(over: Partial<Claim> & { assumption_id: string }): Claim {
  return {
    id: over.id ?? nextId('c'),
    text: 'A designer describes losing hours to handoff every week',
    stance: 'supports',
    source_url: 'https://example.org/post/1',
    source_type: 'public_post',
    retrieved_at: '2026-01-01T00:00:00.000Z',
    retrieved_text: 'snapshot of the source passage',
    confidence: 'high',
    ...over,
  }
}

/** N identical claims against one assumption — for saturation and clamp tests. */
export function mkClaims(
  n: number,
  over: Partial<Claim> & { assumption_id: string },
): Claim[] {
  return Array.from({ length: n }, () => mkClaim(over))
}

export function mkLedger(assumptions: Assumption[], claims: Claim[] = []): Ledger {
  return { assumptions, claims }
}
