# just-ai-help v2 — the complete design, as an executor plan — NOT LAUNCHED

Written by the planner (Fable) on the user's order 2026-07-27 ("rethink on solution, design
it for opus to execute"). **Launches only on the user's literal "go".** Executor: Opus.
Every decision is CLOSED here; any case this plan does not decide → STOP, collect it under
OPEN QUESTIONS in the report, do not improvise. The evidence base for every decision is
`justwrite-app/docs/plans/2026-07-26-i18n-single-source-research.md` (the R3 CORRECTION
section onward) — read it first.

## The design, final

Three layers, one Node repo, zero Python, no framework, no hosted service:

```
Layer 1  TRANSLATE   the batch loop. Commodity. Adopted if a candidate passes the
                     spike (STEP 2); otherwise OURS per the spec in STEP 3 — small,
                     because the valuable part was never the loop.
Layer 2  VERIFY      our checks. THE differentiator — nothing on npm does content QA
                     (verified 2026-07-27); pofilter's 48 tests are the SPEC, implemented
                     in Node. Includes the per-language conventions table.
Layer 3  REVIEW      triage + a single-file local web page. Flagged rows first, edit,
                     save, re-check. No accounts, no DB — the JSON files are the state.
```

Function 2 (docs → lede/hints extraction) is **explicitly OUT of this plan** — its own
plan after the translation core is solid.

### What changed from the v1 shape, and why (the rethink)

1. **The GPL fork is no longer the long-term base.** Two measured facts killed it: its
   self-verification pass — the 1,269-line argument for adopting it — is BLIND to the
   defects that matter (qwen3's run passed verification 40/40 while missing the opening
   `¿` 5/5 times and leaving "autosave" in English) AND it dominates cost (945 of
   TranslateGemma-12B's 1,145 s was verification). What's actually load-bearing
   (batching, placeholder shielding, retry, cache, diff) is small. Every failure today —
   `--think`, `chat_template_kwargs`, stale model ids, wrong rate limits — was one
   disease: *the tool owns the request body and we can't reach it*. The cure is owning
   the request body.
2. **One candidate earns a spike before we build: Lingo.dev CLI** (Apache-2.0 LICENSE —
   a permissive licence like MIT, NOT the Apache server; it is `npm install lingo.dev`,
   pure Node). 5,401 stars, pushed 2026-07-24, BYO-LLM incl. Ollama, lockfile delta.
   The user's standing rule is adopt-first; the spike has mechanical pass criteria so
   the decision is data, not taste.
3. **The review UI is ours and tiny.** intlayer's editor verified unable to read
   external vue-i18n JSON (its docs: it writes Intlayer content-declaration files).
   Crowdin dropped by the user (BYOK — doesn't solve the engine problem). The UI's
   value is displaying OUR flags; an adopted editor discards exactly that.

### Rejected alternatives (do not re-litigate; reasons recorded in the research doc)

- json-autotranslate — OpenAI endpoint hardcoded (`openai.ts:317`); DeepL-free closed to
  new signups. Google-Translate backend reachable through it remains a FUTURE cloud row
  only if the user ever creates a GCP billing account.
- Crowdin / locize / Tolgee — hosted TMS; BYOK / 27× too small / heavier than the problem.
- intlayer — wants to BE the i18n framework; editor can't read external JSON.
- LTEngine (Rust) — heaviest install of all candidates (source build: Rust+clang+CMake),
  LibreTranslate API shape, and its own docs list no glossary / no placeholder handling —
  the two axes every quality failure today was on.
- NMT engines (NLLB / opus-mt) — instruction-blind at the sizes that fit; TranslateGemma
  4B translated the brand (`Strands→Hilos`); 12B is clean but 1,145 s and doesn't fit 8 GB.
- Gemini free as a real engine — measured quota `GenerateRequestsPerDayPerProjectPerModel-
  FreeTier` = **20/day**. Smoke-test row only.
- Mixing Python (pofilter) — user ruling: ONE language. pofilter's test list is the spec;
  its code stays out.

### Measured constants the plan builds on (do not re-measure)

40-key stress corpus (`i18n-proto` scratchpad; regenerate deterministically from JW
`en.json` if lost — 8 plural pipes, 20 interpolations, 10 long slot paragraphs, 7 glossary
keys, 15 short labels). Results 2026-07-27: Gemini 3.6 Flash clean/94 s; qwen3:8b
structurally clean/205 s but 5/5 missing `¿` + 1 untranslated word; Gemma-26B 1
identical-halves plural bug/147 s; TranslateGemma 12B clean/1,145 s; 4B glossary+key
failures/81 s. Thinking-off = 13× faster but corrupted `{n}`→`{nota}`. Full system ≈
4,729 strings / 26,697 words / 157,438 chars per language.

---

## STEP 0 — housekeeping (clean trees before design work)

1. `E:\Dev\Web\i18n-ai-translate` (the fork): `git add -A`, one commit — "--think for the
   ollama engine on translate/diff/check + parseThink; prepare script quoted for Windows
   (single-quoted esbuild banner breaks cmd.exe)". It stays as evidence + PR material;
   it is NOT the base going forward.
2. `E:\Dev\Web\just-ai-help`: commit the pending edits (think passthrough in
   translate.js, `"i18n-ai-translate": "file:../i18n-ai-translate"` in package.json).
3. `E:\Dev\Web\justwrite-app`: gate the pending `rewriteDesc` edit — `npm run
   i18n:report` (MISSING must be 0), `npm run test:unit`, `npm run build:vite` — then
   commit it (copy fix, user-approved 2026-07-27 "your rec go").
4. **Push NOTHING.** Unpushed commits exist (runner `8b17baf` `7c3ab00`; JW `32cd687`
   `3e2ad02`); pushing is the user's word. `just-ai-help` has no remote yet — creating
   one is the user's call, flag it in the report.
5. Never touch the user's live `:1420`/`:17495`. Ollama may be started/stopped freely
   (user granted 2026-07-27). Scratchpad for all test junk, never the repo.
6. The Gemini key appeared in chat this session — use env `GEMINI_API_KEY` only, never
   write it to a file, and note in the report that the user may want to rotate it.

## STEP 1 — engines.json truth pass (small, unconditional)

- `gemini-free` note → "SMOKE-TEST ONLY: free tier is 20 requests/day/model (measured
  2026-07-27, quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier). Cannot translate
  a real catalogue." Drop any wording implying adequacy.
- README: remove the untested `gemma3:12b` recommendation line; the local default is
  written by STEP 5's bake-off, not by hand.
- Profile schema v2 (used by both paths): `{ kind: "openai-compat"|"ollama", url, model,
  apiKeyEnv?, headers?, extraBody?, think?, batchSize, rateLimitMs?, timeoutMs,
  maxOutputTokens }`. `extraBody` merges into the request verbatim — the general
  pass-through that would have prevented every failure today (`think:false`,
  `chat_template_kwargs.enable_thinking`, `reasoning_effort` all become data).

## STEP 2 — the Lingo.dev spike (timeboxed, mechanical verdict)

Scratchpad only. `npm install lingo.dev`, configure its BYO-LLM Ollama provider, run the
40-key corpus en→es with qwen3:8b. **PASS requires ALL of:**
(a) runs fully local with NO lingo.dev account/auth;
(b) a documented mechanism to inject the do-not-translate glossary AND a product-context
    line (config or prompt override) — if 30 minutes of docs/source reading finds none,
    that is a FAIL, stop looking;
(c) output passes our `--check-only` structural gate (placeholders 40/40, pipes 8/8,
    glossary 3/3 present);
(d) immediate re-run translates 0 keys (delta works).
Record the verdict + evidence in the research doc either way. Also record (not pass/fail):
whether its request body is shapeable (`think`, extraBody-equivalent).

**PASS → STEP 3A. FAIL → STEP 3B.** No third option; do not attempt to patch lingo.dev.

## STEP 3A — integrate lingo.dev as Layer 1

translate.js execs lingo.dev (child_process, `process.execPath` + its bin — never a
shell string; the Windows quoting lesson). Engine profiles map onto its provider config.
`--check-only`, checks, and everything downstream unchanged. e2e gate: corpus run matches
the fork's measured results. Then retire the fork (leave the repo; remove the `file:` dep).

## STEP 3B — build Layer 1 ourselves: `src/loop.js` (~400–500 lines, zero new deps)

Node 20+ global fetch only. Spec — every decision closed:

- **Shielding:** swap each interpolation (config prefix/suffix regex) for `⟦0⟧`,`⟦1⟧`…
  before send; restore by index after; count mismatch after restore = item failure →
  retry path. Plural pipes translate as ONE unit (never split halves — all engines kept
  pipe structure today when shown whole strings).
- **Prompt (verbatim; one template, slots filled from config):**
  system: `You are a professional software-UI translator, {source}→{targetLang}. Rules:
  tokens like ⟦0⟧ are untouchable placeholders — reproduce each exactly once; never
  translate these terms: {doNotTranslate}; {conventionsLine}; a string containing " | "
  holds plural forms — translate each half and keep the separator; output ONLY JSON
  matching the schema.` user: `Context: {context}. Translate items: [{id, text}…]`.
  Temperature 0.2.
- **Transport:** `kind:"ollama"` → POST `{url}/api/chat` `{model, messages, stream:false,
  format:<json schema {items:[{id:int, translation:string}]}>, think:<profile.think,
  omit if undefined>, options:{temperature:0.2}}`. `kind:"openai-compat"` → POST
  `{url}/v1/chat/completions` with `response_format:{type:"json_schema",…}` +
  `...extraBody`. Both request shapes were proven accepted today (llama-server + Gemini
  native + Ollama).
- **Batching/retry:** batch 16 (profile override); malformed JSON or missing ids →
  retry batch ×3 → then singletons ×2 → then leave key untranslated (checks flag it;
  NEVER silently skip — and exit non-zero, the dependency's silent-skip bug class).
- **Cache/delta:** `.jah-cache.json`: sha1(source|lang|contextHash|glossaryHash) →
  translation. Skip keys whose target exists AND hash matches. `--force` overrides.
- **Gate:** corpus with qwen3:8b must meet or beat the fork's measured line: 40/40
  translated, placeholders 40/40, pipes 8/8, glossary 3/3, and wall time ≤ 1.5× the
  fork's 205 s. Then delete the `file:` dep (fork retired).

## STEP 4 — Layer 2 expansion (pofilter-as-spec, in Node)

Existing checks stay (missing / placeholders / glossary-kept / plural-halves-differ /
identical-to-English). Add, each as a small pure function + a crafted-bad-file test that
proves it BITES: `startpunc/endpunc` driven by `src/conventions.json` (ship **es only**:
`{"es":{"pairedPunct":[["¿","?"],["¡","!"]]}}` — do NOT invent other languages' rules
without the user), `numbers` (digits in source appear in target), `brackets` (paired
counts match), `blank`, `doublewords`, leading/trailing whitespace parity. Output shape
everywhere: `{key, code, detail}` — this list IS the triage feed. Tests: `node --test`
(built-in runner, zero deps).

## STEP 5 — the local-model bake-off (mechanical selection)

Candidates: `qwen3:8b` (installed) and `gemma3:12b` (pull it). Run the corpus through
Layer 1 with the conventions-aware prompt. Score: (1) structural failures — must be 0;
(2) semantic flags from Layer 2; (3) wall time. Winner = fewest flags among structurally
clean, time as tiebreak; if neither is clean, keep qwen3:8b and record "review required".
Write the winner into the ollama profile + README with the numbers. The rationale for the
prompt line: qwen3's 5/5 `¿` failure is plausibly prompt-fixable; this step tests that
directly rather than assuming either way.

## STEP 6 — full-language proof

Run the FULL JW `en.json` (846 keys) → es with the winning setup, in the background (no
foreground timeout), then `--check-only` + triage report. Deliverable: the real `es.json`
+ flag counts **in the scratchpad + report — do NOT commit es.json into JustWrite** (wiring
Spanish into the app is the user's separate call). This closes "proven on a sample,
unproven at scale".

## STEP 7 — Layer 3: the review page (`src/review.js`)

`node src/review.js config.json --lang es [--port 4780]`. node:http, ONE static HTML
page inline CSS/JS (~150 lines, no framework, no build): GET `/api/data` → keys with
source/target/flags; POST `/api/save {key, value}` → rewrite nested target JSON
(structure rebuilt from the source file's shape so key order is preserved), re-run checks
for that key, return updated flags. Table: flagged rows pinned first with reason chips,
inline textarea, save on blur, counts in the header ("N flagged / M"). Plain styling —
this is a utility, not a product surface. Gate: `node --test` round-trip (nested save
preserves structure byte-stably except the edited value) + endpoint tests; one line in
the report asking the user to look at it once.

## STEP 8 — escalation + docs

- `--escalate <profileName>`: run checks on the existing target → re-translate ONLY
  flagged keys via the named profile → merge → re-check → report before/after flag
  counts. Gate: corpus test with a deliberately corrupted first pass.
- README rewritten to the final architecture with the honest measured tables (including
  qwen3's semantic failures — the structural/semantic split is the day's central finding).
- Full record appended to the JW research doc; one-line tracker update in JW TASKS.md.

## Constraints and stop-conditions

- Commit per step, detailed messages, push nothing. STOP (don't decide) on: any lingo.dev
  behaviour outside the spike criteria; any new language's conventions; anything touching
  JW's app wiring; publishing/remote creation; the upstream PR (user: only after we're
  confident — and note the fork's --think is already superseded if STEP 3B runs).
- USER-OWNED, out of scope: pushes, shipping es.json into JW, the upstream PR timing,
  GitHub remote for just-ai-help, key rotation.
- The 40-key corpus is THE acceptance instrument for every step. If a step's gate fails,
  fix within the step or STOP and report — never wave through.
