import { describe, expect, it } from 'vitest'

import { mkAssumption } from '../scoring/test-factories'
import type { SourceDocument } from './adapters/types'
import { extractClaims } from './extract-claims'
import { createScriptedModelClient } from './model'

const assumption = mkAssumption({ id: 'a1' })

const document = (over: Partial<SourceDocument> = {}): SourceDocument => ({
  adapterId: 'hacker-news',
  url: 'https://news.ycombinator.com/item?id=1',
  title: 'A thread',
  text: 'A bookkeeper describes spending two days a month on matching.',
  sourceType: 'public_post',
  publishedAt: '2021-04-01T00:00:00.000Z',
  retrievedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const extraction = (over: Record<string, unknown> = {}) => ({
  document_index: 0,
  text: 'A bookkeeper reports two days a month on matching.',
  stance: 'supports',
  confidence: 'medium',
  ...over,
})

describe('extractClaims', () => {
  it('attaches provenance from the document, not from the model', async () => {
    const model = createScriptedModelClient([{ claims: [extraction()] }])
    const { claims } = await extractClaims(assumption, [document()], { model })

    expect(claims).toEqual([
      {
        id: 'a1-c1',
        assumption_id: 'a1',
        text: 'A bookkeeper reports two days a month on matching.',
        stance: 'supports',
        confidence: 'medium',
        source_url: 'https://news.ycombinator.com/item?id=1',
        source_type: 'public_post',
        retrieved_at: '2026-01-01T00:00:00.000Z',
        retrieved_text: 'A bookkeeper describes spending two days a month on matching.',
      },
    ])
  })

  it('CANNOT be made to fabricate a citation, even when the model supplies one', async () => {
    // The structural guarantee behind kill criterion 3. Provenance fields are copied from the
    // document the code already holds; nothing the model emits under those names is read.
    const model = createScriptedModelClient([
      {
        claims: [
          extraction({
            source_url: 'https://totally-real-research.example/study-2021',
            source_type: 'news',
            retrieved_at: '1999-01-01T00:00:00.000Z',
            retrieved_text: 'invented supporting passage',
          }),
        ],
      },
    ])

    const { claims } = await extractClaims(assumption, [document()], { model })

    expect(claims[0]!.source_url).toBe('https://news.ycombinator.com/item?id=1')
    expect(claims[0]!.source_type).toBe('public_post')
    expect(claims[0]!.retrieved_at).toBe('2026-01-01T00:00:00.000Z')
    expect(claims[0]!.retrieved_text).toBe(document().text)
  })

  it('cannot emit model_inference — only the synthesizer may', async () => {
    const model = createScriptedModelClient([{ claims: [extraction({ source_type: 'model_inference' })] }])
    const { claims } = await extractClaims(assumption, [document()], { model })
    expect(claims[0]!.source_type).toBe('public_post')
  })

  it('rejects a cite pointing at a document that was not supplied', async () => {
    // The closest this stage can get to inventing a source: cite an index that does not exist.
    const model = createScriptedModelClient([
      { claims: [extraction({ document_index: 7 }), extraction({ document_index: -1 }), extraction()] },
    ])
    const { claims, rejected } = await extractClaims(assumption, [document()], { model })

    expect(claims).toHaveLength(1)
    expect(rejected.map((r) => r.reason)).toEqual([
      'document_index 7 is not a supplied document',
      'document_index -1 is not a supplied document',
    ])
  })

  it.each([
    ['empty text', extraction({ text: '   ' }), 'claim text is empty'],
    ['bad stance', extraction({ stance: 'agrees' }), "stance 'agrees' is not valid"],
    ['bad confidence', extraction({ confidence: 'certain' }), "confidence 'certain' is not valid"],
    ['not an object', 'a string', 'extraction is not an object'],
  ])('reports malformed output rather than dropping it: %s', async (_label, bad, reason) => {
    const model = createScriptedModelClient([{ claims: [bad] }])
    const { claims, rejected } = await extractClaims(assumption, [document()], { model })

    expect(claims).toEqual([])
    expect(rejected).toEqual([{ reason, raw: bad }])
  })

  it('treats an empty extraction list as the correct answer it usually is', async () => {
    const model = createScriptedModelClient([{ claims: [] }])
    const result = await extractClaims(assumption, [document(), document()], { model })
    expect(result).toEqual({ claims: [], rejected: [] })
  })

  it('does not call the model when there are no documents', async () => {
    // Asking a model to extract from nothing is an invitation to invent.
    const model = createScriptedModelClient([])
    const result = await extractClaims(assumption, [], { model })

    expect(result).toEqual({ claims: [], rejected: [] })
    expect(model.calls).toHaveLength(0)
  })

  it('reports unusable output shape instead of throwing', async () => {
    const model = createScriptedModelClient([{ unexpected: true }])
    const { claims, rejected } = await extractClaims(assumption, [document()], { model })

    expect(claims).toEqual([])
    expect(rejected[0]!.reason).toBe('output had no claims array')
  })

  it('numbers claims deterministically and skips ids for rejected extractions', async () => {
    const model = createScriptedModelClient([
      { claims: [extraction(), extraction({ stance: 'nonsense' }), extraction({ document_index: 1 })] },
    ])
    const { claims } = await extractClaims(assumption, [document(), document({ url: 'https://example.org/2' })], {
      model,
    })

    expect(claims.map((c) => c.id)).toEqual(['a1-c1', 'a1-c2'])
    expect(claims[1]!.source_url).toBe('https://example.org/2')
  })

  it('sends the pinned model id and a forced tool call', async () => {
    const model = createScriptedModelClient([{ claims: [] }])
    await extractClaims(assumption, [document()], { model })

    const [call] = model.calls
    expect(call!.request.modelId).toBe('claude-sonnet-5')
    expect(call!.request.tool.name).toBe('emit_claims')
    expect(call!.request.userMessage).toContain('--- DOCUMENT 0 ---')
    expect(call!.request.userMessage).toContain(assumption.statement)
  })

  it('never puts a document url in the prompt — the model cites by index only', async () => {
    const model = createScriptedModelClient([{ claims: [] }])
    await extractClaims(assumption, [document()], { model })

    expect(model.calls[0]!.request.userMessage).not.toContain('news.ycombinator.com')
  })
})
