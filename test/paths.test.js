// Path resolution. Every one of these asserts a bug that was REAL, not a hypothetical.
//
// The tool used to resolve `localesDir` and the cache against the WORKING DIRECTORY. That is
// why every documented command started with a `cd`, and why running from the wrong folder
// silently began with no cache and re-translated a whole catalogue — 27 minutes and 464
// hand-corrected keys, measured on 2026-07-31.
//
// The first test is the load-bearing one: it runs from a directory that is not the project.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { projectPaths } from "../server/paths.js";

/** A project laid out the way a host app really is: config at root, strings deeper in. */
function project({ sidecarsInLocales = false, key = "locales" } = {}) {
	const root = mkdtempSync(join(tmpdir(), "jah-paths-"));
	const locales = join(root, "src", "i18n", "locales");
	mkdirSync(locales, { recursive: true });
	writeFileSync(join(locales, "en.json"), "{}");
	if (sidecarsInLocales) writeFileSync(join(locales, "es.accepted.json"), "{}");
	const configPath = join(root, "config.json");
	writeFileSync(configPath, JSON.stringify({ [key]: "src/i18n/locales", targets: ["es"] }));
	return { root, locales, configPath };
}

test("BITES: paths do NOT depend on the working directory", () => {
	const { root, locales, configPath } = project();
	const cwd = process.cwd();
	try {
		// Stand somewhere entirely unrelated — the state that used to break everything.
		process.chdir(tmpdir());
		const p = projectPaths(configPath, JSON.parse(readFileSync(configPath, "utf8")));
		assert.equal(p.localesDir, resolve(locales), "localesDir must come from the config's own folder");
		assert.equal(p.sourceFile, join(resolve(locales), "en.json"));
		assert.equal(p.cachePath, join(resolve(root), ".jah-cache.json"), "the cache must not follow the shell");
	} finally {
		process.chdir(cwd);
	}
});

test("a relative config path resolves the same as an absolute one", () => {
	const { configPath, locales } = project();
	const cfg = JSON.parse(readFileSync(configPath, "utf8"));
	const cwd = process.cwd();
	try {
		process.chdir(resolve(configPath, ".."));
		const rel = projectPaths("config.json", cfg);
		const abs = projectPaths(configPath, cfg);
		assert.equal(rel.localesDir, abs.localesDir);
		assert.equal(rel.localesDir, resolve(locales));
	} finally {
		process.chdir(cwd);
	}
});

test("the older `localesDir` key still works — upgrading must not invalidate a config", () => {
	const { configPath, locales } = project({ key: "localesDir" });
	const cfg = JSON.parse(readFileSync(configPath, "utf8"));
	assert.equal(projectPaths(configPath, cfg).localesDir, resolve(locales));
});

test("a config naming no source file fails with a message that names the problem", () => {
	const { root } = project();
	assert.throws(() => projectPaths(join(root, "config.json"), { targets: ["es"] }), /has no "source"/);
});

test("sidecars default beside the config, so locales/ holds app assets only", () => {
	const { root, configPath } = project();
	const cfg = JSON.parse(readFileSync(configPath, "utf8"));
	const p = projectPaths(configPath, cfg);
	assert.equal(p.acceptedFile("es"), join(resolve(root), "es.accepted.json"));
	assert.equal(p.notesFile("es"), join(resolve(root), "es.notes.json"));
	assert.equal(p.probeFile("es"), join(resolve(root), "es.probe.json"));
	// The translation itself is an app asset and stays where the app loads it.
	assert.equal(p.targetFile("es"), join(p.localesDir, "es.json"));
});

test("BITES: a project that ALREADY keeps sidecars in locales/ keeps using it", () => {
	// Upgrading the tool must never orphan a reviewer's verdicts by looking somewhere new.
	const { locales, configPath } = project({ sidecarsInLocales: true });
	const cfg = JSON.parse(readFileSync(configPath, "utf8"));
	const p = projectPaths(configPath, cfg);
	assert.equal(p.acceptedFile("es"), join(resolve(locales), "es.accepted.json"));
	// …and ALL sidecars follow, not just the one that existed. Deciding per file split a real
	// catalogue across two folders.
	assert.equal(p.notesFile("es"), join(resolve(locales), "es.notes.json"));
	assert.equal(p.sidecarDir, resolve(locales));
});
