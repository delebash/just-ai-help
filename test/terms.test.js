// Terminology consistency. The rule this project applies to every check: one that has never
// been SEEN to fail is indistinguishable from one that cannot work. So the first test plants
// the exact defect this check was built for and asserts it complains, and the rest pin the
// behaviours that stop it becoming noise.
//
// The measured case, from 2026-07-31: `settings.backups.dataFolderHint` hand-rewritten to use
// `guardado automático` where the catalogue says `autoguardado` fifteen times. No other check
// in this project can see that, and HANDOFF says so in as many words.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import test from "node:test";
import { checkKeyTerms, checkTerms, DOMINANCE, stem, termIndex, terms, termUsage } from "../server/terms.js";

/**
 * Seven keys establishing "autosave" -> "autoguardado", plus one that breaks it: 7/8 = 87.5%,
 * which clears the shipped 0.85 threshold. Sized deliberately — a fixture that sits BELOW the
 * threshold would make every assertion below pass vacuously against an empty index, which is
 * the failure mode this whole file exists to prevent.
 */
const SRC = {
	"a.one": "Autosave every minute",
	"a.two": "Autosave folder",
	"a.three": "Disable autosave",
	"a.four": "Autosave is running",
	"a.five": "Restore from autosave",
	"a.six": "Autosave settings",
	"a.seven": "Last autosave time",
	"a.rogue": "Autosave keeps your work",
};
const DST = {
	"a.one": "Autoguardado cada minuto",
	"a.two": "Carpeta de autoguardado",
	"a.three": "Desactivar autoguardado",
	"a.four": "El autoguardado se está ejecutando",
	"a.five": "Restaurar desde autoguardado",
	"a.six": "Ajustes de autoguardado",
	"a.seven": "Hora del último autoguardado",
	"a.rogue": "El guardado automático conserva tu trabajo",
};

test("IT BITES — a minority rendering of an established term is reported", () => {
	const { findings } = checkTerms({ sourceFlat: SRC, targetFlat: DST });
	const rogue = findings.filter((f) => f.key === "a.rogue" && f.term === "autosave");
	assert.equal(rogue.length, 1, "the odd one out must be flagged");
	assert.equal(rogue[0].expected, "autoguardado");
	assert.match(rogue[0].detail, /7 of 8 other keys/);
});

test("the conforming keys are NOT flagged", () => {
	const { findings } = checkTerms({ sourceFlat: SRC, targetFlat: DST });
	assert.deepEqual(
		findings.filter((f) => f.term === "autosave").map((f) => f.key),
		["a.rogue"],
		"only the deviation, never the convention",
	);
});

test("findings are ADVISORY — this check never fails a gate on its own", () => {
	const { findings } = checkTerms({ sourceFlat: SRC, targetFlat: DST });
	assert.ok(findings.length > 0);
	assert.ok(
		findings.every((f) => f.advisory === true),
		"terminology is a judgement call; the reviewer decides, not the exit code",
	);
});

test("INFLECTION IS NOT A DEFECT — plural and verb forms of the same word agree", () => {
	// Without stemming this reported `personaje` vs `personajes` as an inconsistency, and that
	// class was the majority of 102 findings on the real catalogue.
	const src = {
		"c.1": "Character sheet",
		"c.2": "Character list",
		"c.3": "Delete character",
		"c.4": "Character notes",
		"c.5": "All characters here",
	};
	const dst = {
		"c.1": "Ficha de personaje",
		"c.2": "Lista de personajes",
		"c.3": "Eliminar personaje",
		"c.4": "Notas de personaje",
		"c.5": "Todos los personajes aquí",
	};
	const { findings } = checkTerms({ sourceFlat: src, targetFlat: dst });
	assert.deepEqual(findings.filter((f) => f.term === "character"), [], "personaje/personajes are the same term");
});

test("a term with no settled convention is left alone", () => {
	// Four keys, four different renderings — the catalogue has no opinion, so neither has the check.
	const src = { "d.1": "Remove item", "d.2": "Remove entry", "d.3": "Remove tag", "d.4": "Remove scene" };
	const dst = { "d.1": "Quitar elemento", "d.2": "Eliminar entrada", "d.3": "Suprimir etiqueta", "d.4": "Borrar escena" };
	assert.deepEqual(checkTerms({ sourceFlat: src, targetFlat: dst }).findings, []);
});

test("a term appearing in too few keys is not yet a convention", () => {
	const src = { "e.1": "Autosave now", "e.2": "Autosave off", "e.3": "Autosave here" };
	const dst = { "e.1": "Autoguardado ahora", "e.2": "Autoguardado apagado", "e.3": "Guardado automático aquí" };
	assert.deepEqual(checkTerms({ sourceFlat: src, targetFlat: dst }).findings, [], "three keys is not evidence of a house style");
});

test("an untranslated key is skipped rather than flagged as inconsistent", () => {
	const { findings } = checkTerms({ sourceFlat: { ...SRC, "a.missing": "Autosave later" }, targetFlat: DST });
	assert.ok(!findings.some((f) => f.key === "a.missing"), "missing is a different check's job");
});

test("placeholders are not words", () => {
	assert.ok(!terms("Save {count} chapters").has("count"), "{count} is an interpolation, not vocabulary");
	assert.ok(terms("Save {count} chapters").has("chapters"));
});

test("the shipped dominance threshold is the measured one", () => {
	// Guards the tuning: at 0.90 the check stopped catching the defect it exists for, measured
	// on the real catalogue. If someone raises this to reduce noise, that is what they lose.
	assert.equal(DOMINANCE, 0.85);
	const at90 = checkTerms({ sourceFlat: SRC, targetFlat: DST, dominance: 0.9 }).findings;
	assert.deepEqual(at90, [], "7-of-8 is 87.5%, so a stricter threshold silences this fixture — as it did the real one");
});

test("the index reports a readable word, not a stem fragment", () => {
	const index = termIndex({ sourceFlat: SRC, targetFlat: DST });
	assert.equal(index.get("autosave").target, "autoguardado", "a finding has to name a word a human recognises");
	assert.equal(stem("autoguardado"), "autog");
});

test("termUsage shows the distribution rather than asserting an answer", () => {
	const usage = termUsage({ sourceFlat: SRC, targetFlat: DST, term: "autosave" });
	const top = usage[0];
	assert.equal(top.target, "autoguardado");
	assert.equal(top.count, 7);
	assert.ok(top.example, "a reviewer must be able to go and look at one");
	// The minority form is listed too — sometimes the majority is what is wrong.
	assert.ok(usage.some((u) => u.target === "automático"));
});

test("checkKeyTerms works against a prebuilt index — the panel path", () => {
	const index = termIndex({ sourceFlat: SRC, targetFlat: DST });
	const out = checkKeyTerms({ key: "a.rogue", src: SRC["a.rogue"], dst: DST["a.rogue"], index });
	assert.equal(out.length, 1);
	assert.equal(out[0].code, "terminology");
});
