/**
 * Search-query generation, v1.
 *
 * Turns assumptions into short keyword queries the source adapters can actually match. Exists
 * because the first live pipeline run proved the lexical baseline insufficient: stripping a
 * 25-word falsifiable statement to eight ANDed terms returns zero hits, and a run where every
 * query misses reads as "no evidence exists" when the truth is "nobody searched properly".
 *
 * One batched call for the whole ledger — queries are cheap to generate together and the planner
 * stays synchronous.
 */

import type { Assumption } from '../../scoring/types'

export const PROMPT_ID = 'generate-queries'
export const PROMPT_VERSION = 'v1'

/** Keyword extraction is a cheap reading task. Pinned per §8. */
export const MODEL_ID = 'claude-sonnet-5'

/**
 * Defends against: the failure the baseline demonstrated. A query that restates the assumption
 * finds only people who phrase things like an analyst; the evidence is written by people
 * describing their own Tuesday.
 */
const ROLE = `You write search queries that find evidence about assumptions.

Search for the PHENOMENON, not the assumption's wording. An assumption about founders losing
hours to agent context loss is evidenced by posts where someone complains their coding agent
forgot everything again — so the query is "coding agent forgets context", never "solo founders
lose 3 hours weekly context re-explanation".`

/**
 * Defends against: over-specific queries. Search engines AND terms together; every added word
 * halves the results. Zero hits is the silent worst outcome — it reads downstream as evidence
 * of absence.
 */
const SHORT = `Queries are 2 to 4 words. Never more than 5.

No boolean operators, no quotes, no site: filters. Plain keywords a forum search understands.
If you cannot say it in 4 words, split it into two queries.`

/**
 * Defends against: three restatements of one angle. Variants exist to catch different vocabulary
 * for the same phenomenon, not to pad the count.
 */
const ANGLES = `Give 2 or 3 queries per assumption, each a DIFFERENT angle or vocabulary.

For a willingness-to-pay assumption: what people pay for, what they complain about paying for,
and the product category's name. Not the same three words reshuffled.`

export const SYSTEM_PROMPT = [ROLE, SHORT, ANGLES].join('\n\n')

export function renderUserMessage(assumptions: Assumption[]): string {
  return [
    'Write search queries for each assumption below. Reference each by its id.',
    '',
    ...assumptions.map((a) => `[${a.id}] (${a.category}) ${a.statement}`),
  ].join('\n')
}

export const EMIT_QUERIES_TOOL = {
  name: 'emit_search_queries',
  description: 'Emit search queries per assumption. This is the only way to return output.',
  input_schema: {
    type: 'object',
    required: ['queries'],
    properties: {
      queries: {
        type: 'array',
        items: {
          type: 'object',
          required: ['assumption_id', 'searches'],
          properties: {
            assumption_id: { type: 'string', description: 'The id exactly as listed.' },
            searches: {
              type: 'array',
              minItems: 2,
              maxItems: 3,
              items: {
                type: 'array',
                minItems: 1,
                maxItems: 5,
                items: { type: 'string', description: 'One keyword. 2-4 keywords per search.' },
              },
            },
          },
        },
      },
    },
  },
} as const
