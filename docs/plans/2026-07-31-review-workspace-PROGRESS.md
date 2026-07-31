# Review workspace — BUILD PROGRESS

**COMPLETE.** All six phases built, tested and committed on `main`, nothing pushed.
Design: [`2026-07-31-review-workspace-design.md`](2026-07-31-review-workspace-design.md).

Read branch and commit state from git, never from this file.

---

## Phases

| phase | what | commit |
|---|---|---|
| 0 | database — `node:sqlite`, providers/connections, gitignore guard | `4a39431` |
| 1a | `store.js` (review state, undo log, proposals, runs) + `terms.js` | `05b01dc` |
| 2 | `jobs.js` — progress, cancel, rejoin, proposals-only | `9de86c5` |
| 1b | `server.js` — the whole API over HTTP | `b29cca5` |
| 3 | `review-ui/` Vue 3 app + committed `dist` + staleness guard | `2abb601` |
| 5 | per-key notes feeding the next run | `bc87719` |
| 6 | docs — README, GUIDE, CLAUDE.md | this commit |

**144 tests pass.** Was 75 before this work.

## What was built

- **Undo everything, across days.** The action log is in SQLite, so an accept made on Friday is
  undoable on Monday. Un-accept exists; accepted findings are a visible, reversible bucket.
- **Bulk re-translate** with progress, cancel and rejoin-after-reload. Results are **proposals** —
  an engine never writes the catalogue.
- **Second opinion** — the Google widget in a same-origin frame, banner cropped at 42px.
- **Siblings**, **terminology** against the catalogue's own usage, **per-key notes** that feed the
  next run.
- **All target languages in one queue**, filterable.
- Keyboard-first: `j`/`k`, `a`, `u`, `e`, `g`, `/`.

## Non-negotiables, all now enforced by tests

1. **If git should see it, it is a FILE; workshop state is the DATABASE.** `--check-only` runs
   green with `.jah.db` deleted.
2. **Every engine action is a PROPOSAL.** A job leaves the locale file byte-identical.
3. **A key never reaches the UI**, and storing one refuses unless `.gitignore` covers `.jah.db`.
4. **Every check has a test that hands it something broken.**
5. **Saving one value leaves the file byte-identical except that value.**

## Two bugs found by running it, not by tests

- An unrecognised job **scope** fell through to the flagged branch and started a 154-key run.
  Now refused with a 400.
- The terminology check reported **102 findings** on the real catalogue, mostly inflection
  (`personaje`/`personajes`). Stemming plus a measured dominance threshold took it to 30 while
  still catching the defect it exists for.

## Open / not done

- **Back-translation** (`POST /api/backtranslate`) is specified in the design and **not built**.
  The second-opinion panel currently offers Google and staged proposals.
- **`--escalate` from the UI** works through the job endpoint; the CLI flag is unchanged.
- **No online engine is configured.** Groq/Mistral/OpenRouter rows are not added — the user has
  no key and did not want one yet. Local engines work today.
- The UI has been **driven against the real 2,039-key catalogue via HTTP** (154 rows, siblings,
  frame, presets) but **not clicked through in a browser**. That is the obvious next check.

## Log

- **2026-07-31** — design `55b292c`; phases 0–6 as above; 75 → 144 tests.
