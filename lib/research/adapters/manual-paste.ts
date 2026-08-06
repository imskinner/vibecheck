/**
 * Manual paste. PRD §5.5.
 *
 * compliance: manual_paste — the user pasted this themselves. No automated access, no session, no
 * terms to violate.
 *
 * This is the ONLY sanctioned route for Reddit, LinkedIn and X content. The PRD is explicit that
 * the business is not built on unlicensed scraping of those platforms, and the alternative is not
 * "scrape carefully" — it is this. A user pasting a thread they are looking at is a different act
 * from us harvesting it, legally and ethically.
 *
 * It is also how a run degrades gracefully when a source goes dark: the founder can still bring the
 * evidence in by hand, and it carries a real source_url and a real snapshot.
 */

import type { ClaimSourceType } from '../../scoring/types'
import type { Clock, ResearchQuery, SourceAdapter, SourceDocument } from './types'
import { respectsCutoff, systemClock, truncateSnapshot } from './types'

export interface PastedItem {
  /** Where the user got it. Required — a pasted document with no origin is not evidence. */
  url: string
  title?: string | null
  text: string
  sourceType?: ClaimSourceType
  publishedAt?: string | null
  /** Which assumption the user attached it to. Omit to make it available to every query. */
  assumptionId?: string
}

export interface ManualPasteOptions {
  items: PastedItem[]
  clock?: Clock
}

export function createManualPasteAdapter(options: ManualPasteOptions): SourceAdapter {
  const clock = options.clock ?? systemClock
  const items = options.items

  return {
    id: 'manual-paste',
    compliance: 'manual_paste',
    legalNotes:
      'Content supplied by the user from their own browsing. No automated retrieval. The sanctioned route for Reddit, LinkedIn and X, which must never be scraped at scale.',
    sourceType: 'public_post',

    // Disabled rather than empty when nothing was pasted, so a run reports "no manual evidence
    // supplied" instead of silently looking like the source returned nothing.
    isEnabled: () => items.length > 0,

    async search(query: ResearchQuery): Promise<SourceDocument[]> {
      const retrievedAt = clock()

      return items
        .filter((item) => item.assumptionId === undefined || item.assumptionId === query.assumptionId)
        .filter((item) => respectsCutoff(item.publishedAt ?? null, query.notAfter))
        .slice(0, query.maxResults)
        .map((item): SourceDocument => ({
          adapterId: 'manual-paste',
          url: item.url,
          title: item.title ?? null,
          text: truncateSnapshot(item.text),
          sourceType: item.sourceType ?? 'public_post',
          publishedAt: item.publishedAt ?? null,
          retrievedAt,
        }))
    },
  }
}
