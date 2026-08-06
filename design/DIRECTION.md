# M2 design direction

Decided 2026-08-05/06 after two mockup rounds. **`proto-a-rail.html` in this folder is the
reference** — a clickable prototype of the full journey. M2 implements this direction; deviations
should be deliberate and noted here.

## The direction in one paragraph

The "Instrument" visual world with the Lab's and the Dossier's *framings, without their theming*.
Warm graphite darks, one functional-orange accent spent in one place per screen, DIN-flavored
display type, machined squared corners. The left rail **is the product's loop**: Idea → Canvas
gate → Report → Discovery pack → Evidence. Sub-scores read as plain questions ("Is the pain real,
frequent, expensive?"); kill-shots read as questions with their pre-registered thresholds.

## Tokens

| Role | Value |
|---|---|
| Ground / panel / well | `#16171a` / `#1d1f23` / `#101113` |
| Edge | `#2f3238` |
| Ink / secondary / muted | `#e7e5dd` / `#a5a49b` / `#6d6d66` |
| Accent (one place per screen) | `#ff7a1a` |
| Status good / warn | `#9fb867` / `#d9a93c` (always with text, never color-alone) |
| Display / body / data | Bahnschrift → Segoe UI fallback / Segoe UI / Consolas |

Dark-only by deliberate commitment. Radii ≤ 4px. `tabular-nums` wherever digits align.

## Non-negotiable UI rules (these encode product rules)

- **The cap is the hero moment.** Composite renders with its cap state and the sentence that
  explains it ("talking to people is what moves this"). Never soften it (PRD §5.8).
- **`model_inference` content renders visually distinct** — dashed border, italic, explicitly
  score-inert (PRD §5.3). Same treatment for landscape entries with `basis: 'inference'`.
- **Red-team origin is always labelled** (chip + text, not color-alone).
- **Titles first, statements one click deep.** Assumptions lead with a ≤5-word title; the full
  falsifiable statement, criterion, ratings (as dot scales), and claims live in the expanded row.
  (Engine gap: generation doesn't emit `title` yet — add to the tool schema before M2 binds.)
- **Thresholds are displayed, never authored, in the Discovery pack** — it renders the existing
  `falsification_criterion` (PRD §5.6.5).
- **Landscape section**: quadrant with idea-specific axes + YOU marker + dashed empty-space
  callout; threat matrix with severity stripes and filter chips; threat copy states ability ×
  motivation. Landscape informs *what to test*, never the score — the UI copy says so.
- **File upload** on idea input (.md .txt .pdf .docx .xlsx .csv) and evidence intake
  (.txt .md .pdf .docx), with extraction/truncation feedback and, on evidence, the note that
  quotes are verified against the transcript.

## Alternates kept for recombination

Round 2 (same design system, different topology): **B master–detail** (best at 30-report scale;
candidate for the report screen) · **C quiet flow** (calmest single read). Round 1 references:
instrument / dossier / laboratory / telemetry. All published as claude.ai artifacts; URLs in the
project memory. The competitive-landscape section's structural inspiration is Gui's H1 control
panel artifact (verdict box, 2×2 with empty-wedge cell, threat-pilled matrix).
