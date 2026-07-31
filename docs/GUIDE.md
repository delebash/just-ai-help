# just-ai-help — user guide

Translate your app's `en.json` into other languages with an AI model, then **check what it
wrote**. Optionally author your help docs once and let their sentences become locale keys.

This is the short version. The [README](../README.md) explains *why* every part works the way
it does; this page just tells you what to run.

---

## 1. What you need

- **Node 20 or newer.** That is the whole install — there are no npm packages to fetch.
- **An engine**: either Ollama on your own machine (free, private, slower) or an online API
  key (fast, costs money or is heavily rate-limited).

```bash
node --version      # v20+
git clone <this repo>
cd just-ai-help
npm test            # 75 tests, should all pass
```

---

## 2. Get the model

Install Ollama once (it handles the download and your GPU), then run these two commands. This
is the default and you do not have to choose anything:

```bash
ollama serve            # leave this running
ollama pull hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL
```

That is a normal `ollama pull` — Ollama fetches it from HuggingFace for you. **There is nothing
to download by hand.**

**What you get.** Gemma-4 26B-A4B QAT: a 26-billion-parameter model that only uses about 4
billion of them per word, so it is both the **most accurate and the fastest** model we measured
— 40 test keys in ~74 s using your graphics card, or ~129 s on the processor alone, with zero
errors either way. For comparison the runner-up takes ~167 s. It is a 15 GB download.

**What it needs.** About 15 GB of memory, which Ollama spreads across your graphics card and
your system RAM. We measured it on an 8 GB card with 32 GB of system RAM. More graphics memory
only makes it faster.

### Pick something else only in these cases

| if | use | how |
|---|---|---|
| **15 GB will not fit** — small disk, or 16 GB of system RAM and no big card | `gemma3:12b` (8.1 GB) | `ollama pull gemma3:12b`, then set `"engine": "ollama-gemma3"` |
| **You want it fast and will review the output** | Hy-MT2-7B (4.6 GB) | `ollama pull hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M`, then set `"model"` to that tag |
| **4 GB or less to work with** | an online model | see below — nothing local we tested is good enough |

**About `gemma3:12b`.** Just as accurate — also zero real errors — and 2.3× slower. Nothing is
wrong with it; it is simply the smaller download. It was the default until 2026-07-29.

**About the fast option.** Hy-MT2-7B is genuinely the quickest, but on our corpus it
reproducibly dropped the Spanish opening `¿` and once invented a word that was not in the
source. It is a fine choice *if* you plan to review with `--probe` and the review page; it is
not the choice if you want to ship the output unread.

Full numbers and the reasoning: [`models.md`](models.md).

### Or use an online model

Pick a row from **`server/config/engines.json`** — that file is the list, and each row carries
its own note saying what it costs and whether it has ever been measured. Set `"engine"` to the
row name and export the key it asks for.

The rows are not enumerated here on purpose: a copy of that list in prose goes stale, and this
page's copy already had, naming five engines when eight shipped. The review workspace shows the
same list with a key/no-key status beside each row.

**One row is worth calling out**, because it looks usable and is not: `gemini-free` allows 20
requests per day per model — measured — and a 2,000-key set of strings is over a hundred
requests. It proves a setup works; it cannot translate anything real.

**When online is the right call:** you have no usable GPU, you need it done in minutes rather
than an hour, or you are translating into a language your local model handles badly. Otherwise
local is free, private, and good enough — that is the whole point of the measurements.

---

## 3. Configure it

```bash
cp docs/config.example.json just-ai-help.config.json
```

Edit the copy:

```json
{
  "localesDir": "src/i18n/locales",
  "sourceLanguage": "en",
  "targets": ["es"],

  "placeholder": { "prefix": "{", "suffix": "}" },
  "pluralSeparator": "|",

  "context": "a desktop app for managing recipes",
  "glossary": { "doNotTranslate": ["Acme", "Smart Pantry"] },

  "engine": "ollama"
}
```

- **`placeholder`** — `{` / `}` for vue-i18n, `{{` / `}}` for i18next.
- **`pluralSeparator`** — `"|"` for vue-i18n; set it to `null` if your framework has no pipes.
- **`context`** — one sentence about your app. It goes in the prompt and genuinely changes
  word choice.
- **`glossary.doNotTranslate`** — brand names and terms that must survive untouched.
- **`engine`** — which row of `server/config/engines.json` to use. **That file is the list**; it
  is not repeated here, because a copy of it in prose is a copy that goes stale, and this one
  already had. Local rows need no key; the review workspace shows every row with a key/no-key
  status beside it. Each row already carries the right settings for the model it names, so
  switching model by switching *engine* is the option that cannot go wrong.
- **`model`** — overrides the engine row's model, e.g. `"model":
  "hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M"`. If the model you name is a *thinking* model, add
  `"think": false` too, or it will return nothing (see troubleshooting).

---

## 4. The workflow

```bash
node server/translate.js config.json                  # 1. translate what changed, then check
node server/translate.js config.json --probe          # 2. (optional) second opinion on meaning
node server/review.js    config.json                  # 3. fix what got flagged
node server/translate.js config.json --accept <key>   # 3b. mark a flag as correct, not a defect
node server/translate.js config.json --check-only     # 4. in CI: verify, no engine needed
```

**1 — Translate.** Only keys that are new or changed get sent to the model; everything else is
left alone, so re-runs are cheap and your hand-edits survive. When it finishes it re-reads the
files it wrote and reports anything wrong: missing keys, mangled `{placeholders}`, lost plural
forms, translated brand names, missing Spanish `¿`, and more.

**2 — Probe (optional).** The checks above catch *form* problems. A translation can pass all
of them and still say the wrong thing. `--probe` translates everything a second time with the
same model and flags the keys where the two passes disagree — where a model is sure it repeats
itself, where it is guessing it wanders. It costs a second full pass of engine time, which is
why it is opt-in. Set the budget with `"suspects": { "topN": 20 }`.

**Set `topN` above your disagreement count.** It is a display window, not a total, and it costs
nothing — engine time is spent by `--escalate`, which acts on what gets reported. On a 1,965-key
run the probe found **150** disagreeing keys and `topN: 30` showed thirty, so four fifths were
invisible. Do not trust the ranking to pick for you: on that run the two genuinely wrong keys
ranked **#22 and #30 of the 30 shown**, because suspects are ordered by how *differently* the
second pass worded it and a semantic misreading can be a single word.

And know what `--probe` cannot do: it measures whether the model *agrees with itself*, so a
model that is confidently wrong twice looks clean. On that same run, "Everything JustWrite saves
lives here" came back as "Todo JustWrite salva vidas aquí" — "saves lives" — and the second pass
made the same misreading in different words. No check catches that. Read the file.

**3 — Review.** Opens `http://localhost:4780` — a three-pane workspace, and where most of the
work happens.

The left pane is the queue: buckets by defect class, with counts, plus a language filter. Every
target language appears together by default; pick one to narrow. The middle is the key list.
The right is where you judge a translation, and it holds everything you would otherwise have
left the page for:

- **why it is flagged**, in plain English rather than a check code;
- the **English** with `{placeholders}` marked, so what must survive is obvious;
- the editable translation — saves when you click away;
- a **second opinion**: Google Translate embedded beside your own output. Neither is treated as
  authoritative because neither is — on `characterAudit.why` ("Why:") the local model wrote
  "¿Por qué?" and Google wrote the correct "Por qué:"; on the data-folder hint the local model
  was right and Google wrong;
- **siblings** from the same namespace — often the fastest proof that something is off, since a
  neighbour usually shows how the pattern is meant to look;
- a **note** for the key, which is sent with it on the next translation, so a fix you work out
  once does not have to be worked out again.

**Everything is undoable**, including an approval — press `u`, or the Undo button. Accepted
findings stay visible in their own bucket and can be reversed at any time.

**Re-translate from the toolbar** — one key, everything flagged, or the whole catalogue, with
progress and a cancel button. Results arrive as *proposals* shown beside the current value; an
engine never writes your catalogue, you do. So cancelling a fifty-minute run costs nothing.

**Keyboard:** `j`/`k` move · `a` accept · `u` undo · `e` edit · `g` Google · `/` search.

Your locale JSON, acceptances and notes stay ordinary committed files — you can still just edit
the JSON. Review progress, undo history and engine connections live in `.jah.db`, which is
gitignored; deleting it loses your place, never your work.

**3b — Some flags are not defects.** Start with the distinction, because the name misleads:

- **Corrected** — the translation was wrong. You edit it, and the finding disappears by itself.
  **Nothing is recorded.**
- **Accepted** — you changed *nothing*. The translation was already right and the *check* was
  wrong to flag it. In Spanish the correct translation of "No" is "No".

Only the second case is written down. Here is why it has to be.

**The checks have no memory.** They re-read the files from scratch on every run, so `"General"`
→ `"General"` trips `untranslated` today, tomorrow, and on run 500. Nothing about that string
will ever change on its own. Without a recorded verdict you get the same findings every single
time, `--check-only` is permanently red, and within a week nobody reads the output. A gate that
cannot go green is a gate people stop reading.

So an acceptance is not an exemption and not a to-do item. It is **the memory that stops the
same question being asked forever.**

```bash
node server/translate.js config.json --accept common.no,settings.sections.general
```

Or press **correct as-is** on the row in the review workspace. Either way it lands in
`<lang>.accepted.json`. **Commit that file** — it is a project decision, not a measurement, and
it has to be in the repo because `--check-only` runs in CI against a fresh clone. Acceptances
kept anywhere gitignored would be absent there, and the gate would be red on every build.

**It reopens itself when it should.** That is why the entry is a hash of the key, the check, the
English *and* the translation — not just the key:

> Today the English is `"General"` and the Spanish is `"General"`. You rule it correct.
>
> Later someone changes the English to `"General settings"`. Whoever updates the catalogue
> copies the English across, so the Spanish becomes `"General settings"` too — a genuinely
> untranslated string.
>
> Source and target match again, so it is flagged. Your ruling covered `"General"`/`"General"`,
> so the hash no longer matches and **the finding fires.** You get told.

A simpler design — "ignore key `settings.sections.general`" — would have stayed quiet and
shipped English text inside the Spanish build indefinitely. That is the failure this shape
exists to prevent, and it is why it is never a per-key exemption.

Two smaller guarantees:

- It is **per finding, not per key.** Accepting `untranslated` on a key does not silence a
  placeholder bug that shows up on the same key later.
- It is **never silent.** Every run prints `N accepted as correct`, at zero or otherwise, so a
  suppression can never be invisible.

To un-accept something, delete its entry from the file — or use the workspace, which can undo it.

**4 — CI.** `--check-only` re-runs every check against the files already committed. No engine,
no network, no API key. It exits non-zero if anything is wrong.

**Escalate (optional).** If a cheap model left a handful of bad keys, re-do *only those* with
a better one:

```bash
node server/translate.js config.json --escalate gemini-free
```

### Help docs → locale keys (optional)

If you keep help articles as markdown, put the one-line summary and field hints in the
front-matter and let them become translatable keys:

```markdown
---
lede: Everything about your manuscript's characters, in one place.
hints:
  role: Main characters appear in the sidebar; the rest stay in the library.
---
# Characters
```

```bash
node server/extract.js config.json            # writes lede.* and hints.* into en.json
node server/extract.js config.json --check    # CI: fails if they are stale
```

Then translate as usual — by that point they are ordinary keys.

---

## 5. Troubleshooting

**"Empty content from …/api/chat"** — you are running a *thinking* model and it spent its
whole token budget deliberating before writing an answer. Add `"think": false` to your config
(Ollama), or start llama.cpp's server with `--reasoning off`. You should not hit this with the
default engine, which already sets `think: false` for you — it comes up when you point `model`
at a different thinking model, or set `"think"` yourself.

**It is much slower than the table says** — another model is probably still loaded and holding
your VRAM. Unload it and re-run; a timing taken while something else holds the GPU is not a
measurement. Check with `curl http://127.0.0.1:11434/api/ps`.

**A key keeps showing as a suspect after you fixed it** — the review page retires probe
entries automatically, but hand-editing the JSON does not. Delete that key from
`<lang>.probe.json` or re-run `--probe`.

**Everything is flagged `untranslated`** — check that your `sourceLanguage` and `targets` are
not the same, and that your glossary is not swallowing the whole string.

**A correct translation is flagged anyway** — two different causes, two different fixes.

If it is a *brand or technical term* (`Tauri`, `Vue 3 + Pinia`, a model id, `tokens`), add it to
`glossary.doNotTranslate`. That is not a workaround: it also shields the term from the model
during translation, which is what you wanted anyway. On the JustWrite catalogue this alone took
`untranslated` from 11 findings to 7.

**But only if the term must never be translated *anywhere*.** The glossary is not just a
substitution — every term also goes into the system prompt as `never translate these terms`, and
the model applies that to lowercase and inflected forms the substitution itself would never
touch. So a word that is a label in one string and ordinary prose in another will bleed. Both
halves of that were measured on the 1,965-key JustWrite run:

- Adding `AI` turned **48 correct translations into findings**. "Exclude from AI" must become
  "Excluir de la IA"; there is no way to shield the acronym and still allow that.
- `Strands` — a genuine product name — made the model write "la Strand narrativa" for "the
  narrative strand", even though `shield()` is case-sensitive and word-bounded and so never
  substituted anything there. The instruction did it, not the substitution.

The test: *would you be unhappy to see this word translated in a full sentence?* If no, keep it
out of the glossary and accept the label instead.

If it is a *word that is genuinely the same in both languages* — Spanish `No`, `Error`, `ID`,
`total` — that is a judgement only you can make, so make it once with **correct as-is** or
`--accept` (see step 3b). The flags are a worklist, not a verdict.
