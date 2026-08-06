import { describe, expect, it } from 'vitest'

import { createScriptedModelClient } from '../research/model'
import { scoreLedger } from '../scoring/composite'
import { diffScores } from '../scoring/movement'
import { mkAssumption, mkClaims, mkCriterion, mkLedger } from '../scoring/test-factories'
import { applyEvidence, extractEvidence } from './intake'

const AT = '2026-02-01T00:00:00.000Z'

const TRANSCRIPT = [
  'Call 1 — Dana, freelance designer.',
  'Dana: "I pay for three handoff tools right now, about $60 a month all in."',
  'Call 2 — Sam.',
  'Sam: "honestly I just export PNGs and email them, never paid for anything".',
].join('\n')

const assumptions = () => [
  mkAssumption({ id: 'a1', falsification_criterion: mkCriterion({ sample_size: 2, threshold: 1, comparator: '<' }) }),
  mkAssumption({ id: 'a2', category: 'access' }),
]

const emitted = (over: Record<string, unknown> = {}) => ({
  assumption_id: 'a1',
  text: 'Dana pays for three handoff tools, about $60 a month.',
  stance: 'supports',
  confidence: 'high',
  quote: 'I pay for three handoff tools right now, about $60 a month all in.',
  ...over,
})

describe('extractEvidence', () => {
  it('mints primary-conversation claims with code-owned provenance', async () => {
    const model = createScriptedModelClient([{ claims: [emitted()] }])
    const { proposals, rejected } = await extractEvidence(TRANSCRIPT, assumptions(), { model, retrievedAt: AT })

    expect(rejected).toEqual([])
    expect(proposals).toEqual([
      {
        id: 'ev-c1',
        assumption_id: 'a1',
        text: 'Dana pays for three handoff tools, about $60 a month.',
        stance: 'supports',
        confidence: 'high',
        source_url: null,
        source_type: 'primary_conversation',
        retrieved_at: AT,
        retrieved_text: 'I pay for three handoff tools right now, about $60 a month all in.',
      },
    ])
  })

  it('CANNOT mint anything but a primary conversation, even from a hostile model', async () => {
    // This stage lifts the cap, so it is the most attractive fabrication target in the product.
    // A smuggled source_type or URL must leave no trace.
    const model = createScriptedModelClient([
      { claims: [emitted({ source_type: 'news', source_url: 'https://fake.example', retrieved_at: '1999-01-01' })] },
    ])
    const { proposals } = await extractEvidence(TRANSCRIPT, assumptions(), { model, retrievedAt: AT })

    expect(proposals[0]!.source_type).toBe('primary_conversation')
    expect(proposals[0]!.source_url).toBeNull()
    expect(proposals[0]!.retrieved_at).toBe(AT)
  })

  it('REJECTS a quote that is not in the transcript', async () => {
    // The load-bearing rejection: a fabricated quote is a fabricated interview.
    const model = createScriptedModelClient([
      { claims: [emitted({ quote: 'I would absolutely pay $100 a month for this.' })] },
    ])
    const { proposals, rejected } = await extractEvidence(TRANSCRIPT, assumptions(), { model, retrievedAt: AT })

    expect(proposals).toEqual([])
    expect(rejected[0]!.reason).toBe('quote not found in the transcript')
  })

  it('accepts a quote despite whitespace and case differences, but not rewording', async () => {
    const reformatted = emitted({ quote: 'i pay for  three handoff tools\nright now, about $60 a month all in.' })
    const reworded = emitted({ quote: 'I pay for 3 handoff tools currently, roughly $60 monthly.' })
    const model = createScriptedModelClient([{ claims: [reformatted, reworded] }])

    const { proposals, rejected } = await extractEvidence(TRANSCRIPT, assumptions(), { model, retrievedAt: AT })
    expect(proposals).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })

  it.each([
    ['unknown assumption', emitted({ assumption_id: 'ghost' }), /not in the ledger/],
    ['bad stance', emitted({ stance: 'agrees' }), /stance/],
    ['missing quote', emitted({ quote: '' }), /no quote/],
    ['empty text', emitted({ text: ' ' }), /text is empty/],
  ])('rejects %s with the reason', async (_label, bad, pattern) => {
    const model = createScriptedModelClient([{ claims: [bad] }])
    const { proposals, rejected } = await extractEvidence(TRANSCRIPT, assumptions(), { model, retrievedAt: AT })

    expect(proposals).toEqual([])
    expect(rejected[0]!.reason).toMatch(pattern)
  })

  it('spends no model call on an empty transcript or empty ledger', async () => {
    const model = createScriptedModelClient([])
    await extractEvidence('  ', assumptions(), { model, retrievedAt: AT })
    await extractEvidence(TRANSCRIPT, [], { model, retrievedAt: AT })
    expect(model.calls).toHaveLength(0)
  })

  it('shows the model the ledger and the notes, on the pinned cheap model', async () => {
    const model = createScriptedModelClient([{ claims: [] }])
    await extractEvidence(TRANSCRIPT, assumptions(), { model, retrievedAt: AT })

    const [call] = model.calls
    expect(call!.request.modelId).toBe('claude-sonnet-5')
    expect(call!.request.userMessage).toContain('[a1]')
    expect(call!.request.userMessage).toContain('Dana')
  })
})

describe('applyEvidence', () => {
  const approved = (stance: 'supports' | 'refutes', id: string) => ({
    id,
    assumption_id: 'a1',
    text: 'An interviewee account.',
    stance,
    confidence: 'high' as const,
    source_url: null,
    source_type: 'primary_conversation' as const,
    retrieved_at: AT,
    retrieved_text: 'their words',
  })

  it('appends claims and resolves the criterion when the sample completes', () => {
    const ledger = mkLedger(assumptions(), [])
    // sample_size 2, refuted when supports < 1. Two supporting accounts → supported.
    const { ledger: after, statusChanges } = applyEvidence(ledger, [
      approved('supports', 'ev-c1'),
      approved('supports', 'ev-c2'),
    ])

    expect(after.claims).toHaveLength(2)
    expect(after.assumptions.find((a) => a.id === 'a1')!.status).toBe('supported')
    expect(statusChanges).toHaveLength(1)
    expect(statusChanges[0]).toMatchObject({ assumptionId: 'a1', from: 'untested', to: 'supported' })
    expect(statusChanges[0]!.evaluation.explanation).toContain('not met')
    // Untouched assumption and input ledger unchanged.
    expect(after.assumptions.find((a) => a.id === 'a2')!.status).toBe('untested')
    expect(ledger.claims).toHaveLength(0)
  })

  it('moves to mixed on a conflicted incomplete sample, without resolving', () => {
    const a = mkAssumption({ id: 'a1', falsification_criterion: mkCriterion({ sample_size: 10 }) })
    const { ledger: after, statusChanges } = applyEvidence(mkLedger([a], []), [
      approved('supports', 'ev-c1'),
      approved('refutes', 'ev-c2'),
    ])

    expect(after.assumptions[0]!.status).toBe('mixed')
    expect(statusChanges[0]!.evaluation.resolved).toBe(false)
  })

  it('THE M4 HEADLINE: primary evidence lifts the cap and the movement is attributable', () => {
    // The full retention mechanic in one test: a desk-only ledger sits capped; the founder logs
    // real conversations; EQ rises, the cap lifts, the composite moves, and the diff names the
    // exact claims responsible.
    const a1 = mkAssumption({
      id: 'a1',
      category: 'access',
      impact: 5,
      falsification_criterion: mkCriterion({ sample_size: 2, threshold: 1, comparator: '<' }),
    })
    const deskOnly = mkLedger([a1], mkClaims(6, { assumption_id: 'a1', source_type: 'public_post' }))
    const before = scoreLedger(deskOnly)
    expect(before.capBinding).toBe(true)
    expect(before.composite).toBe(30)

    const { ledger: after } = applyEvidence(deskOnly, [approved('supports', 'ev-c1'), approved('supports', 'ev-c2')])
    const afterScore = scoreLedger(after)

    expect(afterScore.evidenceQuality).toBe(100)
    expect(afterScore.capBinding).toBe(false)
    expect(afterScore.composite).toBeGreaterThan(before.composite)

    const movement = diffScores(before, afterScore)
    expect(movement.compositeDelta).toBeGreaterThan(0)
    expect(movement.newClaimIds.sort()).toEqual(['ev-c1', 'ev-c2'])
  })

  it('changes nothing when no claims are approved', () => {
    const ledger = mkLedger(assumptions(), [])
    const { ledger: after, statusChanges } = applyEvidence(ledger, [])
    expect(after).toEqual(ledger)
    expect(statusChanges).toEqual([])
  })
})
