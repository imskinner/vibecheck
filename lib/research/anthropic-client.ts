/**
 * The one place a provider SDK is imported. PRD §8.
 *
 * Everything else in the pipeline talks to `ModelClient` (see model.ts), so stages stay testable
 * without an API key and this file stays the only thing to change if the provider does.
 *
 * Notes that are easy to get wrong on the current API and are load-bearing here:
 *
 *   · `temperature`, `top_p` and `top_k` are REJECTED with a 400 on Opus 5 / Sonnet 5. They are not
 *     sent. Determinism is not available from sampling parameters — the scoring function is where
 *     this product gets its reproducibility, not the model.
 *   · Thinking is ON by default on Opus 5, and `max_tokens` caps thinking PLUS response together.
 *     The default below leaves headroom for both; a tight budget truncates the tool call and the
 *     JSON arrives malformed.
 *   · Model ids are passed through from the caller and are pinned in the versioned prompt files,
 *     never defaulted here. A stage that could silently change model would invalidate every
 *     historical eval number (PRD §5.9).
 */

import Anthropic from '@anthropic-ai/sdk'

import type { ModelClient, ToolCallRequest } from './model'

/**
 * Leaves room for thinking plus a tool call. Non-streaming, so kept under the level where the
 * SDK's HTTP timeout becomes the binding constraint.
 */
const DEFAULT_MAX_TOKENS = 16_000

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AnthropicModelClientOptions {
  /** Pre-configured SDK client. Omit to construct one from the ambient credentials. */
  client?: Anthropic
  /** Retries on 429 and 5xx. The SDK handles the backoff. */
  maxRetries?: number
  /** Milliseconds in the TypeScript SDK, unlike the Python one. */
  timeoutMs?: number
  maxTokens?: number
  /** Thinking depth and overall token spend. Revisit with eval data, not taste. */
  effort?: Effort
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  calls: number
}

export interface AnthropicModelClient extends ModelClient {
  /** Running totals for the process. Eval runs are the reason this is worth having. */
  usage(): UsageTotals
}

export class ModelRefusalError extends Error {
  constructor(
    readonly modelId: string,
    readonly category: string | null,
  ) {
    super(`model ${modelId} declined the request${category ? ` (${category})` : ''}`)
    this.name = 'ModelRefusalError'
  }
}

export class NoToolCallError extends Error {
  constructor(
    readonly modelId: string,
    readonly toolName: string,
    readonly stopReason: string | null,
  ) {
    super(
      `model ${modelId} returned no '${toolName}' tool call (stop_reason: ${stopReason ?? 'null'})`,
    )
    this.name = 'NoToolCallError'
  }
}

export class TruncatedToolCallError extends Error {
  constructor(
    readonly modelId: string,
    readonly toolName: string,
  ) {
    super(
      `model ${modelId} hit max_tokens while emitting '${toolName}' — the tool input is truncated and cannot be trusted. Raise maxTokens for this stage.`,
    )
    this.name = 'TruncatedToolCallError'
  }
}

export function createAnthropicModelClient(
  options: AnthropicModelClientOptions = {},
): AnthropicModelClient {
  const client =
    options.client ??
    new Anthropic({
      maxRetries: options.maxRetries ?? 3,
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    })

  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    calls: 0,
  }

  return {
    usage: () => ({ ...totals }),

    async callTool(request: ToolCallRequest): Promise<unknown> {
      // Streamed, then collected. Non-streaming requests are refused by the SDK at the token
      // budgets the big-input stages need (proven live at 32k), and streaming removes the
      // HTTP-timeout class for every stage at once. finalMessage() yields the same Message
      // object create() would have.
      const stream = client.messages.stream({
        model: request.modelId,
        max_tokens: request.maxTokens ?? options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: [{ role: 'user', content: request.userMessage }],
        tools: [
          {
            name: request.tool.name,
            description: request.tool.description,
            // Deliberately NOT `strict: true`. Strict mode drops numeric range constraints
            // (`minimum`/`maximum`) and array bounds (`minItems`/`maxItems`), which our schemas
            // rely on for the 1–5 ratings and the 5–9 assumption count. Every field is validated
            // downstream anyway — see extract-claims.ts and falsifiability.ts — so the schema
            // keeps its documentation value instead.
            input_schema: request.tool.input_schema as Anthropic.Tool['input_schema'],
          },
        ],
        // Forced: free text means prose wrapping and fenced-JSON parse failures.
        tool_choice: { type: 'tool', name: request.tool.name },
        ...(options.effort === undefined ? {} : { output_config: { effort: options.effort } }),
      })
      const message = await stream.finalMessage()

      totals.calls += 1
      totals.inputTokens += message.usage.input_tokens
      totals.outputTokens += message.usage.output_tokens
      totals.cacheReadInputTokens += message.usage.cache_read_input_tokens ?? 0
      totals.cacheCreationInputTokens += message.usage.cache_creation_input_tokens ?? 0

      // Check before reading content: a refusal returns HTTP 200 with empty or partial content,
      // so indexing into content[0] would throw something unhelpful instead.
      if (message.stop_reason === 'refusal') {
        throw new ModelRefusalError(request.modelId, message.stop_details?.category ?? null)
      }

      const toolUse = message.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === 'tool_use' && block.name === request.tool.name,
      )

      if (!toolUse) {
        throw new NoToolCallError(request.modelId, request.tool.name, message.stop_reason)
      }

      // A tool call that hit max_tokens is a half-written object the API surfaces as empty or
      // partial input — the first live landscape run proved it arrives looking complete and
      // parses as "fields missing". Thinking is on by default and shares the max_tokens budget
      // with the output, so big-input stages hit this before anything else does. Fail loudly;
      // never hand a truncated emission to a stage that will treat it as the model's answer.
      if (message.stop_reason === 'max_tokens') {
        throw new TruncatedToolCallError(request.modelId, request.tool.name)
      }

      return toolUse.input
    },
  }
}
