/**
 * Headless golden-set runner. PRD §7.
 *
 *   npm run eval            human-readable report
 *   npm run eval -- --json  machine-readable, for CI to diff between prompt versions
 *
 * There is no LLM in this path. It scores the frozen fixture ledgers in layer 2 and reports what
 * the deterministic scoring function does with them. From M1 the pipeline generates layer 2 and
 * this same runner measures the whole thing.
 */

import { scoreLedger, type ScoreResult, type SubScoreKey } from '../../lib/scoring'
import { toLedger, type Outcome, type OutcomeBasis } from '../golden-set/format'
import { loadGoldenSet, type LoadFailure } from '../golden-set/load'
import { separation, type ScoredEntry, type SeparationReport } from './stats'

const M0_GATE = 10

interface Row {
  id: string
  outcome: Outcome
  basis: OutcomeBasis
  score: ScoreResult
}

interface EvalReport {
  loaded: number
  scored: number
  skippedNoLayer2: string[]
  failures: LoadFailure[]
  m0Gate: { required: number; scored: number; met: boolean }
  entries: {
    id: string
    outcome: Outcome
    basis: OutcomeBasis
    composite: number
    evidenceQuality: number
    weightedMean: number
    cap: number
    capBinding: boolean
    subScores: ScoreResult['subScores']
  }[]
  separation: SeparationReport
  stability: { status: 'not_applicable'; reason: string }
  fabrication: { status: 'not_applicable'; reason: string }
}

function build(): { report: EvalReport; rows: Row[] } {
  const { entries, failures } = loadGoldenSet()

  const rows: Row[] = []
  const skippedNoLayer2: string[] = []

  for (const { entry } of entries) {
    const ledger = toLedger(entry)
    if (!ledger) {
      skippedNoLayer2.push(entry.id)
      continue
    }
    rows.push({
      id: entry.id,
      outcome: entry.layer1.outcome,
      basis: entry.layer1.outcome_basis,
      score: scoreLedger(ledger),
    })
  }

  // Synthetic fixtures pin scoring behaviour; they are not evidence about the world and must never
  // reach a separation statistic. PRD §7.1.
  const forSeparation: ScoredEntry[] = rows
    .filter((r) => r.basis === 'public_record')
    .map((r) => ({ id: r.id, outcome: r.outcome, composite: r.score.composite }))

  return {
    rows,
    report: {
      loaded: entries.length,
      scored: rows.length,
      skippedNoLayer2,
      failures,
      m0Gate: { required: M0_GATE, scored: rows.length, met: rows.length >= M0_GATE },
      entries: rows.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        basis: r.basis,
        composite: r.score.composite,
        evidenceQuality: r.score.evidenceQuality,
        weightedMean: r.score.weightedMean,
        cap: r.score.cap,
        capBinding: r.score.capBinding,
        subScores: r.score.subScores,
      })),
      separation: separation(forSeparation),
      // Paraphrasing an idea does not perturb a hand-authored fixture ledger, so there is nothing
      // to measure until assumption generation is live. Reported as such, not as a fake zero.
      stability: { status: 'not_applicable', reason: 'no assumption generation until M1' },
      fabrication: { status: 'not_applicable', reason: 'no source adapters until M1' },
    },
  }
}

const SUB_SCORE_COLUMNS: [SubScoreKey, string][] = [
  ['severity', 'sev'],
  ['access', 'acc'],
  ['wedge', 'wdg'],
  ['fit', 'fit'],
]

function printHuman(report: EvalReport, rows: Row[]): void {
  const line = (s = '') => process.stdout.write(s + '\n')
  const num = (x: number, w = 6) => x.toFixed(1).padStart(w)
  const rule = '  ' + '─'.repeat(96)

  line()
  line('  VIBECHECK GOLDEN SET')
  line(rule)
  line(
    '  ' +
      'entry'.padEnd(32) +
      'outcome'.padEnd(11) +
      'basis'.padEnd(15) +
      SUB_SCORE_COLUMNS.map(([, label]) => label.padStart(6)).join('') +
      'EQ'.padStart(7) +
      'score'.padStart(8),
  )
  line(rule)

  for (const r of rows) {
    const s = r.score
    line(
      '  ' +
        r.id.padEnd(32) +
        r.outcome.padEnd(11) +
        r.basis.padEnd(15) +
        SUB_SCORE_COLUMNS.map(([key]) => num(s.subScores[key].value)).join('') +
        num(s.evidenceQuality, 7) +
        num(s.composite, 8) +
        (s.capBinding ? '  ← capped' : ''),
    )
  }

  line(rule)
  line()
  line(
    `  M0 gate      ${report.m0Gate.met ? 'MET' : 'NOT MET'} — ${report.m0Gate.scored}/${report.m0Gate.required} entries scored headless`,
  )

  const sep = report.separation
  if (sep.status === 'ok') {
    line(`  separation   mean died ${sep.meanDied.toFixed(1)} · mean succeeded ${sep.meanSucceeded.toFixed(1)}`)
    line(
      `               difference ${sep.meanDifference.toFixed(1)} · Cohen's d ${sep.cohensD.toFixed(2)} · overlap ${(sep.overlap * 100).toFixed(0)}%`,
    )
  } else {
    line(`  separation   INSUFFICIENT_N — ${sep.reason}`)
    line(`               ${sep.nDied} died / ${sep.nSucceeded} succeeded counted (synthetic fixtures excluded)`)
  }
  line(`  stability    NOT_APPLICABLE — ${report.stability.reason}`)
  line(`  fabrication  NOT_APPLICABLE — ${report.fabrication.reason}`)

  if (report.skippedNoLayer2.length > 0) {
    const count = report.skippedNoLayer2.length
    line()
    line(`  ${count} entr${count === 1 ? 'y has' : 'ies have'} no fixture ledger and ${count === 1 ? 'was' : 'were'} not scored:`)
    for (const id of report.skippedNoLayer2) line(`    · ${id}`)
  }

  if (report.failures.length > 0) {
    line()
    line('  VALIDATION FAILURES')
    for (const f of report.failures) {
      line(`    ${f.file}`)
      for (const e of f.errors) line(`      · ${e}`)
    }
  }
  line()
}

const { report, rows } = build()

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
} else {
  printHuman(report, rows)
}

// A failed entry is a silently shrunk sample, which is exactly the kind of quiet degradation the
// eval harness exists to catch. Fail the run.
if (report.failures.length > 0) process.exitCode = 1
