/**
 * Blind-run plumbing. PRD §7 — "run the pipeline on each, with the model given only what was
 * knowable at t0".
 *
 * The blind input is the entry's one-liner and description, NEVER its name. A model that reads
 * "Kite" can recall the shutdown instead of deriving it, and the separation number stops
 * measuring the scoring function. Descriptions are kept name-free at source (format.test.ts has
 * no opinion on this; blind.test.ts sweeps every entry on disk), and the name is redacted here
 * anyway — two layers, because this is the single easiest way to quietly invalidate M5.
 */

import type { ContaminationRisk, GoldenIdea, Outcome } from '../golden-set/format'
import { separation, type SeparationReport } from './stats'

/** What summarise() needs from an artifact. The files on disk carry much more. */
export interface BlindArtifactSummary {
  entry_id: string
  outcome: Outcome
  contamination_risk: ContaminationRisk
  variant: number
  composite: number
}

export interface EntryStability {
  entry_id: string
  variants: number
  /** Sample standard deviation of composites across variants. Null below 3 variants. */
  sigma: number | null
}

export interface BlindSummary {
  entries: number
  /** Separation over variant-0 composites, whole set. */
  separationAll: SeparationReport
  /** The real number: high-contamination entries excluded. PRD golden-set README. */
  separationBlind: SeparationReport
  stability: EntryStability[]
  /** Worst per-entry sigma, against the σ<6 target. Null until any entry has 3+ variants. */
  maxSigma: number | null
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The text the pipeline sees. One-liner + description, with the product name redacted wherever
 * it appears — including possessives.
 */
export function blindInput(entry: GoldenIdea): string {
  const text = `${entry.layer1.one_liner}\n\n${entry.layer1.description}`
  const name = entry.layer1.name.trim()
  if (name === '') return text
  return text.replace(new RegExp(`\\b${escapeRegex(name)}(?:'s)?\\b`, 'gi'), 'the product')
}

export const artifactFile = (entryId: string, variant: number): string => `${entryId}.v${variant}.json`

function sampleSigma(values: number[]): number | null {
  if (values.length < 3) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function summarise(artifacts: BlindArtifactSummary[]): BlindSummary {
  const byEntry = new Map<string, BlindArtifactSummary[]>()
  for (const a of artifacts) {
    const bucket = byEntry.get(a.entry_id)
    if (bucket) bucket.push(a)
    else byEntry.set(a.entry_id, [a])
  }

  const originals = [...byEntry.values()]
    .map((variants) => variants.find((v) => v.variant === 0))
    .filter((v): v is BlindArtifactSummary => v !== undefined)

  const scored = originals.map((o) => ({ id: o.entry_id, outcome: o.outcome, composite: o.composite }))
  const blindScored = originals
    .filter((o) => o.contamination_risk !== 'high')
    .map((o) => ({ id: o.entry_id, outcome: o.outcome, composite: o.composite }))

  const stability: EntryStability[] = [...byEntry.entries()].map(([entry_id, variants]) => ({
    entry_id,
    variants: variants.length,
    sigma: sampleSigma(variants.map((v) => v.composite)),
  }))

  const sigmas = stability.map((s) => s.sigma).filter((s): s is number => s !== null)

  return {
    entries: byEntry.size,
    separationAll: separation(scored),
    separationBlind: separation(blindScored),
    stability,
    maxSigma: sigmas.length === 0 ? null : Math.max(...sigmas),
  }
}
