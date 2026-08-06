/**
 * Documents → Claims. The ONLY place a source-backed claim is minted. PRD §5.3.
 *
 * Concentrating this in one stage is what makes provenance enforceable rather than aspirational.
 * The model chooses a document index, a stance, a paraphrase and a confidence. Everything that
 * constitutes provenance — source_url, source_type, retrieved_at, retrieved_text — is copied from
 * the document the code already holds, and is never read from the model's output.
 *
 * The consequence worth stating plainly: this stage CANNOT fabricate a citation. Not "is
 * instructed not to" — cannot. A hallucinated URL has nowhere to enter, because no field in the
 * tool schema accepts one. Kill criterion 3 in §10 is the reason that had to be structural.
 *
 * Nor can it emit `model_inference`: source_type comes from the document, and only the synthesizer
 * may record an honest negative (PRD §5.3).
 */

import type { Claim, Assumption, ClaimConfidence, ClaimStance } from '../scoring/types'
import { CLAIM_CONFIDENCES, CLAIM_STANCES } from '../scoring/types'
import type { SourceDocument } from './adapters/types'
import type { ModelClient } from './model'
import {
  EMIT_CLAIMS_TOOL,
  MODEL_ID,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './prompts/extract-claims.v1'

export interface ExtractClaimsOptions {
  model: ModelClient
  /** Deterministic by default. Injectable so persisted ids can come from the database instead. */
  makeClaimId?: (assumptionId: string, index: number) => string
  modelId?: string
}

export interface RejectedExtraction {
  reason: string
  raw: unknown
}

export interface ExtractionResult {
  claims: Claim[]
  /** Malformed output is reported, never silently dropped — this is a prompt-quality signal. */
  rejected: RejectedExtraction[]
}

const defaultClaimId = (assumptionId: string, index: number) => `${assumptionId}-c${index + 1}`

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export async function extractClaims(
  assumption: Assumption,
  documents: SourceDocument[],
  options: ExtractClaimsOptions,
): Promise<ExtractionResult> {
  // No documents means no call. Asking a model to extract from nothing invites it to invent.
  if (documents.length === 0) return { claims: [], rejected: [] }

  const raw = await options.model.callTool({
    modelId: options.modelId ?? MODEL_ID,
    system: SYSTEM_PROMPT,
    userMessage: renderUserMessage(assumption, documents),
    tool: EMIT_CLAIMS_TOOL,
  })

  const makeClaimId = options.makeClaimId ?? defaultClaimId
  const claims: Claim[] = []
  const rejected: RejectedExtraction[] = []

  const extractions = isObject(raw) && Array.isArray(raw['claims']) ? raw['claims'] : null
  if (extractions === null) {
    return { claims: [], rejected: [{ reason: 'output had no claims array', raw }] }
  }

  for (const extraction of extractions) {
    if (!isObject(extraction)) {
      rejected.push({ reason: 'extraction is not an object', raw: extraction })
      continue
    }

    const index = extraction['document_index']
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= documents.length) {
      // A cite pointing at nothing is the closest this stage can get to a fabricated source.
      rejected.push({ reason: `document_index ${String(index)} is not a supplied document`, raw: extraction })
      continue
    }

    const text = extraction['text']
    if (typeof text !== 'string' || text.trim().length === 0) {
      rejected.push({ reason: 'claim text is empty', raw: extraction })
      continue
    }

    const stance = extraction['stance']
    if (!isMember(CLAIM_STANCES, stance)) {
      rejected.push({ reason: `stance '${String(stance)}' is not valid`, raw: extraction })
      continue
    }

    const confidence = extraction['confidence']
    if (!isMember(CLAIM_CONFIDENCES, confidence)) {
      rejected.push({ reason: `confidence '${String(confidence)}' is not valid`, raw: extraction })
      continue
    }

    const document = documents[index]!

    claims.push({
      id: makeClaimId(assumption.id, claims.length),
      assumption_id: assumption.id,
      text: text.trim(),
      stance: stance as ClaimStance,
      confidence: confidence as ClaimConfidence,
      // Provenance comes from the document, never from the model. Anything the model supplied
      // under these names is ignored by construction.
      source_url: document.url,
      source_type: document.sourceType,
      retrieved_at: document.retrievedAt,
      retrieved_text: document.text,
    })
  }

  return { claims, rejected }
}

function isMember<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}
