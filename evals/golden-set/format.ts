/**
 * Golden-set entry format and validator. PRD §7.1.
 *
 * Two layers, because deterministic scoring consumes a LEDGER, not an idea, and M0 has to run
 * headless before any LLM exists in the codebase:
 *
 *   Layer 1 — the idea. Description, t0, known outcome, sourcing. All a contributed entry needs.
 *   Layer 2 — a frozen fixture ledger, hand-authored. Only M0 needs it. From M1 the pipeline
 *             generates it and the fixtures become regression baselines rather than inputs.
 *
 * Validation is hand-rolled rather than schema-library-driven: the format is small, and M0 has no
 * reason to take on a runtime validation dependency it would only use here.
 */

import type { Assumption, Claim, Ledger } from '../../lib/scoring/types'
import {
  ASSUMPTION_CATEGORIES,
  ASSUMPTION_ORIGINS,
  ASSUMPTION_STATUSES,
  CLAIM_CONFIDENCES,
  CLAIM_SOURCE_TYPES,
  CLAIM_STANCES,
  COMPARATORS,
} from '../../lib/scoring/types'

export const GOLDEN_SET_SCHEMA_VERSION = 1

export const OUTCOMES = ['died', 'succeeded'] as const
export type Outcome = (typeof OUTCOMES)[number]

/**
 * `synthetic` entries are fixtures written to pin scoring behaviour. They are EXCLUDED from
 * separation statistics — inventing plausible startup outcomes and citing them would be exactly
 * the fabrication this product exists to prevent. Only `public_record` entries count as signal.
 */
export const OUTCOME_BASES = ['public_record', 'synthetic'] as const
export type OutcomeBasis = (typeof OUTCOME_BASES)[number]

/** Synthetic fixtures use this scheme so a fixture citation can never be mistaken for a real one. */
export const SYNTHETIC_URL_SCHEME = 'example://'

/**
 * How likely it is that a model has already read this outcome. A famous shutdown is not a blind
 * test: the pipeline can recall the ending rather than derive it, which inflates separation for
 * reasons that have nothing to do with the scoring function. M5 should report separation over the
 * whole set AND over `low` + `medium` only, and treat the second number as the real one.
 *
 * Required on public_record entries, because it is a judgement the contributor has to make
 * consciously rather than a field that quietly defaults.
 */
export const CONTAMINATION_RISKS = ['low', 'medium', 'high'] as const
export type ContaminationRisk = (typeof CONTAMINATION_RISKS)[number]

/**
 * How the source was checked. `fetched` means the page was loaded and its content confirmed the
 * claim; `search_result` means a search engine returned this URL with a title matching the claim
 * but the page was not opened. The distinction is worth keeping: a golden set whose sourcing
 * cannot be audited is not evidence, and this is the field that makes spot-checking possible.
 */
export const SOURCE_VERIFICATIONS = ['fetched', 'search_result'] as const
export type SourceVerification = (typeof SOURCE_VERIFICATIONS)[number]

export interface GoldenSource {
  url: string
  note: string
  verified?: SourceVerification
}

export interface GoldenLayer1 {
  name: string
  one_liner: string
  description: string
  /** Knowledge cutoff. Nothing in layer 2 may postdate this. */
  t0: string
  outcome: Outcome
  outcome_date: string
  outcome_basis: OutcomeBasis
  outcome_note: string
  /** Required for public_record entries. See CONTAMINATION_RISKS. */
  contamination_risk?: ContaminationRisk
  sources: GoldenSource[]
}

export interface GoldenLayer2 {
  authored_by: string
  authored_at: string
  /** What this fixture is meant to pin down. Reviewers read this first. */
  pins: string
  assumptions: Assumption[]
  claims: Claim[]
}

export interface GoldenIdea {
  id: string
  schema_version: number
  layer1: GoldenLayer1
  layer2?: GoldenLayer2
}

export function toLedger(entry: GoldenIdea): Ledger | null {
  if (!entry.layer2) return null
  return { assumptions: entry.layer2.assumptions, claims: entry.layer2.claims }
}

/* ── validation ─────────────────────────────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v)

export function validateGoldenIdea(raw: unknown): ValidationResult {
  const errors: string[] = []
  const err = (msg: string) => errors.push(msg)

  if (!isObject(raw)) return { ok: false, errors: ['entry is not an object'] }
  if (!isNonEmptyString(raw['id'])) err('id must be a non-empty string')
  if (raw['schema_version'] !== GOLDEN_SET_SCHEMA_VERSION) {
    err(`schema_version must be ${GOLDEN_SET_SCHEMA_VERSION}`)
  }

  const l1 = raw['layer1']
  if (!isObject(l1)) return { ok: false, errors: [...errors, 'layer1 is required'] }

  for (const field of ['name', 'one_liner', 'description', 'outcome_note'] as const) {
    if (!isNonEmptyString(l1[field])) err(`layer1.${field} must be a non-empty string`)
  }
  if (!isIsoDate(l1['t0'])) err('layer1.t0 must be an ISO date')
  if (!isIsoDate(l1['outcome_date'])) err('layer1.outcome_date must be an ISO date')
  if (!includes(OUTCOMES, l1['outcome'])) err(`layer1.outcome must be one of ${OUTCOMES.join(', ')}`)
  if (!includes(OUTCOME_BASES, l1['outcome_basis'])) {
    err(`layer1.outcome_basis must be one of ${OUTCOME_BASES.join(', ')}`)
  }

  const synthetic = l1['outcome_basis'] === 'synthetic'

  if (!synthetic && !includes(CONTAMINATION_RISKS, l1['contamination_risk'])) {
    err(`layer1.contamination_risk is required for a public_record entry (${CONTAMINATION_RISKS.join(', ')})`)
  }

  const sources = l1['sources']
  if (!Array.isArray(sources)) err('layer1.sources must be an array')
  else if (!synthetic && sources.length === 0) {
    // A real outcome with no sourcing is an assertion, not a record.
    err('layer1.sources must contain at least one source for a public_record entry')
  } else {
    sources.forEach((source, i) => {
      if (!isObject(source)) return err(`layer1.sources[${i}] is not an object`)
      if (!isNonEmptyString(source['url'])) err(`layer1.sources[${i}].url must be a non-empty string`)
      if (!isNonEmptyString(source['note'])) err(`layer1.sources[${i}].note must be a non-empty string`)
      if (source['verified'] !== undefined && !includes(SOURCE_VERIFICATIONS, source['verified'])) {
        err(`layer1.sources[${i}].verified must be one of ${SOURCE_VERIFICATIONS.join(', ')}`)
      }
      if (!synthetic && isNonEmptyString(source['url']) && !/^https?:\/\//.test(source['url'])) {
        err(`layer1.sources[${i}].url must be an http(s) URL in a public_record entry`)
      }
    })
  }

  if (isIsoDate(l1['t0']) && isIsoDate(l1['outcome_date']) && l1['outcome_date'] < l1['t0']) {
    err('layer1.outcome_date must not precede layer1.t0')
  }

  const l2 = raw['layer2']
  if (l2 !== undefined) {
    if (!isObject(l2)) err('layer2 must be an object when present')
    else errors.push(...validateLayer2(l2, String(l1['t0'] ?? ''), synthetic))
  }

  return { ok: errors.length === 0, errors }
}

function validateLayer2(l2: Record<string, unknown>, t0: string, synthetic: boolean): string[] {
  const errors: string[] = []
  const err = (msg: string) => errors.push(msg)

  for (const field of ['authored_by', 'authored_at', 'pins'] as const) {
    if (!isNonEmptyString(l2[field])) err(`layer2.${field} must be a non-empty string`)
  }

  const assumptions = l2['assumptions']
  const claims = l2['claims']
  if (!Array.isArray(assumptions) || assumptions.length === 0) {
    return [...errors, 'layer2.assumptions must be a non-empty array']
  }
  if (!Array.isArray(claims)) return [...errors, 'layer2.claims must be an array']

  const ids = new Set<string>()
  assumptions.forEach((a, i) => {
    if (!isObject(a)) return err(`layer2.assumptions[${i}] is not an object`)
    const at = `layer2.assumptions[${i}]`
    if (!isNonEmptyString(a['id'])) err(`${at}.id must be a non-empty string`)
    else {
      if (ids.has(a['id'])) err(`${at}.id is duplicated`)
      ids.add(a['id'])
    }
    if (!isNonEmptyString(a['statement'])) err(`${at}.statement must be a non-empty string`)
    if (!includes(ASSUMPTION_CATEGORIES, a['category'])) err(`${at}.category is invalid`)
    if (!includes(ASSUMPTION_ORIGINS, a['origin'])) err(`${at}.origin is invalid`)
    if (!includes(ASSUMPTION_STATUSES, a['status'])) err(`${at}.status is invalid`)
    for (const field of ['impact', 'uncertainty', 'test_cost'] as const) {
      const v = a[field]
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
        err(`${at}.${field} must be an integer 1–5`)
      }
    }
    errors.push(...validateCriterion(a['falsification_criterion'], at))
  })

  const claimIds = new Set<string>()
  claims.forEach((c, i) => {
    if (!isObject(c)) return err(`layer2.claims[${i}] is not an object`)
    const at = `layer2.claims[${i}]`
    if (!isNonEmptyString(c['id'])) err(`${at}.id must be a non-empty string`)
    else {
      if (claimIds.has(c['id'])) err(`${at}.id is duplicated`)
      claimIds.add(c['id'])
    }
    if (!isNonEmptyString(c['text'])) err(`${at}.text must be a non-empty string`)
    if (!includes(CLAIM_STANCES, c['stance'])) err(`${at}.stance is invalid`)
    if (!includes(CLAIM_SOURCE_TYPES, c['source_type'])) err(`${at}.source_type is invalid`)
    if (!includes(CLAIM_CONFIDENCES, c['confidence'])) err(`${at}.confidence is invalid`)

    const assumptionId = c['assumption_id']
    if (typeof assumptionId !== 'string' || !ids.has(assumptionId)) {
      err(`${at}.assumption_id does not match any assumption in this entry`)
    }

    // Blind scoring: the fixture may only contain what was knowable at t0. PRD §7.
    const retrievedAt = c['retrieved_at']
    if (!isIsoDate(retrievedAt)) err(`${at}.retrieved_at must be an ISO date`)
    else if (t0 && retrievedAt.slice(0, 10) > t0.slice(0, 10)) {
      err(`${at}.retrieved_at (${retrievedAt}) postdates t0 (${t0}) — that is not blind scoring`)
    }

    const url = c['source_url']
    const sourceType = c['source_type']
    if (sourceType !== 'primary_conversation' && sourceType !== 'model_inference' && !isNonEmptyString(url)) {
      err(`${at}.source_url is required for source_type '${String(sourceType)}'`)
    }
    if (synthetic && isNonEmptyString(url) && !url.startsWith(SYNTHETIC_URL_SCHEME)) {
      // A fixture citation must never be mistakable for a real one.
      err(`${at}.source_url must use the ${SYNTHETIC_URL_SCHEME} scheme in a synthetic entry`)
    }
    if (!synthetic && isNonEmptyString(url) && url.startsWith(SYNTHETIC_URL_SCHEME)) {
      err(`${at}.source_url uses the synthetic scheme in a public_record entry`)
    }
  })

  return errors
}

function validateCriterion(raw: unknown, at: string): string[] {
  if (!isObject(raw)) return [`${at}.falsification_criterion is required`]
  const errors: string[] = []
  for (const field of ['applies_to', 'observation', 'metric'] as const) {
    if (!isNonEmptyString(raw[field])) errors.push(`${at}.falsification_criterion.${field} is required`)
  }
  if (!includes(COMPARATORS, raw['comparator'])) {
    errors.push(`${at}.falsification_criterion.comparator is invalid`)
  }
  if (typeof raw['threshold'] !== 'number') {
    errors.push(`${at}.falsification_criterion.threshold must be a number`)
  }
  const sampleSize = raw['sample_size']
  if (typeof sampleSize !== 'number' || !Number.isInteger(sampleSize) || sampleSize < 1) {
    errors.push(`${at}.falsification_criterion.sample_size must be a positive integer`)
  }
  return errors
}

function includes<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/** Narrowing cast for entries that have already passed validation. */
export function asGoldenIdea(raw: unknown): GoldenIdea {
  return raw as GoldenIdea
}

export type { Assumption, Claim }
