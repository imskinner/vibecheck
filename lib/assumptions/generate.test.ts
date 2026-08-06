import { describe, expect, it } from 'vitest'

import type { IdeaCanvas } from '../canvas/types'
import { createScriptedModelClient } from '../research/model'
import { generateAssumptions } from './generate'

const canvas: IdeaCanvas = {
  problem: 'Solo founders using AI coding agents lose hours re-explaining project context.',
  icp_hypothesis: 'Technical solo founders who use coding agents daily.',
  wedge_hypothesis: 'A persistent decision log the agent reads and writes automatically.',
  business_model: '$19/month per developer, no free tier.',
  stage: 'Pre-build.',
}

/** A well-formed emission item whose statement passes the falsifiability check. */
const item = (over: Record<string, unknown> = {}) => ({
  statement:
    'Technical solo founders using AI coding agents daily lose more than 3 hours a week re-explaining project context',
  category: 'problem',
  impact: 4,
  uncertainty: 4,
  test_cost: 2,
  falsification_criterion: {
    applies_to: 'technical solo founders using AI coding agents daily',
    observation: 'ask them to walk through their last three sessions and time the context setup',
    metric: 'count who spent 3+ hours a week on context re-establishment',
    comparator: '<',
    threshold: 4,
    sample_size: 10,
  },
  ...over,
})

/** Five valid assumptions spread across categories, including the mandatory access one. */
const fullLedger = () => [
  item(),
  item({
    statement:
      'At least 2 in 10 technical founders contacted through build-in-public communities reply to a cold DM within a week',
    category: 'access',
  }),
  item({
    statement:
      'At least 3 in 10 target founders already pay above $15 a month for a developer productivity tool',
    category: 'willingness_to_pay',
  }),
  item({
    statement: 'No incumbent AI coding assistant ships a persistent decision log within 12 months',
    category: 'competition',
  }),
  item({
    statement: 'The founder can ship a working decision-log prototype to 5 users within 4 weeks',
    category: 'execution',
  }),
]

const VAGUE = 'Developers want a better way to manage context'

describe('generateAssumptions', () => {
  it('turns a valid emission into a ledger with code-owned fields', async () => {
    const model = createScriptedModelClient([{ assumptions: fullLedger() }])
    const result = await generateAssumptions(canvas, { model })

    expect(result.assumptions).toHaveLength(5)
    expect(result.rejected).toEqual([])
    expect(result.discarded).toEqual([])
    expect(result.regenerationRounds).toBe(0)
    expect(result.warnings).toEqual([])

    for (const a of result.assumptions) {
      // origin and status are set by code, never read from the model — a generator that could
      // mark its own output 'supported' would bypass the entire evidence mechanism.
      expect(a.origin).toBe('canvas')
      expect(a.status).toBe('untested')
    }
    expect(result.assumptions.map((a) => a.id)).toEqual(['gen-a1', 'gen-a2', 'gen-a3', 'gen-a4', 'gen-a5'])
  })

  it('sends the pinned model id and the forced tool call', async () => {
    const model = createScriptedModelClient([{ assumptions: fullLedger() }])
    await generateAssumptions(canvas, { model })

    const [call] = model.calls
    expect(call!.request.modelId).toBe('claude-opus-5')
    expect(call!.request.tool.name).toBe('emit_assumptions')
    expect(call!.request.userMessage).toContain(canvas.problem)
  })

  it.each([
    ['bad category', item({ category: 'vibes' }), "category 'vibes' is not valid"],
    ['rating out of range', item({ impact: 7 }), 'impact must be an integer 1-5'],
    ['fractional rating', item({ uncertainty: 3.5 }), 'uncertainty must be an integer 1-5'],
    ['missing criterion', item({ falsification_criterion: undefined }), 'falsification_criterion is malformed'],
    ['zero sample size', item({ falsification_criterion: { ...(item().falsification_criterion as object), sample_size: 0 } }), 'falsification_criterion is malformed'],
    ['empty statement', item({ statement: '  ' }), 'statement is empty'],
    ['not an object', 'a string', 'assumption is not an object'],
  ])('rejects malformed output rather than repairing it: %s', async (_label, bad, reason) => {
    const model = createScriptedModelClient([{ assumptions: [...fullLedger(), bad] }])
    const result = await generateAssumptions(canvas, { model })

    expect(result.assumptions).toHaveLength(5)
    expect(result.rejected).toEqual([{ reason, raw: bad }])
  })

  it('REGENERATES a vague statement instead of keeping it', async () => {
    // PRD §5.2.1. The single most important behaviour in this module: an unfalsifiable statement
    // must never reach the ledger, because everything downstream scores against it.
    const replacement = item({
      statement:
        'At least 4 in 10 professional developers using coding agents weekly have built a custom context workaround',
      category: 'icp',
    })
    const model = createScriptedModelClient([
      { assumptions: [...fullLedger(), item({ statement: VAGUE, category: 'icp' })] },
      { assumptions: [replacement] },
    ])

    const result = await generateAssumptions(canvas, { model })

    expect(result.regenerationRounds).toBe(1)
    expect(result.discarded).toEqual([])
    expect(result.assumptions).toHaveLength(6)
    expect(result.assumptions.map((a) => a.statement)).toContain(replacement.statement)
    expect(result.assumptions.map((a) => a.statement)).not.toContain(VAGUE)
  })

  it('tells the model why the statement failed, not just that it did', async () => {
    const model = createScriptedModelClient([
      { assumptions: [...fullLedger(), item({ statement: VAGUE, category: 'icp' })] },
      { assumptions: [item({ statement: 'At least 4 in 10 senior developers have paid for a context tool', category: 'icp' })] },
    ])
    await generateAssumptions(canvas, { model })

    const regen = model.calls[1]!.request
    expect(regen.userMessage).toContain(VAGUE)
    // The lexical checker's specific complaints — the model needs them to fix the right thing.
    expect(regen.userMessage).toMatch(/threshold|preference|population/i)
    // Kept statements are listed so the replacement does not duplicate one.
    expect(regen.userMessage).toContain(fullLedger()[0]!.statement)
    expect(regen.tool.name).toBe('emit_assumptions')
  })

  it('discards a statement that stays vague after the regeneration budget', async () => {
    const model = createScriptedModelClient([
      { assumptions: [...fullLedger(), item({ statement: VAGUE, category: 'icp' })] },
      { assumptions: [item({ statement: 'People need this product', category: 'icp' })] },
      { assumptions: [item({ statement: 'There is demand for better tooling', category: 'icp' })] },
    ])

    const result = await generateAssumptions(canvas, { model, maxRegenerationRounds: 2 })

    expect(result.regenerationRounds).toBe(2)
    expect(result.assumptions).toHaveLength(5)
    expect(result.discarded).toHaveLength(1)
    expect(result.discarded[0]!.failures.length).toBeGreaterThan(0)
    expect(result.warnings).toContainEqual(expect.stringContaining('discarded'))
  })

  it('warns when the ledger has no access assumption', async () => {
    // Market Access is where products die and the category models most under-generate. A missing
    // access assumption produces an uncovered sub-score, which looks like a finding and is a gap.
    const noAccess = fullLedger().filter((a) => a.category !== 'access')
    const model = createScriptedModelClient([{ assumptions: noAccess }])

    const result = await generateAssumptions(canvas, { model })
    expect(result.warnings).toContainEqual(expect.stringContaining('access'))
  })

  it('warns when fewer than five assumptions survive', async () => {
    const model = createScriptedModelClient([{ assumptions: fullLedger().slice(0, 3) }])
    const result = await generateAssumptions(canvas, { model })

    expect(result.assumptions).toHaveLength(3)
    expect(result.warnings).toContainEqual(expect.stringContaining('5'))
  })

  it('reports an unusable emission shape instead of throwing', async () => {
    const model = createScriptedModelClient([{ unexpected: true }])
    const result = await generateAssumptions(canvas, { model })

    expect(result.assumptions).toEqual([])
    expect(result.rejected[0]!.reason).toBe('output had no assumptions array')
    expect(result.warnings).toContainEqual(expect.stringContaining('5'))
  })

  it('does not regenerate when nothing failed', async () => {
    const model = createScriptedModelClient([{ assumptions: fullLedger() }])
    await generateAssumptions(canvas, { model })
    expect(model.calls).toHaveLength(1)
  })

  it('numbers regenerated assumptions after the kept ones', async () => {
    const model = createScriptedModelClient([
      { assumptions: [...fullLedger(), item({ statement: VAGUE, category: 'icp' })] },
      { assumptions: [item({ statement: 'At least 4 in 10 senior developers have paid for a context tool', category: 'icp' })] },
    ])
    const result = await generateAssumptions(canvas, { model })

    expect(result.assumptions.map((a) => a.id)).toEqual([
      'gen-a1', 'gen-a2', 'gen-a3', 'gen-a4', 'gen-a5', 'gen-a6',
    ])
  })

  it('trims statements before storing them', async () => {
    const padded = item({ statement: `  ${item().statement}  ` })
    const model = createScriptedModelClient([{ assumptions: [padded, ...fullLedger().slice(1)] }])
    const result = await generateAssumptions(canvas, { model })

    expect(result.assumptions[0]!.statement).toBe(item().statement)
  })
})
