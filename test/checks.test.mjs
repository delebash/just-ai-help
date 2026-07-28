// Every check gets TWO cases: a clean string it must stay silent about, and a deliberately
// broken one it must complain about. The second is the point. A check that has never been
// seen to fail is indistinguishable from a check that cannot fail — and this project exists
// because a tool that always exited 0 looked exactly like a tool that worked.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildContext, checkOne, runChecks } from "../src/checks.mjs";

const conventions = JSON.parse(readFileSync(new URL("../src/conventions.json", import.meta.url), "utf8"));

const cfg = {
	placeholder: { prefix: "{", suffix: "}" },
	pluralSeparator: "|",
	glossary: { doNotTranslate: ["JustWrite", "Strands"] },
};
const ctx = buildContext(cfg, conventions, "es");

/** Returns the set of codes raised for one source/target pair. */
const codes = (src, dst) => checkOne({ key: "k", src, dst, ctx }).map((f) => f.code);

test("clean translations raise nothing", () => {
	assert.deepEqual(codes("Delete {n} note?", "¿Eliminar {n} nota?"), []);
	assert.deepEqual(codes("{n} note | {n} notes", "{n} nota | {n} notas"), []);
	assert.deepEqual(codes("Open JustWrite", "Abrir JustWrite"), []);
	assert.deepEqual(codes("Save", "Guardar"), []);
});

test("placeholder-changed bites when an interpolation is rewritten", () => {
	// The exact defect lingo.dev produced on the corpus, 2026-07-27.
	assert.ok(codes("{n} note | {n} notes", "{n} nota | {3} notas").includes("placeholder-changed"));
	assert.ok(codes("Move to {into}", "Mover a {dentro}").includes("placeholder-changed"));
	assert.ok(codes("Hello {name}", "Hola").includes("placeholder-changed"));
});

test("plural-halves-lost bites when a form disappears", () => {
	assert.ok(codes("{n} note | {n} notes", "{n} notas").includes("plural-halves-lost"));
});

test("plural-halves-identical bites — the one nothing else catches", () => {
	// Right separator, right placeholders, right word count, and still wrong.
	const found = codes("Delete {n} autosave? | Delete {n} autosaves?", "¿Eliminar {n} autoguardados? | ¿Eliminar {n} autoguardados?");
	assert.ok(found.includes("plural-halves-identical"));
});

test("glossary-translated bites when a brand name is translated", () => {
	// "Strands" -> "Hilos", produced by both lingo.dev and one unshielded run, 2026-07-27.
	assert.ok(codes("Strands", "Hilos").includes("glossary-translated"));
	assert.ok(codes("Open JustWrite now", "Abrir Escribir ahora").includes("glossary-translated"));
});

test("untranslated bites on a skipped string but NOT on a shielded-only one", () => {
	assert.ok(codes("Chapters", "Chapters").includes("untranslated"));
	// Shielded content is meant to come back unchanged. Flagging our own correct behaviour
	// would train people to ignore the report.
	assert.deepEqual(codes("Strands", "Strands"), []);
	assert.deepEqual(codes("{count}", "{count}"), []);
});

test("startpunc bites on the missing Spanish opening mark", () => {
	// Measured 5/5 failures on qwen3:8b and 5/5 on lingo.dev, both with the rule in the prompt.
	assert.ok(codes("Delete this chapter?", "Eliminar este capítulo?").includes("startpunc"));
	assert.ok(codes("Careful!", "Cuidado!").includes("startpunc"));
	assert.deepEqual(codes("Delete this chapter?", "¿Eliminar este capítulo?"), []);
});

test("spurious-interrogative bites when the model invents a question", () => {
	// The real regression, measured on the full 846-key catalogue 2026-07-27: 72 ¿ against
	// 16 real questions. These two are verbatim from that run.
	assert.ok(codes("Try tutorial project", "¿Probar proyecto de tutorial?").includes("spurious-interrogative"));
	assert.ok(codes("Statuses", "¿Estados?").includes("spurious-interrogative"));
	assert.ok(codes("Careful", "¡Cuidado!").includes("spurious-interrogative"));
	// A genuine question keeps its marks and stays silent — the cure must not undo startpunc.
	assert.deepEqual(codes("Delete this chapter?", "¿Eliminar este capítulo?"), []);
	assert.deepEqual(codes("Careful!", "¡Cuidado!"), []);
});

test("startpunc is silent for a language with no conventions row", () => {
	// Shipping rules we do not know is worse than shipping none.
	const frCtx = buildContext(cfg, conventions, "fr");
	assert.deepEqual(checkOne({ key: "k", src: "Delete?", dst: "Supprimer ?", ctx: frCtx }).map((f) => f.code), []);
});

test("endpunc bites when terminal punctuation is dropped", () => {
	assert.ok(codes("Saved.", "Guardado").includes("endpunc"));
	assert.ok(codes("Ready", "¿Listo?").includes("endpunc"));
});

test("numbers bites when a quantity changes", () => {
	assert.ok(codes("Up to 500 words", "Hasta 50 palabras").includes("numbers"));
	assert.deepEqual(codes("Up to 500 words", "Hasta 500 palabras"), []);
});

test("brackets bites when a wrapper is dropped", () => {
	assert.ok(codes("Chapter (draft)", "Capítulo (borrador").includes("brackets"));
	assert.ok(codes("See [docs]", "Ver docs").includes("brackets"));
});

test("blank bites on a whitespace-only translation", () => {
	assert.ok(codes("Save", "   ").includes("blank"));
});

test("doublewords bites on a stutter", () => {
	assert.ok(codes("The book", "El el libro").includes("doublewords"));
	assert.deepEqual(codes("It is what it is", "Es lo que es"), []);
});

test("whitespace bites when leading or trailing spacing changes", () => {
	assert.ok(codes("Save ", "Guardar").includes("whitespace"));
	assert.ok(codes("Save", " Guardar").includes("whitespace"));
});

test("missing is reported for a key with no translation at all", () => {
	const findings = runChecks({
		sourceFlat: { "a.b": "Save", "a.c": "Open" },
		targetFlat: { "a.b": "Guardar" },
		ctx,
	});
	assert.deepEqual(findings, [{ key: "a.c", code: "missing", detail: "no translation was written" }]);
});

test("every finding has the { key, code, detail } shape the triage feed needs", () => {
	const findings = runChecks({
		sourceFlat: { bad: "Delete {n} note?" },
		targetFlat: { bad: "Eliminar {3} nota" },
		ctx,
	});
	assert.ok(findings.length >= 3);
	for (const f of findings) {
		assert.equal(f.key, "bad");
		assert.equal(typeof f.code, "string");
		assert.ok(f.detail.length > 0, `code ${f.code} produced an empty detail`);
	}
});
