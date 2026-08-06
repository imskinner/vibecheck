/**
 * The model boundary.
 *
 * Every LLM stage in the pipeline goes through this interface, for three reasons:
 *
 *   · Stages are testable without an API key, a network, or a bill. The scripted client below is
 *     what the extractor, synthesizer and red-team tests run against.
 *   · Model ids stay pinned per stage and get recorded on the immutable Report row (PRD §5.9).
 *     A stage that reached for a provider SDK directly would be a stage that could silently
 *     upgrade its model and invalidate every historical eval number.
 *   · There is exactly one place to add caching, retries, and cost accounting.
 *
 * No provider SDK is imported anywhere in the codebase yet. The concrete implementation is one
 * file and lands when the dependency is agreed.
 */

export interface ToolSpec {
  name: string
  description: string
  input_schema: unknown
}

export interface ToolCallRequest {
  /** Pinned, never "latest". Recorded on the Report row. */
  modelId: string
  system: string
  userMessage: string
  /** Forced tool call. Free-text output means prose wrapping and fenced-JSON parse failures. */
  tool: ToolSpec
  maxTokens?: number
}

export interface ModelClient {
  /** Resolves to the tool input the model produced. Rejects if the model returned no tool call. */
  callTool(request: ToolCallRequest): Promise<unknown>
}

export interface ScriptedCall {
  request: ToolCallRequest
}

export interface ScriptedModelClient extends ModelClient {
  readonly calls: ScriptedCall[]
}

/**
 * Test double. Takes responses in order, or a function of the request for stages that need to
 * branch. Throws when the script runs out rather than returning undefined, so a stage making an
 * unexpected extra call fails loudly instead of silently receiving nothing.
 */
export function createScriptedModelClient(
  responses: unknown[] | ((request: ToolCallRequest) => unknown),
): ScriptedModelClient {
  const calls: ScriptedCall[] = []
  let index = 0

  return {
    calls,
    async callTool(request: ToolCallRequest): Promise<unknown> {
      calls.push({ request })
      if (typeof responses === 'function') return responses(request)
      if (index >= responses.length) {
        throw new Error(
          `scripted model client exhausted: call ${index + 1} to tool '${request.tool.name}' has no scripted response`,
        )
      }
      return responses[index++]
    },
  }
}
