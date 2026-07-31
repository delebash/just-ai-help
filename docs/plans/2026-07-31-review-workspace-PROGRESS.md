# Review workspace — BUILD PROGRESS

**Live status file. Update it at every phase boundary.** If a session is compacted mid-build,
read this first, then the design at [`2026-07-31-review-workspace-design.md`](2026-07-31-review-workspace-design.md).

Read branch and commit state from git, never from this file.

---

## Where we are

| phase | what | state |
|---|---|---|
| 0 | database — `node:sqlite`, providers/connections, gitignore guard | ✅ **done** — `4a39431` |
| 1 | server: store, unaccept, action log, notes, terms, siblings, engines | 🔨 in progress |
| 2 | jobs: SSE progress, cancel, rejoin | ⬜ |
| 3 | `review-ui/` Vue app: queue, list, detail, keyboard, undo | ⬜ |
| 4 | second opinion: Google widget, local re-translate, back-translation | ⬜ |
| 5 | terminology check + notes feeding the next run | ⬜ |
| 6 | docs: GUIDE, README, CLAUDE.md, HANDOFF | ⬜ |

## Non-negotiables carried from the design

1. **If git should see it, it is a FILE. If it is workshop state, it is the DATABASE.**
   `<lang>.json`, `<lang>.accepted.json`, `<lang>.notes.json` and the config stay committed.
   Deleting `.jah.db` must never break a build — there is a test.
2. **Every engine action produces a PROPOSAL. Only a human writes the target file.**
3. **A key never appears in anything the UI can read**, and storing one refuses unless
   `.gitignore` covers `.jah.db`.
4. **Every check ships with a test that hands it something broken and asserts it complains.**
5. **Never let a run exit 0 having silently skipped keys.**

## Verified facts this build rests on

- `characterAudit.why` was `"¿Por qué?"` for EN `"Why:"` — wrong. Google and MyMemory both say
  `"Por qué:"`. **The user fixed it by hand at 05:43 on 2026-07-31**, so it is no longer a live
  defect; it survives as the fixture case for the second-opinion panel.
- On `settings.backups.dataFolderHint` the local model is RIGHT and both online engines are
  wrong. Neither source dominates — that is why a second opinion is never auto-applied.
- Google Translate's widget works in a minimal same-origin page; **42px of top-crop** removes its
  banner; the parent can read the result back. Verified by the user in a browser.
- Raw MT mangles placeholders (`{link}` → `{enlace}`), so reference output is display-only.
- `translate.js:93-101` merges `{...base, ...cfg.profile}` — the preset/override order the
  database reuses.
- The key is read in exactly two places, both `process.env[profile.apiKeyEnv]`
  (`loop.js:137`, `translate.js:107`).

## Module map

| file | role |
|---|---|
| `src/db.js` | schema, providers/connections, secrets, prefs |
| `src/store.js` | review state, action log + undo, proposals, notes |
| `src/terms.js` | terminology-consistency check against the catalogue itself |
| `src/jobs.js` | long-run manager: start, stream, cancel, rejoin |
| `src/server.js` | the HTTP API |
| `src/review.js` | CLI entry; starts the server |
| `review-ui/` | Vue 3 + `@delebash/llm-ui`, built to a committed `dist/` |

## Log

- **2026-07-31** — design committed `55b292c`; phase 0 committed `4a39431` (16 tests, 91 total).
