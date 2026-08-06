import { describe, expect, it } from 'vitest'

import { MODEL_INFERENCE_MAX_SWING, NEUTRAL_SUPPORT } from './constants'
import { assumptionSupport, claimWeight } from './support'
import { mkAssumption, mkClaim, mkClaims } from './test-factories'

const A = 'a1'

describe('claimWeight', () => {
  it('multiplies source weight by confidence weight', () => {
    expect(
      claimWeight(mkClaim({ assumption_id: A, source_type: 'primary_conversation', confidence: 'high' })),
    ).toBeCloseTo(1.0)
    expect(
      claimWeight(mkClaim({ assumption_id: A, source_type: 'public_post', confidence: 'medium' })),
    ).toBeCloseTo(0.36)
    expect(
      claimWeight(mkClaim({ assumption_id: A, source_type: 'model_inference', confidence: 'low' })),
    ).toBeCloseTo(0.045)
  })
})

describe('assumptionSupport', () => {
  const untested = mkAssumption({ id: A, status: 'untested' })

  it('returns exactly neutral for an assumption with no evidence', () => {
    // PRD §5.4.1 — an untested assumption is a known unknown, not a demerit.
    expect(assumptionSupport(untested, []).value).toBe(NEUTRAL_SUPPORT)
  })

  it('ignores context claims entirely', () => {
    const claims = mkClaims(5, { assumption_id: A, stance: 'context' })
    expect(assumptionSupport(untested, claims).value).toBe(NEUTRAL_SUPPORT)
  })

  it('moves up on support and down on refutation, symmetrically', () => {
    const supports = mkClaim({ assumption_id: A, source_type: 'primary_conversation', stance: 'supports' })
    const refutes = mkClaim({ assumption_id: A, source_type: 'primary_conversation', stance: 'refutes' })
    expect(assumptionSupport(untested, [supports]).value).toBeCloseTo(66.667, 2)
    expect(assumptionSupport(untested, [refutes]).value).toBeCloseTo(33.333, 2)
  })

  it('saturates — each additional agreeing source is worth less than the one before it', () => {
    const at = (n: number) =>
      assumptionSupport(untested, mkClaims(n, { assumption_id: A, source_type: 'primary_conversation' })).value

    const marginals = Array.from({ length: 10 }, (_, i) => at(i + 1) - (i === 0 ? NEUTRAL_SUPPORT : at(i)))
    for (let i = 1; i < marginals.length; i++) {
      expect(marginals[i]!).toBeLessThan(marginals[i - 1]!)
    }
    expect(at(1000)).toBeLessThan(100)
  })

  it('never leaves the 0–100 range under any pile of evidence', () => {
    const many = assumptionSupport(untested, mkClaims(500, { assumption_id: A, source_type: 'primary_conversation' })).value
    const manyAgainst = assumptionSupport(
      untested,
      mkClaims(500, { assumption_id: A, source_type: 'primary_conversation', stance: 'refutes' }),
    ).value
    expect(many).toBeLessThanOrEqual(100)
    expect(manyAgainst).toBeGreaterThanOrEqual(0)
  })

  it('ranks a conversation above a blog post, claim for claim', () => {
    const conversation = assumptionSupport(
      untested,
      mkClaims(1, { assumption_id: A, source_type: 'primary_conversation' }),
    ).value
    const post = assumptionSupport(
      untested,
      mkClaims(1, { assumption_id: A, source_type: 'public_post', confidence: 'medium' }),
    ).value
    expect(conversation).toBeGreaterThan(post)
  })

  it('lets accumulated desk research raise a support value — the cap is what holds the line', () => {
    // Deliberate, and worth stating so nobody "fixes" it: enough public posts CAN out-support a
    // single conversation here (~3 medium-confidence posts ≈ 1 conversation). That is a reasonable
    // read of evidence for whether a problem exists, and it is not where the product's thesis is
    // defended. Desk research cannot raise Evidence Quality, so it cannot lift the composite past
    // 30 no matter how much of it accumulates — see composite.test.ts. Enforcing the thesis in
    // this curve as well would double-count the penalty and make sub-scores uninformative.
    const conversation = assumptionSupport(
      untested,
      mkClaims(1, { assumption_id: A, source_type: 'primary_conversation' }),
    ).value
    const manyPosts = assumptionSupport(
      untested,
      mkClaims(3, { assumption_id: A, source_type: 'public_post', confidence: 'medium' }),
    ).value
    expect(manyPosts).toBeGreaterThan(conversation)
  })

  describe('model_inference swing clamp', () => {
    it('lets a small amount of inference nudge the value', () => {
      const one = assumptionSupport(
        untested,
        mkClaims(1, { assumption_id: A, source_type: 'model_inference' }),
      )
      expect(one.value).toBeCloseTo(53.488, 2)
      expect(one.inferenceSwing).toBeCloseTo(3.488, 2)
    })

    it('clamps the aggregate swing no matter how many inference claims pile up', () => {
      // A low weight is not a cap — this is the cap. PRD §5.3.
      for (const n of [5, 20, 500]) {
        const result = assumptionSupport(
          untested,
          mkClaims(n, { assumption_id: A, source_type: 'model_inference' }),
        )
        expect(Math.abs(result.inferenceSwing)).toBeLessThanOrEqual(MODEL_INFERENCE_MAX_SWING + 1e-9)
        expect(result.value).toBeCloseTo(NEUTRAL_SUPPORT + MODEL_INFERENCE_MAX_SWING, 6)
      }
    })

    it('clamps relative to the value the sourced evidence alone would produce', () => {
      const claims = [
        mkClaim({ assumption_id: A, source_type: 'primary_conversation', stance: 'supports' }),
        ...mkClaims(10, { assumption_id: A, source_type: 'model_inference', stance: 'refutes' }),
      ]
      const result = assumptionSupport(untested, claims)
      // Sourced evidence alone → 66.667. Inference may drag it down by at most 8.
      expect(result.value).toBeCloseTo(66.667 - MODEL_INFERENCE_MAX_SWING, 2)
      expect(result.inferenceSwing).toBeCloseTo(-MODEL_INFERENCE_MAX_SWING, 6)
    })

    it('cannot carry an assumption on its own', () => {
      const inferenceOnly = assumptionSupport(
        untested,
        mkClaims(100, { assumption_id: A, source_type: 'model_inference' }),
      ).value
      const oneConversation = assumptionSupport(
        untested,
        mkClaims(1, { assumption_id: A, source_type: 'primary_conversation' }),
      ).value
      expect(inferenceOnly).toBeLessThan(oneConversation)
    })
  })

  describe('falsification criterion overrides', () => {
    it('pins a supported assumption regardless of contrary claims', () => {
      const a = mkAssumption({ id: A, status: 'supported' })
      const result = assumptionSupport(a, mkClaims(20, { assumption_id: A, stance: 'refutes' }))
      expect(result.value).toBe(90)
      expect(result.pinned).toBe(true)
    })

    it('pins a refuted assumption regardless of supporting claims', () => {
      const a = mkAssumption({ id: A, status: 'refuted' })
      const result = assumptionSupport(a, mkClaims(20, { assumption_id: A, stance: 'supports' }))
      expect(result.value).toBe(10)
      expect(result.pinned).toBe(true)
    })

    it('does not pin untested or mixed assumptions', () => {
      for (const status of ['untested', 'mixed'] as const) {
        const a = mkAssumption({ id: A, status })
        const result = assumptionSupport(a, mkClaims(1, { assumption_id: A }))
        expect(result.pinned).toBe(false)
        expect(result.value).not.toBe(90)
      }
    })
  })
})
