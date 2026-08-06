import { describe, expect, it } from 'vitest'

import type { IdeaCanvas } from '../canvas/types'
import { AdapterRegistry } from '../research/adapters/registry'
import type { SourceAdapter, SourceDocument } from '../research/adapters/types'
import { createScriptedModelClient, type ToolCallRequest } from '../research/model'
import { runPipeline } from './index'

const canvas: IdeaCanvas = {
  problem: 'Solo founders using AI coding agents lose hours re-explaining project context.',
  icp_hypothesis: 'Technical solo founders who use coding agents daily.',
  wedge_hypothesis: 'A persistent decision log.',
  business_model: '$19/month.',
  stage: 'Pre-build.',
}

const AT = '2026-01-01T00:00:00.000Z'

const generated = (over: Record<string, unknown> = {}) => ({
  statement:
    'Technical solo founders using AI coding agents daily lose more than 3 hours a week re-explaining project context',
  category: 'problem',
  impact: 4,
  uncertainty: 4,
  test_cost: 2,
  falsification_criterion: {
    applies_to: 'technical solo founders using AI coding agents daily',
    observation: 'time the context setup across their last three sessions',
    metric: 'count spending 3+ hours a week',
    comparator: '<',
    threshold: 4,
    sample_size: 10,
  },
  ...over,
})

const ACCESS_STATEMENT =
  'At least 2 in 10 technical founders contacted through build-in-public communities reply to a cold DM within a week'

const canvasLedger = () => [
  generated(),
  generated({ statement: ACCESS_STATEMENT, category: 'access', impact: 5, uncertainty: 5, test_cost: 1 }),
  generated({
    statement: 'At least 3 in 10 target founders already pay above $15 a month for a developer productivity tool',
    category: 'willingness_to_pay',
  }),
  generated({
    statement: 'No incumbent AI coding assistant ships a persistent decision log within 12 months',
    category: 'competition',
  }),
  generated({
    statement: 'The founder can ship a working decision-log prototype to 5 users within 4 weeks',
    category: 'execution',
  }),
]

const threat = () =>
  generated({
    statement:
      'At least 3 in 10 technical solo founders already maintain a hand-rolled context file for their agent',
    category: 'icp',
    impact: 5,
    uncertainty: 5,
    test_cost: 2,
  })

/**
 * Stateless dispatch on tool name, so the same client drives every stage — and the pipeline can
 * be run twice against it to prove determinism.
 */
const dispatchModel = () =>
  createScriptedModelClient((request: ToolCallRequest) => {
    switch (request.tool.name) {
      case 'emit_assumptions':
        return { assumptions: canvasLedger() }
      case 'emit_red_team_findings':
        return {
          new_assumptions: [threat(), generated({ statement: 'No incumbent agent harness ships decision persistence within 12 months', category: 'timing' })],
          uncertainty_raises: [{ assumption_id: 'gen-a1', uncertainty: 5, reason: 'Nobody has timed this.' }],
        }
      case 'emit_claims':
        // The access assumption comes back empty — the honest-negative path end to end.
        if (request.userMessage.includes(ACCESS_STATEMENT)) return { claims: [] }
        return { claims: [{ document_index: 0, text: 'A supporting post.', stance: 'supports', confidence: 'medium' }] }
      default:
        throw new Error(`unexpected tool ${request.tool.name}`)
    }
  })

const doc = (url: string): SourceDocument => ({
  adapterId: 'stub',
  url,
  title: null,
  text: 'A founder describes the problem.',
  sourceType: 'public_post',
  publishedAt: '2021-01-01T00:00:00.000Z',
  retrievedAt: AT,
})

const stubRegistry = () =>
  new AdapterRegistry().register({
    id: 'stub',
    compliance: 'public_api',
    legalNotes: 'test stub',
    sourceType: 'public_post',
    isEnabled: () => true,
    search: async (q) => [doc(`https://example.org/${q.assumptionId}`)],
  } satisfies SourceAdapter)

describe('runPipeline', () => {
  it('runs idea → ledger → research → score, end to end', async () => {
    const result = await runPipeline(canvas, {
      model: dispatchModel(),
      registry: stubRegistry(),
      retrievedAt: AT,
    })

    // 5 canvas + 2 red-team assumptions, with the raise applied.
    expect(result.ledger.assumptions).toHaveLength(7)
    expect(result.ledger.assumptions.filter((a) => a.origin === 'canvas')).toHaveLength(5)
    expect(result.ledger.assumptions.filter((a) => a.origin === 'red_team')).toHaveLength(2)
    expect(result.ledger.assumptions.find((a) => a.id === 'gen-a1')!.uncertainty).toBe(5)

    // Every assumption got researched: 6 with a claim, 1 honest negative.
    expect(result.research.perAssumption).toHaveLength(7)
    expect(result.honestNegatives).toBe(1)
    const negative = result.ledger.claims.find((c) => c.source_type === 'model_inference')!
    expect(negative.stance).toBe('context')
    expect(result.ledger.claims).toHaveLength(7)
  })

  it('THE HEADLINE, THROUGH FIVE STAGES: desk research alone cannot beat 30', async () => {
    // Generation, red team, research, synthesis, scoring — and still no primary conversation
    // anywhere, so the cap binds. This is the product's soul surviving the whole pipeline.
    const result = await runPipeline(canvas, {
      model: dispatchModel(),
      registry: stubRegistry(),
      retrievedAt: AT,
    })

    expect(result.score.evidenceQuality).toBe(0)
    expect(result.score.capBinding).toBe(true)
    expect(result.score.composite).toBe(30)
  })

  it('ranks kill-shots over the combined ledger, red-team threats eligible', async () => {
    const result = await runPipeline(canvas, {
      model: dispatchModel(),
      registry: stubRegistry(),
      retrievedAt: AT,
    })

    expect(result.killShots).toHaveLength(3)
    // gen-a1's raised uncertainty (5) times impact 4, cheapness 4 = 80; the access assumption
    // (5·5·5=125) and the icp threat (5·5·4=100) outrank it.
    expect(result.killShots[0]!.assumption.category).toBe('access')
    expect(result.killShots[1]!.assumption.origin).toBe('red_team')
  })

  it('records provenance for the immutable Report row', async () => {
    const result = await runPipeline(canvas, {
      model: dispatchModel(),
      registry: stubRegistry(),
      retrievedAt: AT,
    })

    expect(result.provenance.promptVersions).toEqual({
      'generate-assumptions': 'v1',
      'red-team': 'v1',
      'extract-claims': 'v1',
    })
    expect(result.provenance.modelIds['generate-assumptions']).toBe('claude-opus-5')
    expect(result.provenance.modelIds['extract-claims']).toBe('claude-sonnet-5')
    expect(result.research.adapterSet).toEqual([
      { id: 'stub', compliance: 'public_api', sourceType: 'public_post', enabled: true },
    ])
  })

  it('aggregates stage warnings with their stage named', async () => {
    const model = createScriptedModelClient((request: ToolCallRequest) => {
      switch (request.tool.name) {
        case 'emit_assumptions':
          // Only 3 assumptions and no access one — two generation warnings.
          return { assumptions: canvasLedger().slice(2) }
        case 'emit_red_team_findings':
          return { new_assumptions: [threat(), generated({ statement: 'No incumbent agent harness ships decision persistence within 12 months', category: 'timing' })] }
        case 'emit_claims':
          return { claims: [{ document_index: 0, text: 'A post.', stance: 'supports', confidence: 'medium' }] }
        default:
          throw new Error('unexpected')
      }
    })

    const result = await runPipeline(canvas, { model, registry: stubRegistry(), retrievedAt: AT })

    expect(result.warnings).toContainEqual(expect.stringMatching(/^generation: .*access/))
    expect(result.warnings).toContainEqual(expect.stringMatching(/^generation: .*only 3/))
  })

  it('is deterministic: the same inputs produce the identical result', async () => {
    const run = () =>
      runPipeline(canvas, { model: dispatchModel(), registry: stubRegistry(), retrievedAt: AT })

    expect(await run()).toEqual(await run())
  })

  it('propagates the knowledge cutoff to research', async () => {
    const cutoffs: (string | undefined)[] = []
    const registry = new AdapterRegistry().register({
      id: 'stub',
      compliance: 'public_api',
      legalNotes: 'test',
      sourceType: 'public_post',
      isEnabled: () => true,
      search: async (q) => {
        cutoffs.push(q.notAfter)
        return []
      },
    } satisfies SourceAdapter)

    await runPipeline(canvas, { model: dispatchModel(), registry, retrievedAt: AT, notAfter: '2021-09-01' })

    expect(cutoffs.length).toBeGreaterThan(0)
    expect(new Set(cutoffs)).toEqual(new Set(['2021-09-01']))
  })
})
