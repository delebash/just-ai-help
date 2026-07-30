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
npm test            # 65 tests, should all pass
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

Full numbers and the reasoning: `src/models.json`.

### Or use an online model

```bash
export GEMINI_API_KEY=...        # free, no card: aistudio.google.com
```

Set `"engine": "gemini-free"` in your config. **Use this to prove your setup works, not to
translate a real catalogue** — the free tier allows 20 requests per day per model, and one
846-key catalogue is about 36 requests. For real online use, set `"engine": "openai"` (or any
OpenAI-compatible provider) with a paid key.

**When online is the right call:** you have no usable GPU, you need it done in minutes rather
than an hour, or you are translating into a language your local model handles badly. Otherwise
local is free, private, and good enough — that is the whole point of the measurements.

---

## 3. Configure it

```bash
cp just-ai-help.config.example.json just-ai-help.config.json
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
- **`engine`** — which row of `src/engines.json` to use. `"ollama"` is local with the default
  26B MoE; `"ollama-gemma3"` is local with the smaller `gemma3:12b`; `"gemini-free"` and
  `"openai"` are online. Each row already carries the right settings for the model it names, so
  switching model by switching *engine* is the option that cannot go wrong.
- **`model`** — overrides the engine row's model, e.g. `"model":
  "hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M"`. If the model you name is a *thinking* model, add
  `"think": false` too, or it will return nothing (see troubleshooting).

---

## 4. The workflow

```bash
node src/translate.js config.json                  # 1. translate what changed, then check
node src/translate.js config.json --probe          # 2. (optional) second opinion on meaning
node src/review.js    config.json --lang es        # 3. fix what got flagged
node src/translate.js config.json --check-only     # 4. in CI: verify, no engine needed
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

**3 — Review.** Opens `http://localhost:4780`. Flagged rows are pinned to the top with the
reason attached; edit in the box, it saves when you click away and re-checks that key. The
JSON files are the only state — no database, no account. You can also just edit the JSON.

**4 — CI.** `--check-only` re-runs every check against the files already committed. No engine,
no network, no API key. It exits non-zero if anything is wrong.

**Escalate (optional).** If a cheap model left a handful of bad keys, re-do *only those* with
a better one:

```bash
node src/translate.js config.json --escalate gemini-free
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
node src/extract.js config.json            # writes lede.* and hints.* into en.json
node src/extract.js config.json --check    # CI: fails if they are stale
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

**A correct translation is flagged anyway** — some checks report a false positive on strings
that are the same word in both languages (`· {n} tokens`). Read the flagged string before
believing the count; the flags are a worklist, not a verdict.
