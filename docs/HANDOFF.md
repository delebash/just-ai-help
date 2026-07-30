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
| **26B-A4B QAT MoE — the shipped default** since 2026-07-29, GPU offload (~15 GB) | 0 | **0** | **73.8 s** (retest 74.2) |
| the same MoE, genuinely CPU-only | 0 | **0** | 128.8 s |
| `gemma3:12b` — the small-download option (8.1 GB) | 0 | **0** | 166.7 s |
| Hy-MT2-7B (4.6 GB) | 0 | 2–3 | **36.6 s** (retest 37.8) |
| qwen3:8b (5.2 GB) | 0 | 3+ | 111.1 s |
| translategemma:12b (8.1 GB) | **2 missing — FAIL** | — | 366.2 s |
| Gemini 3.6 Flash (cloud, not re-measured) | 0 | 0 | 94 s — but 20 requests/DAY |

**The flagship MoE is the most accurate thing measured AND the fastest, and it is now the
shipped default** (`src/engines.json` row `ollama`, changed 2026-07-29). Its real tag is
`hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL` — instruction-tuned, QAT, unsloth's
UD-Q4_K_XL quant, and the exact artefact every number above was taken from. It needs
`"think": false` — a thinking model returns empty content otherwise — so that row carries the
field, while the new `ollama-gemma3` row (gemma3:12b, 8.1 GB) omits it because gemma3 has
nothing to switch off. `think` has no global default; it belongs to the row, matched to the model.

What gates the MoE is **memory, not the card**: ~15 GB across VRAM and system RAM, measured on
8 GB VRAM + 32 GB system RAM. More VRAM only helps. 16 GB of system RAM with no large card is
untested — that is the case `ollama-gemma3` exists for. Note `src/models.json` tiers are keyed
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
> has grown to **867 leaf keys** (counted, not cited). So a check of the recovered 846-key file
> against today's `en.json` will legitimately report ~21 keys missing. Pairing it with the
> matching source means recovering that `en.json` from `justwrite-app` git history.

1. **The flagged keys** — `node src/review.js config.json --lang es`. First real use of the
   review page; also tells us whether the triage UI is any good. **Not blocked.** `review.js`
   and `--check-only` read files on disk and need no engine, so pointing a config at the
   recovered file regenerates the current finding set immediately. Still to do: write the config
   (the repo ships only `just-ai-help.config.example.json`) and decide whether to check against
   today's 867-key `en.json` (≈21 extra `missing`) or the historical one.
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
3. **`--probe` at scale** — validated on the 40-key corpus, not yet on a full catalogue. **Still
   needs engine time, and the recovered file does not help.** Two independent reasons, both read
   from the code rather than assumed: the probe pass always translates fresh into its own
   `<lang>.probe.json` with its own cache (`src/translate.js:242`), and the main pass skips a key
   only when the target exists **AND** `.jah-cache.json` has an entry for its content hash
   (`src/loop.js:320`) — that cache is gitignored and **does not exist**, so every key
   re-translates at full price regardless. Budget two full passes. On the new default MoE that is
   roughly 2×25 min rather than the 2×52 min this doc previously assumed on gemma3:12b, but it has
   not been measured at catalogue scale on either model.
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

## 2026-07-29, later — the default is now the MoE, and two false claims are gone

The user asked why the flagship was not the default, and the answer this repo gave was wrong.

**What was actually wrong.** `src/models.json` said the MoE was "not a public Ollama tag — supply
your own GGUF", and that sentence was the stated reason a slower, equally-accurate model shipped
as the default. `ollama list` settles it: the model is installed as
`hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL`, a name Ollama only assigns to something
**it** pulled from HuggingFace — a hand-imported GGUF carries a local name instead. One command,
no manual download. With that gone, the only remaining objection was the 15 GB download, which is
a disk cost and does not outrank a measured win on both accuracy and speed.

**What changed.** `src/engines.json` row `ollama` now names the full MoE tag and carries
`think: false`; a new `ollama-gemma3` row holds `gemma3:12b` with no `think` field. `think` is now
explicitly per-row, matched to the model that row names, rather than a global that must be absent.
`src/models.json` promotes the MoE to `8gb.recommended` with its real pull command and demotes
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
`.jah-cache.json`, read out of `src/loop.js:320` rather than guessed.
