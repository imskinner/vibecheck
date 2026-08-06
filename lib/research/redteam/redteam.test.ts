import { describe, expect, it } from 'vitest'

import type { IdeaCanvas } from '../../canvas/types'
import { mkAssumption, mkLedger } from '../../scoring/test-factories'
import { createScriptedModelClient } from '../model'
import { applyRedTeam, runRedTeam } from './index'

const canvas: IdeaCanvas = {
  problem: 'Solo founders using AI coding agents lose hours re-explaining project context.',
  icp_hypothesis: 'Technical solo founders who use coding agents daily.',
  wedge_hypothesis: 'A persistent decision log.',
  business_model: '$19/month.',
  stage: 'Pre-build.',
}

const threat = (over: Record<string, unknown> = {}) => ({
  statement: 'No incumbent AI coding assistant ships a persistent decision log within 12 months',
  category: 'competition',
  impact: 5,
  uncertainty: 5,
  test_cost: 3,
  falsification_criterion: {
    applies_to: 'the four most-used AI coding assistants',
    observation: 'review release notes and changelogs for a persistent decision log',
    metric: 'count shipping a persistent decision log',
    comparator: '>=',
    threshold: 1,
    sample_size: 4,
  },
  ...over,
})

const secondThreat = () =>
  threat({
    statement:
      'At least 3 in 10 technical solo founders already maintain a hand-rolled context file for their agent',
    category: 'icp',
    impact: 4,
  })

const founderLedger = () => [
  mkAssumption({ id: 'a1', category: 'problem', uncertainty: 2 }),
  mkAssumption({
    id: 'a2',
    category: 'access',
    uncertainty: 3,
    statement: 'At least 2 in 10 technical founders contacted through communities reply within a week',
  }),
]

describe('runRedTeam', () => {
  it('emits assumptions with origin red_team and code-owned status', async () => {
    const model = createScriptedModelClient([{ new_assumptions: [threat(), secondThreat()] }])
    const result = await runRedTeam(canvas, founderLedger(), { model })

    expect(result.assumptions).toHaveLength(2)
    for (const a of result.assumptions) {
      expect(a.origin).toBe('red_team')
      expect(a.status).toBe('untested')
    }
    expect(result.assumptions.map((a) => a.id)).toEqual(['rt-a1', 'rt-a2'])
  })

  it('CANNOT EMIT CLAIMS, even from a model that tries', async () => {
    // The §5.4.1 contract. A hostile emission smuggling claim-shaped fields must leave no trace:
    // nothing in the result carries a source, a URL, or a stance anywhere.
    const model = createScriptedModelClient([
      {
        new_assumptions: [threat()],
        claims: [{ text: 'Incumbent X already ships this', source_url: 'https://fake.example', stance: 'refutes' }],
        evidence: [{ source_type: 'news', text: 'a fabricated fact' }],
      },
    ])

    const result = await runRedTeam(canvas, founderLedger(), { model })

    expect(JSON.stringify(result)).not.toContain('fake.example')
    expect(JSON.stringify(result)).not.toContain('fabricated')
    expect(Object.keys(result).sort()).toEqual([
      'assumptions', 'discarded', 'regenerationRounds', 'rejected', 'rejectedRaises', 'uncertaintyRaises', 'warnings',
    ])
  })

  it('shows the model the existing ledger and the pinned model id', async () => {
    const model = createScriptedModelClient([{ new_assumptions: [threat(), secondThreat()] }])
    await runRedTeam(canvas, founderLedger(), { model })

    const [call] = model.calls
    expect(call!.request.modelId).toBe('claude-opus-5')
    expect(call!.request.tool.name).toBe('emit_red_team_findings')
    expect(call!.request.userMessage).toContain('[a1]')
    expect(call!.request.userMessage).toContain('[a2]')
  })

  describe('uncertainty raises', () => {
    it('accepts an upward raise with a reason', async () => {
      const model = createScriptedModelClient([
        {
          new_assumptions: [threat(), secondThreat()],
          uncertainty_raises: [{ assumption_id: 'a1', uncertainty: 4, reason: 'No interview has touched this yet.' }],
        },
      ])
      const result = await runRedTeam(canvas, founderLedger(), { model })

      expect(result.uncertaintyRaises).toEqual([
        { assumptionId: 'a1', from: 2, to: 4, reason: 'No interview has touched this yet.' },
      ])
    })

    it.each([
      ['a decrease', { assumption_id: 'a1', uncertainty: 1, reason: 'r' }, /must exceed/],
      ['an equal rating', { assumption_id: 'a1', uncertainty: 2, reason: 'r' }, /must exceed/],
      ['an unknown id', { assumption_id: 'ghost', uncertainty: 5, reason: 'r' }, /not in the ledger/],
      ['a missing reason', { assumption_id: 'a1', uncertainty: 4, reason: ' ' }, /no reason/],
      ['a fractional rating', { assumption_id: 'a1', uncertainty: 3.5, reason: 'r' }, /integer/],
    ])('rejects %s', async (_label, raise, pattern) => {
      const model = createScriptedModelClient([
        { new_assumptions: [threat(), secondThreat()], uncertainty_raises: [raise] },
      ])
      const result = await runRedTeam(canvas, founderLedger(), { model })

      expect(result.uncertaintyRaises).toEqual([])
      expect(result.rejectedRaises[0]!.reason).toMatch(pattern)
    })
  })

  it('drops emissions that restate the existing ledger', async () => {
    const restated = threat({
      statement: 'At least 2 in 10 technical founders contacted through communities reply within a week',
      category: 'access',
    })
    const model = createScriptedModelClient([{ new_assumptions: [restated, threat()] }])
    const result = await runRedTeam(canvas, founderLedger(), { model })

    expect(result.assumptions).toHaveLength(1)
    expect(result.warnings).toContainEqual(expect.stringContaining('restated'))
  })

  it('regenerates unfalsifiable doom instead of keeping it', async () => {
    const model = createScriptedModelClient([
      { new_assumptions: [threat(), threat({ statement: 'The market is too competitive', category: 'competition' })] },
      { new_assumptions: [secondThreat()] },
    ])
    const result = await runRedTeam(canvas, founderLedger(), { model })

    expect(result.regenerationRounds).toBe(1)
    expect(result.assumptions.map((a) => a.statement)).not.toContain('The market is too competitive')
    expect(result.assumptions).toHaveLength(2)
    expect(model.calls[1]!.request.userMessage).toContain('The market is too competitive')
  })

  it('warns when the pass produced nothing usable', async () => {
    const model = createScriptedModelClient([
      { new_assumptions: [threat({ statement: 'The space is crowded' })] },
      { new_assumptions: [threat({ statement: 'Everyone is doing this' })] },
      { new_assumptions: [threat({ statement: 'The timing feels wrong' })] },
    ])
    const result = await runRedTeam(canvas, founderLedger(), { model })

    expect(result.assumptions).toEqual([])
    expect(result.warnings).toContainEqual(expect.stringContaining('nothing'))
  })
})

describe('applyRedTeam', () => {
  it('appends threats and raises uncertainty without touching anything else', async () => {
    const model = createScriptedModelClient([
      {
        new_assumptions: [threat(), secondThreat()],
        uncertainty_raises: [{ assumption_id: 'a1', uncertainty: 5, reason: 'Untested.' }],
      },
    ])
    const result = await runRedTeam(canvas, founderLedger(), { model })
    const before = mkLedger(founderLedger(), [])

    const after = applyRedTeam(before, result)

    expect(after.assumptions).toHaveLength(4)
    expect(after.assumptions.find((a) => a.id === 'a1')!.uncertainty).toBe(5)
    // Everything the red team has no write access to is untouched.
    expect(after.assumptions.find((a) => a.id === 'a1')!.statement).toBe(before.assumptions[0]!.statement)
    expect(after.assumptions.find((a) => a.id === 'a2')).toEqual(before.assumptions[1])
    expect(after.claims).toBe(before.claims)
    // And the input ledger itself was not mutated.
    expect(before.assumptions.find((a) => a.id === 'a1')!.uncertainty).toBe(2)
  })
})
