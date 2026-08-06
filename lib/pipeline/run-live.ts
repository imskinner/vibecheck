/**
 * One idea, end to end, against the real API. The M1 gate.
 *
 *   npm run pipeline:live -- --description "your idea in a sentence or three"
 *   npm run pipeline:live -- --file idea.json          (a saved IdeaCanvas)
 *   npm run pipeline:live -- --description "..." --yes (accept the extracted canvas)
 *
 * The §5.1 gate is enforced here: an extracted canvas is printed and the run STOPS unless --yes
 * was passed, because research on an unconfirmed canvas compounds any extraction error through
 * every stage after it. A canvas loaded from --file counts as confirmed — the founder wrote it.
 *
 * Spends money: one generation call, one red-team call, one extraction call per researched
 * assumption. Credentials resolve from ANTHROPIC_API_KEY or an `ant auth login` profile.
 */

import { readFileSync } from 'node:fs'

import { extractCanvas } from '../canvas/extract'
import type { IdeaCanvas } from '../canvas/types'
import { extractTextFromFile } from '../ingest/extract-text'
import { createAnthropicModelClient } from '../research/anthropic-client'
import { AdapterRegistry } from '../research/adapters/registry'
import { createHackerNewsAdapter } from '../research/adapters/hacker-news'
import { runPipeline } from './index'

const line = (s = '') => process.stdout.write(s + '\n')
const rule = () => line('  ' + '─'.repeat(96))

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function resolveCanvas(model: ReturnType<typeof createAnthropicModelClient>): Promise<IdeaCanvas | null> {
  const file = arg('file')
  if (file !== undefined) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as IdeaCanvas
    for (const field of ['problem', 'icp_hypothesis', 'wedge_hypothesis', 'business_model', 'stage'] as const) {
      if (typeof parsed[field] !== 'string' || parsed[field].trim() === '') {
        line(`  ${file} is missing '${field}'`)
        return null
      }
    }
    return parsed
  }

  // --input-file: a pitch memo, PRD, or research doc (.txt .md .pdf .docx .xlsx .csv). The
  // extracted text goes through canvas extraction and the same §5.1 gate as a typed description.
  const inputFile = arg('input-file')
  let description = arg('description')
  if (inputFile !== undefined) {
    const extracted = await extractTextFromFile(inputFile)
    for (const warning of extracted.warnings) line(`  ⚠ ${inputFile}: ${warning}`)
    description = extracted.text
  }
  if (description === undefined) {
    line('  pass --description "...", --input-file <doc>, or --file <canvas.json>')
    return null
  }

  const extraction = await extractCanvas(description, { model })
  if (extraction.canvas === null) {
    line(`  canvas extraction failed: ${extraction.reason}`)
    return null
  }

  line()
  line('  EXTRACTED CANVAS — review before research runs')
  rule()
  for (const [key, value] of Object.entries(extraction.canvas)) line(`  ${key.padEnd(22)} ${value}`)
  for (const warning of extraction.warnings) line(`  ⚠ ${warning}`)
  rule()

  if (!has('yes')) {
    // The §5.1 gate. Garbage-in is the #1 quality failure mode, and this is the moment a human
    // can still catch it cheaply.
    line('  Research has NOT run. Review the canvas above, then re-run with --yes to confirm it.')
    return null
  }
  return extraction.canvas
}

async function main(): Promise<void> {
  const model = createAnthropicModelClient()
  const canvas = await resolveCanvas(model)
  if (canvas === null) {
    process.exitCode = 2
    return
  }

  const registry = new AdapterRegistry().register(createHackerNewsAdapter())
  const notAfter = arg('not-after')

  const result = await runPipeline(canvas, {
    model,
    registry,
    retrievedAt: new Date().toISOString(),
    ...(notAfter === undefined ? {} : { notAfter }),
  })

  line()
  line(`  LEDGER — ${result.ledger.assumptions.length} assumptions, ${result.ledger.claims.length} claims`)
  rule()
  for (const a of result.ledger.assumptions) {
    const claims = result.ledger.claims.filter((c) => c.assumption_id === a.id)
    const negatives = claims.filter((c) => c.source_type === 'model_inference').length
    const evidence =
      claims.length === 0
        ? 'not researched'
        : negatives === claims.length
          ? 'nothing found'
          : `${claims.length - negatives} claim(s)`
    line(`  [${a.origin === 'red_team' ? 'RED TEAM' : 'canvas'}] [${a.category}] ${evidence}`)
    line(`    ${a.statement}`)
  }

  if (result.redTeam.uncertaintyRaises.length > 0) {
    line()
    line('  RED TEAM RAISED UNCERTAINTY')
    for (const r of result.redTeam.uncertaintyRaises) {
      line(`  ${r.assumptionId}: ${r.from} → ${r.to} — ${r.reason}`)
    }
  }

  line()
  line('  SCORE')
  rule()
  for (const key of ['severity', 'access', 'wedge', 'fit'] as const) {
    const s = result.score.subScores[key]
    line(
      `  ${key.padEnd(10)} ${s.value.toFixed(1).padStart(6)} ±${s.band.toFixed(0)}` +
        (s.uncovered ? '  (uncovered — no assumptions map here)' : ''),
    )
  }
  line(`  ${'EQ'.padEnd(10)} ${result.score.evidenceQuality.toFixed(1).padStart(6)}`)
  line(
    `  ${'composite'.padEnd(10)} ${result.score.composite.toFixed(1).padStart(6)}` +
      (result.score.capBinding
        ? `  ← capped at ${result.score.cap.toFixed(0)}: no primary evidence yet. Talking to people is what moves this.`
        : ''),
  )

  line()
  line('  KILL-SHOTS — what to go test first')
  rule()
  for (const k of result.killShots) {
    line(`  ${k.rank}. [${k.assumption.origin === 'red_team' ? 'RED TEAM' : 'canvas'}] ${k.assumption.statement}`)
    const c = k.assumption.falsification_criterion
    line(`     refuted if: ${c.metric} ${c.comparator} ${c.threshold} of ${c.sample_size}`)
  }

  const landscape = result.competitive.landscape
  if (landscape !== null) {
    line()
    line('  COMPETITIVE LANDSCAPE — informs what to test, never the score')
    rule()
    line(`  axes: x = ${landscape.axes.xLabel} · y = ${landscape.axes.yLabel}`)
    line(`  the idea sits at (${landscape.ideaPosition.x}, ${landscape.ideaPosition.y})`)
    line()
    for (const c of landscape.competitors) {
      const basis = c.basis === 'claims' ? `${c.claimIds.length} claim(s)` : 'inferred'
      line(`  [${c.threat.toUpperCase().padEnd(8)}] ${c.name} (${c.category}, ${basis}) at (${c.x}, ${c.y})`)
      line(`             ${c.what}`)
      line(`             threat: ${c.threatReason}`)
    }
    line()
    line(`  empty space: ${landscape.emptySpace}`)
  }

  if (result.warnings.length > 0) {
    line()
    for (const w of result.warnings) line(`  ⚠ ${w}`)
  }

  const failures = result.research.perAssumption.flatMap((p) => p.adapterFailures)
  if (failures.length > 0) {
    line()
    for (const f of failures.slice(0, 5)) line(`  adapter degraded: ${f.adapterId} — ${f.message}`)
  }

  const usage = model.usage()
  line()
  line(`  usage: ${usage.calls} call(s) · ${usage.inputTokens} in · ${usage.outputTokens} out`)
  line()
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`\n  pipeline failed: ${message}\n`)
  if (/api key|authentication|401/i.test(message)) {
    process.stderr.write('  set ANTHROPIC_API_KEY or run `ant auth login` first.\n')
  }
  process.exitCode = 1
})
