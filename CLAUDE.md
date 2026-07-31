# just-ai-help

Translation and help-docs tooling for **any app that keeps its strings in standard i18n JSON**.
Two functions sharing one pipe: **translate** a locale folder with a local or online AI engine and
then re-read the files to assert what was written; **author** help docs whose front-matter becomes
locale keys, so one sentence serves the article, the surface lede and the field hint.

**Running it needs Node 24+ and nothing else.** The UI ships as a committed `ui/dist`
and SQLite is built into the runtime (`node:sqlite`), so there is no install step for a *user*.
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
node server/translate.js config.json                 # translate what changed, then check
node server/translate.js config.json --check-only    # check files on disk, no engine. THE CI gate.
node server/translate.js config.json --probe         # translate twice, flag where the passes disagree
node server/translate.js config.json --escalate <profile>   # re-do ONLY flagged keys elsewhere
node server/translate.js config.json --accept <key,key>     # record findings as reviewed-correct
node server/extract.js   config.json [--check]       # docs front-matter -> locale keys
node server/review.js    config.json                  # the review workspace at :4780
npm test                                           # node --test, 148 tests
npm run build:ui                                   # rebuild the UI (developers only)
```

## What bites

- **The engine profile is data, not code.** Every field in `server/engines.json` exists because of a real failure — a stale model id, a thinking model with no output budget, a rate limit tuned for another provider. `extraBody` merges into the request body verbatim, so a new provider knob is a config edit. Add a provider by adding a row.
- **A thinking model returns EMPTY content unless thinking is off** — deliberation fills the budget before an answer is written. Ollama: `"think": false`. Raw llama.cpp: `--reasoning off`. `think` has no global default: it belongs to the engine row, matched to the model that row names. The shipped `ollama` row names a thinking model and carries `think: false`; `ollama-gemma3` omits it.
- **A model id must be a pullable tag, never a readable shorthand.** The flagship was written as `gemma-4-26b-a4b-qat` for a year of doc revisions; because that cannot be pulled, a session invented "supply your own GGUF" to explain the gap, and that unverified sentence became the reason the best measured model was not the default. `hf.co/<owner>/<repo>:<quant>` is a first-class Ollama tag — `ollama pull` fetches it from HuggingFace. Check a claim like that against `ollama list`, which records what actually fetched the weights.
- **Shielding is a substitution, and the substitution is what works.** Interpolations and glossary terms are swapped for `⟦0⟧`-style tokens before the model sees them and restored by index; an item whose tokens do not all come back exactly once is a failure that gets retried, not a result. Asking a model nicely does not work — that is measured, not assumed.
- **But the glossary is ALSO an instruction, and that half leaks.** `buildSystemPrompt()` writes every `doNotTranslate` term into the prompt as `never translate these terms`, while `shield()` substitutes only case-sensitive, word-bounded matches. The model obeys the prompt on forms the substitution never touched. Measured on the 1,965-key JustWrite run: adding `AI` turned **48 correct translations into findings** ("Exclude from AI" → "Excluir de la IA" is right and cannot be shielded), and `Strands` produced "la Strand narrativa" for "the narrative strand" with no substitution involved. The glossary is only for terms that must never be translated *anywhere*; a word that is a label in one string and prose in another belongs in `<lang>.accepted.json`.
- **`--probe` refuses to run at an effective temperature of 0**, including an `extraBody` override, because two identical passes would report a meaningless all-clear. `effectiveTemperature()` in `server/loop.js` derives that from the BUILT request body — never re-implement the merge rules elsewhere or the guard and the body will drift.
- **A gate that cannot go green is not a gate.** Some findings are correct output — Spanish for "No" is "No" — so without a way to clear them a PERFECT catalogue still fails `--check-only`, and people stop reading it. `server/accepted.js` records a reviewer verdict in `<lang>.accepted.json`, hashed over (key, code, source, target) so it EXPIRES the moment either string changes. Never a per-key exemption, and the count is always printed. Do NOT "fix" this class of noise with a hand-written list of words that are identical in the target language — `conventions.json` says why, about itself.
- **Never let a run exit 0 having silently skipped keys.** That bug is the reason this project exists. A key that exhausts every retry is left untranslated, reported by name, and the exit code is non-zero.
- **Every check must BITE.** A check ships with a test that hands it a deliberately broken string and asserts it complains; one that has never been seen to fail is indistinguishable from one that cannot.
- **Model claims need a measurement, and measurements go stale.** `server/models.json` marks every row `measured` or `available` and says on what hardware. A timing taken while another engine held VRAM is not a measurement.

## Layout

```
server/   the Node tool — translate loop, checks, probe, the workspace API
ui/       the review workspace: a standard Vite + Vue app (index.html, src/,
          components/, stores/, services/, assets/), built to a COMMITTED ui/dist
test/     node --test, against server/
scripts/  ui-hash.js — stamps the UI build so a stale committed dist is caught
```

ONE `package.json` at the root. Everything the UI needs is build-time only, since the built
output ships, so it is all `devDependencies` and a CLI user installs none of it.

## Where to look

| For | Read |
|---|---|
| Current state, what is open, and which record wins | `docs/HANDOFF.md` — **read this first** |
| Using the tool: which model for your machine, pull commands, the workflow | `docs/GUIDE.md` |
| Why every piece is built this way, with the measured tables | `README.md` |
| Which model to run and what it costs you | `server/models.json` |
| The evidence base for every model claim | `../justwrite-app/docs/plans/2026-07-26-i18n-single-source-research.md` — the sections from "The clean re-measurement — 2026-07-28" onward supersede anything older, including this repo's own docs |

Read branch and working-tree state from git, never from a doc.
