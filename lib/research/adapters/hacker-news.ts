/**
 * Hacker News via the Algolia search API. PRD §5.5 ship-safe set.
 *
 * compliance: public_api — documented, keyless, permissive terms, and the endpoint Algolia
 * provides for exactly this purpose. No scraping, no authenticated session, nothing that breaks
 * if HN changes its commercial terms tomorrow beyond this one file going dark.
 */

import type { Clock, ResearchQuery, SourceAdapter, SourceDocument } from './types'
import { respectsCutoff, systemClock, truncateSnapshot } from './types'

const ENDPOINT = 'https://hn.algolia.com/api/v1/search'

export interface HttpResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type HttpFetch = (url: string) => Promise<HttpResponse>

export interface HackerNewsOptions {
  /** Injected so tests need no network. */
  fetchFn?: HttpFetch
  clock?: Clock
  enabled?: () => boolean
}

interface AlgoliaHit {
  objectID?: string
  title?: string | null
  story_title?: string | null
  comment_text?: string | null
  story_text?: string | null
  created_at?: string | null
}

/** Algolia returns comment bodies as HTML. Kept deliberately small — no parser dependency. */
function toPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    // Ampersand last, or it double-decodes the entities above.
    .replace(/&amp;/g, '&')
}

export function createHackerNewsAdapter(options: HackerNewsOptions = {}): SourceAdapter {
  const fetchFn = options.fetchFn ?? ((url: string) => (globalThis.fetch as unknown as HttpFetch)(url))
  const clock = options.clock ?? systemClock
  const isEnabled = options.enabled ?? (() => true)

  return {
    id: 'hacker-news',
    compliance: 'public_api',
    legalNotes:
      'Algolia-hosted public HN search API. Keyless, documented for third-party use, no authenticated session and no scraping. Rate-limited by Algolia; treat 429 as a degraded run, not an error to retry aggressively.',
    sourceType: 'public_post',
    isEnabled,

    async search(query: ResearchQuery): Promise<SourceDocument[]> {
      const params = new URLSearchParams({
        query: query.terms.join(' '),
        tags: '(story,comment)',
        hitsPerPage: String(Math.max(1, Math.min(query.maxResults, 50))),
      })

      // Enforce the knowledge cutoff at the source as well as in the filter below. Blind scoring
      // is only meaningful if an adapter cannot leak the future into an eval run.
      if (query.notAfter) {
        const cutoff = Math.floor(new Date(query.notAfter).getTime() / 1000)
        if (Number.isFinite(cutoff)) params.set('numericFilters', `created_at_i<${cutoff}`)
      }

      const response = await fetchFn(`${ENDPOINT}?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`hacker-news: search failed with status ${response.status}`)
      }

      const body = (await response.json()) as { hits?: AlgoliaHit[] } | null
      const hits = body?.hits ?? []
      const retrievedAt = clock()

      return hits
        .filter((hit) => typeof hit.objectID === 'string')
        .map((hit): SourceDocument => {
          const raw = hit.comment_text ?? hit.story_text ?? hit.title ?? hit.story_title ?? ''
          return {
            adapterId: 'hacker-news',
            url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
            title: hit.title ?? hit.story_title ?? null,
            text: truncateSnapshot(toPlainText(raw)),
            sourceType: 'public_post',
            publishedAt: hit.created_at ?? null,
            retrievedAt,
          }
        })
        .filter((doc) => doc.text.length > 0)
        .filter((doc) => respectsCutoff(doc.publishedAt, query.notAfter))
    },
  }
}
