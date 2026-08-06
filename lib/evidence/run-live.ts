/**
 * Evidence intake against the real API. The M4 loop, live.
 *
 *   npm run evidence:live -- --artifact evals/runs/blind-full/plausible-2019.v0.json --transcript-file call.txt
 *   npm run evidence:live -- --artifact <run artifact> --transcript "pasted notes..."
 *
 * Loads a run artifact's ledger, extracts primary-conversation claims from the transcript
 * (typed or a file: .txt .md .pdf .docx), prints the proposals with their verified quotes, and
 * shows what WOULD move if every proposal were approved — before/after scores with the movement
 * attributed. Nothing is persisted; this is the intake loop made visible.
 *
 * Spends money: one extraction call.
 */

import { readFileSync } from 'node:fs'

import { extractTextFromFile } from '../ingest/extract-text'
import { createAnthropicModelClient } from '../research/anthropic-client'
import { scoreLedger } from '../scoring/composite'
import { diffScores } from '../scoring/movement'
import type { Ledger } from '../scoring/types'
import { applyEvidence, extractEvidence } from './intake'

const line = (s = '') => process.stdout.write(s + '\n')

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const artifactPath = arg('artifact')
  if (artifactPath === undefined) {
    line('  pass --artifact <run artifact json> and --transcript "..." or --transcript-file <file>')
    process.exitCode = 2
    return
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { ledger?: Ledger }
  if (!artifact.ledger) {
    line(`  ${artifactPath} has no ledger`)
    process.exitCode = 2
    return
  }

  let transcript = arg('transcript')
  const transcriptFile = arg('transcript-file')
  if (transcriptFile !== undefined) {
    const extracted = await extractTextFromFile(transcriptFile)
    for (const warning of extracted.warnings) line(`  ⚠ ${transcriptFile}: ${warning}`)
    transcript = extracted.text
  }
  if (transcript === undefined || transcript.trim() === '') {
    line('  no transcript provided')
    process.exitCode = 2
    return
  }

  const model = createAnthropicModelClient()
  const { proposals, rejected } = await extractEvidence(transcript, artifact.ledger.assumptions, {
    model,
    retrievedAt: new Date().toISOString(),
  })

  line()
  line(`  PROPOSALS — ${proposals.length} claim(s) extracted, pending approval`)
  line('  ' + '─'.repeat(96))
  for (const p of proposals) {
    line(`  [${p.stance.toUpperCase()}] → ${p.assumption_id} (${p.confidence})`)
    line(`    ${p.text}`)
    line(`    quote: "${p.retrieved_text}"`)
    line()
  }
  for (const r of rejected) line(`  REJECTED: ${r.reason}`)

  if (proposals.length === 0) {
    line('  nothing to apply.')
    return
  }

  // What WOULD move. In the product the founder approves per-claim; here we preview all-approved.
  const before = scoreLedger(artifact.ledger)
  const { ledger: after, statusChanges } = applyEvidence(artifact.ledger, proposals)
  const afterScore = scoreLedger(after)
  const movement = diffScores(before, afterScore)

  line('  IF ALL APPROVED')
  line('  ' + '─'.repeat(96))
  line(`  evidence   ${before.evidenceQuality.toFixed(1)} → ${afterScore.evidenceQuality.toFixed(1)}`)
  line(`  cap        ${before.cap.toFixed(1)} → ${afterScore.cap.toFixed(1)}`)
  line(`  composite  ${before.composite.toFixed(1)} → ${afterScore.composite.toFixed(1)}  (Δ ${movement.compositeDelta >= 0 ? '+' : ''}${movement.compositeDelta.toFixed(1)})`)
  for (const change of statusChanges) {
    line(`  status     ${change.assumptionId}: ${change.from} → ${change.to} — ${change.evaluation.explanation}`)
  }
  line(`  attributed to: ${movement.newClaimIds.join(', ')}`)

  const usage = model.usage()
  line()
  line(`  usage: ${usage.calls} call(s) · ${usage.inputTokens} in · ${usage.outputTokens} out`)
  line()
}

main().catch((error: unknown) => {
  process.stderr.write(`\n  evidence intake failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
