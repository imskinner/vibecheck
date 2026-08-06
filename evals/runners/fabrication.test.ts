import { describe, expect, it } from 'vitest'

import { createScriptedModelClient, type ToolCallRequest } from '../../lib/research/model'
import { mkClaim } from '../../lib/scoring/test-factories'
import type { Claim } from '../../lib/scoring/types'
import { checkFabrication, eligibleClaims, sampleClaims, type VerifiableClaim } from './fabrication'

const A = 'a1'
const STATEMENT = 'Solo founders will let a third-party service store project decision text off-machine'

const item = (over: Partial<Claim> = {}): VerifiableClaim => ({
  claim: mkClaim({ assumption_id: A, source_type: 'public_post', ...over }),
  assumptionStatement: STATEMENT,
})

describe('eligibleClaims', () => {
  it('targets desk claims with snapshots, and nothing else', () => {
    const items = [
      item(),
      // Primary conversations are verified at intake by the verbatim-quote check.
      item({ source_type: 'primary_conversation' }),
      // model_inference has nothing to verify against.
      item({ source_type: 'model_inference', retrieved_text: null }),
      // A desk claim that lost its snapshot cannot be verified — excluded, not passed.
      item({ source_type: 'news', retrieved_text: null }),
      item({ source_type: 'company_page', retrieved_text: '  ' }),
    ]
    expect(eligibleClaims(items)).toHaveLength(1)
    expect(eligibleClaims(items)[0]!.claim.source_type).toBe('public_post')
  })
})

describe('sampleClaims', () => {
  const pool = Array.from({ length: 50 }, (_, i) => item({ id: `c${i}` }))

  it('is deterministic for a given seed', () => {
    const a = sampleClaims(pool, 10, 42).map((x) => x.claim.id)
    const b = sampleClaims(pool, 10, 42).map((x) => x.claim.id)
    expect(a).toEqual(b)
  })

  it('varies with the seed and never repeats a claim', () => {
    const a = sampleClaims(pool, 10, 1).map((x) => x.claim.id)
    const b = sampleClaims(pool, 10, 2).map((x) => x.claim.id)
    expect(a).not.toEqual(b)
    expect(new Set(a).size).toBe(10)
  })

  it('returns the whole pool when the sample exceeds it', () => {
    expect(sampleClaims(pool.slice(0, 3), 10, 1)).toHaveLength(3)
  })
})

describe('checkFabrication', () => {
  const judge = (answers: Record<string, { content: string; stance: string }>) =>
    (request: ToolCallRequest) => {
      const match = Object.entries(answers).find(([text]) => request.userMessage.includes(text))
      return { content: match?.[1].content ?? 'supported', stance: match?.[1].stance ?? 'correct', reason: 'r' }
    }

  it('keeps fabrication and stance error as SEPARATE rates', () => {
    // The v1 lesson: a claim whose content the snapshot backs but whose direction is wrong is a
    // miscategorisation, not an invention. Folding them together made 12.5% out of what may have
    // been 0% fabrication.
    const items = [
      item({ text: 'claim one' }),
      item({ text: 'claim two' }),
      item({ text: 'claim three' }),
      item({ text: 'claim four' }),
    ]
    const model = createScriptedModelClient(
      judge({
        'claim two': { content: 'unsupported', stance: 'unclear' },
        'claim three': { content: 'supported', stance: 'inverted' },
      }),
    )

    return checkFabrication(items, { model, sampleSize: 4, seed: 7 }).then((report) => {
      expect(report.contentSupported).toBe(3)
      expect(report.contentUnsupported).toBe(1)
      expect(report.fabricationRate).toBeCloseTo(1 / 4, 10)
      expect(report.stanceInverted).toBe(1)
      expect(report.stanceErrorRate).toBeCloseTo(1 / 3, 10)
    })
  })

  it('shows the judge the assumption the stance is relative to', async () => {
    const model = createScriptedModelClient((request: ToolCallRequest) => {
      expect(request.userMessage).toContain(STATEMENT)
      expect(request.userMessage).toContain('THE SNAPSHOT')
      return { content: 'supported', stance: 'correct', reason: 'r' }
    })
    await checkFabrication([item()], { model, sampleSize: 1, seed: 1 })
    expect(model.calls).toHaveLength(1)
  })

  it('sends the snapshot, never the URL', async () => {
    const target = item({
      source_type: 'news',
      source_url: 'https://example.org/article',
      retrieved_text: 'the stored passage that was actually retrieved',
    })
    const model = createScriptedModelClient((request: ToolCallRequest) => {
      expect(request.userMessage).toContain('the stored passage that was actually retrieved')
      expect(request.userMessage).not.toContain('https://example.org/article')
      return { content: 'supported', stance: 'correct', reason: 'r' }
    })
    await checkFabrication([target], { model, sampleSize: 1, seed: 1 })
  })

  it('excludes insufficient and unclear from both rates', async () => {
    const model = createScriptedModelClient([
      { content: 'insufficient', stance: 'unclear', reason: 'truncated' },
    ])
    const report = await checkFabrication([item()], { model, sampleSize: 1, seed: 1 })

    expect(report.contentInsufficient).toBe(1)
    expect(report.stanceUnclear).toBe(1)
    expect(report.fabricationRate).toBeNull()
    expect(report.stanceErrorRate).toBeNull()
  })

  it('counts an unusable judge emission separately, never as a verdict', async () => {
    const model = createScriptedModelClient([{ content: 'probably fine', stance: 'correct', reason: 'r' }])
    const report = await checkFabrication([item()], { model, sampleSize: 1, seed: 1 })

    expect(report.unusable).toBe(1)
    expect(report.fabricationRate).toBeNull()
  })

  it('reports null rates rather than flattering zeros when nothing was eligible', async () => {
    const model = createScriptedModelClient([])
    const report = await checkFabrication(
      [item({ source_type: 'primary_conversation' })],
      { model, sampleSize: 5, seed: 1 },
    )

    expect(report.eligible).toBe(0)
    expect(report.fabricationRate).toBeNull()
    expect(model.calls).toHaveLength(0)
  })
})
