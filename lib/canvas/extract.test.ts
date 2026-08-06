import { describe, expect, it } from 'vitest'

import { createScriptedModelClient } from '../research/model'
import { extractCanvas } from './extract'

const emission = (over: Record<string, unknown> = {}) => ({
  problem: 'Solo founders lose hours re-explaining context to coding agents.',
  icp_hypothesis: 'Technical solo founders using coding agents daily.',
  wedge_hypothesis: 'A persistent decision log.',
  business_model: '$19/month per developer.',
  stage: 'Pre-build.',
  ...over,
})

const INPUT = 'An idea about coding agents forgetting context between sessions.'

describe('extractCanvas', () => {
  it('extracts a full canvas', async () => {
    const model = createScriptedModelClient([emission()])
    const result = await extractCanvas(INPUT, { model })

    expect(result.reason).toBeNull()
    expect(result.canvas).toEqual({
      problem: 'Solo founders lose hours re-explaining context to coding agents.',
      icp_hypothesis: 'Technical solo founders using coding agents daily.',
      wedge_hypothesis: 'A persistent decision log.',
      business_model: '$19/month per developer.',
      stage: 'Pre-build.',
    })
    expect(result.notStated).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('CANNOT emit a founder advantage, even from a model that volunteers one', async () => {
    // The advantage is user-supplied by design — an extracted one flatters Founder Fit on
    // evidence that does not exist. The canvas type simply never receives it.
    const model = createScriptedModelClient([
      emission({ founder_unfair_advantage: 'The founder is a world-class expert.' }),
    ])
    const result = await extractCanvas(INPUT, { model })

    expect(result.canvas).not.toHaveProperty('founder_unfair_advantage')
    expect(JSON.stringify(result)).not.toContain('world-class')
  })

  it('surfaces not-stated fields as gaps instead of defaulting them', async () => {
    const model = createScriptedModelClient([
      emission({ business_model: 'not stated', stage: 'Not Stated' }),
    ])
    const result = await extractCanvas(INPUT, { model })

    expect(result.canvas!.business_model).toBe('not stated')
    expect(result.notStated).toEqual(['business_model', 'stage'])
    expect(result.warnings[0]).toContain('business_model')
  })

  it('sends the pinned cheaper model and the forced tool', async () => {
    const model = createScriptedModelClient([emission()])
    await extractCanvas(INPUT, { model })

    const [call] = model.calls
    expect(call!.request.modelId).toBe('claude-sonnet-5')
    expect(call!.request.tool.name).toBe('emit_canvas')
    expect(call!.request.userMessage).toContain(INPUT)
  })

  it.each([
    ['missing field', emission({ stage: undefined }), "field 'stage' is missing or empty"],
    ['empty field', emission({ problem: '  ' }), "field 'problem' is missing or empty"],
    ['not an object', 'prose instead', 'output was not an object'],
  ])('reports an unusable emission rather than guessing: %s', async (_label, bad, reason) => {
    const model = createScriptedModelClient([bad])
    const result = await extractCanvas(INPUT, { model })

    expect(result.canvas).toBeNull()
    expect(result.reason).toBe(reason)
  })

  it('refuses empty input without spending a model call', async () => {
    const model = createScriptedModelClient([])
    const result = await extractCanvas('   ', { model })

    expect(result.canvas).toBeNull()
    expect(result.reason).toBe('input is empty')
    expect(model.calls).toHaveLength(0)
  })

  it('trims whitespace from extracted fields', async () => {
    const model = createScriptedModelClient([emission({ problem: '  padded problem  ' })])
    const result = await extractCanvas(INPUT, { model })
    expect(result.canvas!.problem).toBe('padded problem')
  })
})
