# The review workspace — design, 2026-07-31

Status: **design, awaiting the user's go to implement.** No production code written.

Supersedes STEP 7 of [`2026-07-27-v2-design-executor-plan.md`](2026-07-27-v2-design-executor-plan.md),
whose spec said *"Plain styling — this is a utility, not a product surface."* That sentence is why
the current page is a table with a textarea, and replacing it is this document's purpose.

---

## 1. The problem

Three stages of this pipeline work and are measured. The fourth does not exist.

| stage | state |
|---|---|
| translate locally | ✅ 2,039 keys, ~52 min including both probe passes |
| flag what looks wrong (`checks.js`) | ✅ 5 flagged on the current catalogue |
| flag what the model was unsure of (`--probe`) | ✅ 200 advisory disagreements |
| re-do flagged keys elsewhere (`--escalate`) | ✅ 36 keys in 2.0 min, fixed 7 of 8 hard defects |
| **a human working through the result** | ❌ **a table with a textarea** |

Today a reviewer runs a CLI, opens a browser, closes it, runs a different CLI. The page cannot
re-translate, cannot show a second opinion, cannot undo an acceptance, and hides everything it has
accepted so those decisions can never be revisited.

## 2. What is verified (evidence, not assertion)

Everything below was run on 2026-07-31, several of it by the user directly. It is short because
each line replaced a guess that turned out wrong.

- **Neither the local model nor an online engine is reliably better.** On `characterAudit.why`
  (EN `"Why:"`) the local model produced `"¿Por qué?"` — wrong — while Google and MyMemory both
  produced `"Por qué:"` — right. On `settings.backups.dataFolderHint` the local model was right and
  both online engines were wrong. **This is why a second opinion is offered and never auto-applied.**
- **Google's widget works embedded**, verified by the user: in a page containing only the string,
  it translates correctly; **`42px` of top-crop removes Google's banner** without touching any
  Google CSS; and the parent page can read the translated text back out (same-origin).
- **Raw MT breaks placeholders.** Google returned `{link}` as `{enlace}`. Reference output must be
  display-only and must never be written to the catalogue unreviewed.
- **Sibling keys settle ambiguity.** `characterAudit.why` was provable as a defect only by seeing
  that its sibling `cheapestFix` renders `"Cheapest fix:"` → `"Solución más económica:"`, the same
  label-with-colon pattern done correctly.
- **Terminology drifts silently and no check catches it.** A hand-written improvement to
  `dataFolderHint` used `guardado automático`, which appears **0** times in the catalogue against
  **15** for `autoguardado`. Nothing in the pipeline would have flagged that.
- **`--probe` is the same model twice**, so a confident error comes back identically and probe
  cannot see it. That is precisely the gap the review surface fills.

> A note on this document's history: earlier revisions asserted several things that testing
> disproved, including a claimed defect taken from `HANDOFF.md` that is **not** in the shipped
> `es.json`. Where this doc states a fact it now names how it was checked.

## 3. The flow, end to end

1. **Translate** — one command, local model, free, private. `--probe` optionally runs a second pass
   to mark keys where the model was unsure.
2. **Check** — runs automatically, no model. Flags structural and convention defects.
3. **Review** — open the workspace. Everything below is this step.
4. **Ship** — the target JSON is a normal file; git is the durable history.

## 4. Governing principle

> **Every engine action produces a PROPOSAL. Only a human writes the target file.**

Nothing an engine emits overwrites a translation. Re-translations and reference readings land in a
staging area and are shown beside the current value; the reviewer keeps or discards. This makes undo
structural rather than bolted on, makes a 50-minute job safe to cancel, and means a placeholder-
mangling MT result can never reach the catalogue.

---

## 5. The interface

### 5.1 Shape

Three regions: a **queue** to choose work from, a **list** to move through it, and a **detail panel**
that holds everything needed to judge one key. List-and-detail rather than an editable table,
because judging a translation needs far more context than a row can carry.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ es ▾  reviewed 12/205  ▓▓▓░░░░░░  │ Re-translate [all flagged ▾] with [gemma3 ▾] ▶ │ ↩ ⚙ │
├──────────────────┬─────────────────────────────┬───────────────────────────────────────┤
│ QUEUE            │ KEYS                        │  characterAudit.why                   │
│                  │                             │  characterAudit ›  why                │
│ ▸ Needs review 5 │ ● characterAudit.why      ⚑ │                                       │
│   spurious-int 1 │ ● indexBuild.unknownShort ⚑ │  ⚑ spurious-interrogative             │
│   endpunc      2 │ ○ strands.bodyPlaceholder   │    a declarative source rendered as    │
│   untranslated 1 │ ○ analysisView.badge…       │    a question                          │
│   startpunc    1 │                             │                                       │
│ ▸ Unsure     200 │ ── accepted (54) ─────────  │  ENGLISH                              │
│ ▸ Missing     30 │ ✓ settings.sections.general │  Why:                                 │
│ ▸ Accepted    54 │ ✓ common.no                 │                                       │
│ ▸ All       2039 │ ✓ …                         │  SPANISH                    ✎ edited  │
│                  │                             │  ┌─────────────────────────────────┐  │
│ [search…]        │                             │  │ ¿Por qué?                       │  │
│                  │                             │  └─────────────────────────────────┘  │
│                  │                             │                                       │
│                  │                             │  SECOND OPINION      [Google ▾]       │
│                  │                             │  ┌─────────────────────────────────┐  │
│                  │                             │  │ Por qué:              [use this]│  │
│                  │                             │  └─────────────────────────────────┘  │
│                  │                             │                                       │
│                  │                             │  ⚠ TERMS  none flagged                │
│                  │                             │  SIBLINGS in characterAudit           │
│                  │                             │   cheapestFix  "Cheapest fix:"        │
│                  │                             │                "Solución más econó…"  │
│                  │                             │                                       │
│                  │                             │  NOTE FOR FUTURE RUNS                 │
│                  │                             │  ┌─────────────────────────────────┐  │
│                  │                             │  │ label above the reasoning, not  │  │
│                  │                             │  │ a question                      │  │
│                  │                             │  └─────────────────────────────────┘  │
│                  │                             │                                       │
│                  │                             │  [✓ Accept]  [↻ Re-translate]  [Skip] │
└──────────────────┴─────────────────────────────┴───────────────────────────────────────┘
```

### 5.2 Languages — all at once, filterable

**Decided by the user, 2026-07-31: review all target languages in one queue, with a filter to narrow
to a single language when wanted. Both modes, one UI.**

Translation across several languages already works and needs nothing built: `config.targets` is a
list and the CLI loops over it (`translate.js:200, 242, 295, 334`), so `["es","fr","de"]` translates,
checks and probes all three from one command — start it Friday, read it Monday.

The **review** side is what changes. Today `createReviewServer({ lang })` binds to one language,
defaulting to `cfg.targets[0]` (`review.js:161-163`). It becomes multi-language:

- the queue counts findings across every target, with a **language filter** (All · es · fr · de) in
  the header;
- every list row carries a language badge, so `characterAudit.why` flagged in three languages is
  three rows;
- the detail panel edits the language of the selected row, and writes to that language's files;
- **bulk actions respect the active filter** — "re-translate all flagged" with the filter on Spanish
  does Spanish only; with the filter off it does every language. The button states which, so a
  fifty-minute job never starts on a scope the reviewer did not mean;
- every database table carries a `lang` column, and acceptances, notes and proposals stay per
  language, as the files already are.

*Recommendation, not decided:* when one key is flagged in several languages, group those rows
together under the key rather than scattering them. The same source string is usually what makes a
key hard, so seeing three languages fail on it together is the fastest route to noticing the English
is at fault. It is a display choice and can be added later without rework.

### 5.3 Queue

Buckets with live counts, every one clickable:

- **Needs review** — everything the checks flagged, then sub-buckets per check code so a reviewer
  can work one defect class at a time (they cluster; ten spurious questions are ten of the same
  decision, and batching them is far faster than context-switching).
- **Unsure** — probe disagreements, sorted by spread. **No `topN` cut.** That limit exists because
  a CLI report must truncate; the last run had 150 disagreements, showed 30, and both real defects
  ranked #22 and #30 of those shown. A scrollable list has no such problem.
- **Missing** — keys in `en.json` with no translation, including any that exhausted every retry.
- **Accepted** — everything signed off, always visible, each reversible in one click. **This is the
  fix for the complaint that started this work.**
- **All keys** — with search.

Search covers key path, English and translation at once.

### 5.4 List

Compact rows: status dot, key path, flag icon. Selection moves with `j`/`k` or arrows. The list is
virtualised so 2,039 keys scroll without lag. Accepted items appear in their own section rather than
disappearing.

### 5.5 Detail panel — the part that does the work

**Why it is flagged.** The check code plus a plain-English explanation of what that check looks for.
A code like `spurious-interrogative` means nothing on its own.

**English source**, with placeholders such as `{link}` visually marked so it is obvious what must
survive.

**The translation**, editable, autosizing, saving on blur. No save button.

**Second opinion**, with an engine dropdown:

| option | cost | account |
|---|---|---|
| **Google Translate** — the verified embedded widget, banner cropped at 42px | free | none |
| **Local second model** (`ollama-gemma3`) | free | none |
| Online LLM, free tier (Groq, Mistral, OpenRouter) | free | free signup |
| Online LLM, paid (user's choice) | ~3¢ for a whole flagged set | user's own |

**Both free AND paid providers appear in this dropdown** — the user asked for both as options. What
paid is *not* is a default: nothing paid is preselected, and none is set up today. Free and paid are
labelled so the distinction is visible at the point of choosing.

The first two are wired first, since both work today and neither needs an account. Each result
renders with a **use this** button that copies it into the translation box — never applied
automatically, because the evidence shows either source can be the wrong one.

**Back-translation** — the current translation rendered back into English, on demand. It catches
wrong-word errors (`autoconservado` reads back as "self-preserved"). It does **not** catch every
class, and the panel says so rather than implying more than it delivers.

**Terminology check** — a new check, earned by evidence. It builds a term-frequency map from the
target file and warns when a string uses a minority variant of a term established elsewhere:
*"uses `guardado automático`; catalogue uses `autoguardado` (15×)."* Nothing in the pipeline catches
this today, and a careful human introduced exactly this defect during design.

**Siblings** — the other keys in the same namespace with their translations. This is how the
`characterAudit.why` defect was actually proven; a reviewer deserves the same view without leaving
the page.

**Note for future runs** — free text saved per key. Written *reactively*, only for keys already
being fixed, so it costs nothing until needed. The note is injected as per-key context on the next
translation of that key, so the fix compounds instead of recurring. This is the answer to "should we
do per-key context": yes, but authored during review, never up front for 2,039 keys.

### 5.6 Actions

Per key: **Accept** · **Unaccept** · **Re-translate** · **Skip** · **Revert edit**. Every one is
undoable and every one shows a toast with an inline **Undo**.

### 5.7 Bulk — the toolbar

Clicking through rows one at a time is the right mode for judging, and the wrong mode for the first
pass over 200 keys. The toolbar carries a scope + engine + go:

```
 Re-translate  [ all flagged ▾ ]  with  [ gemma3 (local) ▾ ]   ▶ Start
                 all flagged (5)
                 selected (12)
                 everything unsure (200)
                 whole catalogue (2039)
```

This is the existing `--escalate` path with a progress bar. It is already measured: 36 flagged keys
re-done on `ollama-gemma3` took **2.0 minutes and fixed 7 of the 8 hard defects**. Running it from
the toolbar is the same work without the CLI.

While it runs the header shows a live progress bar with elapsed time, keys done and requests made,
and a **Cancel** that stops after the current batch. Rows fill in as results land, so reviewing can
start before the job finishes. Closing the tab does not kill it — job state lives on the server and
a reloaded page rejoins (`GET /api/jobs/current`).

**Results arrive as proposals, never as writes** (§4). So a bulk run ends with a review step:
each touched row shows *old → new* side by side, with **Keep mine** / **Use new**, plus
**Apply all** and **Discard all** for the confident cases. A bulk re-translate can therefore never
damage a good catalogue, and cancelling loses nothing.

**Which engines can do bulk.** The local models and any LLM row can. **The Google widget cannot** —
it is a per-row embedded panel by nature. In principle one frame could hold every flagged string and
be read back in one pass, but that is **unverified**, and Google mangles placeholders (`{link}` →
`{enlace}`, measured), so a bulk MT run would produce mostly noise. Bulk is for the local and LLM
engines; Google stays the per-row second opinion.

**Bulk accept** is separate and always available: select rows, accept all. Used most on a check that
is right about the pattern and wrong about the catalogue — the `untranslated` flags on `"No"`,
`"ID"`, `"Error"` were 8 of 9 false positives, and clearing them in one action is the difference
between a gate that goes green and one people stop reading.

### 5.8 Keyboard

Reviewing 200 items by mouse is miserable, so the keyboard is primary:

`j`/`k` move · `a` accept · `u` undo · `e` focus the editor · `g` Google second opinion ·
`r` re-translate · `b` back-translate · `n` note · `/` search · `⌘K` command palette · `Esc` back to list.

### 5.9 Progress

The header shows reviewed-this-session against the queue size, with a bar. Long review sessions
need a sense of movement; a bare count of remaining findings reads as a treadmill.

---

## 6. Undo — three layers, because the complaint had three causes

1. **Nothing destructive by default.** Engine output is a proposal (§4).
2. **A session action log.** Every accept, unaccept, apply, discard and manual edit records the
   previous value. `⌘Z` and the header's undo button pop it; a history panel lists the session.
   Session-scoped by design — the files are git-tracked and git is the durable undo.
3. **Accepted is a visible bucket**, not a void. An acceptance from last week is listed,
   inspectable and reversible.

Acceptance expiry is unchanged and must stay: the hash covers (key, code, source, target), so
editing either string revives the finding. That was proven on the real catalogue.

---

## 7. Storage — a database, and the one boundary that matters

**Decision (the user, 2026-07-31): this becomes a full app with a database, like JustWrite.**
Verified: JW runs SQLite through SQLAlchemy (`justwrite_server/database.py:44`,
`sqlite:///{_db_path}`). This repo is Node rather than Python, so the equivalent is
**`node:sqlite`** — SQLite built into the runtime, **no package to install**. Tested here on
2026-07-31 against Node v26.5.0: create, insert and read all work.

*Cost to name:* `node:sqlite` needs Node ≥ 22 (≥ 24 for the stable API), and `package.json`
currently declares `>=20`. Recommend bumping to `>=24`. The alternative is `better-sqlite3`, a
native module that compiles on install — more setup, not less.

### The boundary

> **If git should see it, it is a FILE. If it is workshop state, it is the DATABASE.**

This is the one rule that keeps a database from breaking the pipeline. `<lang>.json` is consumed by
the real app through vue-i18n and `--check-only` is the CI gate reading these files — so they cannot
move into a database that CI has never heard of.

**Files — committed, unchanged, still the deliverable**

| file | why it stays a file |
|---|---|
| `<lang>.json` | the actual product; the app loads it, git diffs it |
| `<lang>.accepted.json` | the CI gate needs it to reach green |
| `<lang>.notes.json` | changes translation output, so it belongs with the run that produced it |
| `just-ai-help.config.json` | reproducibility — a run without its config is an anecdote |

**Database — `.jah.db`, gitignored, the workshop**

| table | holds | why a DB and not a file |
|---|---|---|
| `review_state` | per key: reviewed / skipped / last visited | **your actual reason — close the tab today, resume exactly here tomorrow** |
| `actions` | every accept, unaccept, edit, apply, discard, with the previous value | undo that survives a restart, instead of dying with the browser tab |
| `proposals` | staged engine output, per key per engine | a bulk run over 2,039 keys with old/new pairs is real data |
| `runs` | each translate/probe/escalate: engine, keys, requests, elapsed, findings | currently thrown away. "How did this catalogue get here" becomes answerable |
| `references` | cached second opinions per (key, engine) | never fetch the same Google reading twice |
| `providers` | shipped provider presets — transport, URL, default model, timeouts, `think`, `extraBody` | **re-seeded wholesale on update**, so a changed endpoint or a stale model id is fixed for everyone |
| `connections` | the user's own: which preset, the key, and **only the fields they changed** | survives re-seeding, because an override lives here rather than as a modified copy of the preset |
| `prefs` | selected connection, UI state | the remembered-dropdown request |

### Connections — one store, presets seeded

Approved by the user 2026-07-31. **All connections live in the database.** `engines.json` stops
being config and becomes the **seed file** — the menu the "Add connection" dropdown is populated
from, not a file anyone edits.

Resolution at runtime is **preset fields, then the user's overrides on top** — the same merge
`translate.js:93-101` already performs for `{...base, ...cfg.profile}`, so the semantics are proven
rather than new.

What that buys, and it is exactly what a single store seemed to cost:

- re-seeding on update **fixes a changed URL or a stale model id** without touching anything of the
  user's, because it rewrites only the `providers` table;
- **the key is never touched** — it lives in `connections`;
- a deliberate override **survives the update**, being stored separately rather than as an edited
  copy;
- a fully **custom provider** is simply a connection with no preset behind it, holding its own fields.

Migrations are deferred: seed fresh for now, add a migration file when there is something to migrate.

### Displaying fields that are not uniform

The awkward part, and the reason a plain form is not enough: most fields are common to every
provider, but `think` means something only to Ollama and `extraBody` is arbitrary JSON merged into
the request verbatim — which is the point of it, since it is what makes a new provider quirk a
config change instead of a code change. So the form has three tiers:

| tier | fields | how it renders |
|---|---|---|
| common | transport, URL, model, key, batch size, timeout, output cap, rate limit | ordinary inputs |
| transport-specific | `think` (Ollama only), `headers` | shown only when relevant, hidden otherwise |
| advanced | `extraBody` | collapsed JSON editor, validated on save. Free-form by necessity |

**Presets are what make this usable.** Choosing "Ollama — Gemma 4 MoE" fills in every field
including `think: false`, so nobody has to learn that a thinking model returns empty content without
it. The `_why` notes already in `engines.json` become help text beside the fields instead of comments
no one reads.

**Keys** live in `connections`, in the gitignored database, loaded into `process.env` at startup so
no translation code changes — verified, the key is read only as `process.env[profile.apiKeyEnv]`
(`loop.js:137`, `translate.js:107`). `GET /api/engines` returns `hasKey: true|false`, never a value.

Rows are small and the catalogue is 2,039 keys, so this is not about scale — it is about
**queryable history that outlives a session**, which is exactly what you asked for and what files
handle badly.

### Keys, settled properly

I previously quoted `engines.json`'s *"the key is never written to a file"* as policy. Checking it,
the commit is authored under your git identity like every commit in this repo, so authorship proves
nothing either way — and you have now stated the actual rule: **keys may be written locally; they
must never be committed.**

So keys live in the `secrets` table of the gitignored database. At startup they are loaded into
`process.env`, which means **no change to any translation code** — verified, the key is read only as
`process.env[profile.apiKeyEnv]` (`loop.js:137`, `translate.js:107`). `.gitignore` must cover
`.jah.db`; it currently covers `node_modules/`, `just-ai-help.config.json`, `.jah-cache.json`,
`*.log` and `.evidence/` and nothing else, so adding it is a prerequisite, and the app refuses to
store a key if the ignore is missing rather than trusting it. `GET /api/engines` returns
`hasKey: true|false` and never a value.

## 8. Endpoints

Existing: `GET /api/data`, `POST /api/save`, `POST /api/accept`.

| new | purpose |
|---|---|
| `DELETE /api/accept` `{key, code?}` | unaccept |
| `GET /api/accepted` | list acceptances for the Accepted bucket |
| `POST /api/jobs` · `GET /api/jobs/:id/stream` (SSE) · `POST /api/jobs/:id/cancel` · `GET /api/jobs/current` | long runs — progress, cancel, and rejoin after a reload. One job at a time; a second start returns 409 |
| `GET /api/proposals` · `POST /api/proposals/apply` · `DELETE /api/proposals` | keep or discard staged output |
| `POST /api/backtranslate` `{key}` | local model, target → English |
| `GET /api/terms?key=` | terminology-frequency comparison for one string |
| `GET /api/siblings?key=` | same-namespace keys with translations |
| `PUT /api/notes` `{key, note}` | per-key context |
| `GET /api/engines` | rows with `hasKey` computed, so the picker can disable what cannot run and say why. Never returns a key value |
| `PUT /api/engines/selected` `{engine}` | the remembered provider — written to the catalogue config, pre-selected next session |
| `PUT /api/engines/:name/key` `{key, persist}` | write-only. `persist:false` holds it in server memory for this process; `persist:true` appends to gitignored `.env`, and **fails with a usable error if `.gitignore` does not cover `.env`** |
| `POST /api/undo` | pop the action log |
| `GET /gt-frame?text=&tl=` | the minimal same-origin page hosting the Google widget |

The job wrapper is thin: `translateLanguage()` in `src/loop.js` already takes a key subset, an
`onBatch` callback and returns `failed[]`. It is redirected to the proposals file and streamed.
Two existing behaviours are preserved deliberately — an escalation profile takes **no** config
overrides (`translate.js:97`), and re-translating a key retires its probe entry (`translate.js:260`).

## 9. Settings in the app — what moves into the UI, and what must not

The user asked whether the API/engine config should live in the review app rather than only in
JSON. Yes for most of it, with one hard line.

**Editable in the UI, written back to the catalogue config file.** Engine choice and per-catalogue
overrides, the glossary, the product context line, target languages. The file stays the source of
truth, so `--check-only` in CI keeps working and the run stays reproducible — HANDOFF records two
catalogue runs that were unreproducible because their config was never kept: *"an output without the
config that produced it is an anecdote."* A settings screen that writes the same file preserves that
and removes the hand-editing.

**Written to the catalogue config, never to `engines.json`.** Verified at `translate.js:93-101`: the
config already overrides `model`, `url` and `think` over any engine row. `engines.json` ships *with
the tool*, so UI edits there would be lost on update — and each of its fields carries a recorded
rationale that a form should not quietly overwrite. So the UI edits overrides, not the shipped rows.

### 9.1 The provider picker — chosen once, remembered

A dropdown of available providers. Picking one shows only the fields that provider actually needs —
usually a key, sometimes a URL, nothing for the local engines. **The choice is saved and
pre-selected on every future review; changing the dropdown changes the default.** The preference
lives in the catalogue config beside the glossary, because it is a real setting that affects output
and belongs with the run it produced.

Key storage is covered in §7 — the `secrets` table of the gitignored database, loaded into
`process.env` at startup so no translation code changes. The settings screen shows each engine's
status (ready, or *"needs a key"*) so the picker can disable what cannot run and say why, and states
plainly where the key is stored.

## 10. Shell and reuse — SETTLED

> **Decided by the user, 2026-07-31: stay on Node, browser UI, no desktop shell.**
> Reason given: *"since this is a smaller app i did want to avoid python and all the packaging and
> pip issues, node is usally easier."* Not to be re-proposed.

That holds up on the facts. **Running this app requires Node and nothing else** — the UI ships as a
committed `dist/`, so there is no `npm install` for a user, and `node:sqlite` is built into the
runtime so the database needs no package either. `npm install` is needed only by someone developing
the UI. A Python port would add a virtualenv, pip, and a packaging story for distribution, in
exchange for consolidating a language across the family — a cost paid now against a benefit that is
mostly theoretical at this size.

The rest of this section records *why*, and what the alternatives would have cost, so a future
reader does not re-litigate it from scratch.

Facts first, all checked 2026-07-31:

| | |
|---|---|
| JustWrite | **Tauri** (`@tauri-apps/api`, `-cli`, `-plugin-http`) + Vue + a **Python** FastAPI server + SQLite |
| just-llm-runner | **Python** FastAPI + the Vue kit in `ui/` (which *is* `@delebash/llm-ui`) |
| just-ai-help | **Node** — `loop.js` 406, `translate.js` 367, `review.js` 329, `checks.js` 247, `suspects.js` 141, `accepted.js` 102 — **1,899 lines total** |

### Rust: no, and the reason is those 1,899 lines

Every one of them encodes a measured behaviour with a recorded failure behind it — placeholder
shielding by substitution, retry-then-singleton-then-report, never-silently-skip, the probe
temperature guard, acceptance hashing. A Rust rewrite does not port the code, it **re-opens every
one of those questions** and every measurement has to be taken again. There is no functional gain
to buy that with.

### Tauri: optional, and it composes rather than conflicts

Tauri's backend is Rust, so a Tauri app cannot call this pipeline directly — it would need Node as
a **sidecar binary**, which Tauri supports. That is a real option and nothing in this design blocks
it: the Vue UI is identical either way, and the Node server becomes the sidecar instead of a local
process.

**But it is worth asking what it buys.** This tool runs against a repo's locale folder. Started with
`npm run review` from inside that repo, it already knows where it is; a desktop app has to be told,
and gains a ~50 MB bundled runtime. **Recommend: browser UI now, Tauri later if you want it
launchable.** The decision is deferrable at no cost because the UI does not change.

### llm-runner: reuse it twice, neither by sharing code

Its LLM layer is Python (`llm/ollama.py`, `openai_compat.py`, `anthropic.py`, `gemini.py`) and
cannot be imported into Node. But two real forms of reuse exist and both are already available:

1. **The UI kit — this IS llm-runner.** `@delebash/llm-ui` lives at `just-llm-runner/ui/src`.
   Adopting it (§11) is already reusing the runner; there is no second thing to take.
2. **Compose over HTTP, with zero new code.** llm-runner's job is provider management and
   *spawning* models (`POST /v1/llm-runner/load` — "Download (if needed) + spawn a model"). What it
   spawns speaks the OpenAI shape. So the runner brings a model up, and just-ai-help points its
   **existing `local-openai-compatible` row** at the port. No integration to write, no coupling, and
   each tool keeps doing its own job.

What llm-runner does **not** offer is a generic chat-completion proxy — its generation endpoints
(`/run`, `/stream`) are bound to its own named-prompt system. So it cannot be dropped in as a
transport, and it should not be: owning the request body is this repo's founding decision.

## 11. Stack

Per the user: **Vue 3 + Vite in `review-ui/`, against the real `@delebash/llm-ui`, aliased to the
sibling repo, with the built `dist/` committed.**

- `review-ui/vite.config.js` aliases `@delebash/llm-ui` → `../../just-llm-runner/ui/src`, the same
  mechanism JustWrite uses. The package is unpublished, so a path alias is the only route today.
- `review.js` serves `review-ui/dist` and keeps owning every `/api/*` route.
- **`dist/` is committed** so `npm run review` works without the sibling checkout or a build.
- **A committed artifact must be guarded**: a test hashes `review-ui/src/**` and fails if
  `dist/.buildhash` differs, shipping with a stale fixture that proves it bites.
- Components: `UiButton`, `UiInput`, `UiTextarea`, `UiSelect`, `UiSegmented`, `UiCheckbox`, `UiChip`,
  `UiTag`, `UiTable`, `UiField`, `UiProgress`, `Toast`/`pushToast`, `AppModal`, `AppDialog`,
  `EmptyState`, `Icon`. Peers: `vue`, `pinia`, `reka-ui`, `vue-sonner`, `@tanstack/vue-table`,
  `@vueuse/core`, `marked`.
- Tokens: `review-ui/src/tokens.css`, from `common/tokens.contract.css`. Light and dark.

**The "zero dependencies" language in `CLAUDE.md` and `README.md` is removed in this work.** It was
written by a session, never by the user, whose standing rule is the opposite — adopt-first, recorded
at `2026-07-27-v2-design-executor-plan.md:42`. What the 2026-07-27 incident established is narrower
and still true: own the translation request body.

## 12. Phases

| # | what | done when |
|---|---|---|
| 0 | **Database**: `node:sqlite`, schema + migrations, `.gitignore`, Node bump, secrets loaded into `process.env` | tables create on first run; a second run migrates rather than clobbers; a key round-trips without ever appearing in a response |
| 1 | Server: proposals, unaccept, action log, notes, terms, siblings, `/api/engines` | `node --test` green, every check demonstrated biting |
| 2 | Jobs: SSE, cancel, rejoin | a cancelled job leaves the target file byte-identical; a reloaded page rejoins |
| 3 | `review-ui/`: queue, list, detail panel, keyboard, undo; `dist` + freshness test | the 2,039-key catalogue is reviewable without touching a CLI |
| 4 | Second opinion: Google widget panel + local re-translate + back-translation | `characterAudit.why` can be fixed end to end from the UI |
| 5 | Terminology check + notes feeding the next run | the `guardado automático` case is flagged; a noted key translates correctly next run |
| 6 | Docs: `GUIDE.md`, `README.md`, `CLAUDE.md`, `HANDOFF.md` | the workflow is runnable from the docs alone |

## 13. Testing

Repo rule: a check ships with a test that hands it a deliberately broken input and asserts it complains.

- unaccept restores the finding; re-accept clears it
- a job writes **only** the proposals file — the target is asserted byte-identical
- cancel mid-run leaves valid JSON and a partial proposal set; a second concurrent start gets 409
- applying a proposal retires the matching probe entry
- the action log restores the exact previous value for every action type
- the terminology check flags a planted minority variant
- a note is injected as per-key context on the next translation of that key
- back-translation and reference calls leave every file byte-identical
- a reference failure degrades soft — the row still renders and says why
- `dist` freshness fails against a stale `.buildhash`
- **`GET /api/engines` never returns a key value** — asserted against a populated environment
- **storing a key refuses when `.gitignore` does not cover the database** — the test points the
  server at a temp project with a bare `.gitignore` and asserts the write is rejected
- the remembered provider survives a server restart and is pre-selected
- **review state survives a restart** — mark keys reviewed and skipped, restart the server, assert
  the queue resumes in the same place. This is the feature's whole point, so it gets a test
- **undo survives a restart** — an accept made before a restart can still be undone after it
- **the database is never required by the CI gate** — `--check-only` runs green with `.jah.db`
  deleted, proving the committed files remain the source of truth

## 14. Open

1. **Languages** — one target at a time (today's shape) or several at once. A language dimension in
   the queue is much cheaper before phase 3 than after. Recommend one at a time with a switcher in
   the header, since `config.targets` is already a list.
2. **Auto-selecting the language in the Google frame** — under test by the user. If the widget's
   hidden `<select>` can be driven, a row translates on open; if not, the reviewer picks once per
   row. Either way the panel works; this only affects how many clicks.
