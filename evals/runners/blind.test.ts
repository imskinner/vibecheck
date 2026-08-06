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

  it('computes per-entry sigma only at 3+ variants', () => {
    const summary = summarise([
      artifact({ entry_id: 'stable', variant: 0, composite: 30 }),
      artifact({ entry_id: 'stable', variant: 1, composite: 32 }),
      artifact({ entry_id: 'stable', variant: 2, composite: 34 }),
      artifact({ entry_id: 'thin', variant: 0, composite: 50 }),
      artifact({ entry_id: 'thin', variant: 1, composite: 90 }),
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
