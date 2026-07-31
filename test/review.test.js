// The review CLI entry point.
//
// The API contract itself lives in server.test.js; this file covers what `createReviewServer`
// adds on top — serving the committed UI build, and surviving its absence.
//
// The endpoint assertions that used to live here moved to server.test.js when /api/data became
// /api/rows and gained a language dimension. Carried over rather than dropped:
//
//   "save fixes a flag and clears it"                -> server.test.js, save + rows
//   "save can INTRODUCE a flag"                      -> below, unchanged in spirit
//   "byte-identical except that value"               -> server.test.js
//   "an acceptance does not survive an edit"         -> server.test.js
//   "404s an unknown key rather than writing junk"   -> below
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_UI, createReviewServer } from "../server/review.js";

const EN = { nav: { chapters: "Chapters" }, settings: { save: "Save" }, chapters: { title: "Delete this chapter?" } };
const ES = { nav: { chapters: "Capítulos" }, settings: { save: "Guardar" }, chapters: { title: "¿Eliminar este capítulo?" } };

async function withServer(run, { uiDir } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "jah-entry-"));
	const locales = join(dir, "locales");
	mkdirSync(locales, { recursive: true });
	writeFileSync(join(dir, ".gitignore"), ".jah.db\n");
	writeFileSync(
		join(dir, "config.json"),
		JSON.stringify({
			localesDir: locales,
			sourceLanguage: "en",
			targets: ["es"],
			placeholder: { prefix: "{", suffix: "}" },
			pluralSeparator: "|",
			glossary: { doNotTranslate: [] },
		}),
	);
	writeFileSync(join(locales, "en.json"), `${JSON.stringify(EN, null, 2)}\n`);
	writeFileSync(join(locales, "es.json"), `${JSON.stringify(ES, null, 2)}\n`);

	const server = createReviewServer({ configPath: join(dir, "config.json"), ...(uiDir !== undefined ? { uiDir } : {}) });
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
		await run({ base, api, locales });
	} finally {
		server.jah.db.close();
		await new Promise((r) => server.close(r));
	}
}

test("GET / serves the committed UI build", { skip: existsSync(DEFAULT_UI) ? false : "no build — run npm run build:ui" }, async () => {
	await withServer(async ({ base }) => {
		const res = await fetch(`${base}/`);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type"), /text\/html/);
		assert.match(await res.text(), /app\.js/, "the built entry point must be referenced");
	});
});

test("a deep link falls back to the app rather than 404ing", { skip: existsSync(DEFAULT_UI) ? false : "no build" }, async () => {
	await withServer(async ({ base }) => {
		assert.equal((await fetch(`${base}/some/client/route`)).status, 200);
	});
});

test("WITHOUT A BUILD the API still works — the tool degrades, it does not break", async () => {
	await withServer(async ({ api }) => {
		assert.equal((await api("GET", "/api/state")).status, 200);
		assert.equal((await fetch("http://127.0.0.1:1/").catch(() => ({ ok: false }))).ok, false);
	}, { uiDir: join(tmpdir(), "definitely-not-a-build") });
});

test("saving can INTRODUCE a flag — the checks re-run, they are not cached", async () => {
	await withServer(async ({ api }) => {
		const clean = (await api("GET", "/api/rows?lang=es")).body.rows.find((r) => r.key === "settings.save");
		assert.ok(!clean, "settings.save starts clean");

		await api("POST", "/api/save", { lang: "es", key: "settings.save", value: "Save" });
		const now = (await api("GET", "/api/rows?lang=es")).body.rows.find((r) => r.key === "settings.save");
		assert.ok(now?.flags.some((f) => f.code === "untranslated"), "a bad edit must be flagged immediately");
	});
});

test("an unknown key 404s rather than writing junk into the catalogue", async () => {
	await withServer(async ({ api, locales }) => {
		const before = readFileSync(join(locales, "es.json"), "utf8");
		assert.equal((await api("POST", "/api/save", { lang: "es", key: "no.such.key", value: "x" })).status, 404);
		assert.equal((await api("POST", "/api/accept", { lang: "es", key: "no.such.key" })).status, 404);
		assert.equal(readFileSync(join(locales, "es.json"), "utf8"), before, "a rejected write must change nothing");
	});
});

test("a missing config exits with a usable message rather than a stack trace", () => {
	// The factory throws on a missing file; the CLI branch turns that into one line. Asserting
	// the throw is what stops a refactor from silently starting a server on an empty config.
	assert.throws(() => createReviewServer({ configPath: join(tmpdir(), "nope-does-not-exist.json") }));
});
