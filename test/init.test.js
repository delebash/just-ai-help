// `init` — setting a project up by pointing at its source file.
//
// This replaced `docs/config.example.json`, a template you had to find inside the TOOL's repo
// and copy into a different one, hand-editing four values including a relative path the example
// itself got wrong. A generator can do the thing a template never could: read the strings.
//
// The load-bearing tests are the two that assert DERIVATION — that the source language comes
// from the filename and the targets from the folder — because those are the fields a human
// would otherwise get wrong, and getting them wrong fails late and confusingly.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { defaultEngine, findProjectRoot, glossaryCandidates, localeCodesIn, planInit, writeInit } from "../server/init.js";
import { projectPaths } from "../server/paths.js";

/** A host app: package.json at the root, strings several directories down. */
function app({ files = { "en.json": { nav: { save: "Save" } } }, pkg = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "jah-init-"));
	const locales = join(root, "src", "renderer", "i18n", "locales");
	mkdirSync(locales, { recursive: true });
	if (pkg) writeFileSync(join(root, "package.json"), '{"name":"host"}');
	for (const [name, body] of Object.entries(files)) {
		writeFileSync(join(locales, name), JSON.stringify(body, null, 2));
	}
	return { root, locales };
}

test("the config records the FILE you pointed at, not its folder", () => {
	const { root, locales } = app();
	const plan = planInit(join(locales, "en.json"));
	assert.equal(plan.cfg.source, "../src/renderer/i18n/locales/en.json");
	assert.equal(plan.configPath, join(root, "just-ai-help", "config.json"));
	// No sourceLanguage field: the language IS the filename, so nothing can disagree with it.
	assert.ok(!("sourceLanguage" in plan.cfg));
	assert.ok(!("locales" in plan.cfg));
});

test("BITES: the source LANGUAGE comes from the filename — point at es.json and Spanish is the source", () => {
	const { locales } = app({
		files: { "es.json": { a: "Guardar" }, "en.json": { a: "Save" }, "fr.json": { a: "Enregistrer" } },
	});
	const plan = planInit(join(locales, "es.json"));
	assert.equal(plan.sourceLanguage, "es");
	assert.match(plan.cfg.source, /es\.json$/);
	// …and the source is never listed as one of its own targets.
	assert.deepEqual(plan.cfg.targets, ["en", "fr"]);
});

test("targets are the locale files already in the folder", () => {
	const { locales } = app({ files: { "en.json": { a: "Save" }, "de.json": { a: "Speichern" } } });
	assert.deepEqual(planInit(join(locales, "en.json")).cfg.targets, ["de"]);
});

test("a brand-new app — only en.json — gets empty targets rather than a guess", () => {
	const { locales } = app();
	const plan = planInit(join(locales, "en.json"));
	assert.deepEqual(plan.cfg.targets, []);
	assert.equal(plan.cfg.context, "");
});

test("the written config is READ BACK correctly by the path resolver", () => {
	// The round trip is the point: a generator that writes something the tool cannot read is
	// worse than no generator. The `../` in the relative path is exactly what the old example
	// file got wrong.
	const { locales } = app({ files: { "en.json": { a: "Save" }, "es.json": { a: "Guardar" } } });
	const plan = planInit(join(locales, "en.json"), { context: "an app" });
	const written = writeInit(plan);

	const cfg = JSON.parse(readFileSync(written, "utf8"));
	const paths = projectPaths(written, cfg);
	assert.equal(paths.sourceFile, join(resolve(locales), "en.json"));
	assert.equal(paths.localesDir, resolve(locales));
	assert.equal(paths.sourceLanguage, "en");
	assert.equal(paths.targetFile("es"), join(resolve(locales), "es.json"));
	// Sidecars land beside the config, keeping locales/ to app assets only.
	assert.equal(paths.acceptedFile("es"), join(plan.configDir, "es.accepted.json"));
});

test("BITES: an existing config is not clobbered without --force", () => {
	const { locales } = app();
	const plan = planInit(join(locales, "en.json"));
	writeInit(plan);
	writeFileSync(plan.configPath, '{"source":"hand-edited"}');
	assert.throws(() => writeInit(plan), /already exists/);
	// …and --force is honoured, so the escape hatch works.
	writeInit(plan, { force: true });
	assert.equal(JSON.parse(readFileSync(plan.configPath, "utf8")).source, plan.cfg.source);
});

test("placeholder and plural separator are REPORTED, not written into the config", () => {
	const { locales } = app({ files: { "en.json": { a: "{{n}} items", b: "one || many" } } });
	const plan = planInit(join(locales, "en.json"));
	assert.deepEqual(plan.placeholder, { prefix: "{{", suffix: "}}" });
	assert.equal(plan.pluralSeparator, " || ");
	// They are read from the source on every run, so storing them would be a second copy that
	// could go stale.
	assert.ok(!("placeholder" in plan.cfg));
	assert.ok(!("pluralSeparator" in plan.cfg));
});

test("a missing file, an empty catalogue and a rootless project all fail with usable messages", () => {
	const { locales } = app();
	assert.throws(() => planInit(join(locales, "nope.json")), /no such file/);

	const empty = app({ files: { "en.json": {} } });
	assert.throws(() => planInit(join(empty.locales, "en.json")), /holds no strings/);

	// No package.json anywhere above: guessing a location would scatter configs, so it asks.
	const bare = app({ pkg: false });
	assert.throws(() => planInit(join(bare.locales, "en.json")), /--out/);
	// …and --out satisfies it.
	assert.equal(planInit(join(bare.locales, "en.json"), { out: bare.root }).root, resolve(bare.root));
});

test("findProjectRoot walks up to package.json and stops at the filesystem root", () => {
	const { root, locales } = app();
	assert.equal(findProjectRoot(locales), resolve(root));
	assert.equal(findProjectRoot(locales, { marker: "no-such-marker-file" }), null);
});

test("localeCodesIn accepts locale files and ignores tooling sidecars", () => {
	const { locales } = app({ files: { "en.json": { a: "x" }, "pt-BR.json": { a: "x" } } });
	writeFileSync(join(locales, "es.accepted.json"), "{}");
	writeFileSync(join(locales, "es.notes.json"), "{}");
	assert.deepEqual(localeCodesIn(locales), ["en", "pt-BR"]);
	assert.deepEqual(localeCodesIn(join(locales, "nope")), []);
});

test("glossary candidates: recurring mid-sentence capitals, never a mere sentence opener", () => {
	const values = [
		"Export to EPUB from Acme Studio.",
		"Save your work in Acme Studio often.",
		"Open the file to make a PDF with Acme Studio.",
	];
	const got = glossaryCandidates(values);
	assert.deepEqual(got, ["Acme", "Studio"]);
	// "Save", "Export" and "Open" only ever open a sentence, so they are capitalised by grammar
	// rather than by being names — proposing them would be actively harmful.
	for (const w of ["Save", "Export", "Open"]) assert.ok(!got.includes(w), `${w} must not be proposed`);
});

test("BITES: candidates tying on count sort by name instead of throwing", () => {
	// The comparator received [word, count] entries and called localeCompare on the array,
	// which threw the moment two candidates tied — i.e. on almost any real catalogue.
	const values = ["a Beta and Alpha", "b Beta and Alpha", "c Beta and Alpha"];
    assert.deepEqual(glossaryCandidates(values), ["Alpha", "Beta"]);
});

test("BITES: a trailing full stop is not part of the word", () => {
	// "Studio." and "Studio" counted as two different terms, so a name ending a sentence never
	// reached the threshold. Inner punctuation — Vue.js, C++ — must still survive.
	assert.deepEqual(glossaryCandidates(["x Studio.", "y Studio.", "z Studio."]), ["Studio"]);
	assert.deepEqual(glossaryCandidates(["a Vue.js here", "b Vue.js there", "c Vue.js again"]), ["Vue.js"]);
});

test("nothing is written to disk until writeInit is called", () => {
	const { root, locales } = app();
	planInit(join(locales, "en.json"));
	assert.ok(!existsSync(join(root, "just-ai-help")), "planning must be a pure read");
});

// ── the engine field ────────────────────────────────────────────────────────────────────
// Added 2026-07-31 after a fresh init produced a config whose very next command died with
// `unknown engine "undefined"`. Setup that reports success and leaves you unable to run is
// worse than setup that fails.

test("BITES: an init'd config names an engine, so the next command actually runs", () => {
	const { locales } = app();

	const plan = planInit(join(locales, "en.json"));
	assert.ok(plan.cfg.engine, "config has no engine — `unknown engine \"undefined\"` on the next run");
	const engines = JSON.parse(readFileSync(new URL("../server/config/engines.json", import.meta.url), "utf8"));
	assert.ok(engines[plan.cfg.engine], `engine "${plan.cfg.engine}" is not a row in engines.json`);
});

test("--engine overrides the default", () => {
	const { locales } = app();
	assert.equal(planInit(join(locales, "en.json"), { engine: "openai" }).cfg.engine, "openai");
});

test("defaultEngine reads the marker from engines.json, and BITES if the data is ambiguous", () => {
	// The value is DATA, not a constant in code: swapping the recommended default is a row edit.
	const engines = JSON.parse(readFileSync(new URL("../server/config/engines.json", import.meta.url), "utf8"));
	assert.equal(defaultEngine(engines), "ollama");
	// Two defaults, or none, must fail loudly rather than silently pick one.
	assert.throws(() => defaultEngine({ a: { default: true }, b: { default: true } }), /exactly one row/);
	assert.throws(() => defaultEngine({ a: { kind: "ollama" } }), /exactly one row/);
});
