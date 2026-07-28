# just-ai-help

Help-docs and translation tooling for **any app that keeps its strings in standard i18n JSON**.
Nothing here knows about a framework — the placeholder syntax and the plural separator are
config, so vue-i18n, i18next and anything else are all just settings.

Two functions, one pipeline:

1. **Translate.** Point it at a locales folder. It translates `en.json` into your target
   languages with an AI engine — local or online — and then **checks the files it wrote**.
2. **Author the help system.** (Not built yet.) Help docs carry `lede:` and `hints:` in their
   front-matter; those are extracted into locale keys, so one authored sentence becomes the
   help article, the surface lede and the field hint — and translates like any other key,
   because by then it *is* one.

They share one repo because they share the pipe: function 2 emits keys, function 1 translates
them.

> **Zero dependencies.** Node 20+, global `fetch`, nothing from npm. It used to wrap
> [`i18n-ai-translate`](https://github.com/taahamahdi/i18n-ai-translate) and that wrapper is
> gone — see *Why the loop is ours* below.

## Three layers

| | file | what it is |
|---|---|---|
| 1. **Translate** | `src/loop.mjs` | the batch loop — shielding, batching, retry, cache, two transports. Commodity, and ours anyway, for the reason below |
| 2. **Verify** | `src/checks.mjs` | the checks. **The differentiator** — nothing else does content QA on what a translator wrote |
| 3. **Review** | `src/review.mjs` | triage: one local page, flagged rows first, edit, save, re-check |

```bash
node src/translate.mjs config.json                    # translate what changed, then check
node src/translate.mjs config.json --check-only       # check the files on disk. No engine. CI.
node src/translate.mjs config.json --force            # re-translate everything
node src/translate.mjs config.json --escalate <prof>   # re-run ONLY the flagged keys, elsewhere
node src/review.mjs    config.json --lang es           # the review page
npm test                                               # node --test, 36 tests, no deps
```

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

then set `"engine": "ollama"`. No API key. `gemma3:12b` is the profile default because it
**won a bake-off**, not because it sounded right — see *Measured* below. Set `"model"` in
your config to use anything else `ollama list` shows.

This uses the **native** Ollama engine rather than Ollama's OpenAI-compatible `/v1`, because
compat layers are consistently less complete than native APIs — Google's returns bodyless
400s for a request its own native API accepts.

If you already run something else, `"engine": "local-openai-compatible"` points at any
OpenAI-compatible server via `OPENAI_BASE_URL`.

> **A raw llama.cpp server must be started with `--reasoning off`.** A thinking model returns
> empty content otherwise — the deliberation fills `reasoning_content` and the token budget is
> gone before any answer is written. Ollama users don't hit this.

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

## Measured

Against a 40-key sample of a real app's catalog — chosen to break things: every plural-pipe
key, 20 interpolations, the long named-slot paragraphs, glossary terms, and short labels.

### The local bake-off (2026-07-27, two full runs each, scored by the checks above)

| | **gemma3:12b** | qwen3:8b |
|---|---|---|
| translated | 40/40 · 40/40 | 40/40 · 40/40 |
| **structural** failures | **0 · 0** | **0 · 0** |
| semantic flags | **1 · 2** | 3 · 7 |
| missing `¿` (`startpunc`) | **0 · 0** | 1 · 5 |
| length vs English | 1.16× | 1.15× |
| time | 227 s · 219 s | 160 s · 116 s |

Winner: **gemma3:12b** — fewest flags among the structurally clean. Time is only the
tiebreak and was never reached.

**The finding worth keeping.** Both models were told the Spanish `¿` rule in the same system
prompt. gemma3 obeyed it 5 times out of 5, twice. qwen3 missed it 5 times out of 5 on one run
and 1 of 5 on the other — unreliable rather than simply wrong, which is worse to plan around.
So that failure is **not prompt-fixable**; it is a model choice. That is exactly what a
bake-off is for, and it is why the structural/semantic split matters: on structure the two
models are indistinguishable, and structure is all a translator checks about itself.

### Earlier engine measurements (same corpus, before the loop was ours)

| | Gemini 3.6 Flash (free) | local Gemma-26B on an 8 GB card |
|---|---|---|
| translated | 40/40 | 40/40 |
| placeholders intact | 40/40 | 40/40 |
| plural halves identical (bug) | 0 | 1 |
| glossary held | 5/5 | 5/5 |
| time | 94 s | 147 s |

Short labels blow up worst (1.5× on a 10-character nav item), so sidebars overflow before
paragraphs do.
