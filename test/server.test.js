// The workspace API, over real HTTP against a real temp locale folder.
//
// These are the behaviours a reviewer complained were missing. Each test is named for the
// complaint rather than the endpoint, because that is what makes a regression legible:
//
//   "you can't undo something you approved"     -> unaccept, and undo of the unaccept
//   "accepted things vanish"                    -> the accepted bucket is listable
//   "no online AI option, all or just one"      -> job scopes, and 409 on a second start
//   "the buttons are weak"                      -> not testable here; that is the UI phase
//
// The invariant carried from the old page and still load-bearing: saving one value leaves the
// file byte-identical except that value. A review tool that reformats on every save produces an
// 800-line diff for a one-word fix, and nobody reviews that.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceServer } from "../server/server.js";
import { acceptanceHash } from "../server/accepted.js";
import { CONFIRM_CODE } from "../server/confirm.js";
import { confirmations, openProject, proposalCount, putConfirmation, putProposal } from "../server/state.js";

const EN = {
	nav: { chapters: "Chapters", strands: "Strands" },
	characterAudit: { why: "Why:", cheapestFix: "Cheapest fix:", action: "Audit this character" },
	chapters: { outline: { noteCount: "{n} note | {n} notes" }, dialogs: { deleteTitle: "Delete this chapter?" } },
	settings: { save: "Save" },
};
const ES = {
	nav: { chapters: "Capítulos", strands: "Strands" },
	characterAudit: { why: "¿Por qué?", cheapestFix: "Solución más económica:", action: "Auditar este personaje" },
	chapters: { outline: { noteCount: "{n} nota | {n} notas" }, dialogs: { deleteTitle: "Eliminar este capítulo?" } },
	settings: { save: "Guardar" },
};
const FR = { nav: { chapters: "Chapitres", strands: "Strands" }, characterAudit: { why: "Pourquoi :", cheapestFix: "Correctif :", action: "Auditer" }, chapters: { outline: { noteCount: "{n} note | {n} notes" }, dialogs: { deleteTitle: "Supprimer ce chapitre ?" } }, settings: { save: "Enregistrer" } };

/** Spins up the workspace on an ephemeral port over a fresh temp project. */
async function withServer(run, { targets = ["es"] } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "jah-ws-"));
	const locales = join(dir, "locales");
	mkdirSync(locales, { recursive: true });
	// A REAL git repo, because the key guard asks `git check-ignore` rather than parsing
	// .gitignore itself. Outside a repo the guard takes a different branch entirely — there is
	// nothing to commit a key into — so testing it in a non-repo tested nothing.
	execFileSync("git", ["init", "-q"], { cwd: dir });
	writeFileSync(join(dir, ".gitignore"), ["node_modules/", ".jah.db", ""].join("\n"));
	writeFileSync(
		join(dir, "config.json"),
		JSON.stringify({
			localesDir: locales,
			sourceLanguage: "en",
			targets,
			placeholder: { prefix: "{", suffix: "}" },
			pluralSeparator: "|",
			glossary: { doNotTranslate: ["Strands"] },
		}),
	);
	writeFileSync(join(locales, "en.json"), `${JSON.stringify(EN, null, 2)}\n`);
	writeFileSync(join(locales, "es.json"), `${JSON.stringify(ES, null, 2)}\n`);
	if (targets.includes("fr")) writeFileSync(join(locales, "fr.json"), `${JSON.stringify(FR, null, 2)}\n`);

	// A throwaway TOOL folder for this test's settings — its own git repo so the key guard has
	// something real to consult, and so a test can never reach the developer's own settings.
	const settingsRoot = join(dir, "tool");
	mkdirSync(settingsRoot, { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: settingsRoot });
	writeFileSync(join(settingsRoot, ".gitignore"), "settings.json\n");
	const server = createWorkspaceServer({ configPath: join(dir, "config.json"), settingsRoot });
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const api = async (method, path, payload) => {
		const res = await fetch(base + path, {
			method,
			...(payload ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}),
		});
		return { status: res.status, body: await res.json().catch(() => null) };
	};
	try {
		await run({ base, api, dir, locales, settingsRoot, esPath: join(locales, "es.json"), server });
	} finally {
		server.jah.store.close();
		await new Promise((r) => server.close(r));
	}
}

test("the queue reports flagged rows with their reasons", async () => {
	await withServer(async ({ api }) => {
		const { body } = await api("GET", "/api/rows?lang=es");
		const why = body.rows.find((r) => r.key === "characterAudit.why");
		assert.ok(why, "the spurious-interrogative key must be in the queue");
		assert.ok(why.flags.some((f) => f.code === "spurious-interrogative"));
		assert.equal(why.lang, "es");
	});
});

test("ALL LANGUAGES IN ONE QUEUE, and the filter narrows it", async () => {
	await withServer(
		async ({ api }) => {
			const all = (await api("GET", "/api/rows")).body;
			const langs = new Set(all.rows.map((r) => r.lang));
			assert.deepEqual([...langs].sort(), ["es", "fr"], "both targets appear together");

			const justEs = (await api("GET", "/api/rows?lang=es")).body;
			assert.ok(justEs.rows.every((r) => r.lang === "es"), "the filter narrows to one");
			assert.ok(justEs.rows.length < all.rows.length);
		},
		{ targets: ["es", "fr"] },
	);
});

test("SAVING ONE VALUE LEAVES THE FILE BYTE-IDENTICAL EXCEPT THAT VALUE", async () => {
	await withServer(async ({ api, esPath }) => {
		const before = readFileSync(esPath, "utf8");
		await api("POST", "/api/save", { lang: "es", key: "characterAudit.why", value: "Por qué:" });
		const after = readFileSync(esPath, "utf8");
		assert.equal(after, before.replace('"¿Por qué?"', '"Por qué:"'), "a one-word fix must be a one-line diff");
	});
});

test("an edit is undoable — and undo restores the exact previous string", async () => {
	await withServer(async ({ api, esPath }) => {
		const before = readFileSync(esPath, "utf8");
		await api("POST", "/api/save", { lang: "es", key: "characterAudit.why", value: "Por qué:" });
		const undo = await api("POST", "/api/undo", { lang: "es" });
		assert.equal(undo.body.undone.kind, "edit");
		assert.equal(readFileSync(esPath, "utf8"), before, "the file is back to exactly what it was");
	});
});

test("YOU CAN UNDO SOMETHING YOU APPROVED — the complaint that started this rebuild", async () => {
	await withServer(async ({ api }) => {
		const flagged = () => api("GET", "/api/rows?lang=es").then((r) => r.body.rows.find((x) => x.key === "chapters.dialogs.deleteTitle"));

		assert.ok(await flagged(), "the key starts flagged");
		await api("POST", "/api/accept", { lang: "es", key: "chapters.dialogs.deleteTitle" });
		assert.ok(!(await flagged()), "accepting clears it");

		const un = await api("DELETE", "/api/accept", { lang: "es", key: "chapters.dialogs.deleteTitle" });
		assert.ok(un.body.removed >= 1);
		assert.ok(await flagged(), "un-accepting brings it back");
	});
});

test("ACCEPTED THINGS ARE STILL LISTABLE — never a void", async () => {
	await withServer(async ({ api }) => {
		await api("POST", "/api/accept", { lang: "es", key: "chapters.dialogs.deleteTitle" });
		const { body } = await api("GET", "/api/accepted?lang=es");
		assert.ok(body.entries.some((e) => e.key === "chapters.dialogs.deleteTitle"), "a decision must be revisitable");
		assert.ok(body.entries[0].src && body.entries[0].dst, "with both strings, so it can be audited");
	});
});

test("undoing an un-accept puts the acceptance back", async () => {
	await withServer(async ({ api }) => {
		await api("POST", "/api/accept", { lang: "es", key: "chapters.dialogs.deleteTitle" });
		await api("DELETE", "/api/accept", { lang: "es", key: "chapters.dialogs.deleteTitle" });
		await api("POST", "/api/undo", { lang: "es" });
		const { body } = await api("GET", "/api/accepted?lang=es");
		assert.ok(body.entries.some((e) => e.key === "chapters.dialogs.deleteTitle"));
	});
});

test("an acceptance still EXPIRES when the translation changes", async () => {
	await withServer(async ({ api }) => {
		await api("POST", "/api/accept", { lang: "es", key: "chapters.dialogs.deleteTitle" });
		await api("POST", "/api/save", { lang: "es", key: "chapters.dialogs.deleteTitle", value: "Borrar este capitulo?" });
		const rows = (await api("GET", "/api/rows?lang=es")).body.rows;
		assert.ok(rows.some((r) => r.key === "chapters.dialogs.deleteTitle"), "editing either string revives the finding");
	});
});

test("SIBLINGS — how the Why: defect was actually proven", async () => {
	await withServer(async ({ api }) => {
		const { body } = await api("GET", "/api/siblings?lang=es&key=characterAudit.why");
		const fix = body.siblings.find((s) => s.key === "characterAudit.cheapestFix");
		assert.ok(fix, "the sibling that renders the same pattern correctly must be visible");
		assert.equal(fix.source, "Cheapest fix:");
		assert.equal(fix.target, "Solución más económica:");
		assert.ok(!body.siblings.some((s) => s.key === "characterAudit.why"), "not itself");
	});
});

test("term usage shows the distribution rather than asserting an answer", async () => {
	await withServer(async ({ api }) => {
		const { body } = await api("GET", "/api/terms?lang=es&term=chapter");
		assert.ok(Array.isArray(body.usage));
	});
});

test("a note is saved, read back, and undoable", async () => {
	await withServer(async ({ api, dir }) => {
		await api("PUT", "/api/notes", { lang: "es", key: "characterAudit.why", note: "a label, not a question" });
		const rows = (await api("GET", "/api/rows?lang=es")).body.rows;
		assert.equal(rows.find((r) => r.key === "characterAudit.why").note, "a label, not a question");
		// Sidecars live beside the CONFIG now, not inside locales/ — locales/ holds app assets only.
		assert.ok(readFileSync(join(dir, "es.notes.json"), "utf8").includes("a label, not a question"));

		await api("POST", "/api/undo", { lang: "es" });
		const after = (await api("GET", "/api/rows?lang=es")).body.rows;
		assert.equal(after.find((r) => r.key === "characterAudit.why").note, null);
	});
});

test("A KEY IS NEVER RETURNED BY THE ENGINES ENDPOINT", async () => {
	await withServer(async ({ api }) => {
		const saved = await api("PUT", "/api/engines/connection", { label: "groq", provider: "groq", apiKey: "sk-must-not-leak" });
		assert.equal(saved.body.hasKey, true);
		const { body } = await api("GET", "/api/engines");
		assert.ok(!JSON.stringify(body).includes("sk-must-not-leak"), "the settings screen must never echo a key");
		assert.ok(body.providers.length > 0, "and presets are offered to choose from");
	});
});

test("STORING A KEY REFUSES when git does not ignore the settings file", async () => {
	await withServer(async ({ api, settingsRoot }) => {
		writeFileSync(join(settingsRoot, ".gitignore"), "node_modules/\n"); // the guard's line removed
		const res = await api("PUT", "/api/engines/connection", { label: "groq", provider: "groq", apiKey: "sk-nope" });
		assert.equal(res.status, 400);
		assert.match(res.body.error, /does not ignore/);
	});
});

test("a connection with no key is saved without consulting .gitignore", async () => {
	await withServer(async ({ api, settingsRoot }) => {
		writeFileSync(join(settingsRoot, ".gitignore"), "node_modules/\n");
		const res = await api("PUT", "/api/engines/connection", { label: "local", provider: "ollama" });
		assert.equal(res.status, 200, "nothing secret is being written, so nothing to guard");
	});
});

test("a second job is refused with 409", async () => {
	await withServer(async ({ api, server }) => {
		// Occupy the slot without an engine.
		server.jah.jobs.start({
			lang: "es",
			engine: "test",
			profile: {},
			scope: "keys",
			subset: { "settings.save": "Save" },
			cfg: {},
			cachePath: join(tmpdir(), "x.json"),
			translate: () => new Promise(() => {}), // never settles
		});
		const res = await api("POST", "/api/jobs", { lang: "es", scope: "flagged" });
		assert.equal(res.status, 409);
		server.jah.jobs.cancel();
	});
});

test("a job scope that selects nothing is refused rather than started", async () => {
	await withServer(async ({ api }) => {
		const res = await api("POST", "/api/jobs", { lang: "es", scope: "keys", keys: ["does.not.exist"] });
		assert.equal(res.status, 400);
		assert.match(res.body.error, /selected no keys/);
	});
});

test("AN UNKNOWN SCOPE IS REFUSED, not silently read as 'flagged'", async () => {
	// Found by driving the real 2,039-key catalogue: a typo'd scope started a 154-key run.
	// A 52-minute job must never begin on a scope the caller did not ask for.
	await withServer(async ({ api, server }) => {
		const res = await api("POST", "/api/jobs", { lang: "es", scope: "flaged" });
		assert.equal(res.status, 400);
		assert.match(res.body.error, /unknown scope/);
		assert.equal(server.jah.jobs.busy, false, "and nothing may have started");
	});
});

test("an unknown language is refused", async () => {
	await withServer(async ({ api }) => {
		const res = await api("POST", "/api/jobs", { lang: "de", scope: "flagged" });
		assert.equal(res.status, 400);
	});
});

test("the Google frame is our own page, holding only the string", async () => {
	await withServer(async ({ base }) => {
		const html = await (await fetch(`${base}/gt-frame?text=${encodeURIComponent("Why:")}&tl=es`)).text();
		assert.match(html, /id="src">Why:</, "the page IS the text — that is what makes whole-page translation useful");
		assert.match(html, /translate_a\/element\.js/);
	});
});

test("the frame escapes the string rather than injecting it", async () => {
	await withServer(async ({ base }) => {
		const html = await (await fetch(`${base}/gt-frame?text=${encodeURIComponent("<script>x</script>")}&tl=es`)).text();
		assert.ok(!html.includes("<script>x</script>"), "a locale file is untrusted input as far as this page is concerned");
		assert.match(html, /&lt;script&gt;/);
	});
});

test("state reports languages, progress and proposal counts", async () => {
	await withServer(async ({ api }) => {
		const { body } = await api("GET", "/api/state");
		assert.deepEqual(body.langs, ["es"]);
		assert.equal(body.source, "en");
		assert.deepEqual(body.progress.es, { reviewed: 0, skipped: 0 });
	});
});

test("history records what happened, newest first", async () => {
	await withServer(async ({ api }) => {
		await api("POST", "/api/save", { lang: "es", key: "settings.save", value: "Guardar!" });
		await api("POST", "/api/accept", { lang: "es", key: "chapters.dialogs.deleteTitle" });
		const { body } = await api("GET", "/api/history?lang=es");
		assert.equal(body.actions[0].kind, "accept");
		assert.equal(body.actions[1].kind, "edit");
	});
});

test("a bad path 404s as JSON rather than crashing", async () => {
	await withServer(async ({ api }) => {
		assert.equal((await api("GET", "/api/nonsense")).status, 404);
	});
});

test("malformed JSON is refused with 400", async () => {
	await withServer(async ({ base }) => {
		const res = await fetch(`${base}/api/save`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
		assert.equal(res.status, 400);
	});
});

test("BACK-TRANSLATION refuses without an engine rather than pretending", async () => {
	await withServer(async ({ api }) => {
		const res = await api("POST", "/api/backtranslate", { lang: "es", key: "settings.save" });
		assert.equal(res.status, 400);
		assert.match(res.body.error, /no engine connection/);
	});
});

test("back-translating an untranslated key 404s", async () => {
	await withServer(async ({ api }) => {
		const res = await api("POST", "/api/backtranslate", { lang: "es", key: "characterAudit.action", connectionId: 1 });
		assert.notEqual(res.status, 500, "a missing target must be a clean 404/400, never a crash");
	});
});

test("a cached back-translation is served without touching an engine", async () => {
	await withServer(async ({ api, server }) => {
		const { putReference } = await import("../server/state.js");
		putReference(server.jah.store, { lang: "es", key: "settings.save", engine: "backtranslate", value: "Save" });
		const res = await api("POST", "/api/backtranslate", { lang: "es", key: "settings.save" });
		assert.equal(res.status, 200);
		assert.equal(res.body.english, "Save");
		assert.equal(res.body.cached, true, "no engine was consulted — and none is configured here");
	});
});

test("EDITING A KEY DROPS ITS CACHED SECOND OPINION — stale advice must not linger", async () => {
	await withServer(async ({ api, server }) => {
		const { putReference } = await import("../server/state.js");
		putReference(server.jah.store, { lang: "es", key: "settings.save", engine: "backtranslate", value: "old reading" });
		await api("POST", "/api/save", { lang: "es", key: "settings.save", value: "Guardar todo" });
		const res = await api("GET", "/api/reference?lang=es&key=settings.save");
		assert.equal(res.body.cached, null, "the reading was about the old text");
	});
});

// ── The two journeys that were broken, and that 148 unit tests missed ────────────────────
//
// Both features were built and unit-tested in isolation, and both were dead end to end.
// buildUserMessage() had a passing test; nothing asserted a JOB reached it. Undo had a
// passing test; nothing undid an edit on a key that started with no translation.
//
// These follow the whole path on purpose. A test that pokes one function proves that
// function works, and nothing about whether anyone calls it.

test("A NOTE WRITTEN IN THE UI REACHES THE MODEL — the whole point of notes", async () => {
	await withServer(async ({ api, server }) => {
		await api("PUT", "/api/notes", { lang: "es", key: "characterAudit.why", note: "a label, not a question" });

		// Intercept at the engine boundary: whatever the job hands the translate function IS
		// what the model would see.
		let sawCfg = null;
		const { jobs } = server.jah;
		const realStart = jobs.start.bind(jobs);
		jobs.start = (opts) => realStart({ ...opts, translate: async ({ cfg }) => {
			sawCfg = cfg;
			return { values: {}, failed: [], requests: 0 };
		} });

		await api("POST", "/api/jobs", { lang: "es", scope: "keys", keys: ["characterAudit.why"] });
		await jobs.settled();

		assert.ok(sawCfg, "the job ran");
		assert.equal(
			sawCfg.notes?.["characterAudit.why"],
			"a label, not a question",
			"a note is useless if pressing re-translate on that very key does not send it",
		);
	});
});

test("UNDOING AN EDIT ON AN UNTRANSLATED KEY REMOVES IT — it does not leave an empty string", async () => {
	await withServer(async ({ api, locales, esPath }) => {
		// A key present in English with no Spanish yet.
		const en = JSON.parse(readFileSync(join(locales, "en.json"), "utf8"));
		en.settings.brandNew = "Brand new";
		writeFileSync(join(locales, "en.json"), `${JSON.stringify(en, null, 2)}\n`);

		const before = readFileSync(esPath, "utf8");
		await api("POST", "/api/save", { lang: "es", key: "settings.brandNew", value: "Recién añadido" });
		await api("POST", "/api/undo", { lang: "es" });

		const after = JSON.parse(readFileSync(esPath, "utf8"));
		assert.equal(after.settings.brandNew, undefined, "an empty string is a DIFFERENT defect (blank, not missing)");
		assert.equal(readFileSync(esPath, "utf8"), before, "and the file is exactly as it was");
	});
});

test("the key still reports as missing after that undo, not as blank", async () => {
	await withServer(async ({ api, locales }) => {
		const en = JSON.parse(readFileSync(join(locales, "en.json"), "utf8"));
		en.settings.brandNew = "Brand new";
		writeFileSync(join(locales, "en.json"), `${JSON.stringify(en, null, 2)}\n`);

		await api("POST", "/api/save", { lang: "es", key: "settings.brandNew", value: "x" });
		await api("POST", "/api/undo", { lang: "es" });

		const row = (await api("GET", "/api/rows?lang=es")).body.rows.find((r) => r.key === "settings.brandNew");
		assert.ok(row, "it is still work to do");
		assert.ok(row.flags.some((f) => f.code === "missing"), `expected missing, got ${row.flags.map((f) => f.code)}`);
	});
});

test("A CONNECTION CAN BE CREATED AND THEN USED TO START A JOB — the path that was unreachable", async () => {
	// The gap this covers: the settings screen was designed and not built, so no connection
	// could exist, so the toolbar's engine dropdown was empty and Start was permanently
	// disabled. Every piece had a passing unit test; the journey did not exist.
	await withServer(async ({ api, server }) => {
		assert.deepEqual((await api("GET", "/api/engines")).body.connections, [], "starts with none");

		const made = await api("PUT", "/api/engines/connection", { label: "local", provider: "ollama" });
		assert.equal(made.status, 200);

		const { connections } = (await api("GET", "/api/engines")).body;
		assert.equal(connections.length, 1, "the dropdown now has something to offer");

		// And that connection actually resolves into a runnable profile.
		let ran = null;
		const { jobs } = server.jah;
		const realStart = jobs.start.bind(jobs);
		jobs.start = (opts) => realStart({ ...opts, translate: async ({ profile }) => {
			ran = profile;
			return { values: {}, failed: [], requests: 0 };
		} });

		const started = await api("POST", "/api/jobs", { lang: "es", scope: "keys", keys: ["settings.save"], connectionId: connections[0].id });
		assert.equal(started.status, 202);
		await jobs.settled();

		assert.equal(ran?.kind, "ollama", "the preset's transport came through");
		assert.ok(ran?.model, "and its model");
	});
});

test("a job started with no connection is refused, not run against nothing", async () => {
	await withServer(async ({ api }) => {
		const res = await api("POST", "/api/jobs", { lang: "es", scope: "keys", keys: ["settings.save"], connectionId: 999 });
		assert.equal(res.status, 404);
	});
});

test("BITES: a confirmation annotation reaches the WORKSPACE, not just the terminal", async () => {
	// Both doors must show the same thing. The workspace builds its own finding list, so without
	// explicit wiring it showed a bare "identical to the source" while the CLI showed "…and it
	// should be Guardar" — two answers to one question, the drift engine.js exists to prevent.
	await withServer(async ({ api, dir, locales }) => {
		const es = JSON.parse(readFileSync(join(locales, "es.json"), "utf8"));
		es.settings.save = "Save"; // a planted skip
		writeFileSync(join(locales, "es.json"), `${JSON.stringify(es, null, 2)}\n`);

		const store = openProject(dir);
		putConfirmation(store, {
			lang: "es",
			key: "settings.save",
			hash: acceptanceHash({ key: "settings.save", code: CONFIRM_CODE, src: "Save", dst: "Save" }),
			verdict: "translate",
			suggestion: "Guardar",
			engine: "ollama (test)",
		});

		const { body } = await api("GET", "/api/rows?lang=es");
		const flag = body.rows.find((r) => r.key === "settings.save")?.flags.find((f) => f.code === "untranslated");
		assert.ok(flag, "the planted skip must be in the queue");
		assert.equal(flag.suggestion, "Guardar", "the workspace did not receive the annotation");
		assert.equal(flag.confirmed, "translate");
	});
});

test("BITES: a machine verdict does NOT approve — the row is still in the queue", async () => {
	// The correction of 2026-07-31: the engine annotates, a human approves. A "same" verdict
	// pre-ticks a row; if it removed the row instead, a machine would be turning a check green.
	await withServer(async ({ api, dir, locales }) => {
		const es = JSON.parse(readFileSync(join(locales, "es.json"), "utf8"));
		es.settings.save = "Save";
		writeFileSync(join(locales, "es.json"), `${JSON.stringify(es, null, 2)}\n`);

		putConfirmation(openProject(dir), {
			lang: "es",
			key: "settings.save",
			hash: acceptanceHash({ key: "settings.save", code: CONFIRM_CODE, src: "Save", dst: "Save" }),
			verdict: "same",
			engine: "ollama (test)",
		});

		const { body } = await api("GET", "/api/rows?lang=es");
		const row = body.rows.find((r) => r.key === "settings.save");
		assert.ok(row, "a machine verdict removed the row from the human's queue");
		assert.equal(row.flags.find((f) => f.code === "untranslated").confirmed, "same", "…but it should be pre-ticked");
	});
});

// ── Bulk approve ────────────────────────────────────────────────────────────────────────

test("BULK APPROVE records many keys in one call — 70 clicks is why 58 verdicts got scripted", async () => {
	await withServer(async ({ api, locales }) => {
		// Two keys that come back identical: correct output a human must sign off.
		const es = JSON.parse(readFileSync(join(locales, "es.json"), "utf8"));
		es.settings.save = "Save";
		es.nav.chapters = "Chapters";
		writeFileSync(join(locales, "es.json"), `${JSON.stringify(es, null, 2)}\n`);

		const res = await api("POST", "/api/accept", { lang: "es", keys: ["settings.save", "nav.chapters"] });
		assert.equal(res.status, 200);
		assert.equal(res.body.recorded, 2, "both keys must be recorded in one call");

		const rows = (await api("GET", "/api/rows?lang=es")).body.rows;
		assert.ok(!rows.some((r) => r.key === "settings.save"), "an approved key leaves the queue");
		assert.ok(!rows.some((r) => r.key === "nav.chapters"));
	});
});

test("BITES: ONE bulk approve is ONE undo, not one per key", async () => {
	// If a 70-key approval needed 70 undos, the bulk button would be a trap rather than a tool.
	await withServer(async ({ api, locales }) => {
		const es = JSON.parse(readFileSync(join(locales, "es.json"), "utf8"));
		es.settings.save = "Save";
		es.nav.chapters = "Chapters";
		writeFileSync(join(locales, "es.json"), `${JSON.stringify(es, null, 2)}\n`);

		await api("POST", "/api/accept", { lang: "es", keys: ["settings.save", "nav.chapters"] });
		const undone = await api("POST", "/api/undo", { lang: "es" });
		assert.equal(undone.body.undone.kind, "bulk-accept");

		const rows = (await api("GET", "/api/rows?lang=es")).body.rows;
		assert.ok(rows.some((r) => r.key === "settings.save"), "one undo must bring back the whole batch");
		assert.ok(rows.some((r) => r.key === "nav.chapters"), "…both of them");
		assert.equal((await api("POST", "/api/undo", { lang: "es" })).status, 404, "and there is nothing left to undo");
	});
});

test("an approval records WHO made it, from your settings", async () => {
	await withServer(async ({ api, locales }) => {
		await api("PUT", "/api/reviewer", { reviewer: "danel" });
		assert.equal((await api("GET", "/api/reviewer")).body.reviewer, "danel");

		const es = JSON.parse(readFileSync(join(locales, "es.json"), "utf8"));
		es.settings.save = "Save";
		writeFileSync(join(locales, "es.json"), `${JSON.stringify(es, null, 2)}\n`);
		await api("POST", "/api/accept", { lang: "es", keys: ["settings.save"] });

		const entries = (await api("GET", "/api/accepted?lang=es")).body.entries;
		assert.equal(entries.find((e) => e.key === "settings.save").by, "danel");
	});
});

test("BITES: a bulk approve REFUSES the whole batch if any key is unknown", async () => {
	// A partial write would leave the reviewer unable to tell what was recorded.
	await withServer(async ({ api }) => {
		const res = await api("POST", "/api/accept", { lang: "es", keys: ["settings.save", "no.such.key"] });
		assert.equal(res.status, 404);
		assert.match(res.body.error, /no.such.key/);
		assert.equal((await api("GET", "/api/accepted?lang=es")).body.entries.length, 0, "nothing may be recorded");
	});
});

test("a machine verdict is dropped once a human rules on that key", async () => {
	await withServer(async ({ api, dir, locales }) => {
		const es = JSON.parse(readFileSync(join(locales, "es.json"), "utf8"));
		es.settings.save = "Save";
		writeFileSync(join(locales, "es.json"), `${JSON.stringify(es, null, 2)}\n`);
		const store = openProject(dir);
		putConfirmation(store, {
			lang: "es",
			key: "settings.save",
			hash: acceptanceHash({ key: "settings.save", code: CONFIRM_CODE, src: "Save", dst: "Save" }),
			verdict: "same",
			engine: "ollama (test)",
		});
		await api("POST", "/api/accept", { lang: "es", keys: ["settings.save"] });
		assert.equal(confirmations(openProject(dir), "es")["settings.save"], undefined, "the engine's opinion outlived the decision");
	});
});

test("BITES: editing a key DROPS its staged proposal — it must not be applied over newer text", async () => {
	// A pre-existing bug found on 2026-07-31: writeKey dropped the probe entry and the cached
	// back-translation but not the proposal. So a suggestion staged against the OLD string
	// survived an edit, and applying it silently reverted the reviewer's own fix.
	await withServer(async ({ api, dir }) => {
		const store = openProject(dir);
		putProposal(store, { lang: "es", key: "settings.save", engine: "ollama", value: "Almacenar" });
		assert.equal(proposalCount(openProject(dir), "es"), 1);

		await api("POST", "/api/save", { lang: "es", key: "settings.save", value: "Guardar a mano" });

		assert.equal(proposalCount(openProject(dir), "es"), 0, "a stale proposal survived an edit");
	});
});

// ── Setup: the server starts with NO project ────────────────────────────────────────────
//
// It used to read a config on its first line, so the tool could not show a setup page — you
// needed a config to reach the screen that writes a config.

/** A server with no project at all, and a throwaway tool folder for its settings. */
async function withNoProject(run) {
	const dir = mkdtempSync(join(tmpdir(), "jah-setup-"));
	const settingsRoot = join(dir, "tool");
	mkdirSync(settingsRoot, { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: settingsRoot });
	writeFileSync(join(settingsRoot, ".gitignore"), "settings.json\n");

	const server = createWorkspaceServer({ settingsRoot });
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const base = `http://127.0.0.1:${server.address().port}`;
	const api = async (method, path, payload) => {
		const res = await fetch(base + path, {
			method,
			...(payload ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}),
		});
		return { status: res.status, body: await res.json().catch(() => null) };
	};
	api.base = base;
	try {
		await run({ api, dir });
	} finally {
		await new Promise((r) => server.close(r));
	}
}

test("BITES: the server STARTS with no config — that used to be impossible", async () => {
	await withNoProject(async ({ api }) => {
		const { status, body } = await api("GET", "/api/setup/state");
		assert.equal(status, 200);
		assert.equal(body.loaded, false);
		assert.ok(body.providers.length > 0, "the engine list is available before a project exists");
		assert.ok(body.defaultEngine, "and it knows which one it would pick");
	});
});

test("BITES: a project route with no project says needsSetup, it does not crash", async () => {
	await withNoProject(async ({ api }) => {
		const res = await api("GET", "/api/rows");
		assert.equal(res.status, 409);
		assert.equal(res.body.needsSetup, true, "the page must be able to tell WHY it is empty");
	});
});

test("inspect READS a candidate en.json and reports what it found, writing nothing", async () => {
	await withNoProject(async ({ api, dir }) => {
		const locales = join(dir, "app", "src", "locales");
		mkdirSync(locales, { recursive: true });
		writeFileSync(join(dir, "app", "package.json"), '{"name":"app"}');
		writeFileSync(join(locales, "en.json"), JSON.stringify({ a: { save: "Save {n} chapters" }, b: "Delete" }));
		writeFileSync(join(locales, "fr.json"), "{}");

		const { body } = await api("POST", "/api/setup/inspect", { path: join(locales, "en.json") });
		assert.equal(body.ok, true);
		assert.equal(body.keyCount, 2);
		assert.equal(body.sourceLanguage, "en");
		// An existing locale file is a FACT about the folder, reported with how much of the
		// catalogue it covers — not a decision about what to run. Nothing is pre-ticked.
		assert.deepEqual(body.locales, [{ code: "fr", done: 0, total: 2, missing: 2 }]);
		assert.equal(body.targets, undefined, "inspect reports; it does not choose targets for you");
		assert.equal(body.placeholder.prefix, "{", "the placeholder syntax is READ from the strings");
		assert.equal(existsSync(body.configPath), false, "inspect must not write anything");
	});
});

test("BITES: a bad path is reported in words, not as a crash", async () => {
	await withNoProject(async ({ api }) => {
		const res = await api("POST", "/api/setup/inspect", { path: "Z:/nope/en.json" });
		assert.equal(res.status, 400);
		assert.match(res.body.error, /no such file/);
		assert.equal((await api("POST", "/api/setup/inspect", { path: "  " })).status, 400);
	});
});

test("saving setup WRITES the config and the project goes live with no restart", async () => {
	await withNoProject(async ({ api, dir }) => {
		const locales = join(dir, "app", "src", "locales");
		mkdirSync(locales, { recursive: true });
		writeFileSync(join(dir, "app", "package.json"), '{"name":"app"}');
		writeFileSync(join(locales, "en.json"), JSON.stringify({ a: "Save" }));

		assert.equal((await api("GET", "/api/rows")).status, 409, "no project yet");

		const saved = await api("POST", "/api/setup/save", {
			path: join(locales, "en.json"),
			targets: ["es"],
			context: "a novel-writing app",
			engine: "ollama",
		});
		assert.equal(saved.status, 200);
		assert.deepEqual(saved.body.langs, ["es"]);

		// The whole point: no restart.
		assert.equal((await api("GET", "/api/rows")).status, 200, "the project did not go live");
		assert.equal((await api("GET", "/api/setup/state")).body.loaded, true);

		const written = JSON.parse(readFileSync(saved.body.configPath, "utf8"));
		assert.equal(written.context, "a novel-writing app");
		assert.equal(written.engine, "ollama");
	});
});

test("BITES: saving PRESERVES config fields the setup screen does not manage", async () => {
	// The UI is a writer, never an owner. A field added by hand — or by a future version — must
	// survive a save that knows nothing about it.
	await withNoProject(async ({ api, dir }) => {
		const locales = join(dir, "app", "src", "locales");
		mkdirSync(locales, { recursive: true });
		writeFileSync(join(dir, "app", "package.json"), '{"name":"app"}');
		writeFileSync(join(locales, "en.json"), JSON.stringify({ a: "Save" }));

		const first = await api("POST", "/api/setup/save", { path: join(locales, "en.json"), targets: ["es"] });
		const cfgPath = first.body.configPath;
		const withExtra = { ...JSON.parse(readFileSync(cfgPath, "utf8")), suspects: { topN: 200 }, _myNote: "hand-written" };
		writeFileSync(cfgPath, JSON.stringify(withExtra, null, 2));

		await api("POST", "/api/setup/save", { path: join(locales, "en.json"), targets: ["es", "fr"], context: "changed" });

		const after = JSON.parse(readFileSync(cfgPath, "utf8"));
		assert.deepEqual(after.suspects, { topN: 200 }, "an unmanaged field was destroyed by a save");
		assert.equal(after._myNote, "hand-written");
		assert.deepEqual(after.targets, ["es", "fr"], "…while the managed fields did change");
		assert.equal(after.context, "changed");
	});
});

test("BITES: the PAGE ITSELF loads with no project — the first thing a fresh install does", async () => {
	// This crashed on `npm start` in a fresh clone: the guard refuses /api/ paths but deliberately
	// lets everything else through to the static UI, so `GET /` reached `routes[route]` while
	// there was no route table. A TypeError on the very first page load, and it shipped because
	// the setup flow had only ever been exercised through the API, never by asking for the page.
	await withNoProject(async ({ api }) => {
		const res = await fetch(`${api.base}/`);
		assert.notEqual(res.status, 500, "the page must not 500 before a project exists");
		assert.ok(res.status === 200 || res.status === 404, `unexpected ${res.status}`);
	});
});
