# The engines — which provider, what it costs, how to set it up

One row per engine in `server/config/engines.json`. That file holds **data only**; everything
here used to live inside it as `_note`/`_why` keys until 2026-07-31, and moved because **JSON is
for parsers — if nothing reads it, it is prose**.

| for | read |
|---|---|
| which **local model** suits your machine | [`models.md`](models.md) — organised by memory tier |
| what each **config field** means | [`CONFIG.md`](CONFIG.md#2-serverconfigenginesjson--the-engine-catalogue) |
| which **provider** to use and how to connect | this page |

**Set a connection up in the app** — `npm start`, Setup tab, Engine. The row here names a
provider; a *connection* is your copy of it with your key and any field you changed. A tool
update rewrites rows and never touches connections.

> **`measured` vs `available`.** A row that has been run against the 40-key corpus carries
> numbers. A row that has not says so. The difference matters more than any recommendation:
> a stale model id once 404'd 19 of 40 keys, so nothing here is written from memory.

---

## Local — free, private, slower

### `ollama`

**Model:** `hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL`  ·  **Transport:** `ollama`

THE recommended local option: one install, `ollama pull <model>`, done. No API key. Uses Ollama's NATIVE /api/chat, not its OpenAI-compatible /v1 — compat layers are consistently less complete than native APIs. maxOutputTokens is raised from Ollama's own default of 2048, which starves a thinking model: deliberation eats the budget and the answer is never written.

**Why this model.** The 26B-A4B QAT MoE is the default because it was the most accurate AND the fastest thing measured: 0 structural failures and ZERO real errors in three placements — GPU offload 73.8 s (retest 74.2), genuinely CPU-only 128.8 s, Ollama num_gpu:0 132.0 s (retest 131.9) — against 166.7 s for gemma3:12b, which it therefore beats on CPU alone while leaving the card free. Only ~4B of its 26B parameters are active per token, which is what buys that. Clean re-measurement 2026-07-28, every other model unloaded from VRAM, runs sequential. It is a ~15 GB download; that is a disk cost, not a quality argument, so it does not outrank a measured accuracy win. For a smaller download use the `ollama-gemma3` row. Per-tier detail: docs/models.json.

**Why the full tag.** The model id is the FULL tag, not the shorthand `gemma-4-26b-a4b-qat` that this file and the docs used until 2026-07-29 — a shorthand is not pullable, and writing one here is how a reader ends up believing they must go and find weights by hand. `hf.co/<owner>/<repo>:<quant>` is a first-class Ollama tag: `ollama pull` fetches it from HuggingFace directly, exactly as it does the Hy-MT2 row, and no manual download or Modelfile is involved. Verified 2026-07-29 end to end against this tag: `think:false` returned "Guardar {count} capítulos" for "Save {count} chapters" — translated, placeholder intact.

**Memory.** What gates this model is MEMORY, not the graphics card: 15 GB has to live in VRAM, system RAM, or across both. Measured only on 8 GB VRAM + 32 GB system RAM. More VRAM can only help it. A machine with 16 GB of system RAM and no large card is the untested case and is expected to be tight — nobody has run it, so this is a caveat rather than a number. Switch to `ollama-gemma3` (8.1 GB) if it swaps.

**Setup.**

```bash
ollama serve
ollama pull hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL
```

### `ollama-gemma3`

**Model:** `gemma3:12b`  ·  **Transport:** `ollama`

The same Ollama transport with the SMALL model: 8.1 GB instead of ~15 GB. Use this when disk or memory rules out the default, not when you want the better translation.

**Why this model.** gemma3:12b also finishes the 40-key corpus with ZERO real errors (0 structural, 1 semantic flag) and takes 166.7 s to the MoE's 73.8 s — clean re-measurement 2026-07-28. Equal accuracy, 2.3x the time, half the download. It was the default until 2026-07-29, on the reasoning that a ~15 GB download should not be imposed by default; that was dropped once the MoE's pull command turned out to be a single command like any other and the download the only argument left.

**Setup.**

```bash
ollama serve
ollama pull gemma3:12b
```

### `local-openai-compatible`

**Model:** `REQUIRED — the model id your server serves`  ·  **Transport:** `openai-compat`

Any OpenAI-compatible server — llama.cpp's llama-server, LM Studio, vLLM. Override `url` in your config to match yours. A raw llama-server must be started with --reasoning off (or --reasoning-budget 0), or given the equivalent via extraBody: a thinking model returns EMPTY content otherwise, because deliberation fills message.reasoning_content and the token budget runs out before any answer is written.

---

## Online — fast, costs money or is rate-limited

### `gemini-free`

**Model:** `gemini-3.6-flash`  ·  **Transport:** `openai-compat`

SMOKE-TEST ONLY: the free tier is 20 requests per day per model (measured 2026-07-27, quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier). It cannot translate a real catalogue — 846 keys at batch 24 is 36 requests, so ONE language exceeds a whole day's quota. Use it to prove a config works end to end, then switch engines. Quality when it does run is the best measured here: 40/40 keys, 40/40 placeholders, 8/8 pipes, 0 identical-half bugs, 94 s.

**Compatibility.** The v1beta/openai endpoint returned bodyless 400s to i18n-ai-translate's zod-generated response_format. Owning the request body is exactly what makes that reachable — but it is UNVERIFIED against our own loop.

### `mistral`

**Model:** `REQUIRED — pick one from docs.mistral.ai/getting-started/models, e.g. mistral-small-4-0-26-03`  ·  **Transport:** `openai-compat`

Larger free allowance than Groq on the Experiment tier (~1B tokens/month, reported not measured) — but it REQUIRES opting into training on your data, which is a real cost wearing a free label. Read that before choosing it over Groq.

**Measured.** NOTHING. Never run.

**Verified 2026-07-31.** The endpoint returns 401 rather than 404, so the URL is right. The MODEL ID IS DELIBERATELY 'REQUIRED': Mistral's catalogue is dated (mistral-small-4-0-26-03 and similar) and rotates, and writing a dated id here that expires is exactly the failure this file's first line records. Look it up when you configure it.

**Setup.**

```bash
console.mistral.ai for a key, then set `model` on the connection.
```

### `openrouter`

**Model:** `REQUIRED — a catalogue slug like `meta-llama/llama-3.3-70b-instruct`; a `:free` suffix selects a free variant`  ·  **Transport:** `openai-compat`

One key, many providers' models — useful for trying a different model family against the same catalogue without a new account each time. Published free tier is ~1,000 requests/day across models carrying the `:free` suffix.

**Measured.** NOTHING. Never run.

**Verified 2026-07-31.** Endpoint returns 401 rather than 404. The model id is REQUIRED because OpenRouter's slugs are a live catalogue, not a fixed list — pick one from openrouter.ai/models.

**Setup.**

```bash
openrouter.ai for a key, then set `model` on the connection.
```

### `groq`

**Model:** `llama-3.3-70b-versatile`  ·  **Transport:** `openai-compat`

THE FREE ONLINE OPTION. A Groq key costs nothing and needs no credit card — sign up at console.groq.com with email, GitHub or Google. Published free tier: 30 requests/minute, and ~14,400 requests/day on llama-3.1-8b-instant. The 2,039-key JustWrite catalogue is ~128 requests at batch 24, so a whole catalogue is well inside one day's allowance.

**Measured.** NOTHING. This row has never been run. Every timing and quality claim elsewhere in this file came from a measurement; this one has none, so it is not a recommendation — it is a starting point. Run the 40-key corpus before believing anything about it.

**Verified 2026-07-31.** The endpoint and model ids were checked, not remembered: POST https://api.groq.com/openai/v1/chat/completions returns 401 (exists, wants a key) rather than 404, and `llama-3.3-70b-versatile` / `llama-3.1-8b-instant` are listed as production models in Groq's own docs with 131k context. A stale model id is the failure that 404'd 19 of 40 keys on 2026-07-27, so these were not written from memory.

**Why this model.** llama-3.3-70b-versatile for quality; switch to `llama-3.1-8b-instant` for the much larger daily allowance if you are translating a big catalogue rather than escalating a handful of keys.

**Setup.**

```bash
Get a free key at console.groq.com, then add a connection in the review workspace (or set GROQ_API_KEY).
```

### `openai`

**Model:** `gpt-5.2`  ·  **Transport:** `openai-compat`

UNTESTED here — no key. rateLimitMs is OpenAI's published tier-1 figure, not a measurement of ours.

---

## Adding a provider

Add a row to `server/config/engines.json` — it is data, and a new provider knob is a config
edit rather than a code change, because `extraBody` merges into the request body verbatim.
Then add a section here saying what it is and whether anyone has measured it.

The fields, and what each one is for, are in
[`CONFIG.md`](CONFIG.md#2-serverconfigenginesjson--the-engine-catalogue).

