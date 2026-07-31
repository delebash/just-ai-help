# Which model to run

Separate from [`server/config/engines.json`](../server/config/engines.json) on purpose: that
file holds **provider facts** — how to talk to a server. This page holds **model judgement** —
which weights to load. A provider row is config; a model row is a claim about quality, and a
claim needs evidence.

> This was `models.json` until 2026-07-31. Nothing ever read it — it is a document, and a
> document written as JSON has no wrapping, no tables and no links, and shows every edit as one
> enormous changed line. It is Markdown now. **If you add something here, no code cares.**

## The two words that matter: `measured` vs `available`

**`measured`** — it ran the 40-key stress corpus through this tool and the numbers below are its
own. **`available`** — the GGUF exists and the family looks promising. Nothing more.

A larger sibling of a winner is a **candidate, never a recommendation.** TranslateGemma proved
why: the 4B lost a do-not-translate brand name and dropped a key, while its 12B sibling looked
flawless — and then the 12B itself failed structurally once re-measured cleanly. **Promote a row
by running it, not by reasoning about it.**

## How the numbers were taken

Measured 2026-07-28. The discipline is what makes them usable:

- every resident model unloaded (`POST /api/generate {keep_alive:0}`) before each run
- runs strictly sequential

**A timing taken while another engine may hold VRAM is not a measurement.** Hy-MT2-7B read
232.6 s on 2026-07-27 under contention and 36.6 s clean — **6.4× apart**, on a model small enough
that it never leaves the card. The 2026-07-27 figures in git history were all taken without this
discipline, and on RAM running at 2133 MT/s instead of its rated 3600. Both effects are corrected
here.

## How it is scored — real errors, not flag counts

The flagged strings were **read**, not tallied, because the raw count lied in both directions:

- `· {n} tokens` is flagged `untranslated` on every model that correctly left it alone — a false
  positive that penalises the right answer.
- Hy-MT2 escaped that flag only by rewriting it to `· Tokens {n}`, reordering and capitalising for
  no reason. **The check rewarded the worse output.**
- The flagship's single `numbers` flag did not reproduce on a second run: sampling noise.

So the results below give structural failures (always disqualifying) and real errors after
reading, with the raw flag count only where it differs interestingly.

**The corpus:** 40 keys chosen to break things — all 8 plural-pipe forms, 20 interpolations, 10
long paragraphs with named slots, 7 glossary keys, 15 short labels. *Structural* =
placeholders / plurals / glossary / missing. *Semantic* = what only Layer 2 sees, chiefly the
Spanish opening `¿`.

## Disk size does not predict fit

`gemma3:12b` and `translategemma:12b` are **both 8.1 GB**. Measured cleanly they took **166.7 s**
and **366.2 s** for the same 40 keys — and the second one failed structurally, with 2 keys
exhausting every retry.

The clearest case is the other direction: the 26B-A4B MoE is the **largest** thing here at ~15 GB
and among the **fastest**, because only ~4B parameters are active per token. Architecture, context
and offload behaviour decide usability. Disk size tells you almost nothing.

---

## 8 GB tier — and the shipped default

> Measured on an RTX 2070 Super, 8 GB VRAM, 32 GB system RAM at its rated 3600 MT/s, Ollama,
> 2026-07-28.
>
> **VRAM is not the only constraint.** The recommendation is a ~15 GB model that runs on this
> 8 GB card by offloading, so disk and *system* RAM decide whether you can use it at all. Tier
> names on this page are VRAM; the memory the MoE needs is VRAM and system RAM together.

### Recommended — Gemma-4 26B-A4B QAT

```bash
ollama pull hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL
```

| | |
|---|---|
| size | 15 GB |
| status | **measured** |
| engine row | `ollama` — the shipped default |

**Result: 0 structural failures, ZERO real errors, in three placements.** GPU offload 73.8 s
(retest 74.2 s) · genuinely CPU-only 128.8 s · Ollama `num_gpu:0` 132.0 s (retest 131.9 s).
Reproduced 2026-07-29 under the shipped default with no overrides: 69.8 s including a cold model
load, 3 requests, 0 structural, 0 real errors — its one flag being the documented
`· {n} tokens` false positive. Output saved as `.evidence/corpus40-gemma4-moe-es.json`.

**Why.** The most accurate *and* the fastest thing measured here. It beats `gemma3:12b`
(166.7 s) on time even running on the CPU alone, which also leaves the graphics card completely
free. 26B parameters with only ~4B active per token is what a MoE is for.

**It needs `think: false`** — it is a thinking model and returns empty content otherwise, so the
`ollama` engine row carries that field.

**Requires** ~15 GB of memory across VRAM and system RAM, plus the 15 GB download. Measured on
8 GB VRAM + 32 GB system RAM; more VRAM only helps. **16 GB of system RAM with no large card is
the untested case** and may swap — use `gemma3:12b` instead.

> **A correction worth keeping.** Until 2026-07-29 this row said *"not a public Ollama tag —
> supply your own GGUF."* That was wrong in the way that matters. It is not in Ollama's own
> curated library, but `hf.co/<owner>/<repo>:<quant>` is a first-class tag that `ollama pull`
> fetches straight from HuggingFace — the same mechanism the Hy-MT2 row states as an ordinary
> pull command. No manual download, no Modelfile. That false instruction was also the stated
> reason this model was not the default, so **it cost a better default for a day.**
>
> Earlier revisions also called it `gemma-4-26b-a4b-qat`, which is a readable shorthand and not
> pullable. The tag above is the real one, and is what was measured.

### Alternatives

**`gemma3:12b`** — 8.1 GB, measured. *0 structural, 1 semantic flag, **zero real errors** after
reading; 166.7 s.*

The small-download option, and the right pick when ~15 GB will not fit your disk or memory.
Accuracy equals the recommendation — including 0/5 misses on the Spanish opening `¿` across every
run it has had — at 2.3× the time. It **was** the recommendation until 2026-07-29, on the argument
that a ~15 GB download should not be the default; that argument fell over when the MoE's supposed
manual-download requirement turned out to be one ordinary `ollama pull`. Use the `ollama-gemma3`
engine row.

```bash
ollama pull gemma3:12b
```

**`hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M`** — 4.6 GB, measured. *0 structural, 3 semantic flags,
**2–3 real errors**; 36.6 s (retest 37.8 s) — by far the fastest.*

The speed option, and it costs correctness. It misses the Spanish opening `¿` **on the same key on
both runs** — the identical reproducible failure that disqualified qwen3:8b, with the rule in the
same system prompt, so it is a model property and not prompt-fixable — and one run invented the
noun `proyectos` in an otherwise fluent sentence, dropping a closing parenthesis with it. Twice as
fast as the flagship and the least accurate model that finished. **Reasonable if you will review
with `--probe` and the workspace; wrong if you plan to ship it unread.**

```bash
ollama pull hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M
```

**`qwen3:8b`** — 5.2 GB, measured. *0 structural; misses the opening `¿` (1 of 5, then **5 of 5**
on a second run) plus three genuinely untranslated keys; 111.1 s.*

The cautionary tale that started the structural/semantic split: it passes every structural check
and is measurably **unreliable** on Spanish punctuation — unreliable rather than simply wrong,
which is worse to plan around. Superseded on every axis by Hy-MT2-7B (faster, smaller) and
gemma3:12b (accurate).

### Avoid

**`translategemma:12b`** — 8.1 GB. **DISQUALIFIED.** 38/40 keys, 2 keys exhausted every retry
(`missing` — a structural failure), 23 requests of retry-and-split, 366.2 s.

It had been the only local model with zero flags of any kind, rejected solely on a 1,145 s
runtime — **and that result does not reproduce.** Measured cleanly it fails structurally. Kept
here as the reason `measured` means measured *recently* and under controlled conditions: a good
result taken under contention is not evidence.

**`translategemma:4b`** — 3.3 GB. 39/40 keys, translated the do-not-translate brand `Strands` to
`Hilos`, lost a plural pipe.

The specialised-model trap. Translation-tuned, and at 4B it lacks the instruction-following to
honour a glossary — **it faithfully translates the thing you told it not to.**

---

## 4 GB and under — no recommendation

Nothing here is measured. The only small model tested at all, `translategemma:4b`, **failed** — so
this tier has no recommendation rather than a guess. **Use a cloud engine if this is your
hardware.**

Candidates worth running: Hy-MT2-1.8B (first-party Tencent GGUF) and `gemma3:4b`. Note that the
7B of that same family already misses the Spanish `¿` reproducibly, so expect the 1.8B to need
review.

## 16 GB — inherited, not measured

**Recommended: the same MoE as the 8 GB tier**, which is also the shipped default.

No 16 GB card here, so nothing is measured *on* one and the recommendation is inherited rather
than tier-specific. The evidence: the MoE ran clean with zero real errors at 73.8 s **while
offloading** on an 8 GB card, and 16 GB of VRAM removes some or all of that offload — it can only
help. A run on this tier would add a number, not a different answer.

| candidate | status | why |
|---|---|---|
| `hf.co/tencent/Hy-MT2-30B-A3B-GGUF:Q4_K_M` | available | first-party Tencent GGUF, a 30B MoE with ~3B active. **Caveat:** the 7B of this family has a reproducible Spanish `¿` failure — verify before trusting the family |
| `gemma3:27b` | available | larger sibling of the model that is clean at 8 GB |

## 24 GB and above — untested

Listed so users with the hardware know where to look, explicitly **not** as recommendations.

| candidate | status | why |
|---|---|---|
| `hf.co/tencent/Hy-MT2-30B-A3B-GGUF:Q8_0` | available | the same MoE at a higher quant |
| Tower-Plus-72B (mradermacher GGUF quants) | available | Unbabel's translation-specialist family at its largest. The GGUFs are third-party quants; the first-party release is safetensors |

---

## Cloud

**`gemini-3.6-flash`** — measured. *40/40, 0 structural, 0 semantic, 94 s — the best
quality-per-second measured here.* Taken 2026-07-27 and not re-measured in the clean 2026-07-28
set, because one corpus run is 3 of the 20 daily requests.

**And unusable for real work:** the free tier is **20 requests per day per model**, and one
846-key catalogue is 36 requests. Use it to prove a config, not to translate a product. A paid
tier or the `openai` row removes the limit, and the reasoning above stops applying.
