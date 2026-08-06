/**
 * PRD §5.8.6 — the five invariants, stated as the tests that enforce them.
 *
 * These are not example-based checks of convenient cases. Each one is the property that has to
 * hold for every ledger the pipeline can produce, because each one is load-bearing for a promise
 * the product makes to the user.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { scoreLedger } from './composite'
import { CAP_FLOOR, MODEL_INFERENCE_MAX_SWING } from './constants'
import { diffScores } from './movement'
import { mkAssumption, mkClaim, mkClaims, mkCriterion, mkLedger } from './test-factories'
import {
  ASSUMPTION_CATEGORIES,
  ASSUMPTION_STATUSES,
  CLAIM_CONFIDENCES,
  CLAIM_STANCES,
  SUB_SCORE_KEYS,
  type Claim,
  type Ledger,
  type Rating,
} from './types'

/** Deterministic pseudo-random source. Tests must be reproducible; Math.random is banned here. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const DESK_SOURCES = ['public_post', 'company_page', 'funding_db', 'news', 'review_site', 'model_inference'] as const

function randomDeskLedger(rand: () => number): Ledger {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
  const assumptions = Array.from({ length: 1 + Math.floor(rand() * 9) }, (_, i) =>
    mkAssumption({
      id: `a${i}`,
      category: pick(ASSUMPTION_CATEGORIES),
      impact: (1 + Math.floor(rand() * 5)) as Rating,
      status: pick(ASSUMPTION_STATUSES),
    }),
  )
  const claims: Claim[] = []
  for (const a of assumptions) {
    for (let i = 0; i < Math.floor(rand() * 12); i++) {
      claims.push(
        mkClaim({
          assumption_id: a.id,
          source_type: pick(DESK_SOURCES),
          stance: pick(CLAIM_STANCES),
          confidence: pick(CLAIM_CONFIDENCES),
        }),
      )
    }
  }
  return mkLedger(assumptions, claims)
}

describe('invariant 1 — zero primary evidence cannot exceed the cap floor', () => {
  it('holds across 500 generated desk-only ledgers', () => {
    const rand = lcg(20260805)
    for (let i = 0; i < 500; i++) {
      const ledger = randomDeskLedger(rand)
      const r = scoreLedger(ledger)
      expect(r.evidenceQuality).toBe(0)
      expect(r.composite).toBeLessThanOrEqual(CAP_FLOOR)
    }
  })

  it('holds even when every assumption is marked supported without a conversation', () => {
    // The nastiest case: a caller sets statuses directly. The cap must not care.
    const ledger = mkLedger(
      ASSUMPTION_CATEGORIES.map((category, i) =>
        mkAssumption({ id: `a${i}`, category, impact: 5, status: 'supported' }),
      ),
    )
    const r = scoreLedger(ledger)
    expect(r.weightedMean).toBeCloseTo(90)
    expect(r.composite).toBe(CAP_FLOOR)
  })
})

describe('invariant 2 — model inference cannot move a sub-score more than the clamp allows', () => {
  it('holds for any quantity of inference claims', () => {
    const baseline = mkLedger(ASSUMPTION_CATEGORIES.map((category, i) => mkAssumption({ id: `a${i}`, category })))
    const before = scoreLedger(baseline)

    for (const n of [1, 10, 100, 1000]) {
      const claims = baseline.assumptions.flatMap((a) =>
        mkClaims(n, { assumption_id: a.id, source_type: 'model_inference' }),
      )
      const after = scoreLedger(mkLedger(baseline.assumptions, claims))
      for (const key of SUB_SCORE_KEYS) {
        const delta = Math.abs(after.subScores[key].value - before.subScores[key].value)
        expect(delta).toBeLessThanOrEqual(MODEL_INFERENCE_MAX_SWING + 1e-9)
      }
    }
  })
})

describe('invariant 3 — new untested assumptions add uncertainty, never negative mass', () => {
  const withEvidence = (statement: string) =>
    mkLedger(
      [mkAssumption({ id: 'a1', category: 'problem', impact: 3, statement })],
      mkClaims(6, { assumption_id: 'a1', source_type: 'company_page', stance: 'supports' }),
    )

  it('moves a strong sub-score toward 50 without crossing it', () => {
    const base = withEvidence('strong')
    const before = scoreLedger(base).subScores.severity.value
    expect(before).toBeGreaterThan(50)

    let previous = before
    for (let n = 1; n <= 20; n++) {
      const padded = mkLedger(
        [...base.assumptions, ...Array.from({ length: n }, (_, i) => mkAssumption({ id: `rt${i}`, category: 'problem', impact: 5, origin: 'red_team' }))],
        base.claims,
      )
      const value = scoreLedger(padded).subScores.severity.value
      expect(value).toBeLessThanOrEqual(previous + 1e-9)
      expect(value).toBeGreaterThanOrEqual(50 - 1e-9)
      previous = value
    }
  })

  it('moves a weak sub-score toward 50 without crossing it', () => {
    const base = mkLedger(
      [mkAssumption({ id: 'a1', category: 'problem', impact: 3 })],
      mkClaims(6, { assumption_id: 'a1', source_type: 'company_page', stance: 'refutes' }),
    )
    const before = scoreLedger(base).subScores.severity.value
    expect(before).toBeLessThan(50)

    const padded = mkLedger(
      [...base.assumptions, ...Array.from({ length: 20 }, (_, i) => mkAssumption({ id: `rt${i}`, category: 'problem', impact: 5, origin: 'red_team' }))],
      base.claims,
    )
    const after = scoreLedger(padded).subScores.severity.value
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThanOrEqual(50 + 1e-9)
  })

  it('a thorough red team tightens the cap rather than manufacturing a verdict', () => {
    // Documented consequence of PRD §5.4.1: finding six new ways to die makes the score more
    // cautious via Evidence Quality. It must not crater the sub-scores themselves.
    const covered = mkAssumption({
      id: 'a1',
      category: 'access',
      impact: 5,
      status: 'supported',
      falsification_criterion: mkCriterion({ sample_size: 5 }),
    })
    const claims = mkClaims(5, { assumption_id: 'a1', source_type: 'primary_conversation' })

    const before = scoreLedger(mkLedger([covered], claims))
    const after = scoreLedger(
      mkLedger(
        [covered, ...Array.from({ length: 6 }, (_, i) => mkAssumption({ id: `rt${i}`, category: 'competition', impact: 4, origin: 'red_team' }))],
        claims,
      ),
    )

    expect(after.evidenceQuality).toBeLessThan(before.evidenceQuality)
    expect(after.cap).toBeLessThan(before.cap)
    expect(after.subScores.access.value).toBeCloseTo(before.subScores.access.value, 6)
  })
})

describe('invariant 4 — every movement is fully attributable to claims', () => {
  it('rescoring without the claims cited for a movement reproduces the prior score exactly', () => {
    const assumptions = [
      mkAssumption({ id: 'a1', category: 'access', impact: 5, falsification_criterion: mkCriterion({ sample_size: 4 }) }),
      mkAssumption({ id: 'a2', category: 'problem', impact: 3 }),
    ]
    const deskClaims = mkClaims(3, { assumption_id: 'a2', source_type: 'public_post' })
    const before = scoreLedger(mkLedger(assumptions, deskClaims))

    const newClaims = mkClaims(4, { assumption_id: 'a1', source_type: 'primary_conversation' })
    const after = scoreLedger(mkLedger(assumptions, [...deskClaims, ...newClaims]))

    const movement = diffScores(before, after)
    expect(movement.compositeDelta).toBeGreaterThan(0)
    expect(movement.newClaimIds.sort()).toEqual(newClaims.map((c) => c.id).sort())

    const cited = new Set(movement.newClaimIds)
    const rolledBack = scoreLedger(
      mkLedger(assumptions, [...deskClaims, ...newClaims].filter((c) => !cited.has(c.id))),
    )
    expect(rolledBack).toEqual(before)
  })

  it('reports no movement when nothing changed', () => {
    const ledger = mkLedger([mkAssumption({ id: 'a1' })], mkClaims(2, { assumption_id: 'a1' }))
    const movement = diffScores(scoreLedger(ledger), scoreLedger(ledger))
    expect(movement.compositeDelta).toBe(0)
    expect(movement.newClaimIds).toEqual([])
    expect(movement.removedClaimIds).toEqual([])
  })
})

describe('invariant 5 — scoring is a pure function', () => {
  const ledger = mkLedger(
    [mkAssumption({ id: 'a1', category: 'access' }), mkAssumption({ id: 'a2', category: 'problem' })],
    mkClaims(4, { assumption_id: 'a1', source_type: 'primary_conversation' }),
  )

  it('returns identical output for identical input', () => {
    expect(scoreLedger(ledger)).toEqual(scoreLedger(ledger))
  })

  it('does not mutate its input', () => {
    const frozen: Ledger = {
      assumptions: Object.freeze(ledger.assumptions.map((a) => Object.freeze({ ...a }))) as never,
      claims: Object.freeze(ledger.claims.map((c) => Object.freeze({ ...c }))) as never,
    }
    expect(() => scoreLedger(frozen)).not.toThrow()
  })

  it('is order-independent', () => {
    const reversed = mkLedger([...ledger.assumptions].reverse(), [...ledger.claims].reverse())
    const a = scoreLedger(ledger)
    const b = scoreLedger(reversed)
    expect(b.composite).toBeCloseTo(a.composite, 10)
    expect(b.evidenceQuality).toBeCloseTo(a.evidenceQuality, 10)
  })

  it('contains no clock and no randomness anywhere in the module', () => {
    // Enforced by source scan rather than behaviour: a Date.now() creeping into scoring would
    // break eval reproducibility long before any assertion noticed. PRD §5.8.6(5).
    const dir = import.meta.dirname
    const offenders: string[] = []
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'test-factories.ts') continue
      const source = readFileSync(join(dir, file), 'utf8')
      if (/\bMath\.random\b|\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/.test(source)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
