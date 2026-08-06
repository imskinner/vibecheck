/**
 * Claim extraction, v1. PRD §5.3.
 *
 * Converts retrieved documents into claims against ONE assumption. This is the only stage that
 * mints claims from sources, which is what makes provenance enforceable — see extract-claims.ts.
 *
 * Prompts are code. Each section carries the failure mode it defends against.
 */

import type { Assumption } from '../../scoring/types'
import type { SourceDocument } from '../adapters/types'

export const PROMPT_ID = 'extract-claims'
export const PROMPT_VERSION = 'v1'

/**
 * Extraction is a reading task, not a judgement task, so it takes the cheaper model per PRD §8.
 * Pinned and recorded on the Report row.
 */
export const MODEL_ID = 'claude-sonnet-5'

/**
 * Defends against: the model treating this as a research task and answering from what it already
 * knows. Everything it emits must be traceable to a document in front of it.
 */
const ROLE = `You read retrieved documents and record what they say about one specific assumption.

You are not researching. You are not evaluating the idea. You have no knowledge to contribute —
only what these documents contain.`

/**
 * Defends against: the single most dangerous failure in this product. A model that writes a URL
 * can write a plausible one that does not exist, and a fabricated citation is worse than no
 * evidence. It cites by index; the code attaches the real URL. It is structurally unable to
 * fabricate a source.
 */
const CITATION = `Reference documents by their index number only.

NEVER write a URL, a domain, a publication name, or a date. You do not have the ability to cite
sources here — the system attaches the real source to whatever you emit. If you cannot point at a
specific numbered document for a claim, you must not make the claim.`

/**
 * Defends against: stance measured against the idea rather than the assumption, which silently
 * inverts evidence whenever the assumption is phrased negatively ("no incumbent ships X").
 */
const STANCE = `Stance is relative to THE ASSUMPTION AS WRITTEN, not to whether the idea is good.

  supports — the document makes the assumption more likely true
  refutes  — the document makes the assumption more likely false
  context  — relevant background that does neither

Read the assumption carefully before deciding. If it is phrased as a negative ("no incumbent ships
X within 12 months"), then a document showing an incumbent shipping X REFUTES it.`

/**
 * Defends against: manufacturing relevance. Search returns loosely related documents, and a model
 * asked to extract claims will find something to say about each one. Padding the ledger with
 * tangential claims is how a score drifts upward on no real evidence.
 */
const EMPTY_IS_VALID = `Emit nothing for a document that does not bear on this assumption.

Returning an empty list is a correct and expected answer. Most retrieved documents will be
tangential. Do not stretch to connect one — a claim that needs an argument to be relevant is not
evidence about this assumption.`

/**
 * Defends against: reproducing long passages verbatim. §5.3 requires paraphrase; the full snapshot
 * is stored separately for the fabrication check and never rendered.
 */
const PARAPHRASE = `Paraphrase in one sentence. Never quote more than a short fragment.

Write what the document reports, not what it implies. "A bookkeeper describes spending two days a
month on matching" — not "bookkeepers waste enormous time on matching".`

/**
 * Defends against: every claim coming back high-confidence, which makes the weighting inert.
 */
const CONFIDENCE = `Rate confidence by how directly the document establishes the claim.

  high    — the document states this plainly and first-hand
  medium  — the document implies it, or reports it second-hand
  low     — the document gestures at it

A single person's anecdote is at best medium for a claim about a population.`

export const SYSTEM_PROMPT = [ROLE, CITATION, STANCE, EMPTY_IS_VALID, PARAPHRASE, CONFIDENCE].join('\n\n')

export function renderUserMessage(assumption: Assumption, documents: SourceDocument[]): string {
  const rendered = documents.map((doc, i) =>
    [`--- DOCUMENT ${i} ---`, doc.title ? `TITLE: ${doc.title}` : null, doc.text].filter(Boolean).join('\n'),
  )

  return [
    `ASSUMPTION: ${assumption.statement}`,
    '',
    `Record what these ${documents.length} documents say about that assumption. Cite by index.`,
    '',
    ...rendered,
  ].join('\n')
}

export const EMIT_CLAIMS_TOOL = {
  name: 'emit_claims',
  description: 'Record claims extracted from the numbered documents. An empty list is valid.',
  input_schema: {
    type: 'object',
    required: ['claims'],
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          required: ['document_index', 'text', 'stance', 'confidence'],
          properties: {
            document_index: {
              type: 'integer',
              minimum: 0,
              description: 'Index of the document this claim comes from. The only way to cite.',
            },
            text: { type: 'string', description: 'One-sentence paraphrase. No URLs, no long quotes.' },
            stance: { type: 'string', enum: ['supports', 'refutes', 'context'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
    },
  },
} as const
