# just-ai-help

Help-docs and translation tooling for **any app that keeps its strings in standard i18n JSON**.
Nothing here knows about a framework — the placeholder syntax and the plural separator are
config, so vue-i18n, i18next and anything else are all just settings.

Two functions, one pipeline:

1. **Translate.** Point it at a locales folder. It translates `en.json` into your target
   languages with an AI engine — local or online — and then **checks the files it wrote**.
2. **Author the help system.** Help docs carry `lede:` and `hints:` in their front-matter;
   those are extracted into locale keys, so one authored sentence becomes the help article,
   the surface lede and the field hint — and translates like any other key, because by then
   it *is* one. See *Author once, in the docs* below.

They share one repo because they share the pipe: function 2 emits keys, function 1 translates
them.

> **Zero dependencies.** Node 20+, global `fetch`, nothing from npm. It used to wrap
> [`i18n-ai-translate`](https://github.com/taahamahdi/i18n-ai-translate) and that wrapper is
> gone — see *Why the loop is ours* below.

## Three layers

| | file | what it is |
|---|---|---|
| 0. **Author** | `src/extract.mjs` | docs front-matter (`lede:` / `hints:`) → locale keys, so one sentence serves the article, the lede and the hint |
| 1. **Translate** | `src/loop.mjs` | the batch loop — shielding, batching, retry, cache, two transports. Commodity, and ours anyway, for the reason below |
| 2. **Verify** | `src/checks.mjs` + `src/suspects.mjs` | the checks (form) and `--probe` (meaning). **The differentiator** — nothing else does content QA on what a translator wrote |
| 3. **Review** | `src/review.mjs` | triage: one local page, flagged rows first, edit, save, re-check |

```bash
node src/translate.mjs config.json                    # translate what changed, then check
node src/translate.mjs config.json --check-only       # check the files on disk. No engine. CI.
node src/translate.mjs config.json --force            # re-translate everything
node src/translate.mjs config.json --probe             # translate twice, flag where they disagree
node src/translate.mjs config.json --escalate <prof>   # re-run ONLY the flagged keys, elsewhere
node src/extract.mjs   config.json                     # docs front-matter -> locale keys
node src/extract.mjs   config.json --check             # CI: fail if those keys are stale
node src/review.mjs    config.json --lang es           # the review page
npm test                                               # node --test, 65 tests, no deps
```

> **Just want to use it?** [`docs/GUIDE.md`](docs/GUIDE.md) is the short version — which model
> to pull for your machine, the commands, the workflow, and when to use an online engine. This
> README is the long version: why every piece works the way it does.

## Why the loop is ours

Every quality failure measured on 2026-07-27 had one cause: **the request body belonged to
somebody else and we could not reach it.** A thinking flag we could not send, a
`chat_template_kwargs` we could not set, a stale model id baked into a constant, a rate limit
tuned for a different provider — one disease, four symptoms. So the request body is now a
literal object in `src/loop.mjs`, and every provider quirk is a field in a profile
(`extraBody` merges into the body verbatim).

The one adoption candidate that got a fair, timeboxed spike — `lingo.dev`, Apache-2.0, 5.4k
stars, BYO-Ollama — passed three of four criteria and failed the one that counts. It posts the
payload as raw JSON with **no placeholder shielding at all**, so on the 40-key corpus the model
rewrote `{n} notes` as `{3} notas` and translated a do-not-translate brand name, both against a
system prompt that forbade them by name. Shielding is not something you ask a model for. It is
a substitution: interpolations *and* glossary terms are swapped for `⟦0⟧`, `⟦1⟧` … before the
model sees them and restored by index afterwards, and an item whose tokens do not all come back
exactly once is a failure that gets retried, not a result.

## What this adds

### 1. Engine profiles (`src/engines.json`)

Per-provider facts a generic translator cannot hold. Every field in that file comes from a
real failure, not from documentation:

| field | the failure it prevents |
|---|---|
| `model` | a stale model id 404s. `gemini-2.5-flash` — a translator's own baked-in default — is no longer served to new keys, and 19 of 40 keys silently failed |
| `maxOutputTokens` | a **thinking** model returns EMPTY content: deliberation fills `reasoning_content` and the budget is gone before any answer is written |
| `rateLimitMs` | assume OpenAI's ~500 RPM, point it at a provider with a 15 RPM free tier, and it burns the whole run on retries |
| `extraBody` | the general escape hatch. Any knob any server ever grows is config, not a code change |
| `think` | Ollama's top-level thinking switch. Deliberately has no default — off is 13× faster and measurably worse on placeholders |

Add a provider by adding a row.

### 2. Output checks

A translator that **exits 0 even when it skipped keys** makes a broken run and a good run look
identical to CI — the behaviour that started this project. So the tool re-reads the files that
were written and asserts:

| code | what it catches |
|---|---|
| `missing` | the key has no translation at all |
| `blank` | the target is empty or whitespace |
| `placeholder-changed` | `{n}`, `{into}`, named slots — added, dropped or rewritten |
| `plural-halves-lost` | a plural form disappeared |
| `plural-halves-identical` | both halves came back the same |
| `glossary-translated` | a `doNotTranslate` term was translated anyway |
| `untranslated` | identical to the source (exempting strings that are only placeholders and glossary terms) |
| `startpunc` | the target language's opening mark is missing — Spanish `¿` / `¡` |
| `endpunc` | terminal punctuation does not match the source's |
| `numbers` | a quantity changed |
| `brackets` | a `()`, `[]` or `{}` wrapper was dropped or duplicated |
| `doublewords` | a word repeated back to back — a generation stutter |
| `whitespace` | leading or trailing spacing differs from the source |

The test list is the Translate Toolkit's `pofilter` — decades of distilled knowledge about
what goes wrong in translation. Its *tests* are the spec; its Python is not imported.

`plural-halves-identical` is the one nothing else catches. It passes every structural test —
right separator, right placeholders, right word count — and is still wrong:

```
en: "Delete {n} autosave? | Delete {n} autosaves?"
es: "¿Eliminar {n} autoguardados? | ¿Eliminar {n} autoguardados?"
```

`startpunc` is the one that shows why prompting is not enough. Told the Spanish rule
explicitly in the system prompt, qwen3:8b still missed the opening `¿` on **5 of 5** questions
— and so did lingo.dev's run. Every check has a test that hands it a deliberately broken
string and asserts it complains (`npm test`, `node --test`, zero dependencies), because a
check that has never been seen to fail is indistinguishable from one that cannot.

Every finding is `{ key, code, detail }` — one shape, because this list is not only the CI
gate, it is the feed the review page triages on.

## Quick start

```bash
cp just-ai-help.config.example.json just-ai-help.config.json   # then edit it
export GEMINI_API_KEY=...            # free tier, no card: aistudio.google.com
npm run translate
```

There is no `npm install` step — there is nothing to install.

> **The Gemini free tier is a smoke test, not an engine.** Measured 2026-07-27: **20
> requests per day, per model** (quotaId `GenerateRequestsPerDayPerProjectPerModel-FreeTier`).
> A 846-key catalogue at batch 24 is 36 requests, so a single language exceeds a whole day's
> quota. Use it to prove your config works end to end, then run locally or on a paid tier.

### Running it locally instead

**Use Ollama.** One install, and it handles the model download and the GPU for you:

```bash
ollama serve
ollama pull gemma3:12b
```

then set `"engine": "ollama"`. No API key. `gemma3:12b` is the profile default because it was
**measured**, not because it sounded right: zero real errors on the corpus at a size that fits
an 8 GB card. It is not the most accurate model we ran — a 26B-A4B MoE beat it on accuracy
*and* speed — but that one is a ~15 GB download, and availability is not a recommendation. Set
`"model"` in your config to use anything else `ollama list` shows, and see *Measured* below or
`src/models.json` for what each choice costs you.

This uses the **native** Ollama engine rather than Ollama's OpenAI-compatible `/v1`, because
compat layers are consistently less complete than native APIs — Google's returns bodyless
400s for a request its own native API accepts.

If you already run something else, `"engine": "local-openai-compatible"` points at any
OpenAI-compatible server via `OPENAI_BASE_URL`.

> **A thinking model needs its thinking turned off, on either transport.** It returns EMPTY
> content otherwise: deliberation fills `reasoning_content` and the token budget is gone before
> any answer is written. On a raw llama.cpp server, start it with `--reasoning off`. On Ollama,
> set `"think": false` in your config — the profile deliberately sends no `think` field, so a
> thinking model uses its own default and fails. Measured 2026-07-28: the 26B-A4B MoE returned
> `Empty content from …/api/chat` on every retry until `think: false` was set.

**This tool does not download or manage an engine, deliberately.** That job is ~1,000 lines of
CUDA-build-by-compute-capability selection and platform unpacking (measured in a working
implementation), to save you one Ollama install.

## Fixing what it gets wrong

### The review page

```bash
node src/review.mjs just-ai-help.config.json --lang es    # http://localhost:4780
```

One `node:http` server, one HTML page, no framework, no build, no dependencies, no account
and no database — **the JSON files are the state**, the same ones git already tracks.
Flagged rows are pinned to the top with their reason as a chip; edit in place, it saves on
blur, re-runs the checks for that key and updates the counts. Saving one value leaves the
file byte-identical except that value (the nested structure is rebuilt from the *source*
file's shape, so key order never churns) — a one-word fix produces a one-line diff, which is
what makes reviewing a reviewer's work possible. There is a test for exactly that.

### Or just edit the JSON

The output is plain JSON in git. Edit it.

**Corrections survive re-runs.** A key is re-translated only when its target is missing or
when something that could change the answer changed — the source text, the language, the
context sentence or the glossary, hashed together into `.jah-cache.json`. Edit a target value
by hand and later runs leave it alone. `--force` overrides the whole delta.

### Find the errors the checks cannot see — `--probe`

```bash
node src/translate.mjs config.json --probe
```

Every check above is about **form**. A translation can satisfy all of them and still be
wrong, and the two worst cases we have measured both did:

```
en   Delete {n} autosave? | Delete {n} autosaves?
es   ¿Eliminar autosave {n}?          <- "delete autosave NUMBER 3", not "delete 3"
```

The placeholder is present exactly once, no number changed, both plural halves differ, the
punctuation is correct. Nothing structural can object. The other was an invented noun in the
middle of an otherwise fluent sentence.

`--probe` translates the catalogue a **second time with the same engine** and flags the keys
where the two passes disagree. The loop runs at temperature 0.2, so where the model is sure
it repeats itself exactly and where it is guessing it wanders — self-consistency as an
uncertainty measure. Measured over a 40-key corpus: **30 of 40 keys came back byte-identical**,
and both invisible defects above ranked in the top three of the ones that moved. The known
false positive — `· {n} tokens`, correctly left alone — sank to #18, because agreement is the
signal.

Two *different* models was tried and is **worse**: they word everything differently, so real
defects drown in stylistic noise (`Contraer` vs `Colapsar` outranked the hallucination). Same
model twice also needs no second model chosen, downloaded or configured.

The findings use the same `{ key, code, detail }` shape as every check, with `code:
"disagreement"` and the second pass's wording in the detail, so they appear in the report,
on the review page, and in what `--escalate` re-translates — with no new concepts anywhere.
The second opinion is kept in `<lang>.probe.json` beside the locale, so a later
`--check-only` or review session uses it without re-running the engine.

Ranking is **length-normalised**. Raw disagreement correlates with source length (r≈0.42
measured), so a flat ranking spends the whole budget on long paragraphs while the nastiest
defects hide in short strings — one real error was `End` rendered as the verb `Finalizar`,
three characters of source. Keys are banded by length using the corpus's own distribution
and the budget is spread across bands. Set the budget with `"suspects": { "topN": 20 }` in
your config; `0` disables it.

A suspect that has been **acted on** stops being one: escalating a key, or editing it on the
review page, drops its probe entry. Otherwise a reviewer's own fix would become the evidence
against it and the row would stay flagged forever.

**Known limitation:** editing `<lang>.json` **by hand**, outside the review page, does not
retire the probe entry — so that key keeps showing as a suspect, because your wording differs
from the machine's second pass. Remedy: delete the key from `<lang>.probe.json`, or re-run
`--probe`. (The tool cannot currently tell a human edit from a model one. It could — the
cache records what the model actually produced, so a target differing from its cache entry
has been touched by a person — but that couples the suspect list to the cache and has not
been built.)

The cost is honest: the probe is a full second pass over the whole catalogue, regardless of
how small the delta was — a full run costs double, an incremental run costs more than the
delta itself. That is why it is opt-in rather than default.

**It refuses to run at an effective temperature of 0**, and reports its own hit rate. The
whole method is sampling the engine twice, so at temperature 0 the two passes are identical
*by construction* and the result would be a confident "nothing disagreed" that measured
nothing. `--probe` therefore checks the temperature the built request will actually carry —
including an `extraBody` override in the engine profile — before spending any engine time
and exits with an explanation, and every run prints `N/M key(s) differed between the two passes` — with a
warning if N is 0, because a broken instrument and a flawless catalogue produce the same
silence, and this tool exists precisely because a run that silently did nothing once looked
exactly like a run that worked.

### Escalate the flagged keys to a better engine

```bash
node src/translate.mjs config.json --escalate <engine-profile>
```

Checks what is on disk, re-translates **only the keys the checks flagged** with the named
engine profile, merges, re-checks, and prints before → after. The cheap engine does the
catalogue; the expensive one is spent on the few keys that earned it. The escalation profile
deliberately ignores your config's `model`/`url` overrides — the point is to run somewhere
else, and inheriting them would silently defeat that.

Measured on a deliberately corrupted first pass (5 keys broken by hand across every failure
class), qwen3:8b's output escalated to gemma3:12b:

```
es: 16 finding(s) across 11 key(s) before
es: wrote 11 keys in 1 request(s)
es: 16 -> 1 finding(s), 11 -> 1 key(s)          83.6 s
```

Ten keys changed; the eleventh came back identical and stayed flagged, which is the honest
outcome rather than a hidden one.

## Author once, in the docs — `extract`

```bash
node src/extract.mjs config.json            # write the generated keys into the source locale
node src/extract.mjs config.json --check    # CI: fail if they are stale. Writes nothing.
```

The same sentence usually gets written three times: in the help article, as the surface's
one-line lede, and as a field's inline hint. Three copies drift — and then each drifts into a
*different translation*, so the Spanish hint describes something the Spanish help article no
longer says.

So the doc's front-matter is the single authoring home:

```markdown
---
lede: Everything about your manuscript's characters, in one place.
hints:
  lifeStatus: Whether the character is alive at the story's end.
  role: Main characters appear in the sidebar; the rest stay in the library.
---

# Characters
```

`extract` turns that into `lede.characters` and `hints.characters.lifeStatus` in your **source
locale file** — the same file the translator reads. That composition is the entire point:

```
docs → extract → en.json → translate → es.json
```

A changed hint re-translates as an ordinary key delta. The translator never knows docs exist,
and there is no second pipeline to keep in step.

**It owns two prefixes and nothing else.** Every run clears `lede.*` and `hints.*` and
rewrites them from the docs, so a hint deleted from a document disappears from the locale
instead of lingering forever and being translated into nine languages for nobody. Every other
key is untouched — a generator that can clobber hand-written copy is a generator nobody dares
run. Both prefixes are configurable (`ledePrefix`, `hintsPrefix`), as is `docsDir`.

**The file's own shape is preserved.** Nested locales get nested keys, flat locales (literal
dotted keys) get flat ones — detected, not configured, because reshaping 800 hand-written keys
to add two of its own is how a generator gets banned from a repo.

**The front-matter parser refuses what it does not understand.** Tabs, lists, multi-line
scalars, nesting deeper than one level and duplicate keys all throw, naming the file and line.
The failure that matters is not a parser that errors — it is one that *succeeds* on something
it misread and silently drops a sentence, which then never reaches a locale, never gets
translated, and shows up as a blank hint with nothing anywhere reporting a problem.

`--check` is the CI contract: it asserts the committed locale matches the docs. A stale
generated key is exactly as broken as a missing one, and neither is visible by reading either
file on its own.

It runs at **build time**. Runtime stays plain vue-i18n — nothing parses markdown in the app.

## Measured

Against a 40-key sample of a real app's catalog — chosen to break things: every plural-pipe
key, 20 interpolations, the long named-slot paragraphs, glossary terms, and short labels.

### The clean re-measurement — 2026-07-28

Every earlier timing here was taken without ensuring the GPU was otherwise idle, and one of
them was badly wrong because of it. These runs unload every resident model first
(`POST /api/generate {keep_alive:0}`) and run strictly sequentially, on an 8 GB RTX 2070 Super
with the RAM finally at its rated 3600 MT/s. 40/40 keys in 3 requests unless noted.

| model | size | structural | real errors | time |
|---|---|---|---|---|
| 26B-A4B MoE (`gemma-4-26b-a4b-qat`), GPU offload | ~15 GB | 0 | **0** | **73.8 s** |
| the same MoE, genuinely CPU-only | ~15 GB | 0 | **0** | 128.8 s |
| **gemma3:12b** — the default | 8.1 GB | 0 | **0** | 166.7 s |
| Hy-MT2-7B (first-party Tencent GGUF) | 4.6 GB | 0 | 2–3 | **36.6 s** |
| qwen3:8b | 5.2 GB | 0 | 3+ | 111.1 s |
| translategemma:12b | 8.1 GB | **2 missing** | — | 366.2 s |

Timings reproduce to within 1% on a second run (MoE 73.8 / 74.2 s, Hy-MT2 36.6 / 37.8 s).

**"Real errors" is not the flag count, and the difference matters.** The flagged strings were
read rather than tallied, and the count was lying in *both* directions. `· {n} tokens` is
flagged `untranslated` on every model that correctly left it alone — a false positive that
penalises the right answer — while Hy-MT2 escaped that flag only by rewriting it to
`· Tokens {n}`, reordering and capitalising for no reason, so the check **rewarded the worse
output**. The MoE's one `numbers` flag did not reproduce on its second run: sampling noise, not
a fault. A flag list is a worklist, not a verdict.

**Fastest and most accurate are not the same row.** Hy-MT2-7B is twice as fast as the MoE and
is the least accurate of the models that finished: it misses the Spanish opening `¿` on the
same key on **both** runs, and one run invented the noun *"proyectos"* in an otherwise fluent
sentence. That is the same reproducible-`¿` failure that disqualified qwen3:8b, with the rule
in the same system prompt — **not prompt-fixable, a model property.** It is a speed option
that costs correctness, not a default.

**A timing taken while another engine may hold VRAM is not a measurement.** Hy-MT2-7B read
232.6 s on 2026-07-27 and 36.6 s here — 6.4×, entirely GPU contention. Bandwidth cannot explain
it: at 4.6 GB the model never leaves the card. (gemma3:12b, which does partially offload, moved
219–227 s → 166.7 s once the RAM ran at its rated speed — 1.3×, which is what a bandwidth
improvement actually looks like.)

**translategemma:12b is disqualified**, reversing its earlier standing. It had been the only
local model with zero flags of any kind, rejected only on time. Measured clean it needed 23
requests of retry-and-split, returned 38/40 keys and exhausted every retry on two of them — a
structural failure. Its old result does not reproduce.

**Why `gemma3:12b` is still the default** despite the MoE beating it on both axes: zero real
errors at 8.1 GB, on a card that cannot hold a ~15 GB model. Availability is not a
recommendation. If you have the disk and the RAM, the MoE is the better engine — see
`src/models.json` for the per-tier reasoning.

### The cloud row (not re-measured on 2026-07-28)

Gemini 3.6 Flash: 40/40 keys, 40/40 placeholders, 8/8 pipes, 0 identical-half bugs, 94 s — the
best quality-per-second here, and unusable for real work at 20 requests per day per model.

Short labels blow up worst (1.5× on a 10-character nav item), so sidebars overflow before
paragraphs do.
