/**
 * Renders the assumption-generation prompt against one hardcoded idea and prints it.
 *
 *   npm run prompt:assumptions
 *
 * Makes no API call. M0 has no LLM anywhere in the codebase by design; this exists so the prompt
 * can be read in full, diffed across versions, and hand-tested by pasting it somewhere before it
 * is wired up at M1.
 */

import type { IdeaCanvas } from '../../canvas/types'
import {
  EMIT_ASSUMPTIONS_TOOL,
  MODEL_ID,
  PROMPT_ID,
  PROMPT_VERSION,
  renderUserMessage,
  SYSTEM_PROMPT,
} from './generate-assumptions.v1'

/**
 * Deliberately inside the v1 ICP (PRD §2): technical solo builder, has shipped before, days from
 * writing code. A canvas the pipeline would plausibly extract, including the awkward parts —
 * a wedge stated as a feature and a business model with no pricing evidence behind it.
 */
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

const rule = (label: string) => `\n${'═'.repeat(96)}\n  ${label}\n${'═'.repeat(96)}\n`

process.stdout.write(rule(`${PROMPT_ID} ${PROMPT_VERSION}  ·  model ${MODEL_ID}`))
process.stdout.write(rule('SYSTEM'))
process.stdout.write(SYSTEM_PROMPT + '\n')
process.stdout.write(rule('USER'))
process.stdout.write(renderUserMessage(HARDCODED_IDEA) + '\n')
process.stdout.write(rule('TOOL (forced)'))
process.stdout.write(JSON.stringify(EMIT_ASSUMPTIONS_TOOL, null, 2) + '\n')
process.stdout.write(
  '\nNo API call was made. Generated assumptions must pass checkFalsifiability() before being\n' +
    'accepted into a ledger; statements that fail are regenerated, not repaired. Wiring is M1.\n\n',
)
