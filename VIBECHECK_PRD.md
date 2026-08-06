# Vibecheck — Product Requirements Document

**Version:** 0.2 (pre-build)
**Status:** Resolved for build — M0 in progress
**Owner:** Gui
**Last updated:** 2026-08-05

> **v0.2 changelog.** Closes the specification forks found during `/init` interrogation.
> Sub-scores are deterministic and fully specified (§5.8). The red-team pass emits assumptions,
> never claims (§5.4). Falsifiability has an operational test and a structured criterion (§5.2).
> Claims store a retrieval snapshot (§5.3). Core entities are defined (§5.9). Golden-set format is
> two-layer; the M0 gate is 10 ideas, the separation gate is 30 (§7, §9). Changed or new sections
> are marked **[v0.2]**.

---

## 0. Read this first

This PRD deliberately **excludes** most of the original product concept. An earlier version of
this idea was a general-purpose "AI startup idea validator": paste a URL, get a deep market
report and a score. That version was assessed and rejected. Reasons, kept here so the agent does
not re-derive them:

- The category is saturated (Preuve AI, IdeaProof, ValidatorAI, DimeADozen, IdeaBuddy,
  WorthBuild, ProductGapHunt, ValidateMySaaS, PainHunt, aicofounder, and others), and the
  competitors write each other's comparison listicles — a signature of a commodity SEO war.
- Price is anchored at free-to-$29-one-time. No retention, no LTV.
- "Deep research over 50+ live sources with citations" is table stakes, not differentiation.
  Frontier-model deep-research modes do it as a bundled feature.
- A product whose output is a verdict has no reason for a second session.

**Vibecheck's bet is different.** Every competitor stops at the report. Vibecheck's product is
the *bridge from report to real human conversations*, and a score that only moves when the
founder brings back primary evidence.

If a proposed feature does not serve that bridge, it is out of scope for v1.

---

## 1. Problem

Building is cheap. Choosing what to build is not. ~42–43% of startups fail from no market need.
The failure is rarely "I never researched" — it's "I researched, felt confident, built for four
months, and never spoke to ten real buyers."

The gap in the market is not analysis. It is **the twenty feet between a founder reading an
analysis and a founder sending the first cold DM.** Nobody covers that twenty feet.

## 2. Target user (v1)

**Primary:** Technical or product-literate solo builders and 2-person teams who have shipped
something before, have an idea in hand, and are 0–2 weeks from writing code. They are capable of
doing discovery but don't, because the activation energy is high and the first step is unclear.

**Explicitly NOT v1:** first-time non-technical idea-havers, students, accelerator cohorts,
enterprise innovation teams. These are worse payers or need a different product.

**Reachability note:** this ICP is findable (Indie Hackers, HN, r/SaaS, X build-in-public, PH
maker community, Claude Code / Cursor user communities). Reachability is a scoring dimension in
the product; it must also be true of our own ICP.

## 3. The one-sentence product

> Vibecheck turns an idea into a ranked list of the assumptions that could kill it, then hands
> you the specific humans to ask and the exact questions to ask them — and updates your
> confidence score as their answers come in.

## 4. Core loop

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

Steps 1–6 are the acquisition product. **Step 7 is the business.** Build 7 in v1 even if it is
ugly; without it Vibecheck is another $29 report.

## 5. Feature specification

### 5.1 Idea Canvas
- Input: a URL (fetch + parse landing page), a freeform description, or a short guided chat.
- Output: structured JSON — `problem`, `icp_hypothesis`, `wedge_hypothesis`, `business_model`,
  `stage`, `founder_unfair_advantage` (optional, user-supplied).
- Must show the user the parsed canvas and let them correct it before research runs.
  Garbage-in is the #1 quality failure mode.

### 5.2 Assumption Ledger — **[v0.2]**
Each assumption is a row:

```ts
type Assumption = {
  id: string
  statement: string          // MUST be falsifiable. "Freelance designers lose >2h/week to X"
                             // NOT "there is demand for X"
  category: 'problem' | 'icp' | 'willingness_to_pay' | 'access' | 'competition'
            | 'execution' | 'timing'
  origin: 'canvas' | 'red_team' | 'founder'   // [v0.2] see §5.4
  impact: 1 | 2 | 3 | 4 | 5          // if false, how dead are we
  uncertainty: 1 | 2 | 3 | 4 | 5     // how little do we know
  test_cost: 1 | 2 | 3 | 4 | 5       // 1 = one afternoon, 5 = months
  status: 'untested' | 'supported' | 'refuted' | 'mixed'
  falsification_criterion: FalsificationCriterion   // [v0.2] structured, not prose
  evidence: Claim[]
}
```

#### 5.2.1 Operational test for "falsifiable"

"MUST be falsifiable" is otherwise unenforceable, so it is defined as a check, not a vibe. A
statement passes only if all three hold, and the validator is code plus a rubric-graded second
pass — not the generating model's own judgment:

1. **Named population.** A specific, countable group. "Freelance designers billing >$60/hr" passes;
   "users", "businesses", "teams" fail.
2. **Observable predicate.** Something you could witness in past behavior, per Mom Test rules.
   Present or past state, never future intent. "have paid for" passes; "would want" fails.
3. **Threshold.** A quantity or comparator such that a specific observation contradicts the
   statement.

Failing statements are regenerated, not repaired in place — a model asked to patch its own vague
statement will usually just add adjectives. Falsifiability pass-rate is a tracked eval metric.

#### 5.2.2 Falsification criterion

Pre-registering the threshold before interviews is what makes the score honest (§5.6.5). Prose
thresholds do not survive contact with a model re-reading them afterward, which can rationalize
any outcome. So the criterion is structured and evaluated by code:

```ts
type FalsificationCriterion = {
  applies_to: string        // the named population
  observation: string       // what you would go and measure
  metric: string            // the countable unit
  comparator: '<' | '<=' | '>' | '>='
  threshold: number
  sample_size: number       // primary conversations required before this resolves
}
```

Status resolution is deterministic, never a model judgment call. Once an assumption accumulates
`sample_size` claims with `source_type: 'primary_conversation'`, the criterion is evaluated and
`status` is set to `supported` or `refuted`. Below `sample_size`, status is `untested`, or `mixed`
if primary claims conflict in stance. The LLM's role at intake (§5.7) is limited to extracting
claims and proposing which assumption they attach to — the user approves the mapping, and the
arithmetic decides the verdict.

### 5.3 Evidence / Claim schema (the anti-hallucination spine) — **[v0.2]**

```ts
type Claim = {
  id: string
  assumption_id: string
  text: string                  // paraphrased, never a long verbatim quote
  stance: 'supports' | 'refutes' | 'context'
  source_url: string | null
  source_type: 'primary_conversation' | 'public_post' | 'company_page' | 'funding_db'
             | 'news' | 'review_site' | 'model_inference'
  retrieved_at: string          // ISO
  retrieved_text: string | null // [v0.2] bounded snapshot of the source passage
  confidence: 'high' | 'medium' | 'low'
}
```

**Hard rule:** `source_type: 'model_inference'` claims are rendered visually distinct and are
capped in how much they can move a score. A claim with no `source_url` and no primary
conversation behind it is decoration, not evidence.

**[v0.2] `retrieved_text`.** The fabrication check in §7 verifies that a source actually contains
the claim. Checking the live URL later measures link rot and client-side rendering, not model
error — the metric in kill criterion 3 would be dominated by the web changing rather than the
model lying. So the adapter stores a bounded snapshot (~1500 chars around the supporting passage)
at retrieval time. Rules: it is internal-only and never rendered in the product, it is what the
fabrication checker verifies against, and drift between snapshot and live URL is tracked as a
separate, non-alarming number.

**[v0.2] Narrowed scope of `model_inference`.** With the red-team pass rerouted (§5.4), this
source type exists for one job: the synthesizer recording an honest negative — "no evidence found
either way on this assumption" — or connecting two already-sourced claims. It is not a hatch for
model opinion to reach the score. No pipeline stage other than the synthesizer may emit it.

### 5.4 Desk research engine — **[v0.2]**
- Orchestration: **deterministic planner** (code, not an agent) decomposes the ledger into
  per-assumption research tasks → parallel researcher agents → synthesizer → red-team critic.
  Three agent roles, not four. Decomposition is a loop, not a reasoning problem, and making it an
  agent inserts a variance source upstream of everything, which fights the stability target in §7.
- The **red-team critic** is a required, separate pass whose only instruction is to argue the
  idea is dead: name the incumbent that already does this, name why the ICP won't switch, name
  the distribution channel that's closed. Single-shot LLM reports are structurally sycophantic and
  this pass is the intended antidote. *(That it is the biggest quality differentiator is a
  hypothesis about the market, not a requirement. The requirement is that the pass exists and
  emits well-formed assumptions.)*
- All research results are cached and versioned so a report is reproducible and a score is
  auditable. This audit trail doubles as step-level checkpointing — see §8.

#### 5.4.1 Red-team output contract — **[v0.2] the red team never writes Claims**

Look at what §5.4 asks the red team to produce: *name the incumbent, name why the ICP won't
switch, name the closed channel.* None of those are evidence. All three are checkable assertions
about how the idea dies — which is exactly what the Assumption table holds. The red team is the
second assumption generator, covering the negative space the founder's own framing cannot see.

**It therefore emits `Assumption` rows with `origin: 'red_team'`, and may raise `uncertainty` on
existing assumptions. It has no write path to the Claim table.** The `model_inference` cap keeps
no carve-out.

Why this and not the obvious alternative:

- **A correct red-team insight still moves the score, through the front door.** "Incumbent X
  already ships this" becomes an assumption, desk research finds X's pricing page, and the result
  is a `company_page` claim with a real `source_url` — uncapped. The red team bites just as hard;
  it has to bring a receipt like everything else.
- **A wrong one dies quietly instead of becoming a scored artifact.** Models confabulate
  incumbents and invent competitor features, and negative facts are the hardest class to verify.
  Letting the least-grounded stage write claims aims it straight at kill criterion 3. Routed
  through assumptions, a hallucinated threat simply fails to find support and stays `untested`.
- **It feeds the wedge.** Red-team assumptions are high-impact and high-uncertainty by
  construction, so they rank into the kill-shots (§5.5) and out into the Discovery Pack. "Here is
  how you die, and here is who to ask about it" is the most valuable sentence this product can
  produce. Emitting claims would terminate that insight in a report paragraph.

**Rejected alternative — asymmetric capping** (let model inference push a score down freely, cap
only upward movement, on the theory that unwarranted pessimism costs nothing). Rejected because it
makes the number a function of model pessimism, and red-team tone is the least stable output in
the pipeline; and because it breaks movement attribution (§5.8) by linking a score change to a
claim with no `source_url`. The score is earned in both directions or it means nothing.

**Acknowledged cost.** Red-team assumptions do reach the score indirectly, by changing the ledger.
The difference is what they assert: not *"this idea is bad"* but *"here is a known unknown."*
Uncertainty suppressing a score until evidence arrives is the cap philosophy working, not leaking.
This imposes a hard invariant on §5.8, tested in M0: **adding assumptions must increase uncertainty
mass, never negative mass.** A red team that finds six new ways to die must not crater the score
relative to one that found none — otherwise the pipeline punishes its own thoroughness and the
standing temptation becomes softening the red team to make scores look sane.

### 5.5 Source Adapter layer — **non-negotiable architecture requirement**

GummySearch was profitable, had ~135k users and zero burn, and died because Reddit changed its
commercial API terms. Assume every source will do this.

Every data source sits behind one interface:

```ts
interface SourceAdapter {
  id: string
  compliance: 'licensed' | 'public_api' | 'user_authenticated' | 'manual_paste'
  legalNotes: string
  isEnabled(): boolean
  search(query: ResearchQuery): Promise<Claim[]>
}
```

Rules:
- No source may be referenced anywhere in the app except through an adapter.
- Killing one adapter must degrade output, never break the build.
- Ship v1 with the safest set: general web search, Product Hunt public GraphQL API (rate-limited,
  read terms), Hacker News (Algolia API, permissive), company websites/pricing pages, YC RFS
  (public page), public funding announcements.
- Reddit/LinkedIn/X: implement as `user_authenticated` or `manual_paste` adapters only. Do not
  build the business on unlicensed scraping of them.

### 5.6 Discovery Pack (the wedge)
For the top-ranked kill-shot assumption, generate:
1. **Where they are** — named communities, subreddits, Slack/Discord groups, LinkedIn search
   strings, conferences, review-site categories. Specific, not "developer communities."
   **[v0.2] Enforced, not exhorted:** every venue MUST carry a resolvable `url`. A venue without
   one is not specific and is regenerated. This is schema-level, so "developer communities" cannot
   be emitted in the first place.
2. **Who to ask** — surfaced from public posts where someone described this problem in their own
   words, with a link to the post. **Not** a scraped contact database.
3. **What to send** — a short outreach message per channel, written to get a conversation, not a
   demo.
4. **What to ask** — a 20-minute interview guide following Mom Test rules: past behavior, not
   future intent; no pitching; no leading questions. Include 2–3 questions specifically designed
   to *refute* the assumption.
5. **What would change your mind** — an explicit pre-registered threshold: "if fewer than 4 of 10
   say they've paid for a workaround, mark this assumption refuted."

Pre-registering the threshold before the interviews is what makes the score honest.

**[v0.2]** This threshold is not prose written fresh at pack-generation time. It is the rendering
of the assumption's existing `falsification_criterion` (§5.2.2), which was fixed when the
assumption was created. The pack displays it; it does not author it. Anything else lets the
threshold drift toward whatever the evidence turned out to be.

### 5.7 Evidence Intake
- Paste notes, or upload a transcript.
- LLM extracts `Claim`s with `source_type: 'primary_conversation'`, maps them to assumptions,
  and proposes status changes for user approval (never auto-applies).
- Diff view: "your Market Access score moved 41 → 58 because of 3 new primary claims."

### 5.8 Scoring model — **[v0.2] fully specified, deterministic**

**No model ever emits a score.** Sub-scores are a pure function of the ledger. The LLM produces
only structured inputs — assumption text, category, impact, uncertainty, test_cost, claim stance,
claim confidence, source_type. `/lib/scoring` is deterministic, dependency-free, takes plain
TypeScript types rather than database rows, and is unit-tested with no LLM in the process.

This is not a style preference. Two requirements below are unbuildable otherwise: "every score
movement links to the claims that caused it" cannot be honored if a model produced the number, and
the σ < 6 stability target in §7 cannot be reached by asking a model to be numerically consistent
across paraphrases.

Five sub-scores, 0–100, each with a stated confidence band:

| Sub-score | Question it answers |
|---|---|
| **Problem Severity** | Is the pain real, frequent, and expensive? |
| **Market Access** | Can this ICP be reached repeatably and cheaply? *(most competitors ignore this — it is where products actually die)* |
| **Competitive Wedge** | Is there a narrow entry an incumbent won't defend? |
| **Founder Fit** | Unfair advantage, distribution, domain access |
| **Evidence Quality** | How much of the above rests on primary evidence vs. model inference? |

#### 5.8.1 Category → sub-score mapping

Every assumption category maps to exactly one sub-score. Evidence Quality is cross-cutting and
computed over the whole ledger.

| Category | Sub-score |
|---|---|
| `problem`, `icp`, `willingness_to_pay` | Problem Severity |
| `access` | Market Access |
| `competition`, `timing` | Competitive Wedge |
| `execution` | Founder Fit |

#### 5.8.2 Per-assumption support value

Each assumption resolves to `support ∈ [0,100]` — "given current evidence, how well does this
assumption hold?"

Claim weight is `source_weight × confidence_weight`:

| `source_type` | weight | | `confidence` | weight |
|---|---|---|---|---|
| `primary_conversation` | 1.00 | | `high` | 1.0 |
| `company_page`, `funding_db` | 0.80 | | `medium` | 0.6 |
| `review_site` | 0.70 | | `low` | 0.3 |
| `public_post` | 0.60 | | | |
| `news` | 0.50 | | | |
| `model_inference` | **0.15** | | | |

`stance` contributes `+1` for `supports`, `−1` for `refutes`, `0` for `context`. Then:

```
net     = Σ (stance × source_weight × confidence_weight)
support = 50 + 50 × ( net / (|net| + K) )        // K = 2.0, saturating
```

The saturating form is deliberate: no single claim can dominate, and the tenth supporting blog
post is worth far less than the first.

**A low weight is not a cap.** §5.3 requires that `model_inference` be *capped* in how much it can
move a score, and a weight of 0.15 does not do that — enough inference claims still dominate the
curve (three high-confidence ones already exceed 8 support points). So inference is accumulated
separately and its aggregate swing is clamped:

```
support = f(net_sourced) + clamp(f(net_sourced + net_inference) − f(net_sourced), ±8)
```

The clamp is expressed in support points rather than in weight because that is the quantity §5.3
actually constrains. It defends against the synthesizer manufacturing consensus out of its own
opinions.

**Overrides.** If the `falsification_criterion` has resolved (§5.2.2), it wins: `supported` pins
support to 90, `refuted` pins it to 10. Pre-registered arithmetic beats accumulated vibes.

**An assumption with no evidence contributes exactly 50** — the formula gives this for free at
net 0, with no special case. It pulls toward the middle rather than toward zero, which is what
satisfies the §5.4.1 invariant: an untested assumption is a known unknown, not a demerit, and score
suppression stays where it belongs, in the Evidence Quality cap.

Note this is about *evidence*, not *status*. Desk research on an `untested` assumption does move
its support value — it should, since severity and wedge are legitimately informed by public
evidence. What desk research cannot do is raise Evidence Quality (§5.8.4), so it cannot lift the
composite past the cap however much of it accumulates. Enforcing the thesis a second time inside
the support curve would double-count the penalty and make sub-scores uninformative.

#### 5.8.3 Sub-scores and confidence bands

```
sub_score = Σ(impact_i × support_i) / Σ(impact_i)     // over that category's assumptions
```

Impact-weighted, so what matters is whether the load-bearing assumptions hold. A category with no
assumptions scores 50 and is flagged as uncovered rather than silently averaged in.

The confidence band is a direct function of how much of that category's impact mass is untested:

```
band = ±25 × (untested_impact / total_impact)
```

Zero primary evidence therefore reads "48 ±25", which is honest, and the band narrows as evidence
lands — visible progress without moving the number.

#### 5.8.4 Evidence Quality — coverage-weighted

EQ measures whether the assumptions that actually carry the idea have primary evidence, **not** how
many claims exist. A raw ratio or a raw count is trivially gamed: log fifteen conversation notes
against your least important assumption and unlock the cap without testing anything that could
kill you.

```
coverage_i = min(1, primary_claim_count_i / criterion_i.sample_size)   // default 5 if unset
EQ         = 100 × Σ(impact_i × coverage_i) / Σ(impact_i)
```

Only `primary_conversation` claims count toward coverage. Desk research cannot raise EQ at all —
that is the entire point.

#### 5.8.5 Composite and cap

```
weighted_mean = 0.30×severity + 0.30×access + 0.25×wedge + 0.15×fit

composite = min(weighted_mean, 30 + (0.7 × EQ))
```

Market Access carries equal top weight because §5.8's table is right that it is where products
die. Founder Fit is weighted lowest because it is substantially self-reported and equal weighting
would leak self-flattery into the composite.

This means an idea with zero primary conversations **cannot exceed ~30**, no matter how good the
desk research looks. This is the product's soul. It makes the score unflattering by default,
gives the user a reason to return, and makes gaming it require actually talking to people —
which is the desired behavior. Do not soften this to improve first-session conversion.

#### 5.8.6 Invariants — **[v0.2] these are the M0 unit tests**

1. `EQ = 0 ⟹ composite ≤ 30`, for every possible ledger.
2. A ledger of only `model_inference` claims cannot move any sub-score more than ±8 from its
   all-untested baseline.
3. Adding N `untested` assumptions of any impact never decreases the composite by more than the
   uncertainty term permits, and never below 50 on any sub-score by that mechanism alone (§5.4.1).
4. Score movement is fully attributable: removing the claims cited for a movement and rescoring
   reproduces the prior composite exactly.
5. Scoring is a pure function — same ledger in, same numbers out, no clock, no I/O, no randomness.

Additional requirements:
- Show sub-scores, never the composite alone.
- Every score movement links to the claims that caused it.
- Re-running the same idea with reworded input must produce a materially similar score.
  **[v0.2]** "Materially similar" has exactly one definition, the σ < 6 target in §7. Note that
  this is not achievable inside the scoring function: the function's input is an LLM-generated
  ledger, and a paraphrase that yields 9 assumptions instead of 6 moves every aggregate. Stability
  is a property of assumption generation, which is why §7 exists before the UI.

### 5.9 Core entities — **[v0.2] new**

§5.2 and §5.3 defined Assumption and Claim. The other three were referenced throughout and never
specified.

**`Idea`** — the mutable working object. Holds `input_type` (`url` | `description` | `chat`),
`raw_input`, the extracted canvas from §5.1 as structured JSON, and `canvas_confirmed_at`. Research
must not run before the user has confirmed the canvas; garbage-in is the #1 quality failure mode
(§5.1) and this is the enforcement point. Carries `t0`, the knowledge-cutoff date, which is what
makes blind scoring in §7 possible.

**`Report`** — **immutable.** One row per pipeline run. §5.4 requires that a report be reproducible
and a score auditable, which only holds if the run is frozen: the canvas as it was, the adapter set
and their enabled state, prompt versions, and **pinned model IDs per stage**. Without pinned model
IDs the golden set silently drifts underneath you the next time a provider ships an update, and
every historical eval number becomes uninterpretable. A Report is never edited; a re-run is a new
row.

**`ScoreSnapshot`** — append-only, one row per scoring event. Holds the five sub-scores with their
bands, the composite, whether the cap bound and at what value, the claim-set it was computed from,
a pointer to the prior snapshot, and the movement diff — the delta plus the specific claim IDs
responsible. This table is what renders "your Market Access score moved 41 → 58 because of 3 new
primary claims" (§5.7) and what makes invariant 4 in §5.8.6 checkable. Snapshots come from
evidence intake as well as full runs, so the Report reference is nullable.

## 6. Non-goals for v1

Explicitly out of scope. Do not build these; do not scaffold for them.

- Ad creative generation
- A general "GTM toolkit" (landing pages, email sequences, channel plans)
- CRM / pipeline management
- Contact enrichment or email-finding (PII, LGPD/GDPR exposure, licensing cost)
- Team/collaboration features
- Reddit or LinkedIn scraping at scale
- Mobile app
- Multi-language (English only in v1)

The GTM toolkit is the v2 expansion, unlocked *after* evidence intake proves the loop works. It
is the monetization surface, not the acquisition surface.

## 7. Evaluation harness — **build this before the UI**

Long-form judgment output has invisible quality regressions. Without evals, prompt changes are
unfalsifiable.

- **Golden set:** 30 real ideas with known outcomes at a chosen point in time — 15 that died,
  15 that reached meaningful revenue. Sourced from public postmortems, Indie Hackers, and
  shutdown posts.
- **Blind scoring:** run the pipeline on each, with the model given only what was knowable at t0.
- **Target metric:** separation between the two groups on composite score, plus per-sub-score
  discrimination. Report mean difference and overlap, not accuracy theater.
- **Hallucination check:** sample N claims per run, verify the source actually contains the claim
  — against `retrieved_text` (§5.3), not the live URL. Track a fabrication rate. Record it in the
  repo every run. *(Whether to publish it externally is a separate decision, deliberately not
  pre-committed here.)*
- **Stability check:** paraphrase each golden-set input 3 ways, measure score variance.
  Target: composite σ < 6.
- Run the suite in CI on any prompt or pipeline change.

If the golden set shows no separation, **that is the kill signal for Vibecheck itself.** Say so
out loud rather than shipping anyway.

### 7.1 Golden-set format — **[v0.2] two layers**

Deterministic scoring (§5.8) means `/lib/scoring` consumes a *ledger*, not an idea — and M0 must
run headless before any LLM call exists in the codebase. So each entry has two layers:

- **Layer 1 — the idea.** Description, `t0`, known outcome (`died` | `succeeded`), outcome date,
  and sourcing links. This is all a contributed entry needs. Cheap to author.
- **Layer 2 — a frozen fixture ledger.** Hand-authored assumptions and claims for that idea. Only
  M0 needs it, only hand-authoring produces it, and it is expensive — which is exactly why the
  seeded set is 3. From M1 the pipeline generates Layer 2 and the fixtures become regression
  baselines rather than inputs.

The three seeds are chosen adversarially rather than representatively: one clearly dead, one
clearly successful, and one that looked strong on desk research and died on **Market Access** —
the dimension §5.8 claims competitors ignore is the one whose behavior most needs pinning down
before anything is built on top of it.

### 7.2 Sample-size discipline — **[v0.2] enforced by the runner**

At 5-vs-5 no separation is detectable; you would need an effect size around d ≈ 2.0, and a scoring
function that separates dead from successful startups that cleanly means the golden set is wrong,
not that the function is right. Even 15-vs-15 is only powered for a large effect.

**The runner refuses to print a separation statistic below n = 20 and emits `insufficient_n`
instead.** §7's instruction to avoid accuracy theater becomes a property of the tool rather than
something to remember at the moment the numbers are tempting.

Consequently the two gates measure different things and are not in conflict:

| Gate | n | Question |
|---|---|---|
| **M0** | 10 | Does it run headless, parse, and produce auditable output? Plumbing. |
| **M5** | 30 | Is there separation? Signal. |

The stability check is inert at M0 — paraphrasing an idea does not perturb a hand-authored fixture
ledger, so there is nothing to measure until assumption generation is live at M1. The runner
reports `not_applicable` rather than a misleading zero.

## 8. Technical direction — **[v0.2] revised**

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- **DB:** Postgres (Neon or Supabase) + Drizzle ORM. **[v0.2]** Two constraints. The scoring
  function's TypeScript types are the source of truth and the schema is aligned to them, never the
  reverse — otherwise ORM concerns shape the core logic and `/evals` ends up needing a database to
  run, which it must not. And use `text` columns with TS unions plus CHECK constraints rather than
  Postgres enums: `source_type`, `category`, `status` and `origin` will churn, and
  `ALTER TYPE ... ADD VALUE` is transactionally awkward and generates unpleasant migrations.
- **LLM:** Anthropic API with tool use; model choice per stage (cheaper model for extraction,
  stronger for synthesis and red-team). **[v0.2]** Model IDs are pinned in the versioned prompt
  files and recorded on the Report row (§5.9). Unpinned models make evals irreproducible.
- **Long-running jobs:** research runs take minutes and will die inside a serverless request.
  **[v0.2] But no job-runner vendor before M1, and none at all in M0.** The durability requirement
  is already largely satisfied by §5.4's audit trail — once every pipeline step persists its output,
  a crashed run resumes from the last completed step. What remains is a queue and a worker, which
  is a Postgres table plus a polling loop, or `pg-boss` if bought off the shelf. Inngest/Trigger.dev
  buy one genuinely non-trivial thing — fan-out/fan-in with per-adapter rate limits and step-level
  failure observability — and that becomes worth its auth surface, local-dev story and second copy
  of pipeline state only once parallel adapter rate-limiting actually hurts. Revisit at M1. Stream
  progress to the client either way.
- **Auth:** minimal — magic link
- **Report:** server-rendered interactive document with anchored, expandable evidence. Not a PDF.
- **[v0.2] Prompts are code.** Every LLM-stage prompt lives in a versioned `.ts` file, with a
  comment on each instruction naming the failure mode it defends against. An instruction whose
  failure mode nobody can name is an instruction nobody can safely delete later.

### Repository layout

```
/app                  Next.js routes
/lib
  /canvas             idea extraction
  /assumptions        generation + ranking
  /research
    /adapters         SourceAdapter implementations — one file each
    /orchestrator     planner / researcher / synthesizer
    /redteam          adversarial critic
  /scoring            sub-scores, caps, movement diffs
  /evidence           claim schema, intake, transcript parsing
/evals
  /golden-set         30 ideas + known outcomes
  /runners
/db                   drizzle schema + migrations
```

## 9. Milestones

| Milestone | Contents | Done when |
|---|---|---|
| **M0** | Schemas (Idea, Assumption, Claim, Report, ScoreSnapshot), deterministic scoring function, eval harness. 3 seeded golden ideas with fixture ledgers; format and runners built for 30 | Scoring function runs headless on 10 ideas and produces auditable output. All §5.8.6 invariants pass. No LLM call exists in the codebase yet except the assumption-generation prompt, unwired |
| **M1** | Canvas + assumption generation + 2 source adapters + red-team pass | One idea end-to-end, CLI or minimal UI |
| **M2** | Interactive report UI with evidence drill-down and sub-scores | A stranger can read a report and explain why the score is what it is |
| **M3** | Discovery Pack generation | Produces a pack Gui would actually use to send 10 DMs |
| **M4** | Evidence intake + score movement | Score changes after logging a real conversation |
| **M5** | Full 30-idea eval, publish calibration | Separation measured and reported honestly |

**Do not skip M0.** Building UI first is the failure mode.

**[v0.2]** M2's and M3's done-when criteria are judgment gates with a sample size of one, not
runnable checks. That is deliberate and they are worth keeping — but they cannot gate CI, and
nothing should be built that pretends they can. Every other milestone's gate is mechanical.

**[v0.2] Sequencing note.** §4 says step 7 is the business and must ship in v1; the table places
Evidence Intake at M4. There is no conflict — v1 spans M0–M5. Recorded here so no future reader
mistakes M4 for post-v1 scope and cuts it.

## 10. Kill criteria for Vibecheck itself

Pre-registered, in the spirit of the product:

1. If the M5 eval shows no meaningful separation between known-dead and known-successful ideas,
   the scoring premise is invalid. Stop or pivot to pure discovery tooling with no score.
2. If, after 20 users complete a Discovery Pack, fewer than 5 log any primary evidence, the
   bridge doesn't work and Vibecheck is just another report generator. Stop.
3. If fabrication rate on sampled claims exceeds 5% and can't be driven down, the product is
   dangerous and shouldn't ship.

## 11. Open questions

- Does the Evidence Quality cap kill first-session conversion badly enough to need a "preview"
  of what the score could become? (Test; do not assume.)
- Is Product Hunt data actually load-bearing, or is it decorative? Check whether removing it
  changes any golden-set score.
- Pricing: one-time is category-standard and category-poison. Likely answer is per-idea credits
  plus a subscription for the ongoing evidence loop — but this is a v2 question.
- Should the Discovery Pack ever name individuals, or only link to public posts? Default to
  posts-only until legal review. LGPD applies.
