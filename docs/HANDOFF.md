# HANDOFF — 2026-07-28, session end (user rebooting to enable XMP)

Read this first in a new session, then `README.md`, then the research record in
`justwrite-app/docs/plans/2026-07-26-i18n-single-source-research.md` (the "R3 CORRECTION"
section onward is the evidence base for every decision here).

## THE FIRST THING TO DO

**The user is rebooting to enable XMP/DOCP.** Their DDR4-3600 kit (`F4-3600C16-16GVKC`,
2×16 GB, correctly in Channel A + B, MSI MAG B550 TOMAHAWK MAX WIFI) was running at
**2133 MT/s** — the JEDEC fallback, i.e. the profile was never enabled. That is
**34.1 GB/s where the hardware is rated for 57.6 GB/s**, a 69% bandwidth increase sitting
in a BIOS menu.

Verify it took:

```powershell
Get-CimInstance Win32_PhysicalMemory | Select-Object Speed,ConfiguredClockSpeed
```

3600 = it worked. Still 2133 = A-XMP not saved. 3200 = they fell back, which is fine.

**Why it matters beyond tidiness:** LLM decode is almost purely memory-bandwidth-bound, and
their daily driver (`gemma-4-26b-a4b-qat`, 13.3 GB) does not fit their 8 GB card, so it
streams offloaded layers through exactly that RAM. **Every desktop CPU number in our docs was
measured on a misconfigured machine** — including the "pure CPU is not viable" verdict
(`justwrite-app/docs/plans/2026-07-22-igpu-research-and-cpu-band-recovery.md:253`), which rests
on 9.4 tok/s decode and 53 s cold TTFT measured at 2133. That verdict may deserve reopening,
and if a modern CPU + 32 GB really can run the flagship at reading speed, JustWrite's hardware
floor drops from "needs a decent GPU" to "needs 32 GB of RAM" — a product-scope question, not
a benchmark one.

## THE RUN THAT WAS INTERRUPTED

`gemma-4-26b-a4b-qat` (the user's flagship MoE) on the 40-key corpus — **staged but never
completed**. It is the most promising untested candidate: under the OLD pipeline it was the
FASTEST local model measured (147 s vs gemma3:12b's 219-227 s), because it is 26B with only
~4B active, and its single defect then was one identical-halves plural — exactly the class
that shielding now prevents by construction.

It failed at startup with `500 … model name=gemma-4-26b-a4b-qat failed to load` after 21 s,
because Ollama still had `qwen3:14b` (9.2 GB) resident in VRAM. **Two engines cannot share
8 GB.** Unload Ollama first (`POST /api/generate {"model":"…","keep_alive":0}`), THEN start
llama-server. `.evidence/` has nothing for this model yet; `mt-bakeoff/flagship-moe/server.err`
in the scratchpad (7 KB) was never read and may hold a different cause.

Staged config: `C:\Users\danel\.claude\jobs\5b32e070\tmp\mt-bakeoff\flagship-moe\config.json`
(engine `local-openai-compatible`, url `http://127.0.0.1:8080/v1`, model `gemma-4-26b-a4b-qat`).
Runner script: `mt-bakeoff/run-flagship.ps1` — it starts llama-server from the user's own
tuned `models.ini` with `--reasoning off`, runs, and stops the server.

**Re-run it AFTER the XMP change** — the result is now also a bandwidth measurement.

## STATE OF THE REPOS

| repo | branch | state |
|---|---|---|
| `just-ai-help` | `main` | **ahead 1** (`c5e49a5` models.json) — published at github.com/delebash/just-ai-help |
| `justwrite-app` | `claude/book-layout-…` | clean + 1 modified doc, committed below |
| `just-llm-runner` | same | clean, level with origin |
| `i18n-ai-translate` | `master` | **ahead 1**, and `origin` is **taahamahdi's** repo — do NOT push. Needs the user's own GitHub fork before any PR. Its `--think` work is likely superseded now that we own the loop. |

## MEASURED RESULTS — do not re-measure these

Preserved in `.evidence/` (gitignored) because the scratchpad may not survive:
`corpus40-en.json` (the 40-key stress corpus), plus the es output from Gemini, gemma3:12b,
qwen3:8b and Hy-MT2-7B; and `jw-846-keys-es-after-escalate.json` + its run log.

**40-key corpus** (all 8 plural pipes, 20 interpolations, 10 slot paragraphs, 7 glossary keys,
15 short labels):

| engine | structural | semantic | time |
|---|---|---|---|
| Gemini 3.6 Flash (cloud) | 0 | 0 | 94 s — but 20 requests/DAY, smoke only |
| **gemma3:12b** (current default, 8.1 GB) | 0 | 1 and 2 | 219-227 s |
| **Hy-MT2-7B** (first-party Tencent GGUF, **4.6 GB**) | 0 | 2 | 233 s |
| qwen3:8b (5.2 GB) | 0 | 3 and 7 | 116-160 s |
| translategemma:12b (8.1 GB) | 0 | 0 | 1,145 s |
| translategemma:4b (3.3 GB) | **FAIL** — translated `Strands`→`Hilos`, dropped a key | | 81 s |
| gemma-4-26b-a4b-qat | (old pipeline) 1 plural bug | | **147 s — fastest** |

**Hy-MT2-7B is tied with the default at 57% of the disk size** — one run does not unseat a
two-run winner, so a SECOND Hy-MT2 run is the cheap way to settle the 8 GB tier.
`qwen3:14b` was abandoned (9.3 GB on an 8 GB card; and the family's ¿ weakness is known).

**Full 846-key JW catalogue**, gemma3:12b: 846/846 in 52 min, 56 requests, **zero** placeholder
/ plural / glossary / missing failures, 0 of 16 real questions lost their ¿. After the
conventions fix + `--escalate`: **99 findings → 23, 63 keys → 18**.

## WHAT REMAINS, in priority order

1. **Verify XMP, then re-run the flagship MoE** (above). Possibly re-run one CPU-only bench leg.
2. **Second Hy-MT2-7B run** → settle the 8 GB default; update `src/models.json` + README.
3. **Function 2 — the docs → `lede:`/`hints:` extraction.** THE reason this repo exists per the
   user's own framing ("function 1 alone wouldn't justify a repo"). Entirely unbuilt.
4. **The 18 flagged keys** — `node src/review.mjs config.json --lang es`. First real use of the
   review page; also tells us whether the triage UI is any good.
5. **The conversion sweep.** Spanish exists for the 846 converted keys, but the census
   (research doc R1) says ~1,719 JW strings are still hardcoded, plus 613 in the kit and 1,551
   in JustVoice. The pipeline is solved; the conversion is not.
6. **`LICENSE` files.** All three public repos declare GPL-3.0-or-later in metadata and ship no
   LICENSE file — legally that grants nobody anything. User's call, not done.

## USER-OWNED — never do these unasked

Pushing `just-ai-help` (1 commit waiting) · any PR to the i18n-ai-translate upstream ·
shipping `es.json` into JustWrite · rotating the Gemini API key that passed through chat ·
adding LICENSE files.

## TWO PROCESS LESSONS FROM TODAY — worth not repeating

**Check processes properly.** Twice I inferred process state from an indirect signal and was
wrong both times: I called the executor's healthy 846-key run "stalled" (it was 68% done; its
output was buffered in a `tail` pipe) and killed it, and I called my own qwen3:14b run dead
because a bash `ps` couldn't see Windows processes — it was alive, and my "replacement" run
then competed with it for the GPU until both timed out. Use
`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` and read the CommandLine.

**Never let two runs share one GPU.** Unload/stop the first engine explicitly and verify VRAM
is free (`GET /api/ps` for Ollama) before starting the second.
