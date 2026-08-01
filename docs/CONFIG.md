# Configuration — every file, what reads it, who owns it

There are **three** files with real settings in them. Everything else in the tree that ends in
`.json` is either an npm manifest, a document, or output the tool wrote beside your strings.

This page exists because that was not obvious: config had accumulated in several places under
several names, and "which of these do I edit?" had no written answer.

---

## 1. The project config — the only one you write

**One per app whose strings you are translating.** It says where the strings live, which
languages, your glossary and your product context.

**You do not write it by hand. Point the tool at your source file and it writes it:**

```bash
node <just-ai-help>/server/init.js  your-app/src/i18n/locales/en.json
```

That is the whole setup. It finds your project root, creates `your-app/just-ai-help/`, and
writes a config it derived from the strings themselves:

```json
{
  "source": "../src/i18n/locales/en.json",
  "targets": ["es"],
  "context": "",
  "glossary": [],
  "engine": "ollama"
}
```

`engine` names a row in [`engines.json`](#2-serverconfigenginesjson--the-engine-catalogue) and is
written with the shipped default. It used to be omitted, and the next command then died with
`unknown engine "undefined"` — setup that reports success and leaves you unable to run. Change it
with `--engine <row>`, or edit the file. The default lives in `engines.json` as `"default": true`,
so moving it is a data edit.

| | |
|---|---|
| lives | **in the app being translated**, in `just-ai-help/` at its root |
| named | `config.json` — any name works, you pass the path |
| read by | `server/translate.js`, `server/extract.js`, `server/server.js` |
| committed | **yes** — a run without the config that produced it is an anecdote |
| written by | `server/init.js`. **There is no template to copy** |

**`source` names the FILE, not the folder.** Its directory is the locale folder and its filename
is the source language, so one field replaces three and nothing can disagree with anything else.
Point init at `es.json` and Spanish becomes the source, with the other locale files as targets.

What init cannot know is **`context`** — one sentence about your app — and it says so rather
than leaving a silent empty field. It also proposes glossary candidates from recurring
capitalised words and writes **none** of them, because that field is the most dangerous one in
the file (see §1 of the glossary note below).

> There used to be a `docs/config.example.json` you copied by hand. That is the `.env.example`
> pattern used where it does not fit: `.env.example` lives in the *same* repo as the `.env` it
> becomes, and exists because `.env` is gitignored. Neither was true here — you were copying a
> file out of the tool's repo into a different project, then fixing a relative path the example
> itself had wrong. Tools that configure a *different* directory generate the file
> (`eslint --init`, `tsc --init`), and a generator can read your strings, which a template never
> could.

**One folder is the whole footprint.** Everything the tool owns in a host app lives there, and
deleting it leaves the app building and running in every language it already has — you lose only
the translation memory. That is the test of whether the split is right:

```
your-app/
  just-ai-help/
    config.json          es.accepted.json    es.notes.json     ← committed
    .jah-state.json      es.probe.json       .jah-cache.json   ← gitignored
  src/…/i18n/locales/
    en.json  es.json  fr.json                                  ← app assets, nothing else
```

**Four fields.** `locales`, `targets`, `context`, `glossary`. Everything else is either read
from your `en.json` or lives in the review workspace:

| used to be config | now |
|---|---|
| `localesDir`, `sourceLanguage` | derived from `locales` — its folder, its filename |
| `placeholder` | read from `en.json` — `{n}` or `{{n}}` is visible in your own strings |
| `pluralSeparator` | read from `en.json` — and `null` is a real answer |
| engine, key, overrides | a **connection** in `settings.json`, tool-level — set up once, used by every app |

Inference never decides quietly: a run prints what it read, and an explicit value always wins.
The older key names still work, so upgrading does not invalidate a config.

> **The `cd` is gone.** Every path — locales, sidecars, cache, state — resolves against the
> **config file's own directory**, never the shell's. Run from anywhere:

```bash
node path/to/just-ai-help/server/translate.js path/to/your-app/just-ai-help/config.json
```

Until 2026-07-31 `localesDir` was resolved against the working directory. That is why every
command in these docs began with a `cd`, and why running from the wrong folder silently began
with **no cache** and re-translated the entire catalogue — 27 minutes and 464 hand-corrected
keys, on a real run. `server/paths.js` owns this now, and `test/paths.test.js` runs the
resolver from an unrelated directory so it cannot come back.

---

## 1b. `settings.json` — YOURS, in the tool's folder

**Your engine connections, API keys and the name recorded on your approvals.** Tool-level on
purpose: you install this once and point it at as many apps as you like, so a connection is a
property of *you and your machine*, not of any one project. Storing them per-project meant
re-entering the same Ollama URL and the same key for every app.

| | |
|---|---|
| lives | `settings.json`, **inside the tool's own clone** |
| committed | **no** — gitignored, so `git pull` never overwrites your setup |
| written by | the setup screen and the engine panel in the review workspace |

**Not a home-directory dotfile on purpose.** `~/.just-ai-help` and `%APPDATA%` are exactly the
litter that survives an uninstall; deleting this clone has to delete everything it ever wrote,
including your keys.

Which engine a project *uses* stays in that project's `config.json` (`"engine": "ollama"`).
This file only says how to *reach* one — so a project config never carries a credential, and two
apps can use different engines without duplicating your setup.

**The key guard.** `server/settings.js` refuses to save an API key unless `git check-ignore`
agrees the file is ignored. It asks git rather than parsing `.gitignore`, because real gitignore
semantics include parent directories, negation and globs — a hand-rolled parser got that wrong in
the direction that matters.

---

## 2. `server/config/engines.json` — the engine catalogue

**Shipped with the tool. You normally do not edit this.** One row per AI engine: URL, transport,
model id, timeouts, batch size, and per-provider quirks like Ollama's `think` flag. Every field
in it exists because something failed once — a stale model id 404'd 19 of 40 keys, a thinking
model with no token headroom returned empty content, and OpenAI's 120 ms default rate limit was
applied to a provider with a ~15 RPM tier.

**It is DATA ONLY.** Until 2026-07-31 this file carried ~13 KB of `_note`/`_why` prose. That is
gone: which model to run and what it costs you is in [`models.md`](models.md); what each field
means is right here. The rule it broke is the one this page states about `models.json`:
**if nothing parses it, it is prose, and prose belongs in `.md`**.

This file **is** the catalogue and is read directly — there is no copy of it anywhere and no
seeding step, so updating the tool fixes a moved endpoint or a stale model id for everyone.
**Your** choices (which provider, your key, any field you overrode) live in `settings.json` in
the tool's own folder and are never touched by an update.

Add a provider by adding a row here. Change what *you* run by editing a connection in the
review workspace instead.

Read by `server/settings.js` (the workspace) and `server/translate.js` (the CLI).

### The profile schema

PROFILE SCHEMA v2 — the shape the owned translate loop reads. Every field below is DATA, which is the whole point: every failure of 2026-07-27 (--think, chat_template_kwargs, a stale model id, the wrong rate limit) had one disease, that the request body belonged to somebody else and we could not reach it. `extraBody` is the general cure — it merges into the request verbatim, so `think:false`, `chat_template_kwargs.enable_thinking` and `reasoning_effort` become config rather than code.

| field | meaning |
|---|---|
| `kind` | "openai-compat" (POST {url}/chat/completions) or "ollama" (POST {url}/api/chat). Two transports, both proven accepted 2026-07-27. |
| `url` | base URL of the server. No trailing slash. |
| `model` | model id. A value starting "REQUIRED" means the config must supply it — a local server's model id is whatever YOU serve. |
| `apiKeyEnv` | optional. Name of the env var holding the key. Absent = no key needed. The key is never written to a file. |
| `headers` | optional. Extra request headers, merged verbatim. |
| `extraBody` | optional. Merged into the JSON request body verbatim, last. The general pass-through. ONE exception: for kind "ollama", `extraBody.options` is merged one level deep into the built `options` rather than replacing it — otherwise setting num_ctx would silently drop temperature and the output cap. Temperature can be overridden here too; the --probe guard reads the EFFECTIVE temperature of the built request (loop.js effectiveTemperature), so an override to 0 is refused rather than silently measuring nothing. |
| `think` | optional. Ollama's top-level `think` field: false \| true \| "low" \| "medium" \| "high". Omitted when undefined, which leaves the model's own default alone. There is no GLOBAL default — the value belongs to the row, matched to the model that row names, because whether thinking helps is a property of the model and not of the transport. A row naming a thinking model carries `think: false` or it returns empty content; a row naming a non-thinking model omits the field. |
| `batchSize` | how many keys go in one request. |
| `rateLimitMs` | optional. Minimum gap between requests. Omit or 0 for a local server. |
| `timeoutMs` | per-request timeout. Derived from measurement — each row says from what. |
| `maxOutputTokens` | output-token cap for one request. Was `batchMaxTokens`; renamed because it is now ours and it caps output, not a batch. |

### Field notes that are not obvious from the schema

**`gemini-free`**

- `timeoutMs` — 94 s for the entire 40-key corpus, so 120 s per request is roughly 4x the worst single batch.

- Compatibility — The v1beta/openai endpoint returned bodyless 400s to i18n-ai-translate's zod-generated response_format. Owning the request body is exactly what makes that reachable — but it is UNVERIFIED against our own loop.

**`ollama`**

- `default` — The row `init` writes into a new project's config. A marker here rather than a constant in init.js, so the shipped default has exactly one definition and adding a better row is still a data edit. Exactly one row may carry it.

- `think` — `think: false` belongs to THIS row because this row names a thinking model: without it the model returns empty content on every retry, deliberation having consumed the whole 8,192-token budget before any answer was written (measured 2026-07-28 — it is the first thing that happened when the MoE was tried). There is no global default, and the value is per-row for a reason. If you override `model` here, set `think` to suit the model you named: sending `think: false` to a non-thinking model is harmless (verified 2026-07-29 — gemma3:12b answers normally), but sending it to a DIFFERENT thinking model selects a measurably worse mode. Measured 2026-07-27 on qwen3:8b: thinking off is 13x faster (27 s -> 2 s) and it TRANSLATED THE PLACEHOLDER, returning "{nota} nota | {nota} notas" where the thinking run returned "{n} nota | {n} notas".

- `timeoutMs` — the 40-key corpus at batch 16 is 3 requests; the slowest model that finished it took 366 s overall, so ~120 s for a worst batch. 300 s per request keeps headroom for that plus a cold model load, on hardware slower than the 8 GB card these were measured on.

**`ollama-gemma3`**

- `think` — no `think` field, and that is correct for this row: gemma3:12b is not a thinking model, so there is nothing to switch off and the model's own default is the right one.

- `timeoutMs` — same reasoning as the `ollama` row — identical transport, batch and output cap.

**`local-openai-compatible`**

- `timeoutMs` — same reasoning as the ollama row — local generation, smaller batch.

**`groq`**

- `rateLimitMs` — 30 requests/minute published = one per 2s. 2100ms leaves a margin, because a 429 mid-run costs a retry and the whole point of a rate limit field is that the wrong one burns the run — measured on a different provider on 2026-07-27.

### One row per default

Exactly one row carries `"default": true` — the row the setup screen writes into a new
project's config. A marker in the data rather than a constant in `init.js`, so swapping the
recommended default is a data edit like adding a provider. `defaultEngine()` throws if the
count is anything but one, because a silently-wrong default surfaces as a failed run in
somebody else's project.

## 3. `server/config/languages.json` — the language menu

A bare array of BCP 47 codes: the languages the setup screen offers as translation targets.

**Codes only.** The display name for each is derived at runtime from `Intl.DisplayNames` in the
reader's own locale, so no English name is stored here to go stale or be wrong, and the menu
reads correctly for a Spanish-speaking user with nobody translating it.

**It is a menu, not a whitelist** — nothing validates against it, and a code that is not listed
still works if it reaches the config another way.

**Why a file at all:** no runtime API *enumerates* languages. `Intl.DisplayNames` names a code
you already have and `Intl.supportedValuesOf` does not cover languages, so the list has to be
written down, and data belongs in a data file. Regional variants appear only where the split
genuinely changes the translation (`pt`/`pt-BR`, `zh-Hans`/`zh-Hant`, `es`/`es-419`,
`fr`/`fr-CA`); thirty flavours of English would be noise in a menu you use once per project.

Read by `server/server.js` (the setup screen).
## 4. `server/config/conventions.json` — per-language rules

Rules a target language requires regardless of what the source did. Currently Spanish only:
questions and exclamations open with `¿` / `¡`. Two halves — a line injected into the prompt, and
the paired punctuation the checks verify afterwards.

Deliberately tiny — **data only**. The reasoning, the incident that shaped the Spanish rule, and
what you need before adding a language live in [`language-rules.md`](language-rules.md). Short
version: a language is added when someone who knows it says what the rule is, and `pairedPunct`
can only express "the target needs an opening mark the source lacks" — which fits Spanish and
does **not** fit French's spaced punctuation or CJK's full-width forms.

Read by `server/translate.js`, `server/server.js`, `server/terms.js`, `server/accepted.js`.

---

## What the tool WRITES

Two different kinds of file, and they go to two different places on purpose.

**Into your locale folder — app assets, loaded by your app:**

| file | what it is | commit it? |
|---|---|---|
| `<lang>.json` | the translation — **the product**. In production this is the only thing that ships | yes |

**Beside the config — the tool's memory, never loaded by your app:**

| file | what it is | commit it? |
|---|---|---|
| `<lang>.accepted.json` | findings a reviewer judged correct, hashed over (key, code, source, target) so they expire when either string changes, plus `by`/`at` recording who signed off | yes |
| `<lang>.notes.json` | per-key notes from review; sent with that key on its next translation, so a fix found once is not rediscovered | yes |
| `<lang>.probe.json` | the second pass from `--probe` — a measurement | no |

| `.jah-cache.json` | what has already been translated | no |
| `.jah-state.json` | workshop state: review cursor, undo log, staged proposals, confirmation verdicts, run history | no |

**Why the split.** `locales/` has a contract: *these are the app's translations*. Review
artefacts are not — nothing in the app reads them. Keeping them out is not tidiness: the fix
for "adding a language needs three code edits" is to glob that folder, and a plain `*.json`
glob over the old layout registers a phantom language called **`es.accepted`**.

**Upgrading moves nothing.** A project that already keeps its sidecars in `locales/` keeps
using it — the choice is made once for the whole project, so a catalogue is never split across
two folders.

## What is NOT config, despite the extension

`package.json` × 3 — npm manifests. Root is scripts only; `client/` owns the UI dependencies;
`server/` declares none, because it imports nothing but `node:` built-ins.

`client/vite.config.js` — the UI build.

**`docs/models.json` is gone** — it was a reference table of which local model suits which
hardware, read by nothing, and a document written as JSON has no wrapping, no tables and no
links, and shows every edit as one enormous changed line. It is
[`models.md`](models.md) now. The rule it broke is worth stating: **JSON is for what a parser
reads. If nothing parses it, it is prose, and prose belongs in `.md`.**

`.jah-state.json` — not config. Workshop state: your place in a review, undo history,
staged proposals, run history, and engine connections including keys. **Gitignored, and the tool
refuses to save a key unless `git check-ignore` agrees it is.** Deleting it loses your place in a
review and never your work — there is a test asserting the check still passes without it.
