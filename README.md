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

> The translating itself is done by [`i18n-ai-translate`](https://github.com/taahamahdi/i18n-ai-translate),
> which does the hard middle well — batching, swapping interpolations out before the model sees
> them, injecting the glossary, and re-querying to verify its own output. If all you need is
> translation, **use that directly**; this wrapper only adds the two things below.

## What this adds

### 1. Engine profiles (`src/engines.json`)

Per-provider facts a generic translator cannot hold. Every field in that file comes from a
real failure, not from documentation:

| field | the failure it prevents |
|---|---|
| `model` | a stale model id 404s. `gemini-2.5-flash` — the id in the dependency's own defaults — is no longer served to new keys, and 19 of 40 keys silently failed |
| `batchMaxTokens` | a **thinking** model returns EMPTY content: deliberation fills `reasoning_content` and the budget is gone before any answer is written |
| `rateLimitMs` | the `chatgpt` engine assumes OpenAI's ~500 RPM. Point it at a provider with a 15 RPM free tier and it burns the whole run on retries |
| `engine` | Google's OpenAI-compatible endpoint returns **bodyless 400s** for this tool's generated `response_format`. Its native API accepts the same work. Compat layers are not equally complete |

Add a provider by adding a row.

### 2. Output checks

The dependency **exits 0 even when it skipped keys** — a broken run and a good run look
identical to CI. So the runner re-reads the files that were written and asserts:

- nothing missing
- placeholders unchanged (`{n}`, `{into}`, named slots)
- `doNotTranslate` terms still in the source language
- plural forms keep their halves — **and the halves differ from each other**

That last one is the only check that catches this, which passes every structural test and is
still wrong:

```
en: "Delete {n} autosave? | Delete {n} autosaves?"
es: "¿Eliminar {n} autoguardados? | ¿Eliminar {n} autoguardados?"
```

## Quick start

```bash
npm install
cp just-ai-help.config.example.json just-ai-help.config.json   # then edit it
export GEMINI_API_KEY=...            # free tier, no card: aistudio.google.com
npm run translate
```

For a local model instead, set `"engine": "local-llamacpp"`, point `OPENAI_BASE_URL` at any
OpenAI-compatible server (llama.cpp, Ollama, LM Studio) and set the model id it serves.

> **Start a local llama.cpp server with `--reasoning off`.** A thinking model returns empty
> content otherwise. This tool does not download or manage an engine — that is a separate
> problem (~1,000 lines of CUDA-build selection and platform unpacking) and deliberately out of
> scope.

## Fixing what it gets wrong

The output is plain JSON in git. Edit it.

Corrections survive re-runs, as long as later runs use the dependency's `diff` mode — give it
the source file before and after your English edits and it translates **only changed keys**,
reading your existing target file first. Add `--dry-run` to get a unified `.patch` of what
*would* change before anything lands.

## Measured

Against a 40-key sample of a real app's catalog — chosen to break things: every plural-pipe
key, 20 interpolations, the long named-slot paragraphs, glossary terms, and short labels.

| | Gemini 3.6 Flash (free) | local Gemma-26B on an 8 GB card |
|---|---|---|
| translated | 40/40 | 40/40 |
| placeholders intact | 40/40 | 40/40 |
| plural halves identical (bug) | 0 | 1 |
| glossary held | 5/5 | 5/5 |
| length vs English | 1.14× | 1.13× |
| time | 94 s | 147 s |

Short labels blow up worst (1.5× on a 10-character nav item), so sidebars overflow before
paragraphs do.
