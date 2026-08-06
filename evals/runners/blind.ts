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

import { SUB_SCORE_KEYS, type SubScoreKey } from '../../lib/scoring/types'
import type { ContaminationRisk, GoldenIdea, Outcome } from '../golden-set/format'
import { separation, type SeparationReport } from './stats'

/** What summarise() needs from an artifact. The files on disk carry much more. */
export interface BlindArtifactSummary {
  entry_id: string
  outcome: Outcome
  contamination_risk: ContaminationRisk
  variant: number
  composite: number
  /**
   * The uncapped desk signal. In a blind desk run EQ is 0 by construction — no primary
   * conversation can exist — so every composite is min(weightedMean, 30) and composite
   * separation is degenerate. The Evidence Quality cap is a product feature; for measuring
   * whether desk research discriminates, the weighted mean is the instrument. PRD §7 asks for
   * exactly this ("per-sub-score discrimination").
   */
  weightedMean: number
  subScores: Record<SubScoreKey, number>
}

export interface SubScoreDiscrimination {
  meanDied: number
  meanSucceeded: number
  /** Positive = the sub-score rates survivors higher, as it should. */
  difference: number
}

export interface EntryStability {
  entry_id: string
  variants: number
  /** Sample standard deviation of composites across variants. Null below 3 variants. */
  sigma: number | null
}

export interface BlindSummary {
  entries: number
  /** Separation over variant-0 composites, whole set. Degenerate in desk-only runs — kept
   * because runs that include evidence intake (M4+) will differ, and the degeneracy should be
   * visible rather than papered over. */
  separationAll: SeparationReport
  /** The real number: high-contamination entries excluded. PRD golden-set README. */
  separationBlind: SeparationReport
  /** Separation on the weighted mean — the operative number for blind desk runs. */
  separationDesk: SeparationReport
  separationDeskBlind: SeparationReport
  /** Per-sub-score died-vs-succeeded means, low+medium contamination only. */
  perSubScore: Record<SubScoreKey, SubScoreDiscrimination> | null
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

  const uncontaminated = originals.filter((o) => o.contamination_risk !== 'high')
  const on = (rows: BlindArtifactSummary[], value: (o: BlindArtifactSummary) => number) =>
    separation(rows.map((o) => ({ id: o.entry_id, outcome: o.outcome, composite: value(o) })))

  let perSubScore: BlindSummary['perSubScore'] = null
  const died = uncontaminated.filter((o) => o.outcome === 'died')
  const succeeded = uncontaminated.filter((o) => o.outcome === 'succeeded')
  if (died.length > 0 && succeeded.length > 0) {
    perSubScore = {} as NonNullable<BlindSummary['perSubScore']>
    for (const key of SUB_SCORE_KEYS) {
      const mean = (rows: BlindArtifactSummary[]) =>
        rows.reduce((a, o) => a + o.subScores[key], 0) / rows.length
      const meanDied = mean(died)
      const meanSucceeded = mean(succeeded)
      perSubScore[key] = { meanDied, meanSucceeded, difference: meanSucceeded - meanDied }
    }
  }

  // Stability is measured on the weighted mean for the same reason separation is: with every
  // variant capped at 30, composite sigma would read 0 and certify a stability nobody tested.
  const stability: EntryStability[] = [...byEntry.entries()].map(([entry_id, variants]) => ({
    entry_id,
    variants: variants.length,
    sigma: sampleSigma(variants.map((v) => v.weightedMean)),
  }))

  const sigmas = stability.map((s) => s.sigma).filter((s): s is number => s !== null)

  return {
    entries: byEntry.size,
    separationAll: on(originals, (o) => o.composite),
    separationBlind: on(uncontaminated, (o) => o.composite),
    separationDesk: on(originals, (o) => o.weightedMean),
    separationDeskBlind: on(uncontaminated, (o) => o.weightedMean),
    perSubScore,
    stability,
    maxSigma: sigmas.length === 0 ? null : Math.max(...sigmas),
  }
}
