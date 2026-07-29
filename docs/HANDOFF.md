# HANDOFF — current state, 2026-07-29

Read this, then [`docs/GUIDE.md`](GUIDE.md) if you just want to run the thing, then `README.md`
for why it is built this way.

> **READ THE RESEARCH RECORD BEFORE TOUCHING ANY MODEL CLAIM.** The evidence base is
> `justwrite-app/docs/plans/2026-07-26-i18n-single-source-research.md`, and the sections from
> "The clean re-measurement — 2026-07-28" onward (line ~785) supersede everything measured
> before them. **This file was itself wrong for a day** because a session updated that document
> and not this one, and the next session then "corrected" `src/models.json` from the stale
> summary here — promoting a demoted model and calling the best model untested. If those two
> documents ever disagree, the research record wins and this file is the thing to fix.

## What this repo is

Two functions sharing one pipe. **Translate** a standard i18n JSON locale folder with a local
or online model, then re-read the files and assert what was written. **Author** help docs whose
front-matter `lede:`/`hints:` become locale keys, so one sentence serves the article, the lede
and the field hint and translates like any other key. Zero dependencies, Node 20+, 65 tests.

Layers: `src/loop.js` (translate, ours since 2026-07-27) · `src/checks.js` + `src/suspects.js`
(verify — the differentiator) · `src/review.js` (triage page) · `src/extract.js` (author).

## MEASURED RESULTS — the current, clean set (2026-07-28)

Taken with every other model unloaded from VRAM and runs strictly sequential, on the 8 GB
RTX 2070 Super with RAM at its rated 3600 MT/s (XMP **is enabled** — verified 3600/3600 on both
DIMMs; the old "reboot to enable XMP" task is DONE). Numbers are real errors after READING the
flagged strings, not raw flag counts.

| engine | structural | real errors | time |
|---|---|---|---|
| `gemma-4-26b-a4b-qat` MoE, GPU offload (~15 GB) | 0 | **0** | **73.8 s** (retest 74.2) |
| the same MoE, genuinely CPU-only | 0 | **0** | 128.8 s |
| **gemma3:12b** — the shipped default (8.1 GB) | 0 | **0** | 166.7 s |
| Hy-MT2-7B (4.6 GB) | 0 | 2–3 | **36.6 s** (retest 37.8) |
| qwen3:8b (5.2 GB) | 0 | 3+ | 111.1 s |
| translategemma:12b (8.1 GB) | **2 missing — FAIL** | — | 366.2 s |
| Gemini 3.6 Flash (cloud, not re-measured) | 0 | 0 | 94 s — but 20 requests/DAY |

**The flagship MoE is the most accurate thing measured, and it is faster on CPU alone than the
default is with a GPU.** It needs `"think": false` — it is a thinking model and returns empty
content otherwise. It is not the shipped default only because it is a ~15 GB download.

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

> ⚠️ **The Spanish output no longer exists. Checked 2026-07-29: there is no `es.json` anywhere
> in the workspace** — not in `justwrite-app/src/renderer/src/i18n/locales/` (which holds only
> `en.json`), not anywhere else under `E:\Dev\Web`. The 846-key run really happened, but its
> result was never committed, and "shipping `es.json` into JustWrite" is on the USER-OWNED list
> below, so it never landed. Items 1 and 3 both took that file as their input. **Neither is
> doable until a fresh run produces it** — Ollama up, `gemma3:12b`, ~52 min. `en.json` has also
> grown to **867 keys**, so a re-run is not a reproduction of the old one.

1. **The 18 flagged keys** — `node src/review.js config.json --lang es`. First real use of the
   review page; also tells us whether the triage UI is any good. **Blocked:** the 18 findings
   describe a file that no longer exists (see above). The finding *names* were reported to the
   terminal at the time and were not saved either, so re-running is the only route back.
   Requires a config too — the repo ships only `just-ai-help.config.example.json`, and whatever
   config drove the 846-key run was never committed.
2. **The conversion sweep** — the real remaining work, and unaffected by the above.

   **MEASURED 2026-07-29, not cited: `npm run i18n:lint` in `justwrite-app` reports 1,430
   warnings, 0 errors, across 69 of 81 renderer `.vue` files.** 813 `t()`/`$t()` call sites are
   already converted. The research doc's ~1,719 was the right ballpark. Distribution is
   long-tailed — worst are `AnalysisView` 81, `ImportView` 57, `HomeView` 56, `RichEditor` 55,
   `RelationshipArcModal` 42; the tail runs down to single-warning files, so there is cheap
   early progress available. The kit (613) and JustVoice (1,551) figures are still uncounted.

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
3. **`--probe` at scale** — validated on the 40-key corpus, not yet on a full catalogue.
   **Blocked on the same re-run**, and note probe doubles it: two passes, so ~2 hours for 867
   keys, not 52 minutes.
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
repo declares Node 20+). `src/engines.json` lost its false `_legacy` note and four dead fields
(grep-verified unused). Then, after the user caught the model-table errors described at the top
of this file, `src/models.json` and the README's *Measured* section were rewritten from the
research record, and `docs/GUIDE.md` was added as the short user-facing guide.

Then **every `.mjs` became `.js`**. `package.json` already declared `"type": "module"`, so the
extension was carrying no information — the commands are now `node src/translate.js`, and the
whole repo, docs included, says `.js`. One trap found in passing: **`src/checks.js` is binary to
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
