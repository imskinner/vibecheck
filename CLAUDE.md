# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`VIBECHECK_PRD.md` is the source of truth. This file is the operating summary. Where they
disagree, the PRD wins — and say so out loud rather than silently picking one.

---

## What this is

> Vibecheck turns an idea into a ranked list of the assumptions that could kill it, then hands
> you the specific humans to ask and the exact questions to ask them — and updates your
> confidence score as their answers come in.

```
  Idea (URL or description)
        │
        ▼
  [1] Idea Canvas          — structured extraction: problem, ICP, wedge, business model
        │
        ▼
  [2] Assumption Ledger    — 5–9 load-bearing assumptions, each falsifiable
        │
        ▼
  [3] Desk Research        — evidence FOR and AGAINST each assumption, every claim sourced
        │
        ▼
  [4] Red Team pass        — adversarial agent argues the idea is already dead
        │
        ▼
  [5] Kill-Shot Ranking    — top 3 assumptions by (impact × uncertainty × cheapness to test)
        │
        ▼
  [6] Discovery Pack       — WHO to ask, WHERE they are, WHAT to send, WHAT to ask
        │
        ▼
  [7] Evidence Intake      — founder logs conversation notes / transcripts
        │
        └──────► score updates, ledger updates, new kill-shots surface ──► back to [5]
```

Steps 1–6 are the acquisition product. **Step 7 is the business.**

**The category is saturated with commodity report generators, and we are deliberately not one.**
If you find yourself scaffolding a "generate a market report" feature, stop and re-read PRD §0.
The product is the bridge from report to real human conversations, plus a score that only moves
on primary evidence. A proposed feature that doesn't serve that bridge is out of scope for v1.

---

## Hard constraints

These are not preferences. Violating one is a defect regardless of how good the reason sounds.

### The Evidence Quality cap

```
composite = min(0.30×severity + 0.30×access + 0.25×wedge + 0.15×fit, 30 + (0.7 × EQ))
```

An idea with zero primary conversations **cannot exceed ~30**, however good the desk research
looks. The score is unflattering by default, which is what gives the user a reason to return and
makes gaming it require actually talking to people.

**Never weaken this to improve conversion.** Not the 30, not the 0.7, not by adding a source type
that counts toward EQ without being a real conversation. If first-session conversion is a problem,
the answer is a preview of what the score *could* become (PRD §11, an open question), never a
softer cap. Any PR touching these constants needs an explicit instruction from Gui.

### Claim provenance

Every claim carries `source_url`, `source_type`, `retrieved_at`, `confidence`, and a bounded
`retrieved_text` snapshot. Claims with `source_type: 'model_inference'` are **rendered visually
distinct** and **score-capped** (weight 0.15 — they can nudge a support value, never carry one).
A claim with no `source_url` and no primary conversation behind it is decoration, not evidence.

Only the synthesizer may emit `model_inference`, and only to record an honest negative. It is not
a hatch for model opinion to reach the score.

### The Source Adapter rule

**No data source may be referenced anywhere outside an adapter. Ever.** No `fetch` to a vendor API
in a route handler, no scraping helper in `/lib/research/orchestrator`, no exceptions for "just
this one quick lookup."

*GummySearch: profitable, ~135k users, zero burn, dead because Reddit changed its commercial API
terms.* Assume every source does this eventually. Killing one adapter must degrade output, never
break the build.

Reddit / LinkedIn / X are `user_authenticated` or `manual_paste` adapters only. The business does
not get built on unlicensed scraping.

### Non-goals for v1 — do not build, do not scaffold for

Ad creative generation · a general GTM toolkit (landing pages, email sequences, channel plans) ·
CRM or pipeline management · contact enrichment or email-finding (PII, LGPD/GDPR, licensing) ·
team/collaboration features · Reddit or LinkedIn scraping at scale · mobile app · multi-language
(English only).

The GTM toolkit is the v2 monetization surface, unlocked only *after* evidence intake proves the
loop works. Scaffolding for it early is how this becomes the product we rejected.

---

## Architecture

The thing worth understanding before touching anything: **the LLM never produces a number, and the
scoring function never calls an LLM.**

Models emit only structured inputs — assumption text, category, impact/uncertainty/test_cost
ratings, claim stance, claim confidence, source_type. `/lib/scoring` is pure, deterministic,
dependency-free, and takes plain TypeScript types rather than database rows. Two requirements
collapse without this split: score movements must be attributable to specific claims, and
composite σ must stay under 6 across paraphrases. Neither survives a model emitting the score.

Consequences that are easy to violate by accident:

- `/lib/scoring` types are the **source of truth**; the Drizzle schema is aligned to them, not the
  reverse. `/evals` must run without a database.
- **The red team emits `Assumption` rows (`origin: 'red_team'`), never `Claim`s.** It has no write
  path to the Claim table. A correct red-team insight still moves the score — desk research goes
  and finds the incumbent's pricing page, producing a real sourced claim. A wrong one fails to find
  support and stays `untested` instead of becoming a scored artifact. See PRD §5.4.1 before
  changing this; the asymmetric-cap alternative was considered and rejected.
- **The planner is deterministic code, not an agent.** Three agent roles: researcher (parallel),
  synthesizer, red-team. Decomposing a ledger into research tasks is a loop, and making it an agent
  injects variance upstream of the stability target.
- **Adapters return `SourceDocument`, not `Claim`** — a deliberate deviation from the interface
  sketched in §5.5, documented in `lib/research/adapters/types.ts`. Adapters are access and
  compliance; judging stance is model work. §5.5's rules are unchanged.
- **`extract-claims.ts` is the only place a source-backed claim is minted**, and provenance
  (`source_url`, `source_type`, `retrieved_at`, `retrieved_text`) is copied from the document the
  code already holds — never read from model output. The model cites a document *index*. It cannot
  fabricate a citation; there is no field that accepts one. Kill criterion 3 is why that had to be
  structural rather than instructional. Do not add a URL field to that tool schema.
- **Every LLM stage goes through `ModelClient`** (`lib/research/model.ts`). No provider SDK is
  imported anywhere. This keeps model IDs pinned per stage, keeps stages testable with no API key,
  and gives caching and cost accounting one home.
- **Adapters enforce the knowledge cutoff twice** — at the API and on the results. An adapter that
  leaks post-`t0` documents silently invalidates every blind-scoring number in §7.
- **Assumption status is arithmetic, not judgment.** `falsification_criterion` is a structured
  predicate fixed at creation time and evaluated by code once `sample_size` primary claims land.
  The LLM proposes claim→assumption mapping; the user approves it; the arithmetic decides.
- `Report` rows are **immutable** and carry pinned model IDs per stage. A re-run is a new row.
  Unpinned models make every historical eval number uninterpretable.
- `ScoreSnapshot` is append-only and stores the movement diff plus the claim IDs responsible.

Layout is specified in PRD §8. `/lib/scoring`, `/lib/research/adapters` (one file per source),
`/evals/golden-set`, `/evals/runners`, `/db`.

### Prompts are code

Every LLM-stage prompt lives in a versioned `.ts` file, with a comment on each instruction naming
**the failure mode it defends against**. An instruction whose failure mode nobody can name is an
instruction nobody can safely delete later.

---

## Evals

`/evals` is the reason this repo exists before any UI does. Long-form judgment output has invisible
quality regressions; without evals, prompt changes are unfalsifiable.

**The eval suite runs in CI, and any prompt or pipeline change requires an eval run.** A prompt
diff without an attached eval result is not reviewable — the whole point is that you cannot tell by
reading whether it got better or worse.

Golden-set entries have two layers: Layer 1 is the idea (description, `t0`, known outcome,
sourcing) and is all a contributed entry needs; Layer 2 is a hand-authored fixture ledger, needed
only so M0 can score headless before any LLM exists. See `/evals/golden-set/README` for the
contribution format.

The runner enforces its own honesty: it **refuses to print a separation statistic below n = 20**
and emits `insufficient_n` instead. At 5-vs-5 nothing is detectable, and a function that separates
dead from successful startups that cleanly means the golden set is wrong. M0's gate is 10 ideas and
measures plumbing; M5's gate is 30 and measures signal. Stability reports `not_applicable` until
assumption generation is live at M1.

If the golden set shows no separation, that is the kill signal for Vibecheck itself. Say so out
loud rather than shipping anyway.

---

## Commands

| Command | What it does |
|---|---|
| `npm test` | Full suite. The scoring invariants (PRD §5.8.6) live in `lib/scoring/invariants.test.ts`. |
| `npm test -- lib/scoring/support` | Single file, by path fragment. |
| `npm test -- -t "cap"` | Single test, by name. |
| `npm run test:watch` | Watch mode. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run eval` | Headless golden-set run. `-- --json` for machine-readable output. |
| `npm run prompt:assumptions` | Renders the assumption-generation prompt against a hardcoded idea. Makes no API call. |
| `npm run db:generate` | Generates migration SQL from the schema. Needs no database. |
| `npm run migrate` | Applies migrations. Needs `DATABASE_URL` — nothing in M0 does. |

`npm run dev` does not exist yet, and should not until M1.

---

## Working agreements

- Small commits, conventional commit messages.
- **Never add a dependency without stating what it costs and what it replaces.**
- If a task is ambiguous, ask one question rather than building both branches.
- No README badges, no CI configs that weren't asked for, no `docs/` folder.
- M0 is schemas, scoring, and the eval harness. **If you are polishing UI in M0, you have drifted.**
  The eval harness working matters more than anything being pretty.
