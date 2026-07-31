// Engine resolution — one merge, both doors.
//
// THE BUG THESE EXIST FOR. There were two resolvers. The CLI layered a project config's
// overrides onto an engines.json row; the workspace resolved a connection and layered NOTHING.
// `cfg.model`, `cfg.url` and `cfg.think` appeared zero times in server.js's job path, so an
// override set in your config worked from the terminal and was silently ignored when you
// pressed re-translate in the UI. Same tool, same config, two answers, no warning.
//
// The third test is the load-bearing one: it asserts a connection gets the same treatment as
// an engine row. If someone re-splits the resolvers, it fails.

import assert from "node:assert/strict";
import test from "node:test";
import { applyConfigOverrides, profileProblem, resolveEngineRow } from "../server/engine.js";

const ENGINES = {
	ollama: { kind: "ollama", url: "http://127.0.0.1:11434", model: "gemma", think: false, batchSize: 16 },
	openai: { kind: "openai", url: "https://api.openai.com", model: "gpt-4o-mini", apiKeyEnv: "OPENAI_API_KEY" },
	needsModel: { kind: "openai", url: "http://localhost:8080", model: "REQUIRED — your served model id" },
};

test("a bare row resolves when the config overrides nothing", () => {
	const { profile, problem } = resolveEngineRow(ENGINES, "ollama", {});
	assert.equal(problem, null);
	assert.equal(profile.model, "gemma");
	assert.equal(profile.batchSize, 16);
});

test("config overrides win, narrowest last", () => {
	const cfg = { profile: { batchSize: 4, rateLimitMs: 900 }, model: "mine:latest", url: "http://elsewhere", think: "low" };
	const { profile } = resolveEngineRow(ENGINES, "ollama", cfg);
	assert.equal(profile.model, "mine:latest", "cfg.model beats both the row and cfg.profile");
	assert.equal(profile.url, "http://elsewhere");
	assert.equal(profile.think, "low");
	assert.equal(profile.batchSize, 4, "cfg.profile reaches fields with no dedicated key");
	assert.equal(profile.rateLimitMs, 900);
	assert.equal(profile.kind, "ollama", "anything unmentioned survives from the row");
});

test("BITES: a CONNECTION gets the same overrides an engine row does", () => {
	// This is the whole point. A connection comes from the database rather than engines.json,
	// and before 2026-07-31 it was handed to the job loop untouched.
	const connection = { kind: "ollama", url: "http://127.0.0.1:11434", model: "from-the-database", batchSize: 16 };
	const cfg = { model: "from-the-project-config", profile: { batchSize: 2 } };
	const merged = applyConfigOverrides(connection, cfg);
	assert.equal(merged.model, "from-the-project-config", "the project config must reach the workspace path too");
	assert.equal(merged.batchSize, 2);
	assert.equal(merged.kind, "ollama");
});

test("no config is not an error — it just means no overrides", () => {
	const merged = applyConfigOverrides({ model: "m", kind: "ollama" }, null);
	assert.deepEqual(merged, { model: "m", kind: "ollama" });
});

test("--escalate deliberately inherits NO config overrides", () => {
	// Escalating means "run this somewhere else". Inheriting cfg.model would run the same
	// model twice and silently defeat the point.
	const cfg = { model: "the-model-that-just-failed" };
	const { profile } = resolveEngineRow(ENGINES, "ollama", cfg, { applyOverrides: false });
	assert.equal(profile.model, "gemma");
});

test("BITES: an unknown engine names what IS known", () => {
	const { profile, problem } = resolveEngineRow(ENGINES, "nope", {});
	assert.equal(profile, null);
	assert.match(problem, /unknown engine "nope"/);
	assert.match(problem, /ollama/, "the message has to list the options, or it is a dead end");
});

test("BITES: a placeholder model id is refused rather than sent to a server", () => {
	const { problem } = resolveEngineRow(ENGINES, "needsModel", {});
	assert.match(problem, /needs a model id/);
	// …and naming one in the config clears it.
	assert.equal(resolveEngineRow(ENGINES, "needsModel", { model: "llama3" }).problem, null);
});

test("BITES: a missing API key is reported, and a connection's own key satisfies it", () => {
	assert.match(profileProblem(ENGINES.openai, { name: "openai", env: {} }), /set OPENAI_API_KEY/);
	assert.equal(profileProblem(ENGINES.openai, { name: "openai", env: { OPENAI_API_KEY: "k" } }), null);
	// A connection carries its key from the database and has no env var to consult.
	assert.equal(profileProblem({ ...ENGINES.openai, apiKey: "from-db" }, { env: {} }), null);
});

test("a connection pointing at a deleted provider is reported, not run half-built", () => {
	assert.match(profileProblem({ missingProvider: "groq" }), /no longer exists: groq/);
});
