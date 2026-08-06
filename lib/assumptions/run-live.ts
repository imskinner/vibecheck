/**
 * Runs assumption generation against the real Anthropic API for one hardcoded idea.
 *
 *   npm run assumptions:live
 *
 * The first command in the repo that spends money. It exists to hand-inspect what the prompt
 * actually produces before anything downstream consumes it — falsifiability pass-rate, category
 * spread, rating spread, and cost per run are all visible here and nowhere else yet. Credentials
 * resolve from the environment (ANTHROPIC_API_KEY or an `ant auth login` profile).
 */

import { createAnthropicModelClient } from '../research/anthropic-client'
import { rankKillShots } from './ranking'
import { generateAssumptions } from './generate'
import type { IdeaCanvas } from '../canvas/types'
import { MODEL_ID, PROMPT_ID, PROMPT_VERSION } from './prompts/generate-assumptions.v1'

/** Same idea as the preview script: inside the v1 ICP, awkward parts included. */
const HARDCODED_IDEA: IdeaCanvas = {
  problem:
    'Solo founders using AI coding agents lose hours re-explaining project context every time they start a new session, and the agent repeats decisions that were already settled.',
  icp_hypothesis:
    'Technical solo founders and 2-person teams who use Claude Code or Cursor daily and have shipped at least one product before.',
  wedge_hypothesis:
    'A persistent decision log the agent writes to and reads from automatically, rather than a general memory feature.',
  business_model: 'Self-serve subscription, $19/month per developer, no free tier.',
  stage: 'Pre-build. No code written, no landing page.',
}

const line = (s = '') => process.stdout.write(s + '\n')

async function main(): Promise<void> {
  const client = createAnthropicModelClient()

  line()
  line(`  ${PROMPT_ID} ${PROMPT_VERSION} · ${MODEL_ID} · live`)
  line()

  const result = await generateAssumptions(HARDCODED_IDEA, { model: client })

  line(`  LEDGER — ${result.assumptions.length} assumption(s)`)
  line('  ' + '─'.repeat(96))
  for (const a of result.assumptions) {
    line(`  [${a.category}] impact ${a.impact} · uncertainty ${a.uncertainty} · test_cost ${a.test_cost}`)
    line(`    ${a.statement}`)
    const c = a.falsification_criterion
    line(`    refute when: ${c.metric} ${c.comparator} ${c.threshold} of ${c.sample_size}`)
    line()
  }

  const killShots = rankKillShots(result.assumptions, 3)
  line('  KILL-SHOTS (what the Discovery Pack would target)')
  for (const k of killShots) {
    line(`  ${k.rank}. [score ${k.killShotScore}] ${k.assumption.statement}`)
  }
  line()

  if (result.regenerationRounds > 0) {
    line(`  regeneration rounds: ${result.regenerationRounds}`)
  }
  for (const d of result.discarded) {
    line(`  DISCARDED (unfalsifiable): "${d.statement}"`)
    for (const f of d.failures) line(`    · ${f}`)
  }
  for (const r of result.rejected) {
    line(`  REJECTED (malformed): ${r.reason}`)
  }
  for (const w of result.warnings) {
    line(`  WARNING: ${w}`)
  }

  const usage = client.usage()
  line()
  line(
    `  usage: ${usage.calls} call(s) · ${usage.inputTokens} in · ${usage.outputTokens} out` +
      (usage.cacheReadInputTokens > 0 ? ` · ${usage.cacheReadInputTokens} cache-read` : ''),
  )
  line()
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`\n  live run failed: ${message}\n`)
  if (/api key|authentication|401/i.test(message)) {
    process.stderr.write('  set ANTHROPIC_API_KEY or run `ant auth login` first.\n')
  }
  process.exitCode = 1
})
