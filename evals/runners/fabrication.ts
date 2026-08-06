/**
 * Fabrication rate. PRD §7, kill criterion 3: above 5% and undriveable-down, the product is
 * dangerous and should not ship.
 *
 * Samples desk claims that carry a snapshot and asks a judge two separate questions per claim —
 * separated because they are different failure classes with different consequences:
 *
 *   fabrication rate  = content-unsupported / content-decidable
 *       The kill-criterion number: the snapshot does not back what the claim asserts.
 *   stance error rate = stance-inverted / stance-decidable
 *       The extractor recorded the wrong direction relative to the assumption. Real and
 *       score-corrupting, but miscategorisation, not invention — tracked, not conflated.
 *
 * `insufficient`/`unclear` (snapshot truncated before the relevant passage) are reported
 * alongside, never folded into either rate — a measurement gap is not a lie.
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
} from './prompts/verify-claim.v2'

export type ContentVerdict = 'supported' | 'unsupported' | 'insufficient'
export type StanceVerdict = 'correct' | 'inverted' | 'unclear'

/** A claim paired with the statement its stance is relative to. The v1 checker omitted the
 * statement and could not tell judge confusion from real stance inversion. */
export interface VerifiableClaim {
  claim: Claim
  assumptionStatement: string
}

export interface ClaimVerification {
  claimId: string
  assumptionId: string
  content: ContentVerdict
  stance: StanceVerdict
  reason: string
}

export interface FabricationReport {
  /** Claims that were eligible: desk-sourced, with a snapshot to verify against. */
  eligible: number
  sampled: number
  contentSupported: number
  contentUnsupported: number
  contentInsufficient: number
  stanceCorrect: number
  stanceInverted: number
  stanceUnclear: number
  /** Judge emissions that were unusable. Counted separately; not evidence either way. */
  unusable: number
  /** contentUnsupported / (contentSupported + contentUnsupported). Null when nothing decidable. */
  fabricationRate: number | null
  /** stanceInverted / (stanceCorrect + stanceInverted). Null when nothing decidable. */
  stanceErrorRate: number | null
  verifications: ClaimVerification[]
}

export interface FabricationOptions {
  model: ModelClient
  sampleSize: number
  /** Same seed + same claims = same sample. */
  seed: number
  modelId?: string
}

/** Verification targets: desk claims with a snapshot. Primary conversations are verified at
 * intake (verbatim-quote check); model_inference has nothing to verify against. */
export const eligibleClaims = (items: VerifiableClaim[]): VerifiableClaim[] =>
  items.filter(
    ({ claim }) =>
      claim.source_type !== 'primary_conversation' &&
      claim.source_type !== 'model_inference' &&
      claim.retrieved_text !== null &&
      claim.retrieved_text.trim() !== '',
  )

/** Deterministic Fisher–Yates over a seeded LCG. Math.random would make rates unreproducible. */
export function sampleClaims<T>(items: T[], sampleSize: number, seed: number): T[] {
  let s = seed >>> 0
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
  const pool = [...items]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  return pool.slice(0, sampleSize)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const CONTENT_VERDICTS = ['supported', 'unsupported', 'insufficient'] as const
const STANCE_VERDICTS = ['correct', 'inverted', 'unclear'] as const

export async function checkFabrication(
  items: VerifiableClaim[],
  options: FabricationOptions,
): Promise<FabricationReport> {
  const eligible = eligibleClaims(items)
  const sampled = sampleClaims(eligible, options.sampleSize, options.seed)

  const verifications: ClaimVerification[] = []
  let unusable = 0

  for (const { claim, assumptionStatement } of sampled) {
    const raw = await options.model.callTool({
      modelId: options.modelId ?? MODEL_ID,
      system: SYSTEM_PROMPT,
      userMessage: renderUserMessage(assumptionStatement, claim, claim.retrieved_text!),
      tool: VERIFY_CLAIM_TOOL,
    })

    const content = isObject(raw) ? raw['content'] : undefined
    const stance = isObject(raw) ? raw['stance'] : undefined
    const reason = isObject(raw) && typeof raw['reason'] === 'string' ? raw['reason'] : ''

    if (
      !CONTENT_VERDICTS.includes(content as never) ||
      !STANCE_VERDICTS.includes(stance as never)
    ) {
      unusable += 1
      continue
    }
    verifications.push({
      claimId: claim.id,
      assumptionId: claim.assumption_id,
      content: content as ContentVerdict,
      stance: stance as StanceVerdict,
      reason,
    })
  }

  const count = <K extends keyof ClaimVerification>(key: K, value: ClaimVerification[K]) =>
    verifications.filter((v) => v[key] === value).length

  const contentSupported = count('content', 'supported')
  const contentUnsupported = count('content', 'unsupported')
  const stanceCorrect = count('stance', 'correct')
  const stanceInverted = count('stance', 'inverted')
  const contentDecidable = contentSupported + contentUnsupported
  const stanceDecidable = stanceCorrect + stanceInverted

  return {
    eligible: eligible.length,
    sampled: sampled.length,
    contentSupported,
    contentUnsupported,
    contentInsufficient: count('content', 'insufficient'),
    stanceCorrect,
    stanceInverted,
    stanceUnclear: count('stance', 'unclear'),
    unusable,
    fabricationRate: contentDecidable === 0 ? null : contentUnsupported / contentDecidable,
    stanceErrorRate: stanceDecidable === 0 ? null : stanceInverted / stanceDecidable,
    verifications,
  }
}
