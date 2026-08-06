import { describe, expect, it, vi } from 'vitest'

import { createHackerNewsAdapter, type HttpFetch } from './hacker-news'
import { createManualPasteAdapter } from './manual-paste'
import { AdapterRegistry } from './registry'
import { MAX_SNAPSHOT_CHARS, type ResearchQuery, type SourceAdapter } from './types'

const clock = () => '2026-01-01T00:00:00.000Z'

const query = (over: Partial<ResearchQuery> = {}): ResearchQuery => ({
  assumptionId: 'a1',
  terms: ['bookkeeping', 'reconciliation'],
  maxResults: 10,
  ...over,
})

const stubAdapter = (over: Partial<SourceAdapter> & { id: string }): SourceAdapter => ({
  compliance: 'public_api',
  legalNotes: 'test stub',
  sourceType: 'public_post',
  isEnabled: () => true,
  search: async () => [],
  ...over,
})

const doc = (adapterId: string) => ({
  adapterId,
  url: `https://example.org/${adapterId}`,
  title: null,
  text: 'a document',
  sourceType: 'public_post' as const,
  publishedAt: null,
  retrievedAt: clock(),
})

describe('AdapterRegistry', () => {
  it('refuses a duplicate registration', () => {
    const registry = new AdapterRegistry().register(stubAdapter({ id: 'x' }))
    expect(() => registry.register(stubAdapter({ id: 'x' }))).toThrow(/already registered/)
  })

  it('DEGRADES, NEVER BREAKS: one adapter dying does not lose the others', async () => {
    // PRD §5.5. The GummySearch case is the expected one, not the exceptional one.
    const registry = new AdapterRegistry()
      .register(stubAdapter({ id: 'healthy', search: async () => [doc('healthy')] }))
      .register(
        stubAdapter({
          id: 'revoked',
          search: async () => {
            throw new Error('403 commercial terms changed')
          },
        }),
      )
      .register(stubAdapter({ id: 'also-healthy', search: async () => [doc('also-healthy')] }))

    const outcome = await registry.searchAll(query())

    expect(outcome.documents.map((d) => d.adapterId).sort()).toEqual(['also-healthy', 'healthy'])
    expect(outcome.failures).toEqual([{ adapterId: 'revoked', message: expect.stringContaining('403') }])
  })

  it('skips disabled adapters rather than reporting them as failures', async () => {
    const registry = new AdapterRegistry()
      .register(stubAdapter({ id: 'no-credential', isEnabled: () => false, search: async () => [doc('x')] }))
      .register(stubAdapter({ id: 'ok', search: async () => [doc('ok')] }))

    const outcome = await registry.searchAll(query())

    expect(outcome.skipped).toEqual(['no-credential'])
    expect(outcome.failures).toEqual([])
    expect(outcome.documents).toHaveLength(1)
  })

  it('treats an adapter that throws while reporting its own health as disabled', async () => {
    const registry = new AdapterRegistry().register(
      stubAdapter({
        id: 'broken-health',
        isEnabled: () => {
          throw new Error('credential store unreachable')
        },
      }),
    )
    expect(registry.enabled()).toEqual([])
    await expect(registry.searchAll(query())).resolves.toMatchObject({ skipped: ['broken-health'] })
  })

  it('never rejects, whatever the adapters do', async () => {
    const registry = new AdapterRegistry().register(
      stubAdapter({
        id: 'hostile',
        search: () => Promise.reject(new Error('boom')),
      }),
    )
    await expect(registry.searchAll(query())).resolves.toBeTruthy()
  })

  it('describes the adapter set for the immutable Report row', async () => {
    const registry = new AdapterRegistry()
      .register(stubAdapter({ id: 'a' }))
      .register(stubAdapter({ id: 'b', compliance: 'manual_paste', isEnabled: () => false }))

    expect(registry.describe()).toEqual([
      { id: 'a', compliance: 'public_api', sourceType: 'public_post', enabled: true },
      { id: 'b', compliance: 'manual_paste', sourceType: 'public_post', enabled: false },
    ])
  })

  it('can be restricted to a named subset of adapters', async () => {
    const registry = new AdapterRegistry()
      .register(stubAdapter({ id: 'a', search: async () => [doc('a')] }))
      .register(stubAdapter({ id: 'b', search: async () => [doc('b')] }))

    const outcome = await registry.searchAll(query(), ['b'])
    expect(outcome.documents.map((d) => d.adapterId)).toEqual(['b'])
  })
})

describe('hacker-news adapter', () => {
  const respond = (hits: unknown[]): HttpFetch =>
    async () => ({ ok: true, status: 200, json: async () => ({ hits }) })

  it('maps hits to documents with a stable item url', async () => {
    const adapter = createHackerNewsAdapter({
      clock,
      fetchFn: respond([
        { objectID: '123', title: 'Reconciliation is painful', story_text: 'We spend two days a month.', created_at: '2021-04-01T10:00:00.000Z' },
      ]),
    })

    const [document] = await adapter.search(query())

    expect(document).toEqual({
      adapterId: 'hacker-news',
      url: 'https://news.ycombinator.com/item?id=123',
      title: 'Reconciliation is painful',
      text: 'We spend two days a month.',
      sourceType: 'public_post',
      publishedAt: '2021-04-01T10:00:00.000Z',
      retrievedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('strips markup without double-decoding ampersands', async () => {
    const adapter = createHackerNewsAdapter({
      clock,
      fetchFn: respond([
        { objectID: '1', comment_text: '<p>Costs &amp;lt;$50&amp;gt; a month &amp;amp; rising.</p>', created_at: '2021-01-01T00:00:00.000Z' },
      ]),
    })

    const [document] = await adapter.search(query())
    // Decoding & first would turn &amp;lt; into a literal '<' and mangle the quoted text.
    expect(document!.text).toBe('Costs &lt;$50&gt; a month &amp; rising.')
  })

  it('asks the API to respect the knowledge cutoff', async () => {
    const fetchFn = vi.fn<HttpFetch>(async () => ({ ok: true, status: 200, json: async () => ({ hits: [] }) }))
    const adapter = createHackerNewsAdapter({ clock, fetchFn })

    await adapter.search(query({ notAfter: '2021-09-01' }))

    const url = fetchFn.mock.calls[0]![0]
    expect(url).toContain('numericFilters=created_at_i')
    expect(url).toContain(String(Math.floor(new Date('2021-09-01').getTime() / 1000)))
  })

  it('drops post-cutoff documents even when the API ignores the filter', async () => {
    // Defence in depth. An adapter leaking the future into an eval run silently invalidates §7.
    const adapter = createHackerNewsAdapter({
      clock,
      fetchFn: respond([
        { objectID: '1', story_text: 'before', created_at: '2021-08-01T00:00:00.000Z' },
        { objectID: '2', story_text: 'after', created_at: '2022-01-01T00:00:00.000Z' },
      ]),
    })

    const documents = await adapter.search(query({ notAfter: '2021-09-01' }))
    expect(documents.map((d) => d.text)).toEqual(['before'])
  })

  it('truncates snapshots to the bounded size', async () => {
    const adapter = createHackerNewsAdapter({
      clock,
      fetchFn: respond([{ objectID: '1', story_text: 'x'.repeat(5000), created_at: '2021-01-01T00:00:00.000Z' }]),
    })

    const [document] = await adapter.search(query())
    expect(document!.text).toHaveLength(MAX_SNAPSHOT_CHARS)
    expect(document!.text.endsWith('…')).toBe(true)
  })

  it('drops hits with no usable text', async () => {
    const adapter = createHackerNewsAdapter({
      clock,
      fetchFn: respond([{ objectID: '1', created_at: '2021-01-01T00:00:00.000Z' }]),
    })
    expect(await adapter.search(query())).toEqual([])
  })

  it('throws on a failed request, so the registry can record a degraded run', async () => {
    const adapter = createHackerNewsAdapter({
      clock,
      fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    })
    await expect(adapter.search(query())).rejects.toThrow(/429/)
  })
})

describe('manual-paste adapter', () => {
  const item = { url: 'https://reddit.example/r/bookkeeping/1', text: 'A bookkeeper describes the problem.' }

  it('is disabled when nothing was pasted', () => {
    // Reports "no manual evidence supplied" rather than looking like the source returned nothing.
    expect(createManualPasteAdapter({ items: [], clock }).isEnabled()).toBe(false)
    expect(createManualPasteAdapter({ items: [item], clock }).isEnabled()).toBe(true)
  })

  it('declares manual_paste compliance — the only sanctioned route for Reddit and LinkedIn', () => {
    expect(createManualPasteAdapter({ items: [item], clock }).compliance).toBe('manual_paste')
  })

  it('returns only items attached to this assumption, plus unattached ones', async () => {
    const adapter = createManualPasteAdapter({
      clock,
      items: [
        { ...item, assumptionId: 'a1', text: 'for a1' },
        { ...item, assumptionId: 'a2', text: 'for a2' },
        { ...item, text: 'unattached' },
      ],
    })

    const documents = await adapter.search(query({ assumptionId: 'a1' }))
    expect(documents.map((d) => d.text)).toEqual(['for a1', 'unattached'])
  })

  it('respects the knowledge cutoff and the result limit', async () => {
    const adapter = createManualPasteAdapter({
      clock,
      items: [
        { ...item, text: 'old', publishedAt: '2020-01-01' },
        { ...item, text: 'new', publishedAt: '2025-01-01' },
        { ...item, text: 'also old', publishedAt: '2020-06-01' },
      ],
    })

    expect((await adapter.search(query({ notAfter: '2021-01-01' }))).map((d) => d.text)).toEqual(['old', 'also old'])
    expect(await adapter.search(query({ maxResults: 1 }))).toHaveLength(1)
  })
})
