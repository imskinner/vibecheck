import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  createAnthropicModelClient,
  ModelRefusalError,
  NoToolCallError,
  TruncatedToolCallError,
} from './anthropic-client'
import type { ToolCallRequest } from './model'

const request: ToolCallRequest = {
  modelId: 'claude-sonnet-5',
  system: 'system prompt',
  userMessage: 'user message',
  tool: {
    name: 'emit_claims',
    description: 'Emit claims.',
    input_schema: { type: 'object', properties: { claims: { type: 'array' } } },
  },
}

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 }

/** Minimal stand-in for the SDK client. Nothing here touches the network. The client streams
 * and collects via finalMessage(), so the stub mirrors that surface. */
function stubSdk(message: unknown) {
  const create = vi.fn((_body: Record<string, unknown>) => ({ finalMessage: async () => message }))
  return { create, sdk: { messages: { stream: create } } as unknown as Anthropic }
}

const toolUseMessage = (input: unknown, over: Record<string, unknown> = {}) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', name: 'emit_claims', id: 'toolu_1', input }],
  usage,
  ...over,
})

describe('createAnthropicModelClient', () => {
  it('returns the tool input the model produced', async () => {
    const { sdk } = stubSdk(toolUseMessage({ claims: [{ document_index: 0 }] }))
    const model = createAnthropicModelClient({ client: sdk })

    await expect(model.callTool(request)).resolves.toEqual({ claims: [{ document_index: 0 }] })
  })

  it('forces the tool call and passes the pinned model id through', async () => {
    const { create, sdk } = stubSdk(toolUseMessage({}))
    await createAnthropicModelClient({ client: sdk }).callTool(request)

    const body = create.mock.calls[0]![0]
    expect(body['model']).toBe('claude-sonnet-5')
    expect(body['tool_choice']).toEqual({ type: 'tool', name: 'emit_claims' })
    expect(body['system']).toBe('system prompt')
  })

  it('NEVER sends sampling parameters', async () => {
    // temperature/top_p/top_k are rejected with a 400 on Opus 5 and Sonnet 5. This test exists so
    // a future "let's make it more deterministic" edit fails here rather than in production.
    const { create, sdk } = stubSdk(toolUseMessage({}))
    await createAnthropicModelClient({ client: sdk }).callTool(request)

    const body = create.mock.calls[0]![0]
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('top_k')
  })

  it('leaves headroom for thinking plus output in max_tokens', async () => {
    // Thinking is on by default on Opus 5 and max_tokens caps thinking AND response together.
    const { create, sdk } = stubSdk(toolUseMessage({}))
    await createAnthropicModelClient({ client: sdk }).callTool(request)

    expect((create.mock.calls[0]![0] as Record<string, unknown>)['max_tokens']).toBeGreaterThanOrEqual(16_000)
  })

  it('omits effort unless one is configured, and sends it when set', async () => {
    const bare = stubSdk(toolUseMessage({}))
    await createAnthropicModelClient({ client: bare.sdk }).callTool(request)
    expect(bare.create.mock.calls[0]![0] as Record<string, unknown>).not.toHaveProperty('output_config')

    const withEffort = stubSdk(toolUseMessage({}))
    await createAnthropicModelClient({ client: withEffort.sdk, effort: 'high' }).callTool(request)
    expect((withEffort.create.mock.calls[0]![0] as Record<string, unknown>)['output_config']).toEqual({
      effort: 'high',
    })
  })

  it('raises a typed error on a refusal rather than indexing into empty content', async () => {
    const { sdk } = stubSdk({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber' },
      content: [],
      usage,
    })

    await expect(createAnthropicModelClient({ client: sdk }).callTool(request)).rejects.toThrow(
      ModelRefusalError,
    )
  })

  it('raises rather than returning a truncated tool call', async () => {
    // stop_reason max_tokens with no tool_use means the JSON was cut mid-object. Handing that on
    // as a partial result would let a stage treat an incomplete extraction as complete.
    const { sdk } = stubSdk({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }], usage })

    await expect(createAnthropicModelClient({ client: sdk }).callTool(request)).rejects.toThrow(
      NoToolCallError,
    )
  })

  it('raises on a tool call that hit max_tokens, even when a tool block is present', async () => {
    // Proven live: a truncated tool call arrives with empty or partial input that parses as
    // "fields missing" downstream. It must fail loudly, not pass as the model's answer.
    const { sdk } = stubSdk({
      stop_reason: 'max_tokens',
      content: [{ type: 'tool_use', name: 'emit_claims', id: 'toolu_1', input: {} }],
      usage,
    })

    await expect(createAnthropicModelClient({ client: sdk }).callTool(request)).rejects.toThrow(
      TruncatedToolCallError,
    )
  })

  it('ignores a tool call for a different tool', async () => {
    const { sdk } = stubSdk({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'something_else', id: 'toolu_1', input: {} }],
      usage,
    })

    await expect(createAnthropicModelClient({ client: sdk }).callTool(request)).rejects.toThrow(
      NoToolCallError,
    )
  })

  it('accumulates usage across calls', async () => {
    const { sdk } = stubSdk(toolUseMessage({}))
    const model = createAnthropicModelClient({ client: sdk })

    await model.callTool(request)
    await model.callTool(request)

    expect(model.usage()).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 0,
      calls: 2,
    })
  })

  it('counts usage even when the call ends in a refusal', async () => {
    // A refused mid-stream request still bills. Losing it would understate eval cost.
    const { sdk } = stubSdk({ stop_reason: 'refusal', stop_details: null, content: [], usage })
    const model = createAnthropicModelClient({ client: sdk })

    await expect(model.callTool(request)).rejects.toThrow(ModelRefusalError)
    expect(model.usage().calls).toBe(1)
    expect(model.usage().inputTokens).toBe(100)
  })
})
