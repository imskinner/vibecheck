/**
 * Source Adapter layer. PRD §5.5 — non-negotiable architecture requirement.
 *
 * GummySearch was profitable, had ~135k users and zero burn, and died because Reddit changed its
 * commercial API terms. Assume every source will do this.
 *
 * NO DATA SOURCE MAY BE REFERENCED ANYWHERE OUTSIDE AN ADAPTER. No fetch to a vendor API in a
 * route handler, no scraping helper in the orchestrator, no exception for "just this one lookup".
 * Killing one adapter must degrade output, never break the build.
 *
 * ── Deviation from the PRD's sketched interface, deliberate ──────────────────────────────────
 * §5.5 sketches `search(query): Promise<Claim[]>`. Adapters here return `SourceDocument[]` and a
 * single extractor stage converts documents into claims. Reasons:
 *
 *   · Turning a post into a Claim requires judging stance and confidence — that is model work.
 *     Claims-returning adapters would each embed an LLM call, so every adapter would need its own
 *     extraction prompt and two mocks to test. Adapters are access and compliance, not judgement.
 *   · Claims must be minted in exactly one place if provenance is to be enforceable. source_url,
 *     retrieved_at and retrieved_text are properties of a document; a claim inherits them.
 *   · Adapters become pure I/O, so their tests need no API key and no model.
 *
 * §5.5's actual RULES are unchanged and still hold exactly: one interface, nothing outside it,
 * degradation not breakage, and the compliance tier declared per source.
 */

import type { ClaimSourceType } from '../../scoring/types'

/**
 * How we are allowed to touch this source. Recorded per adapter so a compliance review is a
 * question about this file rather than an audit of the whole codebase.
 */
export const ADAPTER_COMPLIANCE = ['licensed', 'public_api', 'user_authenticated', 'manual_paste'] as const
export type AdapterCompliance = (typeof ADAPTER_COMPLIANCE)[number]

/** Bounded snapshot size for the fabrication check. PRD §5.3. */
export const MAX_SNAPSHOT_CHARS = 1500

export interface ResearchQuery {
  /** Which assumption this search is serving. Carried through so claims can be attributed. */
  assumptionId: string
  /** Search terms, already generated. Adapters do not interpret the assumption themselves. */
  terms: string[]
  maxResults: number
  /**
   * Knowledge cutoff, ISO date. Adapters MUST NOT return documents published after this.
   * Blind scoring in §7 is only meaningful if the sources respect t0, and enforcing it here means
   * an adapter cannot leak the future into an eval by accident.
   */
  notAfter?: string
}

export interface SourceDocument {
  adapterId: string
  url: string | null
  title: string | null
  /** Bounded snapshot, truncated to MAX_SNAPSHOT_CHARS. What the fabrication check verifies against. */
  text: string
  sourceType: ClaimSourceType
  publishedAt: string | null
  retrievedAt: string
}

export interface SourceAdapter {
  id: string
  compliance: AdapterCompliance
  /** Why this access pattern is permitted. Read this before changing how an adapter fetches. */
  legalNotes: string
  sourceType: ClaimSourceType
  /** Typically a credential check. A disabled adapter is skipped, never an error. */
  isEnabled(): boolean
  search(query: ResearchQuery): Promise<SourceDocument[]>
}

/** Injected so adapters have no ambient clock and their tests stay deterministic. */
export type Clock = () => string

export const systemClock: Clock = () => new Date().toISOString()

export function truncateSnapshot(text: string, max: number = MAX_SNAPSHOT_CHARS): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : normalized.slice(0, max - 1) + '…'
}

/** Documents published after the cutoff are dropped rather than trusted to a caller's filter. */
export function respectsCutoff(publishedAt: string | null, notAfter: string | undefined): boolean {
  if (!notAfter || !publishedAt) return true
  return publishedAt.slice(0, 10) <= notAfter.slice(0, 10)
}
