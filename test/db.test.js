// The workshop store. The bar is the same as everywhere else here: a mechanism that has never
// been seen to FAIL is indistinguishable from one that cannot work, so every guard below is
// handed a deliberately broken input and asserted to complain.
//
// The load-bearing properties, in the order they would hurt if they broke:
//
//   1. re-seeding presets must NOT touch a user's key or overrides — that is what makes the
//      wholesale replace safe, and it is the whole update story;
//   2. a key must never appear in anything the UI can read;
//   3. storing a key must REFUSE when .gitignore does not cover the database;
//   4. a second open must migrate, not clobber — the difference between resuming a review and
//      losing one;
//   5. `think: false` must survive a round trip, because absent and false mean different
//      things to a thinking model and the wrong one returns empty content.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	assertGitignored,
	DB_FILE,
	getPref,
	listConnections,
	listProviders,
	loadSecretsIntoEnv,
	openDb,
	readConnection,
	readProvider,
	resolveConnection,
	saveConnection,
	schemaVersion,
	seedProviders,
	setPref,
} from "../src/db.js";

const tmp = () => mkdtempSync(join(tmpdir(), "jah-db-"));
const fresh = () => openDb(join(tmp(), DB_FILE));

/** A two-row engines.json, shaped like the real one including the meta keys that must be skipped. */
const ENGINES = {
	_why: "documentation, not a row",
	_schema: { kind: "also not a row" },
	ollama: {
		kind: "ollama",
		url: "http://127.0.0.1:11434",
		model: "hf.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL",
		think: false,
		batchSize: 16,
		timeoutMs: 300000,
		maxOutputTokens: 8192,
		_note: "the shipped default",
	},
	groq: {
		kind: "openai-compat",
		url: "https://api.groq.com/openai/v1",
		model: "llama-3.1-8b-instant",
		apiKeyEnv: "GROQ_API_KEY",
		batchSize: 32,
		rateLimitMs: 100,
		timeoutMs: 120000,
		maxOutputTokens: 16000,
	},
};

test("seeding skips the _meta keys and loads only real rows", () => {
	const db = fresh();
	const n = seedProviders(db, ENGINES);
	assert.equal(n, 2);
	assert.deepEqual(
		listProviders(db).map((p) => p.name),
		["groq", "ollama"],
	);
});

test("think:false survives the round trip — absent and false are different instructions", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	const ollama = readProvider(db, "ollama");
	assert.equal(ollama.think, false, "false must come back as false, not as absent");
	assert.ok(!("think" in readProvider(db, "groq")), "a row without think must not gain one");
});

test("a connection resolves to preset fields with its own overrides on top", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	const id = saveConnection(db, { label: "my groq", provider: "groq", overrides: { model: "llama-3.3-70b" } });
	const profile = resolveConnection(db, id);
	assert.equal(profile.model, "llama-3.3-70b", "the override wins");
	assert.equal(profile.url, "https://api.groq.com/openai/v1", "un-overridden preset fields come through");
	assert.equal(profile.batchSize, 32);
});

test("RE-SEEDING FIXES A STALE URL AND TOUCHES NOTHING OF THE USER'S", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	const id = saveConnection(db, {
		label: "my groq",
		provider: "groq",
		overrides: { model: "llama-3.3-70b" },
		apiKey: "sk-secret",
	});

	// A tool update moves the endpoint.
	seedProviders(db, { ...ENGINES, groq: { ...ENGINES.groq, url: "https://api.groq.com/openai/v2" } });

	const profile = resolveConnection(db, id);
	assert.equal(profile.url, "https://api.groq.com/openai/v2", "the update reached the user");
	assert.equal(profile.model, "llama-3.3-70b", "the user's override survived");
	assert.equal(readConnection(db, id).hasKey, true, "the user's key survived");
});

test("a connection whose provider vanished says so instead of running half-configured", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	const id = saveConnection(db, { label: "gone", provider: "groq", overrides: { model: "x" } });
	seedProviders(db, { ollama: ENGINES.ollama }); // groq dropped from the catalogue
	assert.equal(resolveConnection(db, id).missingProvider, "groq");
});

test("a custom connection needs no preset at all", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	const id = saveConnection(db, {
		label: "my llama-server",
		provider: null,
		overrides: { kind: "openai-compat", url: "http://127.0.0.1:8080/v1", model: "whatever-i-serve" },
	});
	const profile = resolveConnection(db, id);
	assert.equal(profile._custom, true);
	assert.equal(profile.model, "whatever-i-serve");
});

test("THE KEY IS NEVER RETURNED — only whether one is set", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	const id = saveConnection(db, { label: "k", provider: "groq", apiKey: "sk-do-not-leak" });

	for (const shape of [readConnection(db, id), listConnections(db)]) {
		assert.ok(!JSON.stringify(shape).includes("sk-do-not-leak"), "a key must not appear in a UI-facing shape");
	}
	assert.equal(readConnection(db, id).hasKey, true);
});

test("editing a connection without passing a key leaves the key alone", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	const id = saveConnection(db, { label: "k", provider: "groq", apiKey: "sk-keep-me" });
	saveConnection(db, { id, label: "renamed", provider: "groq", overrides: {} });
	assert.equal(readConnection(db, id).hasKey, true, "a rename must not wipe the key");
	assert.equal(readConnection(db, id).label, "renamed");
});

test("stored keys reach the pipeline the only way it reads them — process.env", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	saveConnection(db, { label: "k", provider: "groq", apiKey: "sk-abc" });
	const env = {};
	assert.equal(loadSecretsIntoEnv(db, env), 1);
	assert.equal(env.GROQ_API_KEY, "sk-abc", "loop.js:137 reads exactly this");
});

test("a connection with no key contributes nothing to the environment", () => {
	const db = fresh();
	seedProviders(db, ENGINES);
	saveConnection(db, { label: "local", provider: "ollama" });
	const env = {};
	assert.equal(loadSecretsIntoEnv(db, env), 0);
	assert.deepEqual(env, {});
});

test("REFUSES to store a key when .gitignore does not cover the database", () => {
	const root = tmp();
	writeFileSync(join(root, ".gitignore"), "node_modules/\n*.log\n");
	assert.throws(() => assertGitignored(root, DB_FILE), /does not cover/, "a bare .gitignore must be rejected");
});

test("REFUSES to store a key when there is no .gitignore at all", () => {
	assert.throws(() => assertGitignored(tmp(), DB_FILE), /no \.gitignore/);
});

test("accepts a .gitignore that names the database, and one that globs it", () => {
	for (const line of [DB_FILE, `/${DB_FILE}`, "*.db"]) {
		const root = tmp();
		writeFileSync(join(root, ".gitignore"), `node_modules/\n${line}\n`);
		assert.equal(assertGitignored(root, DB_FILE), true, `"${line}" should count as covering it`);
	}
});

test("a comment mentioning the file does not count as ignoring it", () => {
	const root = tmp();
	writeFileSync(join(root, ".gitignore"), `# remember to ignore ${DB_FILE}\nnode_modules/\n`);
	assert.throws(() => assertGitignored(root, DB_FILE), /does not cover/);
});

test("a SECOND open migrates rather than clobbers — a review survives a restart", () => {
	const dir = tmp();
	const path = join(dir, DB_FILE);

	const first = openDb(path);
	seedProviders(first, ENGINES);
	const id = saveConnection(first, { label: "mine", provider: "groq", apiKey: "sk-1" });
	setPref(first, "selectedConnection", id);
	first.prepare("INSERT INTO review_state (lang, key, status, visited_at) VALUES (?,?,?,?)").run(
		"es",
		"characterAudit.why",
		"reviewed",
		new Date().toISOString(),
	);
	first.close();

	const second = openDb(path);
	assert.equal(schemaVersion(second), 1);
	assert.equal(getPref(second, "selectedConnection"), id, "the remembered dropdown survived");
	assert.equal(readConnection(second, id).hasKey, true, "the key survived");
	assert.equal(
		second.prepare("SELECT status FROM review_state WHERE lang=? AND key=?").get("es", "characterAudit.why").status,
		"reviewed",
		"review progress survived — this is the whole reason for the database",
	);
});

test("prefs round-trip JSON values, including false", () => {
	const db = fresh();
	setPref(db, "groupByKey", false);
	assert.equal(getPref(db, "groupByKey"), false);
	assert.equal(getPref(db, "neverSet", "fallback"), "fallback");
});
