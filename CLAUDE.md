# just-ai-help

Translation and help-docs tooling for **any app that keeps its strings in standard i18n JSON**.
Two functions sharing one pipe: **translate** a locale folder with a local or online AI engine and
then re-read the files to assert what was written; **author** help docs whose front-matter becomes
locale keys, so one sentence serves the article, the surface lede and the field hint.

**Running it needs Node 24+ and nothing else.** The UI ships as a committed `client/dist`
and all state is plain JSON, so there is no install step for a *user*.
`npm install` is for developing the UI only.

**The rule is ADOPT-FIRST, not zero-dependency.** An earlier revision of this file said
"nothing from npm" and told readers to keep it that way. That was written by a session, never
by the user, whose standing rule is the opposite (`docs/plans/2026-07-27-v2-design-executor-plan.md:42`).
What the 2026-07-27 incident actually established is narrower and still true: **own the
translation request body.** The loop is ours because every candidate failed a specific measured
test — json-autotranslate hardcodes its endpoint, Lingo.dev failed its spike, and the fork's
self-verification was blind to the defects that mattered. That reasoning does not extend to a
UI, and it never extended to a library that only reads.

## Commands

```bash
node server/init.js      path/to/your-app/en.json     # once per app: derives and writes the config
node server/translate.js config.json                 # translate what changed, then check
node server/translate.js config.json --check-only    # check files on disk, no engine. Run this before you ship.
node server/translate.js config.json --no-confirm    # skip the confirmation pass (see below)
node server/translate.js config.json --probe         # translate twice, flag where the passes disagree
node server/translate.js config.json --escalate <profile>   # re-do ONLY flagged keys elsewhere
node server/translate.js config.json --accept <key,key>     # record findings as reviewed-correct
node server/extract.js   config.json [--check]       # docs front-matter -> locale keys
node server/review.js    config.json                  # the review workspace at :4780
npm test                                           # node --test, 244 tests
npm run build:client                               # rebuild the UI (developers only)
```

## What bites

- **The engine profile is data, not code.** Every field in `server/config/engines.json` exists because of a real failure — a stale model id, a thinking model with no output budget, a rate limit tuned for another provider. `extraBody` merges into the request body verbatim, so a new provider knob is a config edit. Add a provider by adding a row.
- **A thinking model returns EMPTY content unless thinking is off** — deliberation fills the budget before an answer is written. Ollama: `"think": false`. Raw llama.cpp: `--reasoning off`. `think` has no global default: it belongs to the engine row, matched to the model that row names. The shipped `ollama` row names a thinking model and carries `think: false`; `ollama-gemma3` omits it.
- **A model id must be a pullable tag, never a readable shorthand.** The flagship was written as `gemma-4-26b-a4b-qat` for a year of doc revisions; because that cannot be pulled, a session invented "supply your own GGUF" to explain the gap, and that unverified sentence became the reason the best measured model was not the default. `hf.co/<owner>/<repo>:<quant>` is a first-class Ollama tag — `ollama pull` fetches it from HuggingFace. Check a claim like that against `ollama list`, which records what actually fetched the weights.
- **Shielding is a substitution, and the substitution is what works.** Interpolations and glossary terms are swapped for `⟦0⟧`-style tokens before the model sees them and restored by index; an item whose tokens do not all come back exactly once is a failure that gets retried, not a result. Asking a model nicely does not work — that is measured, not assumed.
- **But the glossary is ALSO an instruction, and that half leaks.** `buildSystemPrompt()` writes every `doNotTranslate` term into the prompt as `never translate these terms`, while `shield()` substitutes only case-sensitive, word-bounded matches. The model obeys the prompt on forms the substitution never touched. Measured on the 1,965-key JustWrite run: adding `AI` turned **48 correct translations into findings** ("Exclude from AI" → "Excluir de la IA" is right and cannot be shielded), and `Strands` produced "la Strand narrativa" for "the narrative strand" with no substitution involved. The glossary is only for terms that must never be translated *anywhere*; a word that is a label in one string and prose in another belongs in `<lang>.accepted.json`.
- **`--probe` refuses to run at an effective temperature of 0**, including an `extraBody` override, because two identical passes would report a meaningless all-clear. `effectiveTemperature()` in `server/loop.js` derives that from the BUILT request body — never re-implement the merge rules elsewhere or the guard and the body will drift.
- **`untranslated` is FOUR situations wearing one badge, and only the engine can tell them apart.** A target byte-identical to its source is a glyph (`A`, `H2`, `{n}s`), a name that stays English (`EPUB`), a word Spanish shares (`Color`, `total`) — or a genuine skip (`books` should be `libros`). A string comparison cannot separate them, so a fresh catalogue raises ~70 and the one real defect hides inside the correct output. `server/confirm.js` asks the engine about exactly those keys — **the candidate set is free, because the translation run already proved everything it CHANGED was translatable**. Measured 2026-07-31: 57 of 71 cleared, 20/20 long planted skips caught, 37/40 short ones. It **never writes a translation** — of 10 proposals, `{n} w` → `{n} min` (w is *words*) and `TODO` → `TODO POR HACER` were wrong, and "elevator pitch" got two different answers in one run. Asking twice to manufacture "unsure" was tried and **failed**: 4 disagreements out of 71, and it agreed with itself confidently on both wrong answers.
- **THE ENGINE NEVER SIGNS OFF.** The confirmation pass writes ANNOTATIONS into `.jah-state.json`, never into `<lang>.accepted.json`. An earlier version wrote acceptances stamped `by: "ollama (<model>)"` and justified it with that field — but `by` exists because an agent once wrote 58 verdicts into a real project in bulk. It makes a machine verdict *visible*; it does not authorise one. A `same` verdict PRE-TICKS a row so 70 keys are one click; the approval recorded is still yours, with your name. Measured false-clear rate on short strings is ~7.5% (`OK`, `pan`) — which is exactly why a human still presses the button.
- **A gate that cannot go green is not a gate.** Some findings are correct output — Spanish for "No" is "No" — so without a way to clear them a PERFECT catalogue still fails `--check-only`, and people stop reading it. `server/accepted.js` records a reviewer verdict in `<lang>.accepted.json`, hashed over (key, code, source, target) so it EXPIRES the moment either string changes. Never a per-key exemption, and the count is always printed. Do NOT "fix" this class of noise with a hand-written list of words that are identical in the target language — `server/config/conventions.json` says why, about itself.
- **Two scopes, one mechanism: JSON.** Committed text is what git must carry — `config.json`, `<lang>.accepted.json`, `<lang>.notes.json`, and the locale files themselves. Everything else is workshop state a re-run can rebuild, and it is gitignored: `.jah-state.json` per project (review cursor, undo log, proposals, confirmation verdicts, runs) and `settings.json` in the TOOL's folder (your connections, API keys, your name). SQLite was removed on 2026-07-31 — the committed files have to be text regardless, so a database was a second mechanism rather than a replacement, and nothing here needs SQL: one user, ~2,000 keys, no foreign keys, and the biggest churniest dataset (the translation cache) was always a plain file.
- **Connections are TOOL-level, never per-project.** You install once and point at many apps; storing a connection beside a project meant re-entering the same key for every app. `settings.json` lives inside the tool's own clone — never `~/.just-ai-help`, because deleting the tool must delete everything it wrote.
- **Every path resolves against the CONFIG FILE, never the working directory.** `server/paths.js` owns all of it, and nothing else may call `resolve()` on a config value. Before 2026-07-31 `localesDir` and the cache were cwd-relative: that is why every documented command began with a `cd`, and why running from the wrong folder silently started with NO cache and re-translated a whole catalogue — 27 minutes and 464 hand-corrected keys, measured. `test/paths.test.js` runs the resolver from an unrelated directory so it cannot come back.
- **ONE engine resolver, `server/engine.js`, used by both doors.** The CLI layered the project config over an `engines.json` row; the workspace resolved a connection and layered nothing, so `cfg.model`, `cfg.url` and `cfg.think` appeared ZERO times in the job path — an override that worked in the terminal was silently ignored in the UI. Same tool, same config, two answers. Never resolve a profile anywhere else.
- **`placeholder` and `pluralSeparator` are READ FROM `en.json`** (`server/infer.js`). An explicit config value always wins, and whatever was inferred is printed rather than decided quietly. The prompt's plural rule is BUILT from the separator: it used to be the literal `" | "`, so the checks obeyed your value while the model was told about a pipe — the setting worked on its default by coincidence and broke on any other value.
- **An acceptance records WHO signed it off.** `by` and `at` sit outside the hash, and an unclaimed verdict is written as `unknown` with a warning rather than borrowing the OS username. The field exists because an agent wrote 58 verdicts into a real project in bulk and the format could not tell them from a human's review.
- **Never let a run exit 0 having silently skipped keys.** That bug is the reason this project exists. A key that exhausts every retry is left untranslated, reported by name, and the exit code is non-zero.
- **Every check must BITE.** A check ships with a test that hands it a deliberately broken string and asserts it complains; one that has never been seen to fail is indistinguishable from one that cannot.
- **Model claims need a measurement, and measurements go stale.** `docs/models.md` marks every row `measured` or `available` and says on what hardware. A timing taken while another engine held VRAM is not a measurement.

## Layout

```
server/   the Node tool — translate loop, checks, probe, the workspace API.
          config/ holds its two shipped settings files (engines, conventions).
          package.json with NO dependencies and no node_modules. Node 24+ built-ins
          only: global fetch for the engines, plain JSON files for state.
          state.js   per-project workshop state (.jah-state.json, gitignored)
          settings.js YOUR connections + keys (settings.json, in THIS folder, gitignored)
client/   the review workspace — a standard Vite + Vue app on @delebash/llm-ui.
          Its OWN package.json and node_modules; built to a COMMITTED client/dist.
test/     node --test, against server/
scripts/  ui-hash.js — stamps the UI build so a stale committed dist is caught
```

**Cleanly split, no workspaces.** The two halves own their own dependencies; the root
`package.json` holds scripts only and has no `node_modules` at all. Every package in the tree
belongs to the client, which is honest — the server imports nothing but `node:` built-ins.

`npm install` happens in `client/`, and only for someone editing the UI. **Using** the tool
needs no install, because `client/dist` is committed.

## Where to look

| For | Read |
|---|---|
| Current state, what is open, and which record wins | `docs/HANDOFF.md` — **read this first** |
| Every config file, what reads it, and which one you edit | `docs/CONFIG.md` |
| Using the tool: which model for your machine, pull commands, the workflow | `docs/GUIDE.md` |
| Why every piece is built this way, with the measured tables | `README.md` |
| Which model to run and what it costs you | `docs/models.md` |
| Which engine/provider, its limits and setup | `docs/engines.md` |
| Why a language rule exists, and what the schema cannot express | `docs/language-rules.md` |
| The evidence base for every model claim | `../justwrite-app/docs/plans/2026-07-26-i18n-single-source-research.md` — the sections from "The clean re-measurement — 2026-07-28" onward supersede anything older, including this repo's own docs |

Read branch and working-tree state from git, never from a doc.
