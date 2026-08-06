import { describe, expect, it } from 'vitest'

import { loadGoldenSet } from '../golden-set/load'
import { asGoldenIdea } from '../golden-set/format'
import { artifactFile, blindInput, summarise, type BlindArtifactSummary } from './blind'

const artifact = (over: Partial<BlindArtifactSummary> = {}): BlindArtifactSummary => ({
  entry_id: 'e1',
  outcome: 'died',
  contamination_risk: 'low',
  variant: 0,
  composite: 30,
  weightedMean: 45,
  subScores: { severity: 50, access: 40, wedge: 50, fit: 45 },
  ...over,
})

describe('blindInput', () => {
  it('NEVER leaks the company name — swept across every real entry on disk', () => {
    // The single easiest way to quietly invalidate M5: a model that reads "Kite" recalls the
    // shutdown instead of deriving it. This test fails if any future entry's description
    // mentions its own product.
    const { entries } = loadGoldenSet()
    const real = entries.filter(({ entry }) => entry.layer1.outcome_basis === 'public_record')
    expect(real.length).toBeGreaterThan(0)

    for (const { file, entry } of real) {
      const input = blindInput(entry).toLowerCase()
      expect(input, `${file} leaks its product name into the blind input`).not.toContain(
        entry.layer1.name.toLowerCase(),
      )
    }
  })

  it('redacts the name and possessives even when the description contains them', () => {
    const entry = asGoldenIdea({
      id: 'x',
      schema_version: 1,
      layer1: {
        name: 'Acme',
        one_liner: "Acme's dashboard for teams.",
        description: 'Acme sells a dashboard. People love acme.',
        t0: '2020-01-01',
        outcome: 'died',
        outcome_date: '2021-01-01',
        outcome_basis: 'public_record',
        outcome_note: 'n',
        contamination_risk: 'low',
        sources: [{ url: 'https://example.org', note: 'n' }],
      },
    })

    const input = blindInput(entry)
    expect(input.toLowerCase()).not.toContain('acme')
    expect(input).toContain('the product sells a dashboard')
  })

  it('never includes outcome fields', () => {
    const { entries } = loadGoldenSet()
    for (const { entry } of entries) {
      if (entry.layer1.outcome_basis !== 'public_record') continue
      expect(blindInput(entry)).not.toContain(entry.layer1.outcome_note)
    }
  })
})

describe('artifactFile', () => {
  it('names artifacts by entry and variant', () => {
    expect(artifactFile('kite-2022', 0)).toBe('kite-2022.v0.json')
    expect(artifactFile('kite-2022', 2)).toBe('kite-2022.v2.json')
  })
})

describe('summarise', () => {
  it('computes separation from variant-0 composites, split by contamination', () => {
    const died = Array.from({ length: 14 }, (_, i) =>
      artifact({ entry_id: `d${i}`, outcome: 'died', composite: 20 + i, contamination_risk: i < 2 ? 'high' : 'low' }),
    )
    const succeeded = Array.from({ length: 14 }, (_, i) =>
      artifact({ entry_id: `s${i}`, outcome: 'succeeded', composite: 60 + i, contamination_risk: 'low' }),
    )

    const summary = summarise([...died, ...succeeded])

    expect(summary.entries).toBe(28)
    expect(summary.separationAll.status).toBe('ok')
    expect(summary.separationAll.n).toBe(28)
    // The blind number excludes the two high-contamination entries.
    expect(summary.separationBlind.status).toBe('ok')
    expect(summary.separationBlind.n).toBe(26)
  })

  it('reports insufficient_n honestly for a pilot-sized run', () => {
    const summary = summarise([
      artifact({ entry_id: 'a', outcome: 'died', composite: 25 }),
      artifact({ entry_id: 'b', outcome: 'succeeded', composite: 60 }),
      artifact({ entry_id: 'c', outcome: 'died', composite: 30 }),
    ])
    expect(summary.separationAll.status).toBe('insufficient_n')
  })

  it('measures separation on the DESK signal, where blind runs actually vary', () => {
    // Every blind desk run has EQ 0, so every composite is min(weightedMean, 30) — identical.
    // A summary that measured only composites would report zero separation forever and read as
    // the kill signal when nothing was measured at all.
    const died = Array.from({ length: 10 }, (_, i) =>
      artifact({ entry_id: `d${i}`, outcome: 'died', composite: 30, weightedMean: 40 + i }),
    )
    const succeeded = Array.from({ length: 10 }, (_, i) =>
      artifact({ entry_id: `s${i}`, outcome: 'succeeded', composite: 30, weightedMean: 55 + i }),
    )

    const summary = summarise([...died, ...succeeded])

    expect(summary.separationDesk.status).toBe('ok')
    if (summary.separationDesk.status !== 'ok') return
    expect(summary.separationDesk.meanDifference).toBeCloseTo(15)
    // And the composite number shows its degeneracy honestly rather than hiding it.
    expect(summary.separationBlind.status).toBe('ok')
    if (summary.separationBlind.status !== 'ok') return
    expect(summary.separationBlind.meanDifference).toBe(0)
  })

  it('reports per-sub-score discrimination over the uncontaminated subset', () => {
    const summary = summarise([
      artifact({ entry_id: 'd1', outcome: 'died', subScores: { severity: 50, access: 30, wedge: 50, fit: 50 } }),
      artifact({ entry_id: 'd2', outcome: 'died', subScores: { severity: 50, access: 40, wedge: 50, fit: 50 }, contamination_risk: 'high' }),
      artifact({ entry_id: 's1', outcome: 'succeeded', subScores: { severity: 50, access: 60, wedge: 50, fit: 50 } }),
    ])

    // d2 is high-contamination and excluded: access meanDied is 30, not 35.
    expect(summary.perSubScore!.access).toEqual({ meanDied: 30, meanSucceeded: 60, difference: 30 })
    expect(summary.perSubScore!.severity.difference).toBe(0)
  })

  it('computes per-entry sigma on the desk signal, only at 3+ variants', () => {
    // Composite sigma in a desk-only run is trivially 0 — every variant is capped at 30 — and
    // would certify a stability nobody tested.
    const summary = summarise([
      artifact({ entry_id: 'stable', variant: 0, composite: 30, weightedMean: 30 }),
      artifact({ entry_id: 'stable', variant: 1, composite: 30, weightedMean: 32 }),
      artifact({ entry_id: 'stable', variant: 2, composite: 30, weightedMean: 34 }),
      artifact({ entry_id: 'thin', variant: 0, weightedMean: 50 }),
      artifact({ entry_id: 'thin', variant: 1, weightedMean: 90 }),
    ])

    const stable = summary.stability.find((s) => s.entry_id === 'stable')!
    const thin = summary.stability.find((s) => s.entry_id === 'thin')!
    expect(stable.sigma).toBeCloseTo(2, 10) // sample sd of 30,32,34
    expect(thin.sigma).toBeNull() // two variants is not a variance estimate
    expect(summary.maxSigma).toBeCloseTo(2, 10)
  })

  it('reports null maxSigma when nothing has enough variants', () => {
    const summary = summarise([artifact()])
    expect(summary.maxSigma).toBeNull()
  })
})
