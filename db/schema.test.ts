/**
 * Keeps the schema aligned to /lib/scoring/types.ts. PRD §8.
 *
 * The failure mode this defends against: a new claim source type or assumption category is added
 * to the TypeScript union, scoring starts producing values for it, and the column silently
 * rejects it at write time — or worse, accepts it and the eval numbers stop matching production.
 */

import { describe, expect, it } from 'vitest'

import {
  ASSUMPTION_CATEGORIES,
  ASSUMPTION_ORIGINS,
  ASSUMPTION_STATUSES,
  CLAIM_CONFIDENCES,
  CLAIM_SOURCE_TYPES,
  CLAIM_STANCES,
} from '../lib/scoring/types'
import { assumptions, claims } from './schema'

describe('schema alignment with the scoring types', () => {
  it.each([
    ['assumptions.category', assumptions.category.enumValues, ASSUMPTION_CATEGORIES],
    ['assumptions.origin', assumptions.origin.enumValues, ASSUMPTION_ORIGINS],
    ['assumptions.status', assumptions.status.enumValues, ASSUMPTION_STATUSES],
    ['claims.stance', claims.stance.enumValues, CLAIM_STANCES],
    ['claims.source_type', claims.sourceType.enumValues, CLAIM_SOURCE_TYPES],
    ['claims.confidence', claims.confidence.enumValues, CLAIM_CONFIDENCES],
  ])('%s accepts exactly the values the scoring types define', (_name, columnValues, typeValues) => {
    expect([...columnValues].sort()).toEqual([...typeValues].sort())
  })
})
