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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceServer } from "../src/server.js";

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
	// The guard refuses to store a key unless the store is genuinely ignored.
	writeFileSync(join(dir, ".gitignore"), "node_modules/\n.jah.db\n");
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

	const server = createWorkspaceServer({ configPath: join(dir, "config.json") });
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
		await run({ base, api, dir, locales, esPath: join(locales, "es.json"), server });
	} finally {
		server.jah.db.close();
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
	await withServer(async ({ api, locales }) => {
		await api("PUT", "/api/notes", { lang: "es", key: "characterAudit.why", note: "a label, not a question" });
		const rows = (await api("GET", "/api/rows?lang=es")).body.rows;
		assert.equal(rows.find((r) => r.key === "characterAudit.why").note, "a label, not a question");
		assert.ok(readFileSync(join(locales, "es.notes.json"), "utf8").includes("a label, not a question"));

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

test("STORING A KEY REFUSES when .gitignore does not cover the database", async () => {
	await withServer(async ({ api, dir }) => {
		writeFileSync(join(dir, ".gitignore"), "node_modules/\n"); // the guard's line removed
		const res = await api("PUT", "/api/engines/connection", { label: "groq", provider: "groq", apiKey: "sk-nope" });
		assert.equal(res.status, 400);
		assert.match(res.body.error, /does not cover/);
	});
});

test("a connection with no key is saved without consulting .gitignore", async () => {
	await withServer(async ({ api, dir }) => {
		writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
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
		const { putReference } = await import("../src/store.js");
		putReference(server.jah.db, { lang: "es", key: "settings.save", engine: "backtranslate", value: "Save" });
		const res = await api("POST", "/api/backtranslate", { lang: "es", key: "settings.save" });
		assert.equal(res.status, 200);
		assert.equal(res.body.english, "Save");
		assert.equal(res.body.cached, true, "no engine was consulted — and none is configured here");
	});
});

test("EDITING A KEY DROPS ITS CACHED SECOND OPINION — stale advice must not linger", async () => {
	await withServer(async ({ api, server }) => {
		const { putReference } = await import("../src/store.js");
		putReference(server.jah.db, { lang: "es", key: "settings.save", engine: "backtranslate", value: "old reading" });
		await api("POST", "/api/save", { lang: "es", key: "settings.save", value: "Guardar todo" });
		const res = await api("GET", "/api/reference?lang=es&key=settings.save");
		assert.equal(res.body.cached, null, "the reading was about the old text");
	});
});
