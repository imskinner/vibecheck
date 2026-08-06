/**
 * Fabrication rate. PRD §7, kill criterion 3: above 5% and undriveable-down, the product is
 * dangerous and should not ship.
 *
 * Samples desk claims that carry a snapshot and asks a judge whether the snapshot supports the
 * claim as recorded. Three verdicts, kept apart on purpose:
 *
 *   fabrication rate = unsupported / (supported + unsupported)
 *
 * `insufficient` (snapshot truncated before the relevant passage) is reported alongside, never
 * folded in — a measurement gap is not a lie, and conflating them makes the kill-criterion
 * number uninterpretable in both directions.
 *
 * Sampling is deterministic (seeded LCG, no ambient randomness) so a rate is reproducible and
 * two people arguing about it are at least arguing about the same claims.
 */

import type { Claim } from '../../lib/scoring/types'
import type { ModelClient } from '../../lib/research/model'
import {
  MODEL_ID,
  renderUserMessage,
  SYSTEM_PROMPT,
  VERIFY_CLAIM_TOOL,
} from './prompts/verify-claim.v1'

export type Verdict = 'supported' | 'unsupported' | 'insufficient'

export interface ClaimVerification {
  claimId: string
  assumptionId: string
  verdict: Verdict
  reason: string
}

export interface FabricationReport {
  /** Claims that were eligible: desk-sourced, with a snapshot to verify against. */
  eligible: number
  sampled: number
  supported: number
  unsupported: number
  insufficient: number
  /** Judge emissions that were unusable. Counted separately; not evidence either way. */
  unusable: number
  /** unsupported / (supported + unsupported). Null when nothing decidable was sampled. */
  rate: number | null
  verifications: ClaimVerification[]
}

export interface FabricationOptions {
  model: ModelClient
  /** Claims to sample per call. */
  sampleSize: number
  /** Seed for the deterministic sampler. Same seed + same claims = same sample. */
  seed: number
  modelId?: string
}

/** Verification targets: desk claims with a snapshot. Primary conversations are verified at
 * intake (verbatim-quote check); model_inference has nothing to verify against. */
export const eligibleClaims = (claims: Claim[]): Claim[] =>
  claims.filter(
    (c) =>
      c.source_type !== 'primary_conversation' &&
      c.source_type !== 'model_inference' &&
      c.retrieved_text !== null &&
      c.retrieved_text.trim() !== '',
  )

/** Deterministic Fisher–Yates over a seeded LCG. Math.random would make rates unreproducible. */
export function sampleClaims(claims: Claim[], sampleSize: number, seed: number): Claim[] {
  let s = seed >>> 0
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
  const pool = [...claims]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  return pool.slice(0, sampleSize)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export async function checkFabrication(claims: Claim[], options: FabricationOptions): Promise<FabricationReport> {
  const eligible = eligibleClaims(claims)
  const sampled = sampleClaims(eligible, options.sampleSize, options.seed)

  const verifications: ClaimVerification[] = []
  let unusable = 0

  for (const claim of sampled) {
    const raw = await options.model.callTool({
      modelId: options.modelId ?? MODEL_ID,
      system: SYSTEM_PROMPT,
      userMessage: renderUserMessage(claim, claim.retrieved_text!),
      tool: VERIFY_CLAIM_TOOL,
    })

    const verdict = isObject(raw) ? raw['verdict'] : undefined
    const reason = isObject(raw) && typeof raw['reason'] === 'string' ? raw['reason'] : ''
    if (verdict !== 'supported' && verdict !== 'unsupported' && verdict !== 'insufficient') {
      unusable += 1
      continue
    }
    verifications.push({ claimId: claim.id, assumptionId: claim.assumption_id, verdict, reason })
  }

  const supported = verifications.filter((v) => v.verdict === 'supported').length
  const unsupported = verifications.filter((v) => v.verdict === 'unsupported').length
  const insufficient = verifications.filter((v) => v.verdict === 'insufficient').length
  const decidable = supported + unsupported

  return {
    eligible: eligible.length,
    sampled: sampled.length,
    supported,
    unsupported,
    insufficient,
    unusable,
    rate: decidable === 0 ? null : unsupported / decidable,
    verifications,
  }
}
