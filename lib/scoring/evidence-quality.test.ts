import { describe, expect, it } from 'vitest'

import { evidenceQuality } from './evidence-quality'
import { mkAssumption, mkClaims, mkCriterion, mkLedger } from './test-factories'

const primary = { source_type: 'primary_conversation' } as const

describe('evidenceQuality', () => {
  it('is zero for an empty ledger', () => {
    expect(evidenceQuality(mkLedger([], []))).toBe(0)
  })

  it('is zero when every claim is desk research', () => {
    // Desk research cannot raise EQ at all. That is the entire point. PRD §5.8.4.
    const a = mkAssumption({ id: 'a1' })
    const claims = [
      ...mkClaims(20, { assumption_id: 'a1', source_type: 'public_post' }),
      ...mkClaims(20, { assumption_id: 'a1', source_type: 'company_page' }),
      ...mkClaims(20, { assumption_id: 'a1', source_type: 'model_inference' }),
    ]
    expect(evidenceQuality(mkLedger([a], claims))).toBe(0)
  })

  it('scales with coverage against the pre-registered sample size', () => {
    const a = mkAssumption({ id: 'a1', impact: 5, falsification_criterion: mkCriterion({ sample_size: 10 }) })
    expect(evidenceQuality(mkLedger([a], mkClaims(5, { assumption_id: 'a1', ...primary })))).toBeCloseTo(50)
    expect(evidenceQuality(mkLedger([a], mkClaims(10, { assumption_id: 'a1', ...primary })))).toBeCloseTo(100)
  })

  it('does not reward over-shooting the sample size', () => {
    const a = mkAssumption({ id: 'a1', falsification_criterion: mkCriterion({ sample_size: 10 }) })
    const ledger = mkLedger([a], mkClaims(200, { assumption_id: 'a1', ...primary }))
    expect(evidenceQuality(ledger)).toBeCloseTo(100)
  })

  it('closes the gaming vector: coverage of trivial assumptions barely moves it', () => {
    // Log fifteen conversations against your least important assumption and you have still
    // tested nothing that could kill you. PRD §5.8.4.
    const loadBearing = mkAssumption({
      id: 'big',
      impact: 5,
      falsification_criterion: mkCriterion({ sample_size: 10 }),
    })
    const trivial = mkAssumption({
      id: 'small',
      impact: 1,
      falsification_criterion: mkCriterion({ sample_size: 10 }),
    })

    const gamed = mkLedger([loadBearing, trivial], mkClaims(15, { assumption_id: 'small', ...primary }))
    const honest = mkLedger([loadBearing, trivial], mkClaims(10, { assumption_id: 'big', ...primary }))

    expect(evidenceQuality(gamed)).toBeCloseTo(100 / 6, 2)
    expect(evidenceQuality(honest)).toBeCloseTo(500 / 6, 2)
    expect(evidenceQuality(honest)).toBeGreaterThan(4 * evidenceQuality(gamed))
  })

  it('is weighted by impact, not by assumption count', () => {
    const heavy = mkAssumption({ id: 'h', impact: 5, falsification_criterion: mkCriterion({ sample_size: 5 }) })
    const light = mkAssumption({ id: 'l1', impact: 1, falsification_criterion: mkCriterion({ sample_size: 5 }) })
    const light2 = mkAssumption({ id: 'l2', impact: 1, falsification_criterion: mkCriterion({ sample_size: 5 }) })

    const coveredHeavy = evidenceQuality(
      mkLedger([heavy, light, light2], mkClaims(5, { assumption_id: 'h', ...primary })),
    )
    const coveredLights = evidenceQuality(
      mkLedger([heavy, light, light2], [
        ...mkClaims(5, { assumption_id: 'l1', ...primary }),
        ...mkClaims(5, { assumption_id: 'l2', ...primary }),
      ]),
    )
    expect(coveredHeavy).toBeGreaterThan(coveredLights)
  })

  it('falls back to a default sample size when the criterion carries a nonsense one', () => {
    // Defends against a generator emitting sample_size: 0 and making coverage divide by zero.
    const a = mkAssumption({ id: 'a1', falsification_criterion: mkCriterion({ sample_size: 0 }) })
    const eq = evidenceQuality(mkLedger([a], mkClaims(5, { assumption_id: 'a1', ...primary })))
    expect(Number.isFinite(eq)).toBe(true)
    expect(eq).toBeCloseTo(100)
  })

  it('is diluted when the red team adds uncovered high-impact assumptions', () => {
    // Documented consequence of PRD §5.4.1: a red-team pass tightens the cap. Finding new ways to
    // die is supposed to make the score more cautious, not less.
    const covered = mkAssumption({ id: 'a1', impact: 5, falsification_criterion: mkCriterion({ sample_size: 5 }) })
    const claims = mkClaims(5, { assumption_id: 'a1', ...primary })
    const before = evidenceQuality(mkLedger([covered], claims))
    const after = evidenceQuality(
      mkLedger([covered, mkAssumption({ id: 'rt', impact: 5, origin: 'red_team' })], claims),
    )
    expect(before).toBeCloseTo(100)
    expect(after).toBeCloseTo(50)
  })
})
