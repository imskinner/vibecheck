/**
 * Blind golden-set runs. PRD §7.
 *
 *   npm run eval:blind -- --pilot                    three entries, one variant each
 *   npm run eval:blind -- --ids kite-2022,senja-2022
 *   npm run eval:blind -- --all                      every public_record entry
 *   npm run eval:blind -- --all --variants 4         + 3 paraphrases each (the stability run)
 *   npm run eval:blind -- --report evals/runs/<dir>  re-print a summary, no spend
 *
 * Each run: blind input (name-free) → canvas extraction → full pipeline with notAfter = t0 →
 * artifact written immediately to the run directory. Existing artifacts are skipped, so an
 * interrupted batch resumes for free. There is no canvas-confirmation gate here on purpose:
 * evals measure the pipeline as it is, and a human correcting canvases would be measuring the
 * human.
 *
 * SPENDS MONEY: roughly one dollar per entry-variant at current sizes.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { extractCanvas } from '../../lib/canvas/extract'
import { createAnthropicModelClient } from '../../lib/research/anthropic-client'
import { AdapterRegistry } from '../../lib/research/adapters/registry'
import { createHackerNewsAdapter } from '../../lib/research/adapters/hacker-news'
import { runPipeline } from '../../lib/pipeline'
import { loadGoldenSet } from '../golden-set/load'
import type { GoldenIdea } from '../golden-set/format'
import { artifactFile, blindInput, summarise, type BlindArtifactSummary } from './blind'
import {
  EMIT_PARAPHRASE_TOOL,
  MODEL_ID as PARAPHRASE_MODEL_ID,
  renderUserMessage as renderParaphrase,
  SYSTEM_PROMPT as PARAPHRASE_SYSTEM,
} from './prompts/paraphrase.v1'

const PILOT_IDS = ['tutorspree-2014', 'senja-2022', 'everpix-2013']

const line = (s = '') => process.stdout.write(s + '\n')

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

function printSummary(artifacts: BlindArtifactSummary[]): void {
  const summary = summarise(artifacts)

  line()
  line('  BLIND RUN SUMMARY')
  line('  ' + '─'.repeat(96))
  for (const a of artifacts.filter((x) => x.variant === 0)) {
    line(
      `  ${a.entry_id.padEnd(28)} ${a.outcome.padEnd(11)} ${a.contamination_risk.padEnd(8)}` +
        ` desk ${a.weightedMean.toFixed(1).padStart(6)} · composite ${a.composite.toFixed(1).padStart(6)}`,
    )
  }
  line('  ' + '─'.repeat(96))

  // The desk numbers are the operative ones for blind runs: EQ is 0 by construction, so every
  // composite is min(weightedMean, 30) and composite separation is degenerate.
  for (const [label, sep] of [
    ['desk separation (all)', summary.separationDesk],
    ['desk separation (blind: low+medium)', summary.separationDeskBlind],
    ['composite separation (degenerate in desk-only runs)', summary.separationBlind],
  ] as const) {
    if (sep.status === 'ok') {
      line(
        `  ${label}: died ${sep.meanDied.toFixed(1)} vs succeeded ${sep.meanSucceeded.toFixed(1)} · ` +
          `diff ${sep.meanDifference.toFixed(1)} · d ${sep.cohensD.toFixed(2)} · overlap ${(sep.overlap * 100).toFixed(0)}%`,
      )
    } else {
      line(`  ${label}: INSUFFICIENT_N — ${sep.reason}`)
    }
  }

  if (summary.perSubScore !== null) {
    for (const [key, d] of Object.entries(summary.perSubScore)) {
      line(
        `  sub-score ${key.padEnd(10)} died ${d.meanDied.toFixed(1).padStart(6)} vs succeeded ${d.meanSucceeded.toFixed(1).padStart(6)} · diff ${d.difference >= 0 ? '+' : ''}${d.difference.toFixed(1)}`,
      )
    }
  }

  if (summary.maxSigma !== null) {
    line(`  stability: worst per-entry desk σ ${summary.maxSigma.toFixed(1)} (target < 6)`)
  } else {
    line('  stability: not measured (needs --variants 3+)')
  }
  line()
}

interface StoredArtifact extends BlindArtifactSummary {
  score: { weightedMean: number; subScores: Record<string, { value: number }> }
}

/** Maps a full stored artifact down to what summarise() needs. */
function toSummary(a: StoredArtifact): BlindArtifactSummary {
  return {
    entry_id: a.entry_id,
    outcome: a.outcome,
    contamination_risk: a.contamination_risk,
    variant: a.variant,
    composite: a.composite,
    weightedMean: a.score.weightedMean,
    subScores: {
      severity: a.score.subScores['severity']!.value,
      access: a.score.subScores['access']!.value,
      wedge: a.score.subScores['wedge']!.value,
      fit: a.score.subScores['fit']!.value,
    },
  }
}

function loadArtifacts(dir: string): BlindArtifactSummary[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'summary.json')
    .map((f) => toSummary(JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredArtifact))
}

async function main(): Promise<void> {
  const reportDir = arg('report')
  if (reportDir !== undefined) {
    printSummary(loadArtifacts(reportDir))
    return
  }

  const { entries, failures } = loadGoldenSet()
  if (failures.length > 0) {
    line(`  ${failures.length} invalid golden-set entr(ies); fix before running blind.`)
    process.exitCode = 1
    return
  }

  const real = entries
    .map((e) => e.entry)
    .filter((e) => e.layer1.outcome_basis === 'public_record')

  let selected: GoldenIdea[]
  if (has('pilot')) {
    selected = real.filter((e) => PILOT_IDS.includes(e.id))
  } else if (arg('ids') !== undefined) {
    const wanted = new Set(arg('ids')!.split(','))
    selected = real.filter((e) => wanted.has(e.id))
  } else if (has('all')) {
    selected = real
  } else {
    line('  pass --pilot, --ids a,b,c, --all, or --report <dir>')
    process.exitCode = 2
    return
  }

  const variants = Number(arg('variants') ?? '1')
  const outDir = arg('out') ?? join('evals', 'runs', `blind-${new Date().toISOString().slice(0, 10)}`)
  mkdirSync(outDir, { recursive: true })

  const model = createAnthropicModelClient()
  const registry = new AdapterRegistry().register(createHackerNewsAdapter())
  const artifacts: BlindArtifactSummary[] = []

  line()
  line(`  ${selected.length} entr(ies) × ${variants} variant(s) → ${outDir}`)

  for (const entry of selected) {
    const original = blindInput(entry)

    for (let variant = 0; variant < variants; variant++) {
      const file = join(outDir, artifactFile(entry.id, variant))
      if (existsSync(file)) {
        line(`  ${entry.id} v${variant}: exists, skipped`)
        artifacts.push(toSummary(JSON.parse(readFileSync(file, 'utf8')) as StoredArtifact))
        continue
      }

      let input = original
      if (variant > 0) {
        const raw = await model.callTool({
          modelId: PARAPHRASE_MODEL_ID,
          system: PARAPHRASE_SYSTEM,
          userMessage: renderParaphrase(original),
          tool: EMIT_PARAPHRASE_TOOL,
        })
        const description = (raw as { description?: unknown }).description
        if (typeof description !== 'string' || description.trim() === '') {
          line(`  ${entry.id} v${variant}: paraphrase failed, skipped`)
          continue
        }
        input = description.trim()
      }

      const extraction = await extractCanvas(input, { model })
      if (extraction.canvas === null) {
        line(`  ${entry.id} v${variant}: canvas extraction failed (${extraction.reason}), skipped`)
        continue
      }

      const before = model.usage()
      const result = await runPipeline(extraction.canvas, {
        model,
        registry,
        retrievedAt: new Date().toISOString(),
        notAfter: entry.layer1.t0,
      })
      const after = model.usage()

      const artifact = {
        entry_id: entry.id,
        outcome: entry.layer1.outcome,
        contamination_risk: entry.layer1.contamination_risk ?? 'high',
        t0: entry.layer1.t0,
        variant,
        paraphrase: variant === 0 ? null : input,
        canvas: result.canvas,
        ledger: result.ledger,
        score: result.score,
        killShots: result.killShots,
        honestNegatives: result.honestNegatives,
        warnings: result.warnings,
        provenance: result.provenance,
        usage: {
          calls: after.calls - before.calls,
          inputTokens: after.inputTokens - before.inputTokens,
          outputTokens: after.outputTokens - before.outputTokens,
        },
        ran_at: new Date().toISOString(),
        composite: result.score.composite,
      }

      writeFileSync(file, JSON.stringify(artifact, null, 2) + '\n', 'utf8')
      artifacts.push(toSummary(artifact as unknown as StoredArtifact))
      line(
        `  ${entry.id} v${variant}: composite ${result.score.composite.toFixed(1)}` +
          ` · EQ ${result.score.evidenceQuality.toFixed(0)} · ${result.ledger.claims.length} claims` +
          ` · ${artifact.usage.calls} calls`,
      )
    }
  }

  printSummary(artifacts)
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summarise(artifacts), null, 2) + '\n', 'utf8')

  const usage = model.usage()
  line(`  total usage: ${usage.calls} call(s) · ${usage.inputTokens} in · ${usage.outputTokens} out`)
  line()
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`\n  blind run failed: ${message}\n`)
  process.exitCode = 1
})
