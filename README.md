# Vibecheck

Vibecheck turns a startup idea into a ranked list of the assumptions that could kill it, then
hands you the specific humans to ask and the exact questions to ask them — and updates your
confidence score only as their answers come in.

Every competitor in this category stops at the report. Vibecheck's product is the bridge from
report to real conversations: an idea with zero primary evidence **cannot score above ~30**, no
matter how good the desk research looks, and the score moves only when logged conversations
resolve pre-registered thresholds.

## Reading order

- **[VIBECHECK_PRD.md](VIBECHECK_PRD.md)** — the source of truth. §0 explains what this
  deliberately is not.
- **[CLAUDE.md](CLAUDE.md)** — operating guide: hard constraints, architecture, commands.
- **[design/DIRECTION.md](design/DIRECTION.md)** — the M2 UI direction and its reference prototype.
- **[evals/RUNS.md](evals/RUNS.md)** — dated eval baselines (run artifacts are gitignored).

## Quick start

```bash
npm install
npm test                 # 331 tests; scoring invariants live in lib/scoring/invariants.test.ts
npm run eval             # headless golden-set run, no API needed

# live (needs ANTHROPIC_API_KEY or `ant auth login`):
npm run pipeline:live -- --description "your idea" --yes
```

The pipeline: canvas extraction → falsifiable assumption generation → adversarial red team →
desk research through source adapters → deterministic scoring → competitive landscape. All
prompts are versioned `.ts` files with per-instruction failure-mode comments; the scoring
function never calls a model, and no model ever emits a score.
