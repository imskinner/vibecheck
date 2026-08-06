/**
 * Fabrication check over a blind-run directory. PRD §7; kill criterion 3.
 *
 *   npm run eval:fabrication -- --dir evals/runs/blind-full [--sample 40] [--seed 20260806]
 *
 * Samples desk claims across every artifact in the directory and judges each against its stored
 * snapshot. SPENDS MONEY: one small judge call per sampled claim.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createAnthropicModelClient } from '../../lib/research/anthropic-client'
import type { Claim } from '../../lib/scoring/types'
import { checkFabrication, eligibleClaims } from './fabrication'

const line = (s = '') => process.stdout.write(s + '\n')

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const dir = arg('dir')
  if (dir === undefined) {
    line('  pass --dir <run directory>')
    process.exitCode = 2
    return
  }
  const sampleSize = Number(arg('sample') ?? '40')
  const seed = Number(arg('seed') ?? '20260806')

  const claims: Claim[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'summary.json' && f !== 'fabrication.json')
    .flatMap((f) => {
      const artifact = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { ledger?: { claims?: Claim[] } }
      return artifact.ledger?.claims ?? []
    })

  const model = createAnthropicModelClient()
  const report = await checkFabrication(claims, { model, sampleSize, seed })

  line()
  line('  FABRICATION CHECK')
  line('  ' + '─'.repeat(96))
  line(`  eligible desk claims ${report.eligible} · sampled ${report.sampled} (seed ${seed})`)
  line(`  supported ${report.supported} · unsupported ${report.unsupported} · insufficient ${report.insufficient} · unusable ${report.unusable}`)
  if (report.rate !== null) {
    const pct = (report.rate * 100).toFixed(1)
    line(`  fabrication rate: ${pct}%  (kill criterion 3: must stay under 5%)`)
    if (report.rate >= 0.05) line('  ⚠ ABOVE THE KILL LINE — say so out loud, do not ship past it.')
  } else {
    line('  fabrication rate: not measurable (nothing decidable sampled)')
  }
  for (const v of report.verifications.filter((x) => x.verdict !== 'supported')) {
    line(`    [${v.verdict}] ${v.claimId} (${v.assumptionId}) — ${v.reason}`)
  }

  const usage = model.usage()
  line(`  usage: ${usage.calls} call(s) · ${usage.inputTokens} in · ${usage.outputTokens} out`)
  line()

  writeFileSync(join(dir, 'fabrication.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
}

main().catch((error: unknown) => {
  process.stderr.write(`\n  fabrication check failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
