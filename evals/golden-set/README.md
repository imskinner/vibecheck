# Golden set

30 real ideas with known outcomes at a chosen point in time — 15 that died, 15 that reached
meaningful revenue. Sourced from public postmortems, Indie Hackers, and shutdown posts.

**Status: 28 real entries (14 died, 14 succeeded), 2 short of 30. Plus 12 synthetic fixtures.**

The two sets do different jobs and are never mixed. The **fixtures** clear the M0 gate and pin the
scoring function's behaviour as a regression suite; they are excluded from separation statistics
because an instrument calibrated on invented outcomes measures nothing about the world. The **real
entries** are the M5 instrument. None has a fixture ledger yet, so none is scored — the pipeline
generates Layer 2 from M1.

Of the 28 real entries, 15 are low-contamination and 11 medium; 2 are high. `npm run eval` prints
that breakdown every run.

If the golden set shows no separation, that is the kill signal for Vibecheck itself (PRD §10).
Say so out loud rather than shipping anyway.

---

## Two layers, and why

Scoring is deterministic and consumes a **ledger**, not an idea. M0 also has to run headless before
any LLM exists in the codebase. So an entry has two layers:

| Layer | Contents | Who writes it | Needed for |
|---|---|---|---|
| **1 — the idea** | description, `t0`, known outcome, sourcing | contributor | everything |
| **2 — fixture ledger** | hand-authored assumptions and claims | maintainer, by hand | M0 only |

**A contributed entry only needs Layer 1.** Layer 2 is expensive to author by hand, which is
exactly why the seeded set is three. From M1 the pipeline generates Layer 2 and the existing
fixtures become regression baselines rather than inputs.

Entries without Layer 2 load and validate fine — the runner reports them as unscored rather than
failing. That is the intended state for the 27 until M1.

---

## Contributing an entry

One JSON file per idea in `ideas/`, named `<outcome-slug>.json`. Validated by `format.ts`; run
`npm run eval` and any malformed entry is listed with its specific errors and fails the run.

```jsonc
{
  "id": "ih-2021-somecompany",          // stable, unique, never reused
  "schema_version": 1,
  "layer1": {
    "name": "SomeCompany",
    "one_liner": "One sentence, as the founder would have pitched it at t0.",
    "description": "2–4 sentences. What it did, for whom, at what price.",

    // The knowledge cutoff. Blind scoring means the model may only see what was knowable here.
    "t0": "2021-04-01",

    "outcome": "died",                   // "died" | "succeeded"
    "outcome_date": "2022-09-15",        // must not precede t0
    "outcome_basis": "public_record",    // "public_record" | "synthetic"
    "outcome_note": "Shut down; founder published a postmortem citing no repeat purchase.",

    // How likely a model has already read this outcome. Required for public_record.
    // See "Contamination" below — this is a judgement you have to make, not a formality.
    "contamination_risk": "low",         // "low" | "medium" | "high"

    "sources": [                         // required for public_record entries; must be http(s)
      {
        "url": "https://…",
        "note": "Founder's shutdown post",
        // "fetched" = you opened the page and it says what you claim.
        // "search_result" = a search returned this URL with a matching title, unopened.
        "verified": "fetched"
      }
    ]
  }
}
```

### Contamination

A famous outcome is not a blind test. If the pipeline can recall that a company shut down rather
than derive it from what was knowable at `t0`, separation goes up for reasons that have nothing to
do with the scoring function — and M5's kill criterion becomes unfalsifiable in the flattering
direction.

So every real entry declares its risk, and **M5 must report separation twice**: once over the whole
set, once over `low` + `medium` only. The second number is the real one. Prefer obscure entries;
they are harder to source and worth the effort.

### Choosing `t0`

`t0` is the point at which the idea was still an open question — typically just before launch or
just before the first significant build. Set it too late and the outcome leaks into the inputs;
set it too early and there is nothing to research. **Nothing in Layer 2 may carry a
`retrieved_at` after `t0`**, and the validator enforces it.

### What makes a good entry

- **The outcome is unambiguous and publicly documented.** "Went quiet" is not "died". Prefer an
  explicit shutdown post, an acquisition notice, or published revenue.
- **"Succeeded" means meaningful revenue**, not funding raised. Raising is not the outcome we are
  trying to predict.
- **Ordinary cases, not famous ones.** Well-known outcomes are contaminated: any model has read the
  postmortem. Obscure entries measure the pipeline; famous entries measure recall.
- **Balance the failure modes.** A set where every dead idea died of no-demand will not exercise
  Market Access or Competitive Wedge at all.

---

## Synthetic fixtures

Entries with `"outcome_basis": "synthetic"` are hand-built to pin specific scoring behaviour. They
are **excluded from separation statistics** — inventing plausible startup outcomes and citing them
would be exactly the fabrication this product exists to prevent.

Every synthetic `source_url` must use the `example://` scheme, enforced by the validator, so a
fixture citation can never be mistaken for a real one. Real entries may not use it.

Each fixture earns its place by pinning a distinct behaviour — they are a behaviour matrix, not a
sample. Adding a fixture that pins nothing new is noise; if you cannot write its `pins` field, it
does not belong here.

| Fixture | Pins |
|---|---|
| `synth-001-postpilot` | The cap binding. Thorough desk research, zero conversations, EQ 0 → held at 30 |
| `synth-002-ledgerlift` | The cap releasing. Primary coverage of load-bearing assumptions → composite set by evidence |
| `synth-003-clinicqueue` | **The Market Access trap.** Severity 90 on real primary evidence, access refuted, composite still ~48 |
| `synth-004-sketchsync` | Uncovered dimensions. Three sub-scores with no assumptions → 50 with `uncovered: true` |
| `synth-005-inference-flood` | The model_inference swing clamp, end to end. 12 inference claims move support by exactly 8 |
| `synth-006-red-team-heavy` | A thorough red team tightens the cap without cratering an evidenced sub-score |
| `synth-007-conflicting-primary` | Conflicting primary evidence is not a verdict — `mixed` stays unresolved, band stays wide |
| `synth-008-gaming-attempt` | **The gaming vector.** 15 conversations on an impact-1 assumption → EQ stays at 17 |
| `synth-009-partial-coverage` | Fractional coverage. The middle of the cap's range, which nothing else occupies |
| `synth-010-weak-below-cap` | The cap is a ceiling, not a floor. Weighted mean 10 → composite 10, not lifted to 30 |
| `synth-011-criterion-override` | Pre-registered arithmetic beats accumulated desk evidence |
| `synth-012-full-coverage` | The top of the range. EQ 100 → cap 100 → cap stops constraining anything |

Two matter most. `synth-003` pins Market Access — the dimension the PRD says competitors ignore, so
the one whose behaviour most needs pinning before anything is built on it. `synth-008` pins the
gaming vector: if a future change makes Evidence Quality a claim count or a plain ratio, that
entry's score jumps and the cap becomes purchasable with busywork.

---

## Running

```bash
npm run eval            # human-readable
npm run eval -- --json  # machine-readable, for CI to diff across prompt versions
```

The runner **refuses to print a separation statistic below n = 20** and emits `insufficient_n`
instead. At 5-vs-5 nothing is detectable, and a function that separates dead from successful
startups that cleanly means the golden set is wrong, not that the function is right. The M0 gate is
10 scored entries and measures plumbing; the M5 gate is 30 and measures signal.

`stability` and `fabrication` report `not_applicable` until M1 — paraphrasing an idea does not
perturb a hand-authored fixture ledger, and there are no source adapters yet.
