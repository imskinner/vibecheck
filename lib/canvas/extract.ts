/**
 * Raw input → IdeaCanvas. PRD §5.1.
 *
 * The output of this stage is a PROPOSAL. Research must not run until the founder has seen and
 * confirmed it — that gate lives with the caller (the `canvas_confirmed_at` column in the app,
 * an explicit flag in the CLI), but the reason lives here: garbage-in is the #1 quality failure
 * mode, and an extraction error compounds through every stage after it.
 */

import type { ModelClient } from '../research/model'
import type { IdeaCanvas } from './types'
import {
  EMIT_CANVAS_TOOL,
  MODEL_ID,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './prompts/extract-canvas.v1'

export interface ExtractOptions {
  model: ModelClient
  modelId?: string
}

const CANVAS_FIELDS = ['problem', 'icp_hypothesis', 'wedge_hypothesis', 'business_model', 'stage'] as const
type CanvasField = (typeof CANVAS_FIELDS)[number]

export interface CanvasExtraction {
  canvas: IdeaCanvas | null
  /** Non-null when the emission was unusable. The raw input is not retried silently. */
  reason: string | null
  /** Fields the input never stated. Shown to the founder as gaps, not silently defaulted. */
  notStated: CanvasField[]
  warnings: string[]
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export async function extractCanvas(rawInput: string, options: ExtractOptions): Promise<CanvasExtraction> {
  if (rawInput.trim() === '') {
    return { canvas: null, reason: 'input is empty', notStated: [], warnings: [] }
  }

  const raw = await options.model.callTool({
    modelId: options.modelId ?? MODEL_ID,
    system: SYSTEM_PROMPT,
    userMessage: renderUserMessage(rawInput),
    tool: EMIT_CANVAS_TOOL,
  })

  if (!isObject(raw)) {
    return { canvas: null, reason: 'output was not an object', notStated: [], warnings: [] }
  }

  const values = {} as Record<CanvasField, string>
  for (const field of CANVAS_FIELDS) {
    const value = raw[field]
    if (typeof value !== 'string' || value.trim() === '') {
      return { canvas: null, reason: `field '${field}' is missing or empty`, notStated: [], warnings: [] }
    }
    values[field] = value.trim()
  }

  const notStated = CANVAS_FIELDS.filter((f) => values[f].toLowerCase() === 'not stated')
  const warnings: string[] = []
  if (notStated.length > 0) {
    warnings.push(
      `the input never stated: ${notStated.join(', ')} — the founder should fill these before research runs`,
    )
  }

  // founder_unfair_advantage is deliberately absent: it is user-supplied through a separate step
  // and the tool schema has no field for it, so an extraction cannot volunteer one.
  const canvas: IdeaCanvas = {
    problem: values.problem,
    icp_hypothesis: values.icp_hypothesis,
    wedge_hypothesis: values.wedge_hypothesis,
    business_model: values.business_model,
    stage: values.stage,
  }

  return { canvas, reason: null, notStated, warnings }
}
