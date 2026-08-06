import { describe, expect, it } from 'vitest'

import { MIN_N_FOR_SEPARATION, separation, type ScoredEntry } from './stats'

const entries = (outcome: 'died' | 'succeeded', scores: number[]): ScoredEntry[] =>
  scores.map((composite, i) => ({ id: `${outcome}-${i}`, outcome, composite }))

describe('separation', () => {
  it('refuses to report anything below the sample-size floor', () => {
    // The anti-accuracy-theater rule, enforced by the tool. PRD §7.2.
    const tiny = [...entries('died', [10, 12, 14, 16, 18]), ...entries('succeeded', [80, 82, 84, 86, 88])]
    const report = separation(tiny)

    expect(report.status).toBe('insufficient_n')
    // Flawless separation in the data must still produce no numbers.
    expect(report).not.toHaveProperty('meanDifference')
    expect(report).not.toHaveProperty('cohensD')
  })

  it('refuses when one outcome group is effectively empty, even at full n', () => {
    const lopsided = [...entries('died', Array.from({ length: 24 }, (_, i) => 20 + i)), ...entries('succeeded', [90])]
    expect(separation(lopsided).status).toBe('insufficient_n')
  })

  it('reports once the floor is met', () => {
    const died = entries('died', Array.from({ length: 10 }, (_, i) => 20 + i))
    const succeeded = entries('succeeded', Array.from({ length: 10 }, (_, i) => 60 + i))
    const report = separation([...died, ...succeeded])

    expect(report.status).toBe('ok')
    if (report.status !== 'ok') return
    expect(report.n).toBe(MIN_N_FOR_SEPARATION)
    expect(report.meanDied).toBeCloseTo(24.5)
    expect(report.meanSucceeded).toBeCloseTo(64.5)
    expect(report.meanDifference).toBeCloseTo(40)
    expect(report.overlap).toBe(0)
    expect(report.cohensD).toBeGreaterThan(2)
  })

  it('reports maximal overlap and no effect for indistinguishable groups', () => {
    const scores = Array.from({ length: 10 }, (_, i) => 40 + i)
    const report = separation([...entries('died', scores), ...entries('succeeded', scores)])

    expect(report.status).toBe('ok')
    if (report.status !== 'ok') return
    expect(report.meanDifference).toBeCloseTo(0)
    expect(report.cohensD).toBeCloseTo(0)
    // Identical distributions sit at the no-signal midpoint, nudged up by the ties on the
    // diagonal: 55 of 100 ordered pairs have died >= succeeded when both groups are {40..49}.
    expect(report.overlap).toBeCloseTo(0.55, 10)
    expect(report.overlap).toBeGreaterThan(0.5)
  })

  it('reports partial overlap when the distributions interleave', () => {
    const died = entries('died', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    const succeeded = entries('succeeded', [55, 60, 65, 70, 75, 80, 85, 90, 95, 100])
    const report = separation([...died, ...succeeded])

    expect(report.status).toBe('ok')
    if (report.status !== 'ok') return
    expect(report.overlap).toBeGreaterThan(0)
    expect(report.overlap).toBeLessThan(0.5)
    expect(report.meanDifference).toBeGreaterThan(0)
  })

  it('does not divide by zero when a group has no spread', () => {
    const report = separation([
      ...entries('died', Array.from({ length: 10 }, () => 30)),
      ...entries('succeeded', Array.from({ length: 10 }, () => 30)),
    ])
    expect(report.status).toBe('ok')
    if (report.status !== 'ok') return
    expect(report.cohensD).toBe(0)
    expect(Number.isNaN(report.cohensD)).toBe(false)
  })
})
