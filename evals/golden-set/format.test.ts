import { describe, expect, it } from 'vitest'

import { validateGoldenIdea } from './format'
import { loadGoldenSet } from './load'

const publicRecord = (over: Record<string, unknown> = {}) => ({
  id: 'test-entry',
  schema_version: 1,
  layer1: {
    name: 'Test',
    one_liner: 'A one liner.',
    description: 'A description of the product.',
    t0: '2020-01-01',
    outcome: 'died',
    outcome_date: '2022-01-01',
    outcome_basis: 'public_record',
    outcome_note: 'Shut down.',
    contamination_risk: 'low',
    sources: [{ url: 'https://example.org/post', note: 'Shutdown post', verified: 'fetched' }],
    ...over,
  },
})

const errorsFor = (raw: unknown) => validateGoldenIdea(raw).errors

describe('validateGoldenIdea', () => {
  it('accepts a well-formed public_record entry', () => {
    expect(validateGoldenIdea(publicRecord())).toEqual({ ok: true, errors: [] })
  })

  it('requires contamination_risk on a public_record entry', () => {
    // A famous outcome is not a blind test. Forcing the judgement makes it visible rather than
    // letting it default to something flattering.
    const { contamination_risk: _omitted, ...rest } = publicRecord().layer1
    expect(errorsFor({ ...publicRecord(), layer1: rest })).toEqual([
      expect.stringContaining('contamination_risk is required'),
    ])
  })

  it('rejects an invalid contamination_risk', () => {
    expect(errorsFor(publicRecord({ contamination_risk: 'none' }))).toEqual([
      expect.stringContaining('contamination_risk is required'),
    ])
  })

  it('does not require contamination_risk on a synthetic fixture', () => {
    const synthetic = publicRecord({ outcome_basis: 'synthetic', sources: [] })
    const { contamination_risk: _omitted, ...rest } = synthetic.layer1
    expect(validateGoldenIdea({ ...synthetic, layer1: rest }).ok).toBe(true)
  })

  it('requires real entries to cite an http(s) URL', () => {
    // Guards against a placeholder, a relative path, or the synthetic example:// scheme reaching
    // an entry that claims to document a real outcome.
    for (const url of ['example://forum/1', '/shutdowns/thing', 'TODO']) {
      expect(errorsFor(publicRecord({ sources: [{ url, note: 'n' }] }))).toEqual([
        expect.stringContaining('must be an http(s) URL'),
      ])
    }
  })

  it('requires every source to carry a note', () => {
    expect(errorsFor(publicRecord({ sources: [{ url: 'https://example.org' }] }))).toEqual([
      expect.stringContaining('sources[0].note'),
    ])
  })

  it('rejects an unknown verification level', () => {
    expect(
      errorsFor(publicRecord({ sources: [{ url: 'https://example.org', note: 'n', verified: 'trust me' }] })),
    ).toEqual([expect.stringContaining('verified must be one of')])
  })

  it('allows a source with no verification level stated', () => {
    expect(validateGoldenIdea(publicRecord({ sources: [{ url: 'https://example.org', note: 'n' }] })).ok).toBe(true)
  })
})

describe('the golden set on disk', () => {
  const { entries, failures } = loadGoldenSet()

  it('has no invalid entries', () => {
    expect(failures).toEqual([])
  })

  it('separates real entries from fixtures, and sources every real one', () => {
    const real = entries.filter(({ entry }) => entry.layer1.outcome_basis === 'public_record')
    expect(real.length).toBeGreaterThan(0)

    for (const { file, entry } of real) {
      expect(entry.layer1.sources.length, `${file} must cite a source`).toBeGreaterThan(0)
      for (const source of entry.layer1.sources) {
        expect(source.url, `${file} source must be a real URL`).toMatch(/^https?:\/\//)
      }
    }
  })

  it('keeps every fixture citation on the synthetic scheme', () => {
    // A fixture citation must never be mistakable for a real one, in either direction.
    const fixtures = entries.filter(({ entry }) => entry.layer1.outcome_basis === 'synthetic')
    for (const { file, entry } of fixtures) {
      for (const claim of entry.layer2?.claims ?? []) {
        if (claim.source_url === null) continue
        expect(claim.source_url, `${file} fixture claim must use example://`).toMatch(/^example:\/\//)
      }
    }
  })
})
