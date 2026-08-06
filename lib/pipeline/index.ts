/**
 * The M1 pipeline: confirmed canvas → assumptions → red team → research → synthesis → score.
 * PRD §4 steps 2–5, deterministic orchestration over the model-driven stages.
 *
 * Takes a CONFIRMED canvas, not raw input. The §5.1 gate — the founder sees and corrects the
 * canvas before research runs — belongs to the caller, because only the caller knows whether a
 * human has looked at it. Nothing in here re-checks that, on purpose: a pipeline that could be
 * handed an unconfirmed canvas silently would make the gate decorative.
 */

import type { IdeaCanvas } from '../canvas/types'
import { generateAssumptions, type GenerationResult } from '../assumptions/generate'
import { rankKillShots, type RankedAssumption } from '../assumptions/ranking'
import {
  MODEL_ID as GENERATE_MODEL_ID,
  PROMPT_ID as GENERATE_PROMPT_ID,
  PROMPT_VERSION as GENERATE_PROMPT_VERSION,
} from '../assumptions/prompts/generate-assumptions.v1'
import type { AdapterRegistry } from '../research/adapters/registry'
import type { ModelClient } from '../research/model'
import { runResearch, type ResearchRun } from '../research/orchestrator'
import {
  MODEL_ID as EXTRACT_MODEL_ID,
  PROMPT_ID as EXTRACT_PROMPT_ID,
  PROMPT_VERSION as EXTRACT_PROMPT_VERSION,
} from '../research/prompts/extract-claims.v1'
import { applyRedTeam, runRedTeam, type RedTeamResult } from '../research/redteam'
import {
  MODEL_ID as RED_TEAM_MODEL_ID,
  PROMPT_ID as RED_TEAM_PROMPT_ID,
  PROMPT_VERSION as RED_TEAM_PROMPT_VERSION,
} from '../research/redteam/prompts/red-team.v1'
import { synthesizeHonestNegatives } from '../research/synthesize'
import { scoreLedger } from '../scoring/composite'
import type { Ledger, ScoreResult } from '../scoring/types'

export interface PipelineOptions {
  model: ModelClient
  registry: AdapterRegistry
  /** ISO timestamp of the run. Injected — the pipeline has no ambient clock. */
  retrievedAt: string
  /** Knowledge cutoff for blind runs (golden set). Omit for live founder ideas. */
  notAfter?: string
  maxDocumentsPerAssumption?: number
}

export interface PipelineResult {
  canvas: IdeaCanvas
  /** The final ledger: canvas + red-team assumptions, sourced claims + honest negatives. */
  ledger: Ledger
  score: ScoreResult
  killShots: RankedAssumption[]
  generation: GenerationResult
  redTeam: RedTeamResult
  research: ResearchRun
  honestNegatives: number
  /** Stage-prefixed aggregation of everything the stages flagged. */
  warnings: string[]
  /** What ran, pinned — the content of the immutable Report row. PRD §5.9. */
  provenance: {
    promptVersions: Record<string, string>
    modelIds: Record<string, string>
  }
}

const KILL_SHOT_COUNT = 3

export async function runPipeline(canvas: IdeaCanvas, options: PipelineOptions): Promise<PipelineResult> {
  // [2] Assumption Ledger — the founder's framing, made falsifiable.
  const generation = await generateAssumptions(canvas, { model: options.model })

  // [4] Red Team — the negative space. Runs BEFORE research so its threats get researched like
  // everything else; that ordering is what §5.4.1 means by "through the front door".
  const redTeam = await runRedTeam(canvas, generation.assumptions, { model: options.model })
  const ledgerAfterRedTeam = applyRedTeam({ assumptions: generation.assumptions, claims: [] }, redTeam)

  // [3] Desk Research — every assumption, canvas and red-team alike, in kill-shot order.
  const research = await runResearch(ledgerAfterRedTeam, {
    registry: options.registry,
    model: options.model,
    ...(options.maxDocumentsPerAssumption === undefined
      ? {}
      : { maxDocumentsPerAssumption: options.maxDocumentsPerAssumption }),
    planOptions: options.notAfter === undefined ? {} : { notAfter: options.notAfter },
  })

  // Synthesis — researched-and-empty becomes an explicit honest negative.
  const negatives = synthesizeHonestNegatives(research, { retrievedAt: options.retrievedAt })

  const ledger: Ledger = {
    assumptions: ledgerAfterRedTeam.assumptions,
    claims: [...research.claims, ...negatives],
  }

  // [5] Kill-Shot Ranking + the deterministic score.
  const score = scoreLedger(ledger)
  const killShots = rankKillShots(ledger.assumptions, KILL_SHOT_COUNT)

  return {
    canvas,
    ledger,
    score,
    killShots,
    generation,
    redTeam,
    research,
    honestNegatives: negatives.length,
    warnings: [
      ...generation.warnings.map((w) => `generation: ${w}`),
      ...redTeam.warnings.map((w) => `red-team: ${w}`),
    ],
    provenance: {
      promptVersions: {
        [GENERATE_PROMPT_ID]: GENERATE_PROMPT_VERSION,
        [RED_TEAM_PROMPT_ID]: RED_TEAM_PROMPT_VERSION,
        [EXTRACT_PROMPT_ID]: EXTRACT_PROMPT_VERSION,
      },
      modelIds: {
        [GENERATE_PROMPT_ID]: GENERATE_MODEL_ID,
        [RED_TEAM_PROMPT_ID]: RED_TEAM_MODEL_ID,
        [EXTRACT_PROMPT_ID]: EXTRACT_MODEL_ID,
      },
    },
  }
}
