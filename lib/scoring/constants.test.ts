import { describe, expect, it } from 'vitest'

import {
  CAP_FLOOR,
  CAP_SLOPE,
  CATEGORY_TO_SUB_SCORE,
  CONFIDENCE_WEIGHT,
  SOURCE_WEIGHT,
  SUB_SCORE_WEIGHTS,
} from './constants'
import {
  ASSUMPTION_CATEGORIES,
  CLAIM_CONFIDENCES,
  CLAIM_SOURCE_TYPES,
  SUB_SCORE_KEYS,
} from './types'

describe('calibration surface', () => {
  it('maps every assumption category to exactly one sub-score', () => {
    for (const category of ASSUMPTION_CATEGORIES) {
      expect(SUB_SCORE_KEYS).toContain(CATEGORY_TO_SUB_SCORE[category])
    }
    expect(Object.keys(CATEGORY_TO_SUB_SCORE).sort()).toEqual([...ASSUMPTION_CATEGORIES].sort())
  })

  it('covers every sub-score with at least one category', () => {
    const covered = new Set(Object.values(CATEGORY_TO_SUB_SCORE))
    for (const key of SUB_SCORE_KEYS) expect(covered).toContain(key)
  })

  it('weights every source type and confidence level', () => {
    for (const t of CLAIM_SOURCE_TYPES) expect(SOURCE_WEIGHT[t]).toBeGreaterThan(0)
    for (const c of CLAIM_CONFIDENCES) expect(CONFIDENCE_WEIGHT[c]).toBeGreaterThan(0)
  })

  it('ranks primary conversation above every desk source, and inference below all', () => {
    const primary = SOURCE_WEIGHT.primary_conversation
    const desk = CLAIM_SOURCE_TYPES.filter(
      (t) => t !== 'primary_conversation' && t !== 'model_inference',
    )
    for (const t of desk) {
      expect(SOURCE_WEIGHT[t]).toBeLessThan(primary)
      expect(SOURCE_WEIGHT.model_inference).toBeLessThan(SOURCE_WEIGHT[t])
    }
  })

  it('has sub-score weights that sum to 1', () => {
    const total = Object.values(SUB_SCORE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('weights market access at least as highly as any other sub-score', () => {
    // PRD §5.8.5 — access is where products die. Guards against a quiet reweighting.
    for (const key of SUB_SCORE_KEYS) {
      expect(SUB_SCORE_WEIGHTS.access).toBeGreaterThanOrEqual(SUB_SCORE_WEIGHTS[key])
    }
  })

  it('keeps the evidence cap at its specified floor and slope', () => {
    // HARD CONSTRAINT. If this test fails, someone weakened the cap. PRD §5.8, CLAUDE.md.
    expect(CAP_FLOOR).toBe(30)
    expect(CAP_SLOPE).toBe(0.7)
    expect(CAP_FLOOR + CAP_SLOPE * 100).toBe(100)
  })
})
