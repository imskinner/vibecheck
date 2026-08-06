import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { asGoldenIdea, validateGoldenIdea, type GoldenIdea } from './format'

export interface LoadedEntry {
  file: string
  entry: GoldenIdea
}

export interface LoadFailure {
  file: string
  errors: string[]
}

export interface GoldenSet {
  entries: LoadedEntry[]
  failures: LoadFailure[]
}

export const DEFAULT_IDEAS_DIR = join(import.meta.dirname, 'ideas')

/**
 * Reads and validates every entry. Invalid entries are collected rather than thrown, so one bad
 * contribution cannot take the whole eval run down — but the runner exits non-zero if any failed,
 * because a silently skipped entry is a silently shrunk sample.
 */
export function loadGoldenSet(dir: string = DEFAULT_IDEAS_DIR): GoldenSet {
  const entries: LoadedEntry[] = []
  const failures: LoadFailure[] = []

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const path = join(dir, file)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      failures.push({ file, errors: [`invalid JSON: ${(error as Error).message}`] })
      continue
    }

    const result = validateGoldenIdea(parsed)
    if (result.ok) entries.push({ file, entry: asGoldenIdea(parsed) })
    else failures.push({ file, errors: result.errors })
  }

  return { entries, failures }
}
