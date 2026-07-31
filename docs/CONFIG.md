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
| template | [`just-ai-help.config.example.json`](../just-ai-help.config.example.json) at the repo root |

```jsonc
{
  "localesDir": "src/renderer/src/i18n/locales",  // relative to your CURRENT DIRECTORY
  "sourceLanguage": "en",
  "targets": ["es"],
  "placeholder": { "prefix": "{", "suffix": "}" },
  "pluralSeparator": "|",
  "context": "JustWrite, a desktop app for writing novels",
  "glossary": { "doNotTranslate": ["JustWrite", "Tauri", "Vue"] },
  "engine": "ollama"
}
```

> **Known sharp edge.** `localesDir` resolves against the directory you run from, **not**
> against the config file. That is why every command needs a `cd` into the project first, and
> why a config cannot yet live in a shared folder. It is a real bug, not a convention.

Run it with:

```bash
cd path/to/your-app
node path/to/just-ai-help/server/translate.js just-ai-help.config.json
```

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

Deliberately tiny. Its own header warns that language rules written from memory are "exactly how
a confident wrong rule ends up applied to every future translation" — a language is added when
someone who knows it says what the rule is.

Read by `server/translate.js`, `server/server.js`, `server/terms.js`, `server/accepted.js`.

---

## What the tool WRITES beside your strings

These appear in your `localesDir`, next to `en.json`. You do not create them.

| file | what it is | commit it? |
|---|---|---|
| `<lang>.json` | the translation — **the product** | yes |
| `<lang>.accepted.json` | findings you judged correct, hashed over (key, code, source, target) so they expire when either string changes | yes |
| `<lang>.notes.json` | per-key notes you wrote during review; sent with that key on its next translation | yes |
| `<lang>.probe.json` | the second pass from `--probe`, used to find keys the model was unsure about | no |

## What is NOT config, despite the extension

`package.json` × 3 — npm manifests. Root is scripts only; `client/` owns the UI dependencies;
`server/` declares none, because it imports nothing but `node:` built-ins.

`client/vite.config.js` — the UI build. `docs/models.json` — a reference table of which local
model suits which hardware; **nothing reads it**, it is a document that happens to be JSON.

`.jah.db` — not config. It is the review workspace's store: your place in a review, undo history,
staged proposals, run history, and engine connections including keys. **Gitignored, and the tool
refuses to save a key unless `git check-ignore` agrees it is.** Deleting it loses your place in a
review and never your work — there is a test asserting the CI gate still passes without it.
