# just-ai-help

Translation and help-docs tooling for **any app that keeps its strings in standard i18n JSON**.
Two functions sharing one pipe: **translate** a locale folder with a local or online AI engine and
then re-read the files to assert what was written; **author** help docs whose front-matter becomes
locale keys, so one sentence serves the article, the surface lede and the field hint.

**Zero dependencies. Node 20+, global `fetch`, nothing from npm.** There is no `npm install` step
because there is nothing to install. Keep it that way — the whole loop was brought in-house
precisely because a dependency owned the request body and we could not reach it.

## Commands

```bash
node src/translate.mjs config.json                 # translate what changed, then check
node src/translate.mjs config.json --check-only    # check files on disk, no engine. THE CI gate.
node src/translate.mjs config.json --probe         # translate twice, flag where the passes disagree
node src/translate.mjs config.json --escalate <profile>   # re-do ONLY flagged keys elsewhere
node src/extract.mjs   config.json [--check]       # docs front-matter -> locale keys
node src/review.mjs    config.json --lang es       # triage page at :4780
npm test                                           # node --test, 65 tests, no deps
```

## What bites

- **The engine profile is data, not code.** Every field in `src/engines.json` exists because of a real failure — a stale model id, a thinking model with no output budget, a rate limit tuned for another provider. `extraBody` merges into the request body verbatim, so a new provider knob is a config edit. Add a provider by adding a row.
- **A thinking model returns EMPTY content unless thinking is off** — deliberation fills the budget before an answer is written. Ollama: `"think": false`. Raw llama.cpp: `--reasoning off`.
- **Shielding is a substitution, never an instruction.** Interpolations and glossary terms are swapped for `⟦0⟧`-style tokens before the model sees them and restored by index; an item whose tokens do not all come back exactly once is a failure that gets retried, not a result. Asking a model nicely does not work — that is measured, not assumed.
- **`--probe` refuses to run at an effective temperature of 0**, including an `extraBody` override, because two identical passes would report a meaningless all-clear. `effectiveTemperature()` in `src/loop.mjs` derives that from the BUILT request body — never re-implement the merge rules elsewhere or the guard and the body will drift.
- **Never let a run exit 0 having silently skipped keys.** That bug is the reason this project exists. A key that exhausts every retry is left untranslated, reported by name, and the exit code is non-zero.
- **Every check must BITE.** A check ships with a test that hands it a deliberately broken string and asserts it complains; one that has never been seen to fail is indistinguishable from one that cannot.
- **Model claims need a measurement, and measurements go stale.** `src/models.json` marks every row `measured` or `available` and says on what hardware. A timing taken while another engine held VRAM is not a measurement.

## Where to look

| For | Read |
|---|---|
| Current state, what is open, and which record wins | `docs/HANDOFF.md` — **read this first** |
| Using the tool: which model for your machine, pull commands, the workflow | `docs/GUIDE.md` |
| Why every piece is built this way, with the measured tables | `README.md` |
| Which model to run and what it costs you | `src/models.json` |
| The evidence base for every model claim | `../justwrite-app/docs/plans/2026-07-26-i18n-single-source-research.md` — the sections from "The clean re-measurement — 2026-07-28" onward supersede anything older, including this repo's own docs |

Read branch and working-tree state from git, never from a doc.
