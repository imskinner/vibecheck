import { describe, expect, it } from 'vitest'

import type { IdeaCanvas } from '../canvas/types'
import { mkAssumption, mkClaims, mkLedger } from '../scoring/test-factories'
import { mapCompetitors } from './competitors'
import { createScriptedModelClient } from './model'

const canvas: IdeaCanvas = {
  problem: 'Consent banners gut analytics data.',
  icp_hypothesis: 'EU-facing site owners on Google Analytics.',
  wedge_hypothesis: 'A single-page cookieless dashboard.',
  business_model: 'Subscription.',
  stage: 'Pre-build.',
}

const ledger = () =>
  mkLedger([mkAssumption({ id: 'a1' })], mkClaims(3, { assumption_id: 'a1', source_type: 'public_post' }))

const entry = (over: Record<string, unknown> = {}) => ({
  name: 'Google Analytics',
  what: 'The free incumbent with near-total market share.',
  category: 'incumbent_feature',
  threat: 'critical',
  threat_reason: 'One consent-mode changelog entry closes the wedge.',
  x: 20,
  y: 90,
  claim_ids: [],
  ...over,
})

const emission = (over: Record<string, unknown> = {}) => ({
  axes: { x_label: 'Owns the compliance story', y_label: 'Depth of reporting' },
  idea_position: { x: 85, y: 25 },
  competitors: [entry(), entry({ name: 'Matomo', category: 'direct', threat: 'high' }), entry({ name: 'A spreadsheet', category: 'diy_substitute', threat: 'medium' })],
  empty_space: 'High-compliance, low-depth is uncontested — if the compliance claim survives rt-a2.',
  ...over,
})

describe('mapCompetitors', () => {
  it('parses a landscape with code-owned basis labelling', async () => {
    const theLedger = ledger()
    const claimIds = theLedger.claims.map((c) => c.id)
    const model = createScriptedModelClient([
      emission({ competitors: [entry({ claim_ids: [claimIds[0]] }), entry({ name: 'Matomo' }), entry({ name: 'Fathom' })] }),
    ])
    const result = await mapCompetitors(canvas, theLedger, { model })

    expect(result.reason).toBeNull()
    const [grounded, recalled] = result.landscape!.competitors
    expect(grounded!.basis).toBe('claims')
    expect(grounded!.claimIds).toEqual([claimIds[0]])
    expect(recalled!.basis).toBe('inference')
  })

  it('CANNOT dress recall as research: phantom claim ids are stripped and reported', async () => {
    const model = createScriptedModelClient([
      emission({ competitors: [entry({ claim_ids: ['ghost-1', 'ghost-2'] }), entry({ name: 'B' }), entry({ name: 'C' })] }),
    ])
    const result = await mapCompetitors(canvas, ledger(), { model })

    const first = result.landscape!.competitors[0]!
    expect(first.claimIds).toEqual([])
    expect(first.basis).toBe('inference')
    expect(result.warnings).toContainEqual(expect.stringContaining('2 claim id(s) not in the ledger'))
  })

  it('warns loudly when the whole landscape is inference', async () => {
    const model = createScriptedModelClient([emission()])
    const result = await mapCompetitors(canvas, ledger(), { model })
    expect(result.warnings).toContainEqual(expect.stringContaining('every landscape entry is model inference'))
  })

  it('dedupes by name and caps the roster', async () => {
    const many = Array.from({ length: 20 }, (_, i) => entry({ name: i < 2 ? 'Same Co' : `Co ${i}` }))
    const model = createScriptedModelClient([emission({ competitors: many })])
    const result = await mapCompetitors(canvas, ledger(), { model })

    expect(result.landscape!.competitors.length).toBeLessThanOrEqual(12)
    expect(result.rejected).toContainEqual(expect.objectContaining({ reason: "duplicate competitor 'Same Co'" }))
    expect(result.warnings).toContainEqual(expect.stringContaining('capped at 12'))
  })

  it.each([
    ['bad category', entry({ category: 'frenemy' }), /category/],
    ['bad threat', entry({ threat: 'existential' }), /threat/],
    ['no position', entry({ x: 'left' }), /quadrant position/],
    ['no reason', entry({ threat_reason: ' ' }), /threat reason/],
  ])('rejects %s with the reason', async (_l, bad, pattern) => {
    const model = createScriptedModelClient([
      emission({ competitors: [bad, entry({ name: 'B' }), entry({ name: 'C' }), entry({ name: 'D' })] }),
    ])
    const result = await mapCompetitors(canvas, ledger(), { model })
    expect(result.rejected[0]!.reason).toMatch(pattern)
    expect(result.landscape!.competitors).toHaveLength(3)
  })

  it('degrades to a reason when the model call itself fails', async () => {
    // A truncated or failed call must degrade the report, never the run.
    const model = {
      callTool: async () => {
        throw new Error("model hit max_tokens while emitting 'emit_competitive_landscape'")
      },
    }
    const result = await mapCompetitors(canvas, ledger(), { model })

    expect(result.landscape).toBeNull()
    expect(result.reason).toMatch(/model call failed — .*max_tokens/)
  })

  it('asks for headroom: the landscape call raises maxTokens', async () => {
    const model = createScriptedModelClient([emission()])
    await mapCompetitors(canvas, ledger(), { model })
    expect(model.calls[0]!.request.maxTokens).toBe(32_000)
  })

  it('returns a reason, not a throw, when the emission is unusable', async () => {
    const model = createScriptedModelClient([{ axes: { x_label: 'x', y_label: 'y' } }])
    const result = await mapCompetitors(canvas, ledger(), { model })
    expect(result.landscape).toBeNull()
    expect(result.reason).toMatch(/idea position/)
  })

  it('clamps out-of-range positions instead of rejecting them', async () => {
    const model = createScriptedModelClient([
      emission({ idea_position: { x: 140, y: -10 }, competitors: [entry(), entry({ name: 'B' }), entry({ name: 'C' })] }),
    ])
    const result = await mapCompetitors(canvas, ledger(), { model })
    expect(result.landscape!.ideaPosition).toEqual({ x: 100, y: 0 })
  })

  it('shows the model the research record but never its model_inference claims', async () => {
    const withInference = mkLedger(
      [mkAssumption({ id: 'a1' })],
      [
        ...mkClaims(2, { assumption_id: 'a1', source_type: 'public_post' }),
        ...mkClaims(1, { assumption_id: 'a1', source_type: 'model_inference', text: 'an honest negative' }),
      ],
    )
    const model = createScriptedModelClient([emission()])
    await mapCompetitors(canvas, withInference, { model })

    const message = model.calls[0]!.request.userMessage
    expect(message).toContain('public_post')
    expect(message).not.toContain('an honest negative')
    expect(model.calls[0]!.request.modelId).toBe('claude-opus-5')
  })
})
