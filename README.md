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

> **Node 24+ and nothing else to run it.** The review UI ships as a committed build and SQLite
> is part of the runtime, so there is no install step for a user; `npm install` is only for
> developing the UI. The translation pipeline itself has no runtime dependencies — it used to
> wrap [`i18n-ai-translate`](https://github.com/taahamahdi/i18n-ai-translate) and that wrapper
> is gone, for reasons measured rather than assumed. See *Why the loop is ours* below.

## Three layers

| | file | what it is |
|---|---|---|
| 0. **Author** | `server/extract.js` | docs front-matter (`lede:` / `hints:`) → locale keys, so one sentence serves the article, the lede and the hint |
| 1. **Translate** | `server/loop.js` | the batch loop — shielding, batching, retry, cache, two transports. Commodity, and ours anyway, for the reason below |
| 2. **Verify** | `server/checks.js` + `server/suspects.js` | the checks (form) and `--probe` (meaning). **The differentiator** — nothing else does content QA on what a translator wrote |
| 3. **Review** | `server/review.js` + `server/server.js` + `ui/` | the workspace: queue, second opinion, re-translate, undo, notes — all languages at once |

```bash
node server/translate.js config.json                    # translate what changed, then check
node server/translate.js config.json --check-only       # check the files on disk. No engine. CI.
node server/translate.js config.json --force            # re-translate everything
node server/translate.js config.json --probe             # translate twice, flag where they disagree
node server/translate.js config.json --escalate <prof>   # re-run ONLY the flagged keys, elsewhere
node server/translate.js config.json --accept <key,key>  # record findings as reviewed-and-correct
node server/extract.js   config.json                     # docs front-matter -> locale keys
node server/extract.js   config.json --check             # CI: fail if those keys are stale
node server/review.js    config.json                     # the review workspace at :4780
npm test                                               # node --test, 144 tests
npm run build:ui                                       # rebuild the UI (developers only)
```

> **Just want to use it?** [`docs/GUIDE.md`](docs/GUIDE.md) is the short version — which model
> to pull for your machine, the commands, the workflow, and when to use an online engine. This
> README is the long version: why every piece works the way it does.
>
> **Confused by the config files?** [`docs/CONFIG.md`](docs/CONFIG.md) lists every one, what
> reads it, and which single file is yours to edit.
>
> **Picking up development?** [`docs/HANDOFF.md`](docs/HANDOFF.md) is the current state: the
> measured results, what is open, and which record wins when two disagree.

## Why the loop is ours

Every quality failure measured on 2026-07-27 had one cause: **the request body belonged to
somebody else and we could not reach it.** A thinking flag we could not send, a
`chat_template_kwargs` we could not set, a stale model id baked into a constant, a rate limit
tuned for a different provider — one disease, four symptoms. So the request body is now a
literal object in `server/loop.js`, and every provider quirk is a field in a profile
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

### 1. Engine profiles (`server/config/engines.json`)

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
| `untranslated` | identical to the source (exempting strings that are only placeholders and glossary terms, and anything a reviewer has accepted — see `--accept`) |
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
string and asserts it complains (`npm test`, `node --test`), because a
check that has never been seen to fail is indistinguishable from one that cannot.

Every finding is `{ key, code, detail }` — one shape, because this list is not only the CI
gate, it is the feed the review workspace triages on.

## Quick start

```bash
mkdir your-app/just-ai-help                            # one folder, the whole footprint
cp docs/config.example.json your-app/just-ai-help/config.json   # then edit it
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
ollama pull hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL
```

then set `"engine": "ollama"`. No API key. That 26B-A4B QAT MoE is the profile default because
it was **measured**, not because it sounded right: zero real errors on the corpus and the
fastest thing we ran, 73.8 s with GPU offload and 128.8 s on the CPU alone — so it beats the
runner-up's 166.7 s without touching the graphics card at all. Only ~4B of its 26B parameters
are active per token, which is what buys that. It is a 15 GB download and the profile sets
`think: false` for it, because it is a thinking model.

`hf.co/<owner>/<repo>:<quant>` is an ordinary Ollama tag — `pull` fetches it from HuggingFace,
with no manual download and no Modelfile. Until 2026-07-29 this repo's docs claimed otherwise
and made that false claim the reason the MoE was not the default; it cost a better default for
a day.

**If 15 GB will not fit**, use `"engine": "ollama-gemma3"` for `gemma3:12b` at 8.1 GB — equally
free of real errors, 2.3× slower, and the default until 2026-07-29. Or set `"model"` to
anything else `ollama list` shows; see *Measured* below or `docs/models.md` for what each
choice costs you.

This uses the **native** Ollama engine rather than Ollama's OpenAI-compatible `/v1`, because
compat layers are consistently less complete than native APIs — Google's returns bodyless
400s for a request its own native API accepts.

If you already run something else, `"engine": "local-openai-compatible"` points at any
OpenAI-compatible server via `OPENAI_BASE_URL`.

> **A thinking model needs its thinking turned off, on either transport.** It returns EMPTY
> content otherwise: deliberation fills `reasoning_content` and the token budget is gone before
> any answer is written. On a raw llama.cpp server, start it with `--reasoning off`. On Ollama,
> set `"think": false`. There is no global default for that field — it belongs to the engine row,
> matched to the model that row names, because whether thinking helps is a property of the model.
> The `ollama` row carries `think: false` because it names a thinking model; `ollama-gemma3` omits
> it because `gemma3:12b` has nothing to switch off. Measured 2026-07-28: the 26B-A4B MoE returned
> `Empty content from …/api/chat` on every retry until `think: false` was set. Sending it to a
> non-thinking model is harmless (verified on gemma3:12b), but sending it to a *different*
> thinking model picks a measurably worse mode — qwen3:8b with thinking off was 13× faster and
> translated the placeholder.

**This tool does not download or manage an engine, deliberately.** That job is ~1,000 lines of
CUDA-build-by-compute-capability selection and platform unpacking (measured in a working
implementation), to save you one Ollama install.

## Fixing what it gets wrong

### The review workspace

```bash
node server/review.js your-app/just-ai-help/config.json    # http://localhost:4780
```

A three-pane workspace: a queue of buckets with live counts, a key list, and a detail panel
holding everything needed to judge one translation. Vue 3 on `@delebash/llm-ui`, the same
component kit the other apps use, served from a committed build — so this needs no install.

**What it does that the old page could not:**

- **Un-accept.** Approving a finding was one-way, and accepted keys then vanished entirely, so
  a decision could never be revisited. They are now a visible bucket, reversible in one click.
- **Undo anything**, across days. The action log is in SQLite, not browser memory, so an accept
  made on Friday is still undoable on Monday.
- **Re-translate from the page** — one key or a whole scope, with progress, cancel, and rejoin
  after a reload. Results arrive as **proposals**: an engine never writes the catalogue, a
  human does. That is what makes a 52-minute job safe to cancel.
- **A second opinion.** Google Translate embedded in a same-origin frame with its banner
  cropped, beside the local model's second pass. Neither is treated as authoritative, because
  neither is: on `characterAudit.why` the local model was wrong and Google right; on
  `settings.backups.dataFolderHint` the reverse.
- **Siblings** from the same namespace — how `characterAudit.why` was actually proven a defect,
  by seeing its neighbour render the same label-with-colon pattern correctly.
- **Terminology** against the catalogue's own usage, and a **note** per key that is sent with
  that key on the next run, so a fix found once stops recurring.
- **Every target language in one queue**, filterable to one.
- **Keyboard first** — `j`/`k` move, `a` accepts, `u` undoes, `e` edits, `g` shows Google,
  `/` searches.

Unchanged and still load-bearing: saving one value leaves the file byte-identical except that
value — the nesting is rebuilt from the *source* file's shape, so key order never churns. A
one-word fix produces a one-line diff, which is what makes reviewing a reviewer's work
possible. There is a test for exactly that.

**What lives where.** The locale JSON, acceptances and notes stay committed files — the app
loads them and `--check-only` reads them, so deleting the workspace database must never break
a build, and there is a test for that too. `.jah.db` (gitignored) holds review progress, undo
history, proposals, run history and engine connections.

### Some findings are correct — `--accept`

The name misleads, so start with the distinction. **Correcting** a translation and **accepting**
a finding are opposites:

|  | what you did | what gets stored |
|---|---|---|
| **Corrected** | edited the translation, because it was wrong | nothing — the finding disappears by itself |
| **Accepted** | changed nothing, because it was already right | a verdict, because the check will ask again |

Not every flag is a defect. The correct Spanish for `"No"` is `"No"`, and `untranslated` will
say so on every run, forever. Left alone that has a consequence worse than noise: **a perfect
catalogue can never exit 0**, and `--check-only` is the CI gate. A gate that cannot go green is
one people stop reading, which is precisely how the next real miss ships.

The reason a verdict has to be *stored* rather than just acted on: **the checks have no memory.**
They re-read the files from scratch every run, so a string that is legitimately identical to its
source trips the same check today, tomorrow and on run 500 — nothing about it will ever change on
its own. An acceptance is not an exemption and not a to-do; it is the memory that stops the same
question being asked forever.

It is committed for a concrete reason too: `--check-only` runs in CI against a **fresh clone**, so
acceptances held anywhere gitignored would be absent exactly where the gate reads them, and every
build would be red.

Measured on the JustWrite catalogue, 2026-07-30 — across two full runs the checks separated
sharply by precision:

| check | findings | real errors |
|---|---|---|
| `spurious-interrogative` | 11 | **11** |
| `startpunc` | 1 | **1** |
| `brackets` | 1 | 0 (a benign added gloss) |
| `endpunc` | 5 | 0 (every one a duplicate of a `spurious-interrogative` hit) |
| `untranslated` | 20 | **1** |

Re-measured at full scale on 2026-07-30 — the same catalogue grown to **1,965 keys**, one MoE
pass plus both `--probe` passes in 51.6 min, 1,965/1,965 translated:

| check | findings | real errors |
|---|---|---|
| `untranslated` | 56 | **2** (both a word translated under `nav.*` and left English elsewhere) |
| `endpunc` | 6 | **6** |
| `spurious-interrogative` | 3 | **3** |
| `whitespace` | 1 | **1** (a silently truncated sentence) |
| *found only by reading the file* | — | **2** |

Two things in that table are worth more than the rest of this section.

**`untranslated` is a worklist, not a verdict** — 54 of its 56 findings were correct output. It
is still the check that found the two real ones, and no cheaper check would have.

**The last row is the honest one.** Two defects passed every structural check *and* both probe
passes. `settings.backups.dataFolderHint` — "Everything JustWrite saves lives here" — came back
as "Todo JustWrite **salva vidas** aquí", "saves lives". Placeholders intact, punctuation
correct, plurals correct, nothing to flag. This is the documented blind spot behaving exactly as
documented: the second probe pass wrote "**guarda vidas**", so the two passes disagreed on
wording while making the identical misreading. `--probe` measures self-consistency, and a model
can be consistently wrong.

**And the other one never surfaced at all.** The probe found **150** keys whose two passes
disagree; `"suspects": { "topN": 30 }` reports thirty, so **20% of the signal was visible** and
`foreshadowing.reviewDesc` — "Setups your manuscript **plants**" read as *houseplants* — sat in
the invisible 120.

Worse, the ranking did not help on the ones it did show. Suspects are ordered by token-set spread
— how *differently* the second pass worded it — and the two semantic defects ranked **#22 and #30
of 30**, at the very bottom of the window. At the `topN: 20` this README suggested for a year,
both would have been invisible. The hidden 120 have a median spread of 0.17 against 0.18 for all
150: **the hidden set is not measurably less suspicious, just less wordy.** Twenty-one hidden keys
disagreed badly (spread ≥ 0.5), including the gender split at the root of a feature-wide naming
inconsistency.

That is a real limit on `rankSuspects`, and it is worth stating plainly: spread measures
*disagreement*, and a semantic misreading can be one word. The header comment in `server/suspects.js`
records the two planted defects ranking **#1 and #3** on the original 40-key corpus. **That result
does not hold at 1,965 keys.**

`topN` is a display budget, not engine time — `--escalate` is what costs. Set it above your
disagreement count and read the list. Nothing here replaces reading the file.

Two fixes, in this order, because the first is free:

**1. Put technical terms in the glossary.** `checkUntranslated` already exempts a string that is
only placeholders, glossary terms, digits and punctuation — that mechanism was starved of data,
not broken. Adding `Tauri`, `Vue`, `Pinia`, the model ids and `tokens` to `doNotTranslate` took
`untranslated` from 11 findings to 7 with no code change, and shields those terms during
translation too.

**2. Record a verdict on what is left.** The remaining seven were Spanish cognates — `No`,
`General`, `App`, `Error`, `ID`, `auto`, `total`. Press **correct as-is** in the review page, or:

```bash
node server/translate.js config.json --accept common.no,settings.sections.general
```

Either writes `<lang>.accepted.json` beside the locale files. Commit it: a reviewer's judgement
is a project decision, not a measurement, which is why it is committed where `<lang>.probe.json`
is not.

**Why a hash and not a list of exempt keys.** An entry is keyed by a hash of *(key, code, source,
target)*, and every part of that is load-bearing:

- Accepting `untranslated` on a key does not silence `brackets` on the same key.
- Change the English and the finding **comes back**. Demonstrated on the real catalogue: with
  `settings.sections.general` accepted, editing the source to `"General settings"` and leaving
  the target unchanged put `untranslated (1)` straight back in the report. A per-key exemption
  list would have hidden that forever — which is exactly why this is not one.
- Edit the translation and it comes back too. The verdict was about those two exact strings.

And it is never silent: every run prints `N accepted as correct`, so a suppression is always
visible to whoever reads the report. To un-accept, delete the entry.

**What this deliberately is not** is a per-language list of "words that are identical in
Spanish". That was the first design and it was wrong twice over: it only ever fixed one check
(the benign `brackets` gloss above needs the same disposal), and `server/config/conventions.json` already
warns, about itself, that language rules written from memory are "exactly how a confident wrong
rule ends up applied to every future translation."

### Or just edit the JSON

The output is plain JSON in git. Edit it.

**Corrections survive re-runs.** A key is re-translated only when its target is missing or
when something that could change the answer changed — the source text, the language, the
context sentence or the glossary, hashed together into `.jah-cache.json`. Edit a target value
by hand and later runs leave it alone. `--force` overrides the whole delta.

### Find the errors the checks cannot see — `--probe`

```bash
node server/translate.js config.json --probe
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
node server/translate.js config.json --escalate <engine-profile>
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
node server/extract.js config.json            # write the generated keys into the source locale
node server/extract.js config.json --check    # CI: fail if they are stale. Writes nothing.
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
| **26B-A4B QAT MoE — the default**, GPU offload | ~15 GB | 0 | **0** | **73.8 s** |
| the same MoE, genuinely CPU-only | ~15 GB | 0 | **0** | 128.8 s |
| `gemma3:12b` — the small-download option | 8.1 GB | 0 | **0** | 166.7 s |
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

**Why the MoE is the default** (changed 2026-07-29): it wins on both axes that matter, accuracy
and speed, and the objections turned out not to be objections. The full tag is
`hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL` — instruction-tuned, quantization-aware
trained, unsloth's UD-Q4_K_XL quant, and the exact artefact these numbers were taken from.

The two arguments that had kept `gemma3:12b` in place both failed on inspection. The first was
that the MoE needed weights supplied by hand — false: one `ollama pull` fetches it, the same
mechanism the Hy-MT2 row always described as an ordinary pull. The second was the 15 GB
download, which is a disk cost and does not outrank a measured accuracy *and* speed win. What
genuinely gates it is **memory** — ~15 GB across VRAM and system RAM, measured on 8 GB VRAM
plus 32 GB system RAM. More VRAM only helps; 16 GB of system RAM with no large card is the
untested case, and `"engine": "ollama-gemma3"` is the answer there. Note that the tier names in
`docs/models.md` are VRAM, which is not the constraint this model is bounded by.

### The cloud row (not re-measured on 2026-07-28)

Gemini 3.6 Flash: 40/40 keys, 40/40 placeholders, 8/8 pipes, 0 identical-half bugs, 94 s — the
best quality-per-second here, and unusable for real work at 20 requests per day per model.

Short labels blow up worst (1.5× on a 10-character nav item), so sidebars overflow before
paragraphs do.
