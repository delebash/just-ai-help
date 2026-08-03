# HANDOFF — current state, 2026-07-31

Read this, then [`docs/GUIDE.md`](GUIDE.md) if you just want to run the thing, then `README.md`
for why it is built this way.

> **READ THE RESEARCH RECORD BEFORE TOUCHING ANY MODEL CLAIM.** The evidence base is
> `justwrite-app/docs/plans/2026-07-26-i18n-single-source-research.md`, and the sections from
> "The clean re-measurement — 2026-07-28" onward (line ~785) supersede everything measured
> before them. **This file was itself wrong for a day** because a session updated that document
> and not this one, and the next session then "corrected" `docs/models.json` from the stale
> summary here — promoting a demoted model and calling the best model untested. If those two
> documents ever disagree, the research record wins and this file is the thing to fix.

## What this repo is

Two functions sharing one pipe. **Translate** a standard i18n JSON locale folder with a local
or online model, then re-read the files and assert what was written. **Author** help docs whose
front-matter `lede:`/`hints:` become locale keys, so one sentence serves the article, the lede
and the field hint and translates like any other key. Node 24+, no server dependencies, 244 tests.

Layers: `server/loop.js` (translate, ours since 2026-07-27) · `server/checks.js` + `server/suspects.js`
(verify — the differentiator) · `server/review.js` (triage page) · `server/extract.js` (author).

## MEASURED RESULTS — the current, clean set (2026-07-28)

Taken with every other model unloaded from VRAM and runs strictly sequential, on the 8 GB
RTX 2070 Super with RAM at its rated 3600 MT/s (XMP **is enabled** — verified 3600/3600 on both
DIMMs; the old "reboot to enable XMP" task is DONE). Numbers are real errors after READING the
flagged strings, not raw flag counts.

| engine | structural | real errors | time |
|---|---|---|---|
| **26B-A4B QAT MoE — the shipped default** since 2026-07-29, GPU offload (~15 GB) | 0 | **0** | **73.8 s** (retest 74.2) |
| the same MoE, genuinely CPU-only | 0 | **0** | 128.8 s |
| `gemma3:12b` — the small-download option (8.1 GB) | 0 | **0** | 166.7 s |
| Hy-MT2-7B (4.6 GB) | 0 | 2–3 | **36.6 s** (retest 37.8) |
| qwen3:8b (5.2 GB) | 0 | 3+ | 111.1 s |
| translategemma:12b (8.1 GB) | **2 missing — FAIL** | — | 366.2 s |
| Gemini 3.6 Flash (cloud, not re-measured) | 0 | 0 | 94 s — but 20 requests/DAY |

**The flagship MoE is the most accurate thing measured AND the fastest, and it is now the
shipped default** (`server/engines.json` row `ollama`, changed 2026-07-29). Its real tag is
`hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL` — instruction-tuned, QAT, unsloth's
UD-Q4_K_XL quant, and the exact artefact every number above was taken from. It needs
`"think": false` — a thinking model returns empty content otherwise — so that row carries the
field, while the new `ollama-gemma3` row (gemma3:12b, 8.1 GB) omits it because gemma3 has
nothing to switch off. `think` has no global default; it belongs to the row, matched to the model.

What gates the MoE is **memory, not the card**: ~15 GB across VRAM and system RAM, measured on
8 GB VRAM + 32 GB system RAM. More VRAM only helps. 16 GB of system RAM with no large card is
untested — that is the case `ollama-gemma3` exists for. Note `docs/models.md` tiers are keyed
by VRAM, which is not this model's binding constraint.

**Hy-MT2-7B is the speed option and it costs correctness** — a reproducible Spanish `¿` miss on
the same key across both runs, plus a hallucinated noun. Not a default.

**translategemma:12b is disqualified**; its old flawless result does not reproduce.

**A timing taken while another engine may hold VRAM is not a measurement** — Hy-MT2 read 232.6 s
under contention and 36.6 s clean.

Evidence files in `.evidence/` (gitignored) are the **2026-07-27** runs — superseded for
timings, still valid as sample output. `corpus40-en.json` is the 40-key stress corpus itself.

**Full 846-key JW catalogue**, gemma3:12b: 846/846 in 52 min, 56 requests, zero placeholder /
plural / glossary / missing failures. After the conventions fix + `--escalate`: 99 findings →
23, 63 keys → 18.

## STATE OF THE REPOS

| repo | branch | state |
|---|---|---|
| `just-ai-help` | `main` | in sync with origin — published at github.com/delebash/just-ai-help |
| `i18n-ai-translate` | `master` | ahead 1 (`0d7168a`, the `--think` work). `origin` is **taahamahdi's** — do NOT push. Needs the user's own fork before any PR, and the work is largely superseded now that we own the loop. |

## WHAT REMAINS

> ✅ **The Spanish output DOES exist — corrected 2026-07-29.** A previous revision of this file
> declared it gone and both items below blocked. That was wrong, and it was wrong in an
> instructive way: the check searched for a file *named* `es.json`, and the artefacts are named
> something else, inside a gitignored directory. They are:
>
> - `.evidence/jw-846-keys-es-after-escalate.json` — **846 leaf keys, Spanish, post-escalate.**
>   Verified by counting leaves and reading the content.
> - `.evidence/jw-846-keys-run.log` — the main run: gemma3:12b, `0 unchanged, 846 to translate`,
>   56 requests, `Elapsed 3112.8s` (51.9 min — the "52 min" cited below). Its report names
>   findings: `untranslated (8)` with all eight keys, and `endpunc (39)` with eight named before
>   the list truncates. Those 47 are the MAIN run's findings; the "99 → 23, 63 keys → 18" figures
>   below came from later conventions-fix and `--escalate` passes that this log does not cover.
>
> Two things are genuinely true from the old warning: no config was ever committed, and `en.json`
> has grown to **867 leaf keys** (counted, not cited). The matching source turned out to be
> recoverable exactly: **`justwrite-app` commit `33dbac8` (2026-07-27) has 846 leaves**, so the
> pair is intact and no `~21 missing` allowance is needed.

1. ~~**The flagged keys**~~ — **TRIAGED 2026-07-30. The finding set is recovered and read, and
   the result vindicates the conventions fix.** `--check-only` on the recovered pair (846-key
   `es.json` against `en.json@33dbac8`) reports **24 findings across 19 unique keys** — near the
   "23 findings, 18 keys" on record, the drift being check refinements since. Every one was read.

   **11 are real errors, 8 are false positives**, and they separate perfectly by check:

   - **`spurious-interrogative`: 10 findings, 10 real errors. A 100% hit rate.** Every one is a
     declarative label or hint that the model turned into a question — `"Where the lie began"` →
     `"¿Dónde comenzó la mentira?"`, `"What they're FOR in the cast."` → `"¿Para qué sirven en el
     elenco?"`. **Two are semantic INVERSIONS, the worst class:** `chapters.header.askQuestion`
     and `…Titled` render `"Tell me about chapter {num}"` as `"¿Qué puedo decirte sobre el
     capítulo {num}?"` — *"What can I tell you about chapter X?"*. The speaker is flipped: the
     user's prompt to the AI became the AI's question to the user. A structural check cannot see
     that, and `--probe` would not either, since both passes would make the same inversion.
     One more is ungrammatical on top: `characters.fields.depth.family.hint` opens `¿` with **no
     closing `?`** and says `"qué costo"` where Spanish needs `"cuánto costó"`.
   - **`endpunc`: 5 findings, 0 independent errors** — every one is a second flag on a key
     `spurious-interrogative` already caught, the added `?` being the same defect seen from the
     punctuation side. Useful corroboration, not new information.
   - **`untranslated`: 9 findings, 1 real error.** The one that counts is
     **`sidebar.nav.askTheBook`, still English: `"Ask the book"`.** The other 8 are the known
     weakness — strings whose correct Spanish IS the English: `"No"`, `"General"`, `"Error"`,
     `"ID"`, `"Tauri ({version})"`, `"Vue 3 + Pinia"`, `"llama3.1:8b, gpt-4o-mini, …"` and the
     documented `"· {n} tokens"`. **So this check runs at an 8-in-9 false-positive rate on a real
     catalogue** — it penalises the right answer, exactly as `models.md` warns, and that is now
     a measured rate rather than an anecdote.

   **What this says about the design.** The checks-as-spec layering works: the check added by
   `17ea118` ("the ¿ rule told half a story, and the model applied it everywhere") is the one
   catching every real defect here, while the oldest and bluntest check supplies nearly all the
   noise. The flag list is a worklist, not a verdict — 19 keys to read, 11 worth fixing.
   **Not fixed:** the recovered `es.json` is a gitignored evidence artifact and shipping it into
   JustWrite is USER-OWNED, so the errors are reported, not patched.
   **Still untested:** the review PAGE itself. This triage went through `--check-only` and reading
   the JSON, so whether the `:4780` UI is any good remains an open question.
2. ~~**The conversion sweep**~~ — **DONE 2026-07-30. `justwrite-app` is at ZERO raw strings and
   `no-raw-text` is now `"error"`, the real gate.** Thirty-eight commits, all pushed, taking it
   1,430 → 0 warnings and 69 → 0 files. All 81 renderer `.vue` files are clean. The rule always
   said it would flip "once every view is converted"; that condition is met, and the flip was
   verified to bite before shipping.

   **Final state:** `en.json` holds 1,965 leaf keys across 70 namespaces; 61 `<i18n-t>` blocks;
   `i18n:report` 0 missing / 0 unused; 471 unit tests; clean build. Full record in
   `justwrite-app/docs/TASKS.md`.

   **What this unblocks here:** the catalogue this tool translates is now complete and
   single-sourced. A full `--probe` run against 1,965 keys is the natural next measurement, and
   it will be the first one taken against a catalogue with no English hiding in the templates.

   **A gate worth knowing about:** `justwrite-app/src/renderer/src/i18n/i18nTSlots.test.js`.
   `<i18n-t>` has two silent failure modes — a renamed keypath renders EMPTY (missingWarn is off)
   and a mismatched slot renders literal `{braces}`. It caught a real one late in the sweep: a
   53-key block was silently never inserted because the guard string matched a NESTED key, so
   every template edit applied against keys that did not exist. Nothing else saw it.

   **The size of the job is ~850 keys, not 1,430.** Of 1,430 warnings, 1,329 parse as single-line
   raw-text nodes, and **1,154 are real copy collapsing to 852 distinct strings** — so ~300 sites
   want an EXISTING key, not a new one. Heaviest repeats: `Done` ×14, `Cancel` ×14, `Retry` ×13,
   `Ask the book` ×10. That puts a number on this file's old "expect it to land below 1,430"
   caveat, and those ~300 duplicate sites are the cheapest real progress left.

   **27 of the warnings were never work, and the meter was miscounting.** `ignorePattern` gained
   `\p{S}` — 23 were glyph-only nodes (`× − ✕ ✓ ✦ ↑ ↓ ↵ ⏎ ⌘`) that the original `[\d\s\p{P}]`
   was plainly meant to cover but missed, Unicode filing them as Symbol not Punctuation. And
   `ignoreNodes` gained `kbd` beside the existing `code`: a `<kbd>`'s content is a key name. The
   Settings shortcut table proved it — every description beside a `<kbd>` was already a `$t()`
   call while the `<kbd>` was flagged, and only SOME rows were, because `⌘\` fell inside
   `ignorePattern` while `⌘F` escaped it on one Latin letter. **Since this rule flips to `error`
   as the real gate, a false entry in that count is a permanent false obligation.**

   **MEASURED 2026-07-29, superseded by the above: 1,430 warnings across 69 of 81 renderer
   `.vue` files**, 813 `t()`/`$t()` sites already converted; the research doc's ~1,719 was the
   right ballpark. Worst files today: `AnalysisView` 81, `ImportView` 57, `HomeView` 56,
   `RichEditor` 55. The kit (613) and JustVoice (1,551) figures are still uncounted.

   **Do not build census tooling — it exists.** `justwrite-app` already ships
   `@intlify/eslint-plugin-vue-i18n`'s `no-raw-text` as `npm run i18n:lint`, and
   `eslint.i18n.config.mjs` says it is deliberately `warn` "during the sweep" and **flips to
   `error` once every view is converted**, becoming the real gate. That is the progress meter
   and the finish line in one. There is also `i18n:report` (vue-i18n-extract, finds missing and
   unused keys) and `i18n:pseudo`.

   **The hard case is already solved, so copy it rather than inventing anything.** Prose split
   around an interpolation must become ONE key with named placeholders, not fragments — see
   `chapters.index.intro` in `en.json`, which does exactly this with `{chapters}`, `{edit}`,
   `{listView}`. Naming convention is `<surface>.<view>.<thing>` plus a shared `common.*` for
   verbs (`save`, `cancel`, `clearFilters`…) — reuse `common` before adding a key.

   A caveat on the number: it counts raw-text *occurrences*, not final keys. Fragments merge, and
   some hits are brand names or avatar initials ("JustWrite", "MH") that should never be
   translated. Expect the key count to land below 1,430.
3. ~~**`--probe` at scale**~~ — **DONE 2026-07-30, 867 keys, and it found the limitation it
   existed to look for.** Full catalogue, two passes, 110 requests, shipped default MoE with no
   overrides, `suspects.topN: 30`. **`Elapsed 1302.7s` — 21.7 minutes, not the ~2 hours this file
   predicted** (that estimate assumed 2×52 min on gemma3:12b; the MoE does both passes in less
   time than gemma3 took for one). Exit code 1, correctly. Evidence:
   `.evidence/jw-867-probe-{es.json,es-secondpass.json,run.log,config.json}` — and the config is
   saved this time, since its absence is what made the last run unreproducible.

   **The output is 99.8% clean: 14 findings, 2 real errors.** All 14 were read.
   - **11 `untranslated` — all 11 false positives**, strings whose correct Spanish is the English:
     `"No"`, `"General"`, `"App"`, `"Error"`, `"ID"`, `"auto"`, `"total"`, `"Tauri ({version})"`,
     `"Vue 3 + Pinia"`, a model-id placeholder, and the documented `"· {n} tokens"`.
   - **1 `brackets`** — `settings.server.headlessTitle`, `"Headless access"` →
     `"Acceso sin interfaz (headless)"`. The model added a parenthetical gloss keeping the English
     term discoverable. Benign, arguably good practice; a reviewer's call, not a defect.
   - **1 `startpunc` — REAL.** `characters.sweepPrompt.message`, the key that already defeated
     Hy-MT2 on both runs and qwen3:8b: the first plural form lost its `?` entirely and the second
     has `?` with no opening `¿`. Note the MoE got this key RIGHT in the 40-key corpus run hours
     earlier, so this is sampling variance at temperature 0.2, not a fixed model property — the
     catalogue's hardest key stays hard.
   - **1 `spurious-interrogative` — REAL.** `characters.fields.capabilities.whoKnows.hint`, a
     declarative hint rendered as a question. Same class as the 10 in item 1's older output, but
     one instance instead of ten.

   ### The finding that matters: probe caught 1 of the 2 real errors, and the miss was predictable

   Cross-pass disagreement was **63/867 by wording** (the number the tool reports, via
   `spread() > 0`) and **74/867 byte-for-byte** — the 11-key gap is keys differing only in
   punctuation or case, which `spread` deliberately does not count as disagreement. Checked
   against the two real errors:

   | real error | passes differed? | probe flagged it? |
   |---|---|---|
   | `characters.sweepPrompt.message` (lost `¿`/`?`) | **yes** | **yes** |
   | `…capabilities.whoKnows.hint` (spurious `¿`) | **no — byte-identical** | **no** |

   **A systematic model bias produces the same wrong answer twice, so no amount of resampling can
   see it.** The declarative-to-question habit is exactly that bias, which is why both passes
   agreed perfectly on a defect. `--probe` measures *uncertainty*, and this model is not uncertain
   here — it is confidently wrong. The `spurious-interrogative` check caught what probe could not,
   and probe caught the punctuation slip a fixed rule found only after the fact. **That is the
   layering argument, now measured rather than asserted: neither layer subsumes the other.**
   Anyone tempted to treat probe as a general semantic safety net should read this row first.

   Also worth noting: the fresh MoE output has 14 findings / 2 real errors where item 1's older
   gemma3:12b-plus-escalate output had 19 flagged keys / 11 real. Suggestive, **not a controlled
   comparison** — different model, a catalogue 21 keys larger, and the older file had been through
   `--escalate`.
4. ~~**LICENSE files**~~ — **DONE 2026-07-29, and the whole family is now MIT.** Every repo
   (`just-ai-help`, `just-llm-runner`, `justwrite-app`, `justwrite-website`, `claude-config`,
   `JustVoice`) ships an MIT `LICENSE` with matching metadata. The user's decision was explicit:
   no restrictions on anyone downstream, selling and closed forks both fine.

   The only thing that had ever forced copyleft was **`pedalboard`** in JustVoice — GPL-3.0
   because it statically links JUCE. It was replaced with first-party DSP
   (`server/justvoice/audio/dsp/`, numpy + scipy) plus Signalsmith Stretch (MIT) for pitch
   shifting, then JustVoice flipped GPL → MIT across 262 files. **JustVoice's flip is on branch
   `claude/admiring-galileo-il3q0o`, not `main`, so GitHub still reports GPL-3.0 for it until
   that merges.**

   Both weights-licence loose ends are now closed too. **`qwen-tts` is Apache-2.0** — verified
   per JustVoice's own refresh policy, from the upstream `LICENSE` (Alibaba Cloud) and the
   HuggingFace model card, not the PyPI classifier. And TADA's **"Built with Llama"** notice
   (Llama 3.2 §1.b) turned out **not to be displayed at all**: the string reached the API
   (`engines_api.py:98`) and no UI code ever read it, while `docs/engines.md` and a comment in
   `models.py` both claimed it was on screen. Now rendered as a pill on the Engines card.

## 2026-07-30, later — accepted findings: the gate can now reach green

**The problem, measured.** Across the two catalogue runs the checks separated sharply by
precision: `spurious-interrogative` 11 findings / 11 real, `startpunc` 1/1, `endpunc` 5/0 (all
duplicates), `brackets` 1/0, and **`untranslated` 20 findings / 1 real**. The consequence is
worse than noise: `"No"` is correct Spanish for `"No"`, so a PERFECT catalogue could never exit
0 — and `--check-only` is the check you run before shipping. One that cannot go green is one people stop reading.

**Fix 1 — glossary hygiene, zero code.** `checkUntranslated` already exempts strings that are
only placeholders, glossary terms, digits and punctuation; that mechanism was starved of data,
not broken. Adding `Tauri`, `Vue`, `Pinia`, the model ids and `tokens` to `doNotTranslate` took
the check from **11 findings to 7** on the 867-key run, and shields those terms during
translation too. Measured, not projected.

**Fix 2 — `server/accepted.js`, a reviewer verdict that expires.** The remaining seven were Spanish
cognates (`No`, `General`, `App`, `Error`, `ID`, `auto`, `total`). They are now cleared by
`--accept <key[,key…]>` or the review page's **correct as-is** button, into a committed
`<lang>.accepted.json`. An entry is hashed over **(key, code, source, target)**, which is the
whole design:

- accepting `untranslated` on a key does not silence `brackets` on it;
- change the English **or** the translation and the finding comes back;
- the count is printed on every run, so no suppression is invisible.

End state on the 867-key data: **14 findings → 2, and both survivors are real defects**
(`characters.sweepPrompt.message` lost its `¿`/`?`, `…whoKnows.hint` gained a spurious one),
with `8 accepted as correct` printed alongside.

**The expiry was proven on the real catalogue, not just in a fixture.** With
`settings.sections.general` accepted, changing the source to `"General settings"` and leaving
the target unchanged put `untranslated (1)` straight back in the report. A per-key exemption
list — which was the FIRST design — would have hidden that forever.

**Why not a per-language list of identical words.** That first design was wrong twice: it only
ever fixed one check (the benign `brackets` gloss needs the same disposal), and it meant writing
lexical claims from memory into `conventions.json`, the one file that warns, about itself, that
this is "exactly how a confident wrong rule ends up applied to every future translation."

**Also committed: `justwrite-app/just-ai-help.config.json`.** Both previous catalogue runs were
unreproducible because their config was never kept. It now lives beside the catalogue it
describes, with the grown glossary.

**The review page has finally been run.** Its `/api/accept` endpoint, the button and the
counter are exercised by tests, and the server was driven live against the 867-key data:
40 flagged → accept → 39, counters update, unknown key 404s. 75 tests, up from 65.

## USER-OWNED — never do these unasked

Pushing any repo · any PR to the i18n-ai-translate upstream · shipping `es.json` into JustWrite
· rotating the Gemini API key that passed through chat · adding LICENSE files elsewhere.

**And the standing rule above all: do nothing without an explicit "go".** A question is a
question, not authorization.

## PROCESS LESSONS — worth not repeating

**Docs go stale in the place you are not looking.** Today's largest error: model facts were
updated in the research doc and not here, and a later session rewrote `models.json` from this
file's stale table. When a measurement lands, update EVERY place that states it, or point the
stale place at the fresh one in the same change.

**A doc can invent a blocker, and a false blocker is more expensive than a stale fact.** This
file spent a day telling every reader that two of its own remaining items were impossible,
because a search for `es.json` did not match `jw-846-keys-es-after-escalate.json`. Nothing was
lost; work was simply not attempted. When you conclude something is missing, say what you
searched for and how — a negative result is only as good as its query, and "checked, not there"
reads as certainty forever.

**Never put a shorthand where an identifier goes.** `gemma-4-26b-a4b-qat` was a readable label
for the flagship, and because it is not a pullable tag, a later revision explained the gap by
inventing a requirement — "supply your own GGUF" — that nobody had tested. That false sentence
then became the stated reason the best measured model was not the default. The real tag,
`hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL`, pulls in one command like any other.
If a name cannot be pasted into a command, it does not belong in a config field.

**Never let two runs share one GPU.** Unload the first engine explicitly and verify VRAM is free
(`GET /api/ps`) before starting the second. This is not tidiness: it produced a 6.4× wrong
timing that stood as a "measurement" for a day and nearly changed the default model.

**Check processes properly.** Twice a session inferred process state from an indirect signal and
was wrong: a healthy 846-key run was called "stalled" (it was 68% done, output buffered in a
`tail` pipe) and killed, and a live run was called dead because a bash `ps` cannot see Windows
processes. Use `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` and read the CommandLine.

## 2026-07-29 — what this session did

Reviewed the whole design (verdict: the architecture stands — owned loop, checks-as-spec,
probe, one-file review page), then fixed what the review found. `--probe`'s temperature guard
read the `TEMPERATURE` constant, but a profile can pin `temperature: 0` via `extraBody`, which
would have produced exactly the meaningless all-clear the guard exists to refuse; it now reads
`effectiveTemperature(profile)`, derived from the BUILT request body so the guard and the body
cannot drift. `npm test` became plain `node --test` (the quoted glob needs Node 21+ while the
repo declares Node 20+). `server/engines.json` lost its false `_legacy` note and four dead fields
(grep-verified unused). Then, after the user caught the model-table errors described at the top
of this file, `docs/models.json` and the README's *Measured* section were rewritten from the
research record, and `docs/GUIDE.md` was added as the short user-facing guide.

Then **every `.mjs` became `.js`**. `package.json` already declared `"type": "module"`, so the
extension was carrying no information — the commands are now `node server/translate.js`, and the
whole repo, docs included, says `.js`. One trap found in passing: **`server/checks.js` is binary to
git and invisible to ripgrep**, because `multiset()` joins on a literal NUL. A grep-based sweep
that reports "clean" has not looked at that file — verify with something that reads bytes.

Then the session moved to **JustVoice, and the whole family went MIT** — see item 4 above. The
work that unblocked it: `pedalboard` (GPL-3.0 via JUCE) was the only copyleft dependency anywhere,
so its twelve effects were reimplemented as `JustVoice/server/justvoice/audio/dsp/` on
numpy + scipy, with pitch shifting delegated to `python-stretch` (Signalsmith Stretch, MIT — and
measurably better than the Rubber Band engine pedalboard used). Reverb is a port of the same
public-domain Freeverb JUCE already wrapped, using JUCE's exact scaling constants so persisted
user chains keep sounding the same. 78 effects tests pass; **how it SOUNDS is still unverified**
and is the user's next task.

Three findings from that stretch worth carrying, all of the same shape — **a claim in a doc that
the code never implemented**:

- `CONTRACT.md`, JustVoice's authoritative boundary doc, described JustWrite orchestrating renders
  over HTTP and muxing M4B in-browser. JustWrite has held no audio code for some time; M4B is
  server-side. Being authoritative, it had seeded the error into three other docs.
- The **"Built with Llama"** notice was plumbed through four backend layers and rendered by none,
  while two places asserted it was on screen. A licence obligation, unmet.
- `docs/effects.md` described a "Robotic" preset of "Pitch ±2 st · Bitcrusher · Comb filter". The
  seeded chain is a chorus. **Every row of that preset table was wrong.**

The lesson generalises past this repo's own "docs go stale" note below: **a doc describing an
intended end state is indistinguishable from one describing reality.** Each of these read as
finished features to anyone auditing from the layer below. Read the seed data, not the table.

## 2026-07-29, later — the default is now the MoE, and two false claims are gone

The user asked why the flagship was not the default, and the answer this repo gave was wrong.

**What was actually wrong.** `docs/models.json` said the MoE was "not a public Ollama tag — supply
your own GGUF", and that sentence was the stated reason a slower, equally-accurate model shipped
as the default. `ollama list` settles it: the model is installed as
`hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL`, a name Ollama only assigns to something
**it** pulled from HuggingFace — a hand-imported GGUF carries a local name instead. One command,
no manual download. With that gone, the only remaining objection was the 15 GB download, which is
a disk cost and does not outrank a measured win on both accuracy and speed.

**What changed.** `server/engines.json` row `ollama` now names the full MoE tag and carries
`think: false`; a new `ollama-gemma3` row holds `gemma3:12b` with no `think` field. `think` is now
explicitly per-row, matched to the model that row names, rather than a global that must be absent.
`docs/models.json` promotes the MoE to `8gb.recommended` with its real pull command and demotes
gemma3:12b to the small-download alternative; the `16gb` tier inherits the same recommendation.
README and `docs/GUIDE.md` follow, and GUIDE now leads with one pull command and a
pick-something-else-only-if table.

**Verified, not assumed** (2026-07-29, this session):
- `think: false` against gemma3:12b returns a normal answer — so the field is safe on a
  non-thinking model, which is what makes a shared row acceptable. Sending it to a *different*
  thinking model is still a quality regression (qwen3:8b translated a placeholder with it).
- The MoE at `think: false` translated `Save {count} chapters` → `Guardar {count} capítulos`:
  correct Spanish, placeholder intact, no empty content. That is the shipped default running.
- `npm test` — 65/65 pass after every edit.

**The corpus run the MoE never had — taken 2026-07-29, and it reproduces.** The 2026-07-28
five-run set wrote its output to a temp scratchpad that has since been cleaned, so `.evidence/`
had sample output for gemma3, Hy-MT2, qwen3 and Gemini and **none for the flagship**. Now it
does: `.evidence/corpus40-gemma4-moe-es.json` and `corpus40-gemma4-moe-run.log`, produced by the
shipped default with no overrides, all models unloaded and `/api/ps` verified empty first.

| | 2026-07-28 record | this run, under the shipped default |
|---|---|---|
| time | 73.8 s (retest 74.2) | **69.8 s**, cold model load included |
| requests | 3 | 3 |
| structural | 0 | 0 |
| semantic flags | 1 (did not reproduce on retest) | 1 — `chapters.footer.aiTokens` |
| real errors | 0 | **0** |

The single flag is the documented false positive: EN `· {n} tokens` → ES `· {n} tokens`, correctly
left alone because "tokens" is "tokens" in Spanish, and the check penalises the right answer.
Also confirmed by reading, not tallying: 0 placeholder mismatches, 8/8 plural pipes intact, 5/5
`JustWrite`/`Strands` occurrences preserved, the opening `¿` present on
`characters.sweepPrompt.message` (the key Hy-MT2 misses on both its runs), and
`chapters.ai.clearStrikesDesc` rendered without the invented noun Hy-MT2 produced there. Exit code
1, which is correct — a run reports its findings rather than exiting 0 on one.

The config was reconstructed (context "JustWrite, a desktop app for writing novels", glossary
`JustWrite` + `Strands`) because the original was never committed, so treat 69.8 s as a
same-instrument reproduction rather than a byte-identical repeat of the 73.8 s figure.

**Also corrected here:** the claim that the 846-key Spanish output no longer existed. It does —
see WHAT REMAINS above. Item 1 is unblocked; item 3 is not, and the reason is the missing
`.jah-cache.json`, read out of `server/loop.js:320` rather than guessed.

## 2026-07-30, overnight — items 1 and 3 closed, item 2 started

**Items 1, 3 and 4 are now done and item 2 is under way.** Detail is in WHAT REMAINS above; what
follows is only what a reader needs to orient.

- **Item 1 (triage)** — the recovered pair checks out against `justwrite-app@33dbac8` (846 leaves,
  an exact match), 24 findings / 19 keys, **11 real errors**. `spurious-interrogative` went 10 for
  10; `untranslated` went 1 for 9. Two of the real errors invert the speaker.
- **Item 3 (`--probe` at scale)** — 867 keys in **21.7 min**, 14 findings, **2 real errors**, and
  the headline result is that **probe caught one and was structurally blind to the other**, because
  a systematic bias answers the same way twice. Neither checking layer subsumes the other, and that
  is now measured.
- **Item 2 (the sweep)** — `justwrite-app@b6ee9cc`, pushed: **1,430 → 1,358 warnings, 69 → 54
  files**, 15 files to zero. The job's real size is **~850 keys, not 1,430**, and 27 of the
  warnings were glyph/`<kbd>` nodes the lint rule should never have counted.

**Two process notes worth keeping.**

**The `.evidence/` config is saved now.** Every previous catalogue run was unreproducible because
the config that drove it was never kept — that is what made item 1 look blocked for a day. The
867-key probe run saved `jw-867-probe-config.json` beside its output. Keep doing that; an output
without the config that produced it is an anecdote.

**A flaky test was observed in `justwrite-app` and deliberately not "fixed".**
`projectHistory.test.js > caps each domain's history independently at the limit` failed once in
four full-suite runs of identical code, passing on clean HEAD, in isolation, and on two further
runs. The failing run coincided with the 15 GB MoE saturating the machine. The mechanism is
unexplained — the test is a synchronous 1005-iteration loop and `addStatusDef` is not in
`COALESCED_ACTIONS`, so the 600 ms coalescing window should not reach it. Recorded in
`justwrite-app/docs/TASKS.md` rather than guessed at, because a fix built on a wrong mechanism is
worse than a known flake.

---

## 2026-07-30 — the full 1,965-key run, triaged to a green gate

**The whole catalogue has now been translated, probed, escalated and triaged.** The output is
`.evidence/2026-07-30-justwrite-es/` (gitignored, with the config that produced it). It has
**not** been landed in JustWrite — that is USER-OWNED and still open.

**The run.** MoE default (`ollama`), 1,965 keys, translate + both `--probe` passes in **51.6 min**.
One key — `readerKnowledge.intro`, five placeholders — exhausted every retry and was reported by
name, exactly as designed; re-run in isolation it succeeded on request 5. Final: **1,965/1,965**.

**Escalation works, and it is cheap.** 36 flagged keys re-done with `ollama-gemma3` cost **2.0 min**
and fixed **7 of the 8** hard defects, including a silently truncated sentence and the `Strands`
bleed. It introduced 2 new defects of its own, both caught by the checks. Net 42 → 33 findings.

**Final state: `--check-only` exits 0** — zero structural findings, 57 accepted, 8 advisory
disagreements outstanding.

### Three findings that outrank the run itself

**1. The glossary is also an instruction, and that half leaks.** `buildSystemPrompt()` writes
every `doNotTranslate` term into the prompt as `never translate these terms`, while `shield()`
substitutes only case-sensitive word-bounded matches — so the model obeys the prompt on forms the
substitution never touched. Adding `AI` turned **48 correct translations into findings**
("Exclude from AI" → "Excluir de la IA" is right and cannot be shielded). `Strands` produced
"la Strand narrativa" for "the narrative strand" with no substitution involved. Reverted `AI`,
`POV`, `Chat`, `Runtime`, `Marketing`; kept `TODO`, `AM`, `PM`, `RAG`, which are labels
everywhere they appear. CLAUDE.md said "shielding is a substitution, never an instruction" —
half true, now corrected.

**2. `suspects.topN` is a display window, not a total.** The probe found **150** disagreeing keys;
`topN: 30` reported thirty, so **20% of the signal was visible** and a key with a real semantic
defect sat in the invisible 120. And the ranking did not earn the cut it makes: the two semantic
defects ranked **#22 and #30 of the 30 shown**, the hidden 120 have a median spread of 0.17
against 0.18 for all 150, and 21 hidden keys disagreed badly (≥ 0.5). `server/suspects.js` records
those planted defects ranking #1 and #3 on the original 40-key corpus — **that does not hold at
1,965 keys.** `topN` is a display budget, not engine time; set it above the disagreement count.

**3. Two real defects passed every structural check AND both probe passes.**
`settings.backups.dataFolderHint` — "Everything JustWrite saves lives here" — came back as "Todo
JustWrite **salva vidas** aquí", *saves lives*. Pass 2 wrote "**guarda vidas**": the two passes
disagreed on wording while making the identical misreading. This is the documented blind spot
behaving as documented. The other was `autoconservado` where the catalogue's other 11 autosave
strings say `autoguardado` — no check compares a term against its own catalogue. Both were found
by reading the file, and nothing else would have found them.

**Also fixed here: `server/checks.js` contained a literal NUL byte** (since the first checks commit,
`8774936`), which made git classify the project's most important file as **binary** — its diffs
rendered as "Binary files differ" and `grep`/`Grep` skipped it silently. Replaced with the
six-character escape; no behaviour change, 75 tests still pass.

---

## 2026-07-31 — config, paths and engines: five defects with one shape

All five were the same disease: **a fact stored in more than one place, with copies that
disagreed.** Each fix ships a test that was watched failing with the fix reverted.

**1. There were TWO engine resolvers.** The CLI layered the project config over an
`engines.json` row; the workspace resolved a connection and layered *nothing* — `cfg.model`,
`cfg.url` and `cfg.think` appeared **zero times** in `server.js`'s job path. An override set in
your config worked from the terminal and was silently ignored when you pressed re-translate in
the UI. Same tool, same config, two answers, no warning. `server/engine.js` is the one merge
now, used by the CLI, the job path and the back-translation endpoint.

**2. Every path resolved against the working directory.** That is why every documented command
began with a `cd`. The cache was worse — running from the wrong folder silently started with
*no cache* and re-translated everything, which is exactly what cost 27 minutes and 464
hand-corrected keys earlier the same day. `server/paths.js` owns it; `test/paths.test.js` runs
the resolver from an unrelated directory. `server.js` was the clearest case: it computed the
right anchor on line 100 and did not use it on line 101.

**3. `placeholder` and `pluralSeparator` are read from `en.json`** (`server/infer.js`).
`pluralSeparator` was the sharp one: honoured by the checks and **ignored by the prompt**, which
had `" | "` typed into it. It worked on the default by coincidence; set `";"` and the model was
told the wrong separator, did not preserve yours, and the checker then reported
`plural-halves-lost` — blaming the model for obeying the tool.

**4. Acceptances record `by` and `at`**, outside the hash. Unclaimed writes `unknown` with a
loud warning, deliberately *not* the OS username: an automated run under a developer's account
would otherwise be indistinguishable from that developer's judgement.

**5. Documents stopped pretending to be config.** `models.json` → `models.md` (nothing ever read
it); `conventions.json` was 81% commentary and is data only, with the reasoning in
`language-rules.md` — which now also records that `pairedPunct` is Spanish-shaped and **cannot**
express French's spaced punctuation or CJK full-width forms.

**The config is four fields:** `locales`, `targets`, `context`, `glossary`. Old key names still
work. 181 tests, up from 153.

### In JustWrite

The tool's whole footprint is one folder, `justwrite-app/just-ai-help/` — config plus the review
sidecars, with `locales/` holding nothing but locale files. Delete the folder and the app still
builds and runs in Spanish.

**Adding a language there is now dropping a file in.** `i18n/index.js` used to name every locale
three times; it discovers them with `import.meta.glob` and names them with `Intl.DisplayNames`,
so a new `fr.json` appears in the picker as "Français" with no code edit. Verified by doing it.
A test reads that file as text and fails if a code or a label is hardcoded back in.

**The 58 acceptances now say `by: "claude (bulk, unreviewed)"`.** They are not human verdicts —
an agent generated them by script, 55 of them by a rule that took every finding of one type, and
the format could not tell them from review until someone asked. They are left in rather than
deleted so the gate stays green; ~25 are glyphs anyone clears in seconds, and the ones worth a
real look are `AI`, `Runtime`, `Chat`, `POV`, `Marketing`, `beats`. Deleting the file re-raises
all 58.

**Still open:** the ~134 advisory `disagreement` suspects, and whether Spanish ships (it is
committed and testable via Settings → Project → Language).

## 2026-07-31, later — `init` replaces the example config

`node server/init.js path/to/en.json` writes the project config. **`docs/config.example.json` is
deleted** — there is nothing to copy.

Setting a project up used to mean finding a template inside THIS repo, copying it into a
different repo, renaming it, and hand-editing a relative path the example itself had wrong. That
is the `.env.example` pattern used where it does not fit: `.env.example` sits in the same repo as
the `.env` it becomes and exists because `.env` is gitignored. Tools that configure a *different*
directory generate the file (`eslint --init`, `tsc --init`), and a generator can read your
strings, which a template never could.

**The config names the FILE, not the folder.** `"source": "../src/i18n/locales/en.json"` — its
directory is the locale folder and its basename is the source language, so `locales` +
`sourceLanguage` collapse into one field that nothing can disagree with. `sourceLanguage` had
been defaulting to `"en"` invisibly; that assumption is gone. Point init at `es.json` and Spanish
is the source with `en`/`fr` as targets — tested, not assumed.

It derives `targets` from the locale files already present, REPORTS the placeholder syntax and
plural separator it read (never stores them — they are read every run), and refuses to decide
`context` or `glossary`. It proposes glossary candidates and writes **none**: that field turned
48 correct translations into findings when `AI` went into it.

Two bugs its own tests caught, both of which would hit any real catalogue: the candidate sort
called `localeCompare` on a `[word, count]` array and threw the moment two terms tied, and a
trailing full stop was part of the token so `"Studio."` and `"Studio"` counted separately.

195 tests. JustWrite's config still uses the older folder-shaped keys and still passes.

## OPEN — the setup/review page, undecided

The user wants one entry point (`npm start`) serving a tabbed page: a setup tab that browses for
`en.json`, picks languages, takes the context, and lets you tick glossary candidates; a review
tab that appears once there is something to review; and the ability to kick off a run, watch it,
cancel it, close the browser and come back.

**Most of it exists.** `POST /api/jobs`, `/api/jobs/cancel`, `/api/jobs/stream`,
`/api/jobs/current`, and `JobManager` already does start/cancel/status/busy.

**The blocker:** `createWorkspaceServer` reads the config on its first line, so it cannot start
before one exists. Routes dispatch through a lookup table, so an unloaded project is ONE guard,
not a per-handler change — verified by reading, after a previous session-mate claimed "~30
handlers" without counting. What has NOT been traced is how much of lines 102–479 must move to
make "start with no config, load one when it appears" work. **Do not estimate it without
reading it.**

Two things settled in that discussion:
- **Load once, not swap.** Nobody asked to switch projects at runtime, so there is no teardown
  path and no "job running against the old project" hazard. That requirement was invented.
- **`--check-only` stays a pure CLI command with no server.** It is the check you run before shipping.

One design point raised and unresolved: a browser file picker yields a `File`, not a path, so
"browse for the file" means exposing a directory-listing API over localhost. `npm start
<path>` pre-filling the page, plus a paste-a-path box with live validation, gets the same
benefit without that surface — but the user asked for browsing, and this was never decided.

---

## 2026-07-31, late — ONE storage mechanism, and the engine stops signing things off

Two things landed together, and the second one is a correction to work done earlier the same day.

### SQLite is gone. Everything is JSON.

`server/db.js` (397 lines) and `server/store.js` (229) are deleted, replaced by
`server/state.js` (348) and `server/settings.js` (185).

**The argument that decided it**, after several turns of getting it wrong: three files in a
project *have* to be committed text — `config.json`, `<lang>.accepted.json`,
`<lang>.notes.json` — because they hold decisions only a human can make, they live in the app's
own git repo, and one of them would otherwise carry an API key into it. So **JSON exists no
matter what**, which means adding a database does not replace a mechanism, it adds a second one.

And nothing here needed SQL. Verified before removing it: **no foreign keys, no cascades**, one
transaction in 626 lines, ~2,000 rows, one user — and the largest, most-written dataset in the
whole tool (the translation cache, 346 KB on the JustWrite catalogue) was a plain JSON file the
entire time the database existed.

Two arguments were used along the way and are **withdrawn** as bad ones:
- *"JSON is readable, a database is not"* — true of every application with a database. Not a
  design principle.
- *"probe.json sets a precedent for gitignored JSON"* — `probe.json` and the caches were the
  inconsistency, not a precedent. Using existing mess to justify more of it.

### Connections are tool-level now

`settings.json` lives **inside the tool's own clone**, gitignored. You install once and point at
many apps; a connection is a property of you and your machine, not of JustWrite. Per-project
storage meant re-entering the same key for every app — which was the actual complaint, and it
was dismissed once as "costing more than it saves" while picturing a single app.

**Not** `~/.just-ai-help`. Deleting the tool has to delete everything it ever wrote.

A real bug this exposed: with the settings path hardcoded, **the test suite wrote fake
connections and fake API keys into the developer's own settings file.** `settingsRoot` is a
parameter now, and the harness gets a throwaway git repo of its own.

### The confirmation pass no longer writes acceptances

Built earlier the same day, it wrote its "correct as-is" verdicts straight into
`<lang>.accepted.json` stamped `by: "ollama (<model>)"`, and justified that with the `by` field.

That was the wrong reading of the field. `by` exists **because** an agent once wrote 58 verdicts
into a real project in bulk; it makes a machine verdict *visible*, it does not authorise one.

Now both outcomes are annotations in `.jah-state.json`. A `same` verdict **pre-ticks** a row; a
`translate` verdict shows its suggestion, unticked. The approval recorded is the human's, with
their name, and the run still exits non-zero until someone presses the button. `POST /api/accept`
takes `keys[]`, **one call is one undo**, and the reviewer name comes from your settings.

**The 58 acceptances in JustWrite are deleted.** Every one was `by: "claude (bulk, unreviewed)"`
— none were the user's. The findings are back in the queue awaiting a real review.

### The server starts with no config

`loadProject()` / one dispatch guard. The tool used to need a config to reach the screen that
writes a config. Setup is a **full config editor** — source, targets, context, glossary, engine,
your name — reachable at one entry point, and it **preserves config fields it does not manage**.

Path entry is a validated text box, not a file picker: a browser file input hands JavaScript a
`File` and never a path, so real "Browse…" means exposing a directory-listing API over
localhost. Ruled against.

### A pre-existing bug, fixed

`writeKey` dropped the probe entry and the cached back-translation on an edit but **not the
staged proposal** — so a suggestion made against the old string survived and could be applied
over newer text, silently reverting a reviewer's own fix.

### Verified

243 tests. The two must-bite tests were watched failing with the logic deliberately broken, then
restored. End-to-end against a live Ollama: setup with no project → config written → project live
with no restart → 5 identical findings → engine annotates 4 `same` + 1 `translate` → bulk approve
records `by: "danel"` → queue drops to the one real defect → one undo restores all four.

**Not verified: the rendered Vue page.** The browser extension was not connected, so the client
was verified by building it (647 modules, clean) and driving the same API the components call —
not by looking at it. Someone should open `npm start` and click through the setup tab before
trusting the layout.

---

## 2026-08-01 — THIS REPO IS BEING REPLACED. Read this before touching anything here.

The decision made today: **just-ai-help is rewritten as a Python app that embeds
`just-llm-runner`**, in a new repo. This Node repo stays until the rewrite works, then goes.

Nothing below is committed anywhere else. The reasoning is here because it cost a day to reach
and is not derivable from the code.

### Why the rewrite

`just-llm-runner` is a **Python library**, not a service — apps `pip install -e` it and mount its
FastAPI router (`from llm_runner import router`; `app.include_router(...)`), and it is frozen into
each app's bundle. JustWrite and JustVoice both already do this. There is no HTTP daemon to talk
to, so **a Node app cannot use it at all**.

And it already owns everything the engine half of this repo re-implements, better:
`runner/hardware.py` (detection), `runner/fit.py` (per-model VRAM fit), `runner/models.py` +
`download.py` (GGUF acquisition), `runner/binary.py` (fetches prebuilt llama.cpp), `process.py`
(`compose_flags`, `start_runner`), `autotune.py`, and `llm/` (the online provider adapters —
anthropic, gemini, openrouter, xai). Plus the UI: `ProviderForm.vue`, `AiModelsArea.vue`,
`LuModelCatalog`, the knob catalog with its **MoE switch bundle**.

So the binary choice is: be Python and get all of that, or stay Node and maintain a second worse
copy forever. That is the whole decision.

### The new repo

| | |
|---|---|
| name | `just_ai_i18n_docgen`, scaffolded at `E:/Dev/Web/` with `create-tauri-app` |
| stack | Vite + Vue + Rust/Tauri + Python, same shape as JW and JV |
| layout | the scaffolder's — `index.html` + `src/` + `src-tauri/` + `public/` at the root. **NO `src/renderer/`**; that was an Electron habit and JW has now been corrected |
| python | `server/src/just_ai_i18n_docgen/` — src-layout, app name used once, no `_server` stutter on the package. Console script `just-ai-i18n-docgen-server` (the `-server` suffix exists ONLY because a same-named console script makes Windows spawn the Tauri binary itself) |
| port | **8742** (JW 17495, JV 8741) |
| state | scaffolded only. No `server/`, no kit alias, no `npm install` |

**Carried over:** shielding, the checks, probe ranking, acceptance-with-expiry, the confirmation
pass, the docs→locale-keys extractor, the review panes.
**Deleted, because llm-runner owns it:** `settings.js`, `engine.js`, `engines.json`,
`docs/models.md`, `docs/engines.md`, all hardware/model selection.

### THE MODEL MEASUREMENTS IN THIS REPO ARE NOT WHAT THEY CLAIM

`docs/models.md` presents its timings as model comparisons. They are comparisons of an
**unconfigured Ollama**. The only knobs the loop ever sent are:

    options: { temperature: 0.2, num_predict: 8192 },  think: false

No `num_ctx` (the model reports 262,144; Ollama's default applies). **No `n-cpu-moe`** — the
expert-offload switch that is the entire reason to run a 26B-A4B MoE on an 8 GB card, and which
Ollama does not expose at all. No MTP.

llm-runner already researched this and measured it: `--n-cpu-moe 32` runs a **35B-A3B at ~30 tok/s
on a 6 GB card**, and its rule is *MoE → lean on `--n-cpu-moe`, skip spec decoding; dense → use MTP*.
So MTP was never the lever for our model — `n-cpu-moe` was, and nothing set it.

The numbers are therefore a **floor, not the model's capability**, and the comparison understates
the MoE specifically, because MoE gains most from the placement nothing configured. The accuracy
findings are unaffected — tuning changes speed, not correctness.

### Uncommitted work sitting in this repo

A full day, never committed, and it should be read before it is thrown away — several pieces
carry measurements:

- **SQLite removed.** `db.js` + `store.js` (626 lines) → `state.js` + `settings.js`. Rationale:
  three files MUST be committed text (`config.json`, `<lang>.accepted.json`, `<lang>.notes.json`),
  so JSON exists regardless and a database is a second mechanism rather than a replacement. No
  foreign keys, no cascades, one transaction in 626 lines, and the largest dataset was already a
  plain file.
- **Connections went tool-level** — `settings.json` inside the tool's own clone, gitignored.
  Never `~/.just-ai-help`; deleting the tool must delete everything it wrote.
- **The confirmation pass** (`confirm.js`) — asks the engine about keys whose translation came
  back byte-identical. Measured: 57 of 71 called correct, **20/20 long planted skips caught,
  37/40 short**. It writes ANNOTATIONS only; the engine never signs `<lang>.accepted.json`.
- **Bulk approve** — `POST /api/accept` takes `keys[]`, one call is one undo, records who.
- **The server can start with no config** — `loadProject()` + one dispatch guard, so a setup
  screen is reachable before a config exists.
- **Prose out of every JSON file**, including the four the tool writes.

### Rules that came out of today and are not in any code

- **No CI.** Never justify a design with it. `--check-only` is the check a human runs before
  shipping. Docs still calling it "THE CI gate" are wrong.
- **Never `~/.tool` or `%APPDATA%`.** Deleting a clone must delete everything it wrote.
- **Use the scaffolder.** `create-tauri-app` exists; hand-rolling its layout is what produced
  `src/renderer/` in two apps and a day of unpicking.
- **A "go" is scoped to the plan as it stood in that message.** Discussion afterwards voids it.

### Still open

- ~~**JustVoice**~~ — **DONE 2026-08-01, `JustVoice@c410370`, pushed.** Same move as JW's `b5de1fc`.
  The watcher exposure was measured there rather than assumed: **381 files guarded vs 30,881
  unguarded** (its Python `server/` is 17,865 of that, `src-tauri/` 12,510), first HTML 500 ms vs
  6,191 ms. Two paths escaped the moved subtree, both in one production file. One trap worth
  carrying: **`server.watch.ignored` passed inline to `createServer()` loses silently to the config
  file**, so a first comparison reported "no difference" with both runs guarded — compare config
  FILES, and read `resolveConfig()` to see which won.
- **JW's Spanish catalogue** now shows ~54 identical-string findings again, because the 58
  machine-written acceptances were deleted. They are unreviewed and need a human.
- **The ~134 probe disagreements** in that catalogue, never triaged.

---

## 2026-08-01, later — llm-runner became the standard, and JV converged

The rewrite's foundation work, done across three repos. Full rulings in the memory file
`llm-runner-standard.md`; the short version:

**The audit.** "Is llm-runner really drop-in for any Python app?" was tested in a clean venv
rather than answered from docs. It was not: `sqlalchemy` was missing from `pyproject.toml`
for the repo's whole life (both host apps declare it themselves, so the import resolved by
host luck), the eager package `__init__`s made one missing dep take down 11,773 of 19,720
lines, the standalone catalog answered `[]` indistinguishably from "unwired", the README
told consumers to pin a tag that had never been cut, and `install_llm` — the headline entry
point — had zero direct test coverage.

**The rulings** (user's, explicit): `install_llm` + SQLAlchemy is THE standard for every
family app; no JSON store backend, now or later; JSON stays only for what belongs to the
TRANSLATED app (`config.json`, `accepted`, `notes`); the bare minimal call
(`install_llm(app, engine=…, session_factory=…, data_dir=…)`) is a requirement for the
any-Python-app goal, not a courtesy; JustVoice converges fully (option 2).

**Landed and pushed:**
- `just-llm-runner@f630703` — declare sqlalchemy, lazy inits, `catalogWired`, the
  clean-install tripwire. `@bf060ca` — the minimal contract, `test_install_llm` (found a
  real race: the backfill daemon thread silently rolled back seeds on single-connection
  test DBs), check 3 ("the stranger's app", runs the bare call on declared deps only),
  `check-consumers.py` (resolves every consumer import; found JV's break in one pass).
  Tag `v0.1.0` cut and pushed — the ref the README always cited.
- `JustVoice@14b3ea7` — part 1: the roles concept deleted (its server had been
  UNIMPORTABLE since llm-runner's `7232214`; nobody noticed because no venv existed —
  one was stood up, 383 tests now run). `@aa1363f` — part 2: `install_llm` adopted,
  providers migrated settings→DB, registry boots from the DB, the dead runner mount is
  live (`catalogWired: true`), and JV's own `feature_prompts` table renamed
  `jv_feature_prompts` after colliding with the shared stack's same-named table.

**Open, in order:**
1. **The rewrite itself** (`just_ai_i18n_docgen`) — still only a scaffold, not a git repo.
   It now has a tested standard to build on: `install_llm` + four features
   (translate/review/extract/confirm) + `feature_prompts={}` (prompts stay app-built —
   shielding and the glossary logic are ours). Its first boot is also the first RUNTIME
   proof of engine-download + model-load from a non-JW host, which the README says out
   loud is still unproven.
2. **JV part 3** — merge its prompt system into the shared prompt/preset model (6
   call-sites, per-tier keys, per-row temperature/think → engine presets), rework the
   SettingsView roles/routing UI (the roles dropdowns currently accept edits and silently
   don't persist), decide local_managed vs the shared runner. UI design input needed.
3. Everything in the earlier sections of this file (JW's ~54 identical-string findings,
   the ~134 probe disagreements, whether Spanish ships) — unchanged.

## 2026-08-02 — the rewrite is functionally complete, and it ran LIVE

`just_ai_i18n_docgen` went from bare scaffold to a working app in one arc
(github.com/delebash/just_ai_i18n_docgen, all pushed):

**Server: every layer of this Node repo, ported test-first — 119 tests.** shieldlib /
loop / checks(12) / suspects / confirm / accepted / state / paths / infer / jsonio /
terms / init / extract+frontmatter / service / jobs / workspace API / CLI. The measured
provenance travelled with the code. The engine half is GONE by design: llm-runner's
presets own provider+model+temperature (0.2 carried over as seeded DATA), and the probe
guard reads the RESOLVED preset. Configs have NO engine field, ever.

**Client: built entirely on @delebash/llm-ui**, including the new kit component this
app caused: **UiMultiSelect** (reka Popover+Listbox, chips, filter — the
target-languages picker, per the user's kit-first ruling). Setup / Review / Runs views,
hash router, per-domain Pinia, the kit's origin-aware transport, dev proxy to :8742.
Vite build clean; **the rendered page is UNVERIFIED — no browser was driven.**

**The live E2E (this box, gemma-4-26B MoE via Ollama): the full arc proven.**
6/6 keys in one request, 8.0s — placeholder restored, plural pipes kept, the opening ¿
present, JustWrite shielded, the No→No cognate flagged, the LIVE confirmation pass
said "correct as-is" (exit 1 — the engine never signs off), `accept --by danel` →
**"all checks passed", exit 0**. Two defects only a live run could find, both fixed
with regression tests: the CLI never booted the shared storage (every test had passed
`send=` explicitly), and the app hand-forked the schema per provider — defeating the
Ollama adapter's OWN response_format→format translation. Rule extracted: hand the
adapters the OpenAI shape; they own the per-provider translation.

**Still open:** Tauri sidecar wiring (`tauri.conf` untouched); LOOKING at the UI; the
llm-runner RUNNER path (engine download + GGUF) from a fresh host — the E2E used the
Ollama provider, so that specific claim stays unproven; JV part 3; and the decision
this file exists to reach: when this Node repo gets archived. The rewrite now covers
its whole surface except "look at the page first".

## 2026-08-02, overnight — full JW parity, THE standard doc, and the re-review's three findings

**Parity is total now, proven live.** `just_ai_i18n_docgen` matches JW in every contract:
npm scripts (`npm run dev` = the DESKTOP APP; vite is `dev:vite`), the Rust sidecar
(JW's pattern, three constants — the shell spawned the server and the webview's own
requests hit /v1, watched in the log), portable data root with `dataroot.txt` +
crash-safe relocate, port eviction, `/v1/*` everywhere (the `/api` prefix was a
Node-era habit, renamed), `serve` subcommand + `JUST_AI_I18N_DOCGEN_DATA_DIR`,
biome with JW's Vue override, `scripts/py.js`, real tauri.conf/index.html, CLAUDE.md.

**THE standard doc** (`just-llm-runner/docs/app-structure.md`) is now generator-grade —
creation → root files → vite/kit → frontend → shell/sidecar → server → llm-runner
adoption → converging an existing app → a checkable definition-of-done. Deviations are
allowed only when flagged AND recorded there.

**The ordered overnight re-review found three real defects, each fixed with the test
that would have caught it:** (1) `make_send` silently dropped topP/samplers/
reasoningEffort — only temperature and think reached the adapter; a half-honoured Lab
setting, the family's most-hated class — `preset_extra()` now mirrors the shared run
path's overlay; (2) the CLI's routeless boot re-implemented install_llm's storage half
against PRIVATE imports — upstreamed as first-class `install_llm(app=None)`
(`just-llm-runner@c76a7c6`); (3) jobs.py claimed "THREE RULES, each of which is a
test" while rules 2 and 3 had none — `test_jobs.py` makes the claim true.

**Final battery, all green:** i18n 123 · llm-runner 718 (+known-bad lspci) · JW 121 ·
JV 383 · clean-install 3/3 · check-consumers both apps · ruff + biome clean · vite
build · cargo check · the live CLI re-proof (check exit 0; translate exit 0 with **0
requests** — the delta idle on an unchanged catalogue, as designed).

**What genuinely remains:** looking at the rendered UI with human eyes ·
`npm run build`/PyInstaller packaging for the shipped sidecar binary · client
unit/e2e test infra (JW has vitest+e2e; this app has none yet) · JV part 3 (prompt
merge, SettingsView rework, local_managed decision) · the llm-runner RUNNER path
runtime proof (engine download + GGUF from a fresh host) · archiving THIS repo.

## 2026-08-03 — Design 1 ruled, the e2e harness, and the standard app chrome

**The GUI redesign ran as live iteration in the REAL app** after the user rejected
mockups twice ("you have problems going from an approved mockup to the real app";
"real app means tauri as webview, not equal browser"). Three switchable designs
(temporary DesignSwitcher pill), screenshotted from the real WebView2, and **Design 1
— sidebar + language table — is THE layout** (user pick). Setup rules ruled and
asserted in e2e: the whole form always visible, Check-path is an explicit button,
nothing auto-runs.

**JW's e2e harness is ported and is now the family standard** (`e2e/`: tauri-driver +
msedgedriver + raw-WebDriver driver.js; `npm test` = 9 smoke tests against the release
build, `npm run screenshots` = every surface as PNGs). Two harness fixes over JW's
copy, both recorded for sync-back: Git Bash's GNU tar breaks on `E:\` (pin System32
bsdtar), and the driver must match the WEBVIEW2 RUNTIME version, not Edge's (Edge 151 /
runtime 150 skew found live). **Driving a Chrome tab is banned** (user ruling; browser
access revoked over it).

**The standard app chrome exists now because this app shipped without ALL of it** —
the user: "are you bringing in the data directory, the style changer, the ai progress
cancel, the logs? did you really think about this?" Answer was no. Built the same day:
`/ai` (kit `AiModelsArea` — providers/models/presets/usage), `AiStatusButton` in the
shell footer, Settings (appearance over the kit engine, storage with data-root
relocate + shared disk usage, kit `LogsPanel`, reviewer moved from Setup, about), and
the server's platform wiring (`install_log_ring` + `install_file_log` +
`make_logs_router` + `make_disk_router`) with content-asserting tests.
`app-structure.md` §10 (harness) + §11 (chrome) make omission impossible to repeat;
definition-of-done boxes added.

**The real webview caught four bugs no test or dev-browser could,** which is the whole
argument for the harness: missing CORS (silent — TestClient is same-origin), summary
counting untranslated backlog as findings, the runtime-vs-Edge driver skew, and
`configureLlmUi({})` defaulting its base to `tauri.localhost` so every kit LLM view
rendered EMPTY in production only (JW passes the resolved base; now so do we).

**Open:** backup/restore (`make_data_router` + kit `DataManagement`) and UpdatesPanel —
deferred, recorded; client vitest units; release packaging (PyInstaller sidecar);
JV part 3; strip the DesignSwitcher once iteration settles; sync the two harness fixes
back into JW's e2e.
