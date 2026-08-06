# Eval run log

Run artifacts live in `evals/runs/` and are **gitignored** — this file records the headline
numbers so they survive the artifacts. Baselines are measured-once facts with dates; re-measure
before treating them as current.

## 2026-08-06 — first full blind run (`blind-full`, 28 entries, v0 only)

Pipeline: all prompts v1 · adapters: hacker-news only · ~$10 · 309 calls.

- **Desk separation (n=26, low+medium contamination):** died 49.3 vs succeeded 50.5 · diff +1.2 ·
  d 0.85 · overlap 27%. Direction right on 3 of 4 sub-scores (severity +1.4, access +1.6,
  fit +1.5, wedge +0.1). **Honest read: weak.** Compressed variance flatters d; 12 of 28 entries
  sat at exactly 50.0 desk. Two causes: thin evidence (~1.2 claims/assumption, single adapter —
  fixable) and Mom-Test-shaped assumptions being deliberately desk-unresolvable (structural; the
  M5 design tension, unresolved).
- **Composite separation: degenerate by construction** (EQ = 0 in every blind run → every
  composite = 30). Measured on the weighted mean instead; PRD §7.2 records the finding.
- **Stability (σ<6): not measured** — needs `--variants 4` (~$40, not yet run).

## 2026-08-06 — fabrication check (seed 20260806, 40 sampled of 143 eligible)

- verify-claim **v1 false alarm:** reported 12.5% — every failure was the judge reading stance as
  snapshot-vs-claim because it was never shown the assumption. Instrument bug, not fabrication.
- verify-claim **v2 (content and stance judged separately):** **fabrication 2.5%** (1 of 40
  decidable) — under the 5% kill line. Stance-error 10% (2 inverted / 20 decidable).
  **20 of 40 "unclear bearing"** — claims topically faithful but weakly connected to their
  specific assumption; extraction-precision work for a prompt v2.

## 2026-08-06 — pilot (3 entries) and live landscape debugging

- Pilot (tutorspree / senja / everpix): exposed the composite degeneracy; red teams found the
  actual documented causes of death blind (Tutorspree's SEO collapse, Everpix's storage COGS).
- Landscape stage live debugging cost three runs (~$3.50): max_tokens truncation surfaced as an
  empty tool input (fixed: `TruncatedToolCallError`, global), SDK refusing 32k non-streaming
  (fixed: all calls stream), axes key variants (fixed: tolerant parse + raw head in the failure
  reason). Final run produced a claims-grounded 12-entry landscape whose empty-space verdict
  correctly called the 2026 privacy-analytics wedge fully contested.
