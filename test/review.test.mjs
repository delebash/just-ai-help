// The review page's contract, tested over the real HTTP endpoints against a real temp
// locale folder. The one that matters is the round-trip: saving one value must leave the
// file byte-identical except that value. A review tool that reformats the file on every
// save produces an 800-line diff for a one-word fix, and nobody can review that.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReviewServer } from "../src/review.mjs";

const EN = {
	nav: { chapters: "Chapters", strands: "Strands" },
	chapters: {
		outline: { noteCount: "{n} note | {n} notes" },
		dialogs: { deleteTitle: "Delete this chapter?" },
	},
	settings: { save: "Save" },
};
const ES = {
	nav: { chapters: "Capítulos", strands: "Strands" },
	chapters: {
		outline: { noteCount: "{n} nota | {n} notas" },
		dialogs: { deleteTitle: "Eliminar este capítulo?" }, // missing ¿ — a startpunc flag
	},
	settings: { save: "Guardar" },
};

/** Spins up the server on an ephemeral port over a fresh temp locale folder. */
async function withServer(run) {
	const dir = mkdtempSync(join(tmpdir(), "jah-review-"));
	const locales = join(dir, "locales");
	writeFileSync(join(dir, "config.json"), JSON.stringify({
		localesDir: locales,
		sourceLanguage: "en",
		targets: ["es"],
		placeholder: { prefix: "{", suffix: "}" },
		pluralSeparator: "|",
		glossary: { doNotTranslate: ["Strands"] },
	}));
	mkdirSync(locales, { recursive: true });
	writeFileSync(join(locales, "en.json"), `${JSON.stringify(EN, null, 2)}\n`);
	writeFileSync(join(locales, "es.json"), `${JSON.stringify(ES, null, 2)}\n`);

	const server = createReviewServer({ configPath: join(dir, "config.json"), lang: "es" });
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		await run({ base, esPath: join(locales, "es.json") });
	} finally {
		await new Promise((r) => server.close(r));
	}
}

test("GET / serves the page", async () => {
	await withServer(async ({ base }) => {
		const res = await fetch(`${base}/`);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type"), /text\/html/);
		const html = await res.text();
		assert.match(html, /just-ai-help review/);
		assert.match(html, /\/api\/data/);
	});
});

test("GET /api/data returns every key, flagged rows first, with reasons", async () => {
	await withServer(async ({ base }) => {
		const data = await (await fetch(`${base}/api/data`)).json();
		assert.equal(data.total, 5);
		assert.equal(data.flagged, 1);
		assert.equal(data.rows[0].key, "chapters.dialogs.deleteTitle");
		assert.deepEqual(data.rows[0].flags.map((f) => f.code), ["startpunc"]);
		assert.ok(data.rows[0].flags[0].detail.length > 0);
		// The rest carry no flags — including "Strands" -> "Strands", which is correct.
		assert.deepEqual(data.rows.slice(1).flatMap((r) => r.flags), []);
	});
});

test("POST /api/save fixes a flag and clears it", async () => {
	await withServer(async ({ base }) => {
		const res = await fetch(`${base}/api/save`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ key: "chapters.dialogs.deleteTitle", value: "¿Eliminar este capítulo?" }),
		});
		assert.equal(res.status, 200);
		const out = await res.json();
		assert.deepEqual(out.flags, []);
		assert.equal(out.flagged, 0);
		assert.equal(out.findings, 0);
	});
});

test("POST /api/save can INTRODUCE a flag — the checks re-run, they are not cached", async () => {
	await withServer(async ({ base }) => {
		const out = await (await fetch(`${base}/api/save`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ key: "chapters.outline.noteCount", value: "{n} nota | {n} nota" }),
		})).json();
		assert.deepEqual(out.flags.map((f) => f.code), ["plural-halves-identical"]);
	});
});

test("saving one value leaves the file byte-identical except that value", async () => {
	await withServer(async ({ base, esPath }) => {
		const before = readFileSync(esPath, "utf8");
		await fetch(`${base}/api/save`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ key: "settings.save", value: "Guardar cambios" }),
		});
		const after = readFileSync(esPath, "utf8");
		assert.equal(after, before.replace('"save": "Guardar"', '"save": "Guardar cambios"'));

		// And the structure is the SOURCE's, not the target's insertion order.
		assert.deepEqual(Object.keys(JSON.parse(after)), Object.keys(EN));
		assert.deepEqual(Object.keys(JSON.parse(after).chapters), Object.keys(EN.chapters));
	});
});

test("POST /api/save rejects a bad body and an unknown key", async () => {
	await withServer(async ({ base }) => {
		const post = (body) =>
			fetch(`${base}/api/save`, { method: "POST", headers: { "content-type": "application/json" }, body });
		assert.equal((await post("not json")).status, 400);
		assert.equal((await post(JSON.stringify({ key: 1, value: "x" }))).status, 400);
		assert.equal((await post(JSON.stringify({ key: "no.such.key", value: "x" }))).status, 404);
	});
});

test("unknown routes 404", async () => {
	await withServer(async ({ base }) => {
		assert.equal((await fetch(`${base}/nope`)).status, 404);
	});
});
