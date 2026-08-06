import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { extractTextFromFile, UnsupportedFileError } from './extract-text'

const dir = mkdtempSync(join(tmpdir(), 'vibecheck-ingest-'))
const write = (name: string, content: string): string => {
  const path = join(dir, name)
  writeFileSync(path, content, 'utf8')
  return path
}

describe('extractTextFromFile', () => {
  it('reads plain text and markdown', async () => {
    const txt = await extractTextFromFile(write('notes.txt', '  interview notes here  '))
    expect(txt).toEqual({ kind: 'text', text: 'interview notes here', warnings: [] })

    const md = await extractTextFromFile(write('idea.md', '# The idea\n\nA tool for…'))
    expect(md.kind).toBe('markdown')
    expect(md.text).toContain('# The idea')
  })

  it('reads csv as text', async () => {
    const result = await extractTextFromFile(write('data.csv', 'name,mrr\nacme,120'))
    expect(result.kind).toBe('csv')
    expect(result.text).toContain('acme,120')
  })

  it('REPORTS truncation instead of silently cutting', async () => {
    // A founder whose 400-page appendix was silently cut would rightly distrust everything
    // downstream of it.
    const result = await extractTextFromFile(write('huge.txt', 'x'.repeat(250_000)))
    expect(result.text).toHaveLength(200_000)
    expect(result.warnings[0]).toMatch(/truncated .* later content was NOT read/)
  })

  it('refuses unsupported extensions loudly', async () => {
    await expect(extractTextFromFile(write('deck.pptx', 'nope'))).rejects.toThrow(UnsupportedFileError)
    await expect(extractTextFromFile(join(dir, 'noext'))).rejects.toThrow(/unsupported file type/)
  })

  it('names the supported set in the error, so the caller can relay it', async () => {
    await expect(extractTextFromFile(write('img.png', ''))).rejects.toThrow(/\.txt \.md .*\.xlsx/)
  })
})
