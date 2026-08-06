import { describe, expect, it } from 'vitest'

import { createScriptedModelClient, type ToolCallRequest } from '../../lib/research/model'
import { mkClaim, mkClaims } from '../../lib/scoring/test-factories'
import { checkFabrication, eligibleClaims, sampleClaims } from './fabrication'

const A = 'a1'

describe('eligibleClaims', () => {
  it('targets desk claims with snapshots, and nothing else', () => {
    const claims = [
      mkClaim({ assumption_id: A, source_type: 'public_post' }),
      // Primary conversations are verified at intake by the verbatim-quote check.
      mkClaim({ assumption_id: A, source_type: 'primary_conversation' }),
      // model_inference has nothing to verify against.
      mkClaim({ assumption_id: A, source_type: 'model_inference', retrieved_text: null }),
      // A desk claim that somehow lost its snapshot cannot be verified — excluded, not passed.
      mkClaim({ assumption_id: A, source_type: 'news', retrieved_text: null }),
      mkClaim({ assumption_id: A, source_type: 'company_page', retrieved_text: '  ' }),
    ]
    expect(eligibleClaims(claims)).toHaveLength(1)
    expect(eligibleClaims(claims)[0]!.source_type).toBe('public_post')
  })
})

describe('sampleClaims', () => {
  const pool = mkClaims(50, { assumption_id: A })

  it('is deterministic for a given seed', () => {
    const a = sampleClaims(pool, 10, 42).map((c) => c.id)
    const b = sampleClaims(pool, 10, 42).map((c) => c.id)
    expect(a).toEqual(b)
  })

  it('varies with the seed and never repeats a claim', () => {
    const a = sampleClaims(pool, 10, 1).map((c) => c.id)
    const b = sampleClaims(pool, 10, 2).map((c) => c.id)
    expect(a).not.toEqual(b)
    expect(new Set(a).size).toBe(10)
  })

  it('returns the whole pool when the sample exceeds it', () => {
    expect(sampleClaims(pool.slice(0, 3), 10, 1)).toHaveLength(3)
  })
})

describe('checkFabrication', () => {
  const verdictFor = (verdicts: Record<string, string>) => (request: ToolCallRequest) => {
    const match = Object.entries(verdicts).find(([text]) => request.userMessage.includes(text))
    return { verdict: match?.[1] ?? 'supported', reason: 'because of these words' }
  }

  it('computes the rate over decidable verdicts only', async () => {
    const claims = [
      mkClaim({ assumption_id: A, text: 'claim one', source_type: 'public_post' }),
      mkClaim({ assumption_id: A, text: 'claim two', source_type: 'public_post' }),
      mkClaim({ assumption_id: A, text: 'claim three', source_type: 'public_post' }),
      mkClaim({ assumption_id: A, text: 'claim four', source_type: 'public_post' }),
    ]
    const model = createScriptedModelClient(
      verdictFor({ 'claim two': 'unsupported', 'claim three': 'insufficient' }),
    )

    const report = await checkFabrication(claims, { model, sampleSize: 4, seed: 7 })

    expect(report.sampled).toBe(4)
    expect(report.supported).toBe(2)
    expect(report.unsupported).toBe(1)
    expect(report.insufficient).toBe(1)
    // 1 unsupported / 3 decidable — insufficient is a measurement gap, not a lie.
    expect(report.rate).toBeCloseTo(1 / 3, 10)
  })

  it('sends the snapshot, not the URL, to the judge', async () => {
    const claim = mkClaim({
      assumption_id: A,
      source_type: 'news',
      source_url: 'https://example.org/article',
      retrieved_text: 'the stored passage that was actually retrieved',
    })
    const model = createScriptedModelClient((request: ToolCallRequest) => {
      expect(request.userMessage).toContain('the stored passage that was actually retrieved')
      expect(request.userMessage).not.toContain('https://example.org/article')
      return { verdict: 'supported', reason: 'r' }
    })

    await checkFabrication([claim], { model, sampleSize: 1, seed: 1 })
    expect(model.calls).toHaveLength(1)
  })

  it('counts an unusable judge emission separately, never as a verdict', async () => {
    const model = createScriptedModelClient([{ verdict: 'probably fine', reason: 'r' }])
    const report = await checkFabrication(
      [mkClaim({ assumption_id: A, source_type: 'public_post' })],
      { model, sampleSize: 1, seed: 1 },
    )

    expect(report.unusable).toBe(1)
    expect(report.rate).toBeNull()
  })

  it('reports a null rate rather than a flattering zero when nothing was decidable', async () => {
    const model = createScriptedModelClient([])
    const report = await checkFabrication(
      [mkClaim({ assumption_id: A, source_type: 'primary_conversation' })],
      { model, sampleSize: 5, seed: 1 },
    )

    expect(report.eligible).toBe(0)
    expect(report.sampled).toBe(0)
    expect(report.rate).toBeNull()
    expect(model.calls).toHaveLength(0)
  })
})
