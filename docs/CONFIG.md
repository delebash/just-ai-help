# Configuration — every file, what reads it, who owns it

There are **three** files with real settings in them. Everything else in the tree that ends in
`.json` is either an npm manifest, a document, or output the tool wrote beside your strings.

This page exists because that was not obvious: config had accumulated in several places under
several names, and "which of these do I edit?" had no written answer.

---

## 1. The project config — the only one you write

**One per app whose strings you are translating.** It says where the strings live, which
languages, your glossary and your product context.

| | |
|---|---|
| lives | **in the app being translated**, beside its `package.json` |
| named | `just-ai-help.config.json` by convention — any name works, you pass the path |
| read by | `server/translate.js`, `server/extract.js`, `server/server.js` |
| committed | **yes** — a run without the config that produced it is an anecdote |
| template | **[`config.example.json`](config.example.json)** — copy it, it is annotated |

```bash
cp docs/config.example.json  path/to/your-app/just-ai-help.config.json
```

The example is not reproduced here on purpose. A second copy of it in this file is a second
thing to keep in step, and that is exactly the failure this page was written about — the
example's own engine list had already drifted, naming five engines when eight ship.

**Four fields.** `locales`, `targets`, `context`, `glossary`. Everything else is either read
from your `en.json` or lives in the review workspace:

| used to be config | now |
|---|---|
| `localesDir`, `sourceLanguage` | derived from `locales` — its folder, its filename |
| `placeholder` | read from `en.json` — `{n}` or `{{n}}` is visible in your own strings |
| `pluralSeparator` | read from `en.json` — and `null` is a real answer |
| engine, key, overrides | a **connection** in the workspace, so a key is never in a committed file |

Inference never decides quietly: a run prints what it read, and an explicit value always wins.
The older key names still work, so upgrading does not invalidate a config.

> **The `cd` is gone.** Every path — locales, sidecars, cache, database — resolves against the
> **config file's own directory**, never the shell's. Run from anywhere:

```bash
node path/to/just-ai-help/server/translate.js path/to/your-app/just-ai-help.config.json
```

Until 2026-07-31 `localesDir` was resolved against the working directory. That is why every
command in these docs began with a `cd`, and why running from the wrong folder silently began
with **no cache** and re-translated the entire catalogue — 27 minutes and 464 hand-corrected
keys, on a real run. `server/paths.js` owns this now, and `test/paths.test.js` runs the
resolver from an unrelated directory so it cannot come back.

---

## 2. `server/config/engines.json` — the engine catalogue

**Shipped with the tool. You normally do not edit this.** One row per AI engine: URL, transport,
model id, timeouts, batch size, and per-provider quirks like Ollama's `think` flag. Every field
in it exists because something failed once — a stale model id 404'd 19 of 40 keys, a thinking
model with no token headroom returned empty content.

Since 2026-07-31 this file is a **seed**, not live config. On every start its rows are loaded
into the `providers` table of `.jah.db`, replacing it wholesale — so updating the tool fixes a
moved endpoint for everyone. **Your** choices (which provider, your key, any field you changed)
live in the `connections` table and are never touched by that reseed.

Add a provider by adding a row here. Change what *you* run by editing a connection in the review
workspace instead.

Read by `server/db.js` (seeding) and `server/translate.js` (the CLI path).

## 3. `server/config/conventions.json` — per-language rules

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
| `.jah.db` | workshop state and your keys | no |

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

`.jah.db` — not config. It is the review workspace's store: your place in a review, undo history,
staged proposals, run history, and engine connections including keys. **Gitignored, and the tool
refuses to save a key unless `git check-ignore` agrees it is.** Deleting it loses your place in a
review and never your work — there is a test asserting the CI gate still passes without it.
