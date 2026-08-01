// YOUR settings: connections, keys, your name. Tool-level, not per-project.
//
// The test that matters most is the last one: a key must never be storable into a file git
// would commit.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	SETTINGS_FILE,
	assertGitignored,
	dropConnection,
	getReviewer,
	listConnections,
	listProviders,
	openSettings,
	readConnection,
	readProvider,
	resolveConnection,
	saveConnection,
	setReviewer,
} from "../server/settings.js";

const tmp = () => mkdtempSync(join(tmpdir(), "jah-settings-"));

/** A stand-in engines.json, so these tests do not depend on the shipped catalogue's contents. */
const ENGINES = {
	_why: "prose, never a provider",
	ollama: { default: true, kind: "ollama", url: "http://127.0.0.1:11434", model: "m", think: false, _note: "prose" },
	openai: { kind: "openai-compat", url: "https://api.openai.com/v1", model: "gpt", apiKeyEnv: "OPENAI_API_KEY" },
};

// ── Providers come straight from engines.json, with no second copy ──────────────────────

test("a provider is read from engines.json, prose keys stripped", () => {
	const p = readProvider("ollama", ENGINES);
	assert.equal(p.kind, "ollama");
	assert.equal(p.think, false, "think:false must survive — it is meaningful, not absent");
	assert.ok(!("_note" in p), "prose must never reach a request body");
	assert.ok(!("default" in p), "the default marker is catalogue metadata, not a profile field");
});

test("BITES: underscore-prefixed keys are never offered as providers", () => {
	// `_why` is documentation. Listing it would put a prose blob in the engine dropdown.
	assert.equal(readProvider("_why", ENGINES), null);
	assert.deepEqual(listProviders(ENGINES).map((p) => p.name), ["ollama", "openai"]);
});

// ── Connections ─────────────────────────────────────────────────────────────────────────

test("a connection stores ONLY your overrides, so a tool update can still fix a moved endpoint", () => {
	const s = openSettings(tmp());
	const id = saveConnection(s, { label: "local", provider: "ollama", overrides: { model: "mine" } });
	const c = readConnection(s, id);
	assert.deepEqual(c.overrides, { model: "mine" }, "a full copy of the preset would freeze the endpoint forever");
	assert.equal(c.provider, "ollama");
});

test("resolveConnection layers your overrides on the preset, in the same order as the CLI", () => {
	const s = openSettings(tmp());
	const id = saveConnection(s, { label: "local", provider: "ollama", overrides: { model: "mine" } });
	const p = resolveConnection(s, id, ENGINES);
	assert.equal(p.url, "http://127.0.0.1:11434", "preset field survives");
	assert.equal(p.model, "mine", "your override wins");
	assert.equal(p.think, false);
});

test("BITES: a connection whose provider vanished says so instead of half-building a profile", () => {
	const s = openSettings(tmp());
	const id = saveConnection(s, { label: "gone", provider: "no-such-row", overrides: { model: "x" } });
	assert.equal(resolveConnection(s, id, ENGINES).missingProvider, "no-such-row");
});

test("BITES: the API key is NEVER in what the UI sees — only whether one is set", () => {
	// Every path that serialises toward a browser goes through readConnection/listConnections.
	const s = openSettings(tmp());
	const id = saveConnection(s, { label: "cloud", provider: "openai", overrides: {}, apiKey: "sk-secret" });
	const shown = readConnection(s, id);
	assert.equal(shown.hasKey, true);
	assert.ok(!("apiKey" in shown), "the key leaked into the UI shape");
	assert.equal(JSON.stringify(listConnections(s)).includes("sk-secret"), false, "the key leaked into the list");
	// …but the run path can still reach it.
	assert.equal(resolveConnection(s, id, ENGINES).apiKey, "sk-secret");
});

test("editing a label leaves the key alone; clearing it takes an explicit null", () => {
	const s = openSettings(tmp());
	const id = saveConnection(s, { label: "cloud", provider: "openai", apiKey: "sk-1" });
	saveConnection(s, { id, label: "renamed", provider: "openai" }); // apiKey undefined
	assert.equal(readConnection(s, id).hasKey, true, "renaming wiped the key");
	saveConnection(s, { id, label: "renamed", provider: "openai", apiKey: null });
	assert.equal(readConnection(s, id).hasKey, false);
});

test("settings survive a reopen — set up once, point at many apps", () => {
	// The whole reason this file is tool-level rather than per-project.
	const dir = tmp();
	saveConnection(openSettings(dir), { label: "local", provider: "ollama", overrides: {} });
	assert.equal(listConnections(openSettings(dir)).length, 1);
});

test("dropConnection removes only its own row", () => {
	const s = openSettings(tmp());
	const a = saveConnection(s, { label: "a", provider: "ollama" });
	saveConnection(s, { label: "b", provider: "ollama" });
	dropConnection(s, a);
	assert.deepEqual(listConnections(s).map((c) => c.label), ["b"]);
});

// ── The reviewer's name ─────────────────────────────────────────────────────────────────

test("the reviewer is asked for, not inherited — unset stays null", () => {
	// NOT the OS username and NOT git config: an automated run under your account would inherit
	// the name and become indistinguishable from your own judgement. That is the exact failure
	// the `by` field exists to expose, after 58 verdicts were written into a real project.
	const s = openSettings(tmp());
	assert.equal(getReviewer(s), null);
	setReviewer(s, "  danel  ");
	assert.equal(getReviewer(s), "danel", "it must trim");
	setReviewer(s, "   ");
	assert.equal(getReviewer(s), null, "blank is not a reviewer");
});

// ── The key guard ───────────────────────────────────────────────────────────────────────

test("BITES: storing a key is REFUSED when git does not ignore the settings file", () => {
	// A key committed to a repo is unrecoverable — it must be rotated. This is the one test in
	// the suite whose failure has a cost outside this machine.
	const dir = tmp();
	execFileSync("git", ["init", "-q"], { cwd: dir });
	writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
	assert.throws(() => assertGitignored(dir, SETTINGS_FILE), /refusing to store a key/);

	writeFileSync(join(dir, ".gitignore"), `node_modules/\n${SETTINGS_FILE}\n`);
	assert.equal(assertGitignored(dir, SETTINGS_FILE), true, "it must accept once git agrees");
});

test("the guard ASKS GIT, so a parent .gitignore counts", () => {
	// A hand-rolled .gitignore parser was wrong in the direction that matters — it refused where
	// git itself said the file was ignored. Real semantics include parent directories.
	const dir = tmp();
	execFileSync("git", ["init", "-q"], { cwd: dir });
	writeFileSync(join(dir, ".gitignore"), "tools/\n");
	const nested = join(dir, "tools", "just-ai-help");
	mkdirSync(nested, { recursive: true });
	assert.equal(assertGitignored(nested, SETTINGS_FILE), true, "a parent rule must count");
});

test("outside a git repo the guard passes, and SAYS WHY rather than passing silently", () => {
	const r = assertGitignored(tmp(), SETTINGS_FILE);
	assert.equal(r.ok, true);
	assert.match(r.reason, /not a git repository/);
});
