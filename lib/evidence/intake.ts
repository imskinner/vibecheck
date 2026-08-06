/**
 * Evidence intake: conversation notes → proposed primary claims → (after approval) ledger update
 * and score movement. PRD §5.7 — step 7 of the loop, the one the PRD calls the business.
 *
 * Two structural guarantees, in the same family as extraction's unfabricatable citations:
 *
 *   · The model cannot set provenance. The tool schema has no source_type/source_url/
 *     retrieved_at; every claim minted here is a primary_conversation with a code-stamped
 *     timestamp, and nothing else can be.
 *   · Every claim must quote the transcript VERBATIM. The quote is checked against the actual
 *     text (whitespace-normalised) and a claim whose quote is not found is rejected. This stage
 *     feeds Evidence Quality — it lifts the cap — so a claim that cannot point at the words it
 *     came from does not exist.
 *
 * Everything here is a PROPOSAL until applyEvidence. The founder approves the claim↔assumption
 * mapping (§5.7: "never auto-applies"); the status verdicts that follow are criterion arithmetic
 * (§5.2.2) and are not up for approval — the user approves the evidence, not the verdict.
 */

import type { ModelClient } from '../research/model'
import type { Assumption, Claim, ClaimConfidence, ClaimStance, Ledger } from '../scoring/types'
import { CLAIM_CONFIDENCES, CLAIM_STANCES } from '../scoring/types'
import { evaluateCriterion, type CriterionEvaluation } from './criterion'
import {
  EMIT_EVIDENCE_TOOL,
  MODEL_ID,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './prompts/extract-evidence.v1'

export interface IntakeOptions {
  model: ModelClient
  /** ISO timestamp stamped on minted claims. Injected — no ambient clock. */
  retrievedAt: string
  makeClaimId?: (index: number) => string
  modelId?: string
}

export interface RejectedEvidence {
  reason: string
  raw: unknown
}

export interface IntakeResult {
  /** Proposed claims, pending founder approval. Not yet in any ledger. */
  proposals: Claim[]
  rejected: RejectedEvidence[]
}

const defaultId = (index: number) => `ev-c${index + 1}`

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Whitespace-insensitive containment: the quote must be the transcript's words, not a rewording. */
const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

export async function extractEvidence(
  transcript: string,
  assumptions: Assumption[],
  options: IntakeOptions,
): Promise<IntakeResult> {
  if (transcript.trim() === '' || assumptions.length === 0) {
    return { proposals: [], rejected: [] }
  }

  const raw = await options.model.callTool({
    modelId: options.modelId ?? MODEL_ID,
    system: SYSTEM_PROMPT,
    userMessage: renderUserMessage(transcript, assumptions),
    tool: EMIT_EVIDENCE_TOOL,
  })

  const makeId = options.makeClaimId ?? defaultId
  const known = new Set(assumptions.map((a) => a.id))
  const haystack = normalise(transcript)

  const proposals: Claim[] = []
  const rejected: RejectedEvidence[] = []

  const items = isObject(raw) && Array.isArray(raw['claims']) ? raw['claims'] : null
  if (items === null) return { proposals, rejected: [{ reason: 'output had no claims array', raw }] }

  for (const item of items) {
    if (!isObject(item)) {
      rejected.push({ reason: 'claim is not an object', raw: item })
      continue
    }
    const assumptionId = item['assumption_id']
    if (typeof assumptionId !== 'string' || !known.has(assumptionId)) {
      rejected.push({ reason: `assumption_id '${String(assumptionId)}' is not in the ledger`, raw: item })
      continue
    }
    const text = item['text']
    if (typeof text !== 'string' || text.trim() === '') {
      rejected.push({ reason: 'claim text is empty', raw: item })
      continue
    }
    const stance = item['stance']
    if (!CLAIM_STANCES.includes(stance as never)) {
      rejected.push({ reason: `stance '${String(stance)}' is not valid`, raw: item })
      continue
    }
    const confidence = item['confidence']
    if (!CLAIM_CONFIDENCES.includes(confidence as never)) {
      rejected.push({ reason: `confidence '${String(confidence)}' is not valid`, raw: item })
      continue
    }
    const quote = item['quote']
    if (typeof quote !== 'string' || quote.trim() === '') {
      rejected.push({ reason: 'claim has no quote', raw: item })
      continue
    }
    if (!haystack.includes(normalise(quote))) {
      // The load-bearing rejection. A claim minted here lifts the cap; one that cannot point at
      // the words it came from is fabrication by construction.
      rejected.push({ reason: 'quote not found in the transcript', raw: item })
      continue
    }

    proposals.push({
      id: makeId(proposals.length),
      assumption_id: assumptionId,
      text: text.trim(),
      stance: stance as ClaimStance,
      confidence: confidence as ClaimConfidence,
      // Provenance is code-owned. This stage mints primary conversations and nothing else.
      source_url: null,
      source_type: 'primary_conversation',
      retrieved_at: options.retrievedAt,
      retrieved_text: quote.trim(),
    })
  }

  return { proposals, rejected }
}

export interface StatusChange {
  assumptionId: string
  from: Assumption['status']
  to: Assumption['status']
  evaluation: CriterionEvaluation
}

export interface AppliedEvidence {
  ledger: Ledger
  /** Criterion-driven status transitions, with the arithmetic that produced each. */
  statusChanges: StatusChange[]
}

/**
 * The post-approval step. Appends the approved claims and re-evaluates each touched assumption's
 * criterion; statuses move only where the arithmetic says so. Immutable throughout — callers
 * diff scores by scoring the ledger before and after (lib/scoring/movement.ts renders the
 * "your Market Access moved 41 → 58" view from exactly this pair).
 */
export function applyEvidence(ledger: Ledger, approved: Claim[]): AppliedEvidence {
  const claims = [...ledger.claims, ...approved]
  const touched = new Set(approved.map((c) => c.assumption_id))
  const statusChanges: StatusChange[] = []

  const assumptions = ledger.assumptions.map((assumption) => {
    if (!touched.has(assumption.id)) return assumption
    const evaluation = evaluateCriterion(assumption, claims)
    if (evaluation.proposedStatus === assumption.status) return assumption
    statusChanges.push({
      assumptionId: assumption.id,
      from: assumption.status,
      to: evaluation.proposedStatus,
      evaluation,
    })
    return { ...assumption, status: evaluation.proposedStatus }
  })

  return { ledger: { assumptions, claims }, statusChanges }
}
