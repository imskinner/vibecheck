/**
 * File → text, for the two places founders bring documents in: idea input (PRD §5.1 — a pitch
 * memo, a PRD, a spreadsheet of research) and evidence intake (§5.7 — call transcripts).
 *
 * This module only extracts text. What happens to the text is the caller's business, and every
 * downstream guarantee survives unchanged: an idea file still goes through canvas extraction and
 * the §5.1 confirmation gate; a transcript file still goes through the verbatim-quote check,
 * which runs against the extracted text exactly as it would against pasted text.
 *
 * Extraction is capped, and truncation is REPORTED — a founder whose 400-page appendix was
 * silently cut would rightly distrust everything downstream of it.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

export type FileKind = 'text' | 'markdown' | 'csv' | 'pdf' | 'docx' | 'spreadsheet'

export interface ExtractedText {
  text: string
  kind: FileKind
  /** Anything lossy that happened — truncation, empty sheets, unparseable pages. */
  warnings: string[]
}

export class UnsupportedFileError extends Error {
  constructor(readonly extension: string) {
    super(
      `unsupported file type '${extension}' — supported: .txt .md .markdown .csv .pdf .docx .xlsx`,
    )
    this.name = 'UnsupportedFileError'
  }
}

/** Roughly 50k tokens — comfortably inside a context window with room for the prompt around it. */
const MAX_CHARS = 200_000

function bounded(text: string, warnings: string[]): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_CHARS) return trimmed
  warnings.push(
    `file text truncated from ${trimmed.length.toLocaleString()} to ${MAX_CHARS.toLocaleString()} characters — later content was NOT read`,
  )
  return trimmed.slice(0, MAX_CHARS)
}

async function fromPdf(path: string, warnings: string[]): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(await readFile(path)) })
  try {
    const result = await parser.getText()
    if (result.text.trim() === '') {
      warnings.push('pdf contained no extractable text — scanned pages need OCR, which is not built')
    }
    return result.text
  } finally {
    await parser.destroy()
  }
}

async function fromDocx(path: string, warnings: string[]): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ path })
  for (const message of result.messages) warnings.push(`docx: ${message.message}`)
  return result.value
}

async function fromSpreadsheet(path: string, warnings: string[]): Promise<string> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)

  const sheets: string[] = []
  workbook.eachSheet((sheet) => {
    const rows: string[] = []
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[])
        .slice(1) // exceljs row.values is 1-indexed with an empty slot 0
        .map((v) => (v === null || v === undefined ? '' : String(v)))
      rows.push(cells.join(', '))
    })
    if (rows.length === 0) warnings.push(`sheet '${sheet.name}' is empty`)
    else sheets.push(`## ${sheet.name}\n${rows.join('\n')}`)
  })
  return sheets.join('\n\n')
}

export async function extractTextFromFile(path: string): Promise<ExtractedText> {
  const extension = extname(path).toLowerCase()
  const warnings: string[] = []

  switch (extension) {
    case '.txt': {
      return { kind: 'text', warnings, text: bounded(await readFile(path, 'utf8'), warnings) }
    }
    case '.md':
    case '.markdown': {
      return { kind: 'markdown', warnings, text: bounded(await readFile(path, 'utf8'), warnings) }
    }
    case '.csv': {
      return { kind: 'csv', warnings, text: bounded(await readFile(path, 'utf8'), warnings) }
    }
    case '.pdf': {
      return { kind: 'pdf', warnings, text: bounded(await fromPdf(path, warnings), warnings) }
    }
    case '.docx': {
      return { kind: 'docx', warnings, text: bounded(await fromDocx(path, warnings), warnings) }
    }
    case '.xlsx': {
      return {
        kind: 'spreadsheet',
        warnings,
        text: bounded(await fromSpreadsheet(path, warnings), warnings),
      }
    }
    default:
      throw new UnsupportedFileError(extension === '' ? '(none)' : extension)
  }
}
