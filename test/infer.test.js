// Reading the catalogue instead of asking for config.
//
// `placeholder` and `pluralSeparator` were both required, and both were traps: omitting
// `placeholder` threw a raw TypeError from deep inside jsonutil.js, and `pluralSeparator` was
// obeyed by the checks while the PROMPT had `" | "` typed into it — so it worked on the default
// by coincidence and broke silently on any other value.
//
// Both facts are in en.json. These tests assert we read them, and that an explicit config value
// always beats what was read.

import assert from "node:assert/strict";
import test from "node:test";
import { inferConfig, inferPlaceholder, inferPluralSeparator } from "../server/infer.js";

test("vue-i18n single braces are detected", () => {
	assert.deepEqual(inferPlaceholder(["Delete {n} items", "Hello {name}"]), { prefix: "{", suffix: "}" });
});

test("BITES: i18next double braces are NOT read as single braces", () => {
	// `{{n}}` also matches a single-brace pattern, so a naive first-match wins the wrong way.
	assert.deepEqual(inferPlaceholder(["Delete {{n}} items", "Hi {{name}}"]), { prefix: "{{", suffix: "}}" });
});

test("one stray brace in prose does not outvote a whole catalogue", () => {
	const values = ["Use {n} of these", "and {count} more", "a literal {{ in prose"];
	assert.deepEqual(inferPlaceholder(values), { prefix: "{", suffix: "}" });
});

test("a catalogue with no interpolations at all falls back to braces", () => {
	assert.deepEqual(inferPlaceholder(["Save", "Cancel"]), { prefix: "{", suffix: "}" });
});

test("the plural separator is read from the strings", () => {
	assert.equal(inferPluralSeparator(["{n} item | {n} items", "Save"]), " | ");
});

test("BITES: a pipe inside prose is not mistaken for a separator", () => {
	// "a | b" needs content on BOTH sides to be a plural form. A trailing pipe is punctuation.
	assert.equal(inferPluralSeparator(["Filter by name |", "Save"]), null);
});

test("a catalogue with no plurals infers null, which is a real answer", () => {
	// i18next keeps plurals as separate keys, so having none is normal — and the checks
	// correctly skip plural checking when the separator is null.
	assert.equal(inferPluralSeparator(["Save", "Cancel"]), null);
});

test("BITES: an explicit config value always beats inference", () => {
	const src = { a: "{n} item | {n} items" };
	const { cfg, inferred } = inferConfig({ placeholder: { prefix: "{{", suffix: "}}" }, pluralSeparator: ";" }, src);
	assert.deepEqual(cfg.placeholder, { prefix: "{{", suffix: "}}" });
	assert.equal(cfg.pluralSeparator, ";");
	assert.deepEqual(inferred, [], "nothing was inferred, so nothing is reported");
});

test("an explicit null separator is honoured and NOT re-inferred", () => {
	// The difference between "not stated" and "stated as none" — `in` rather than truthiness.
	const { cfg, inferred } = inferConfig({ pluralSeparator: null }, { a: "{n} x | {n} xs" });
	assert.equal(cfg.pluralSeparator, null);
	assert.ok(!inferred.some((s) => s.includes("pluralSeparator")));
});

test("what was inferred is REPORTED, never decided quietly", () => {
	const { inferred } = inferConfig({}, { a: "{n} item | {n} items" });
	assert.equal(inferred.length, 2);
	assert.ok(inferred.some((s) => s.includes("placeholder")));
	assert.ok(inferred.some((s) => s.includes("pluralSeparator")));
});

test("a bare glossary array is accepted as well as the nested shape", () => {
	assert.deepEqual(inferConfig({ glossary: ["Acme", "PDF"] }, {}).cfg.glossary, { doNotTranslate: ["Acme", "PDF"] });
	assert.deepEqual(inferConfig({ glossary: { doNotTranslate: ["X"] } }, {}).cfg.glossary, { doNotTranslate: ["X"] });
});
