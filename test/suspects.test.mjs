// The suspect list gets the same bar as every check: a clean case it must stay SILENT
// about, and a real defect it must complain about. The defects below are not invented —
// they are the exact strings two models produced on 2026-07-28, both of which passed every
// structural check in checks.mjs. If this file ever goes quiet on them, the one thing this
// module exists for has stopped working.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import test from "node:test";
import { TEMPERATURE } from "../src/loop.mjs";
import { rankSuspects, spread } from "../src/suspects.mjs";

const codesFor = (findings) => findings.map((f) => f.code);
const keysOf = (findings) => findings.map((f) => f.key);

test("spread is 0 for identical wording and 1 for nothing in common", () => {
	assert.equal(spread("¿Eliminar {n} nota?", "¿Eliminar {n} nota?"), 0);
	assert.equal(spread("Guardar", "Guardar"), 0);
	// Punctuation and case are not differences; the words are.
	assert.equal(spread("Guardar.", "guardar"), 0);
	assert.equal(spread("perro", "gato"), 1);
});

test("a model that repeats itself raises NOTHING — the majority case", () => {
	const sourceFlat = { a: "Save", b: "Delete {n} note? | Delete {n} notes?" };
	const targetFlat = { a: "Guardar", b: "¿Eliminar {n} nota? | ¿Eliminar {n} notas?" };
	assert.deepEqual(
		rankSuspects({ sourceFlat, targetFlat, probeFlat: { ...targetFlat } }),
		[],
	);
});

test("BITES on the placeholder-inversion nothing structural could see", () => {
	// Measured 2026-07-28. "¿Eliminar autosave {n}?" reads "delete autosave NUMBER 3",
	// not "delete 3 autosaves" — and the placeholder is present exactly once, no number
	// changed, both plural halves differ, the punctuation is correct.
	const sourceFlat = { del: "Delete {n} autosave? | Delete {n} autosaves?" };
	const targetFlat = { del: "¿Eliminar autosave {n}? | ¿Eliminar autosaves {n}?" };
	const probeFlat = { del: "¿Eliminar {n} autoguardado? | ¿Eliminar {n} autoguardados?" };
	const found = rankSuspects({ sourceFlat, targetFlat, probeFlat });
	assert.deepEqual(keysOf(found), ["del"]);
	assert.deepEqual(codesFor(found), ["disagreement"]);
});

test("BITES on a hallucinated noun", () => {
	// The "proyectos" case: a word with no counterpart anywhere in the source.
	const sourceFlat = { s: "Remove every struck-through original left behind by accepted AI changes." };
	const targetFlat = { s: "Elimina cada original tachado que haya quedado tras los cambios aceptados de la IA." };
	const probeFlat = { s: "Elimina los originales de aquellos proyectos aún pendientes cuya aprobación se haya dado." };
	assert.deepEqual(codesFor(rankSuspects({ sourceFlat, targetFlat, probeFlat })), ["disagreement"]);
});

test("the finding NAMES the second rendering, so a reviewer can compare without digging", () => {
	const sourceFlat = { k: "End" };
	const found = rankSuspects({ sourceFlat, targetFlat: { k: "Fin" }, probeFlat: { k: "Finalizar" } });
	assert.equal(found.length, 1);
	assert.match(found[0].detail, /Finalizar/);
	assert.match(found[0].detail, /spread/);
});

test("topN is a budget, and 0 disables the whole thing", () => {
	const sourceFlat = {};
	const targetFlat = {};
	const probeFlat = {};
	for (let i = 0; i < 30; i++) {
		sourceFlat[`k${i}`] = `Word number ${i} here`;
		targetFlat[`k${i}`] = `alpha ${i}`;
		probeFlat[`k${i}`] = `omega ${i}`;
	}
	assert.equal(rankSuspects({ sourceFlat, targetFlat, probeFlat, topN: 5 }).length, 5);
	assert.equal(rankSuspects({ sourceFlat, targetFlat, probeFlat, topN: 0 }).length, 0);
});

test("length banding keeps a SHORT defect from being crowded out by long paragraphs", () => {
	// Raw spread correlates with source length (r~0.42 measured), so without banding a
	// budget of 3 goes entirely to the long strings and the three-character "End" defect —
	// a real one — is never surfaced. This is the test that pins the normalisation.
	const sourceFlat = { short: "End" };
	const targetFlat = { short: "Fin" };
	const probeFlat = { short: "Finalizar" };
	for (let i = 0; i < 12; i++) {
		const k = `long${i}`;
		sourceFlat[k] = `A considerably longer sentence of user interface prose, number ${i}, with plenty of words in it.`;
		targetFlat[k] = `Una frase mucho mas larga de texto de interfaz numero ${i} con bastantes palabras dentro.`;
		probeFlat[k] = `Otra redaccion completamente distinta para el numero ${i} sin coincidencias apenas ningunas.`;
	}
	const picked = keysOf(rankSuspects({ sourceFlat, targetFlat, probeFlat, topN: 3 }));
	assert.ok(picked.includes("short"), `banding failed — picked ${picked.join(", ")}`);
});

test("the sampling temperature stays non-zero — the whole probe depends on it", () => {
	// At temperature 0 the two passes are the same text by construction, so --probe would
	// report "nothing disagreed" and mean nothing by it: a silent all-clear, which is the
	// exact failure this project was built to stop. translate.mjs refuses to run --probe in
	// that state; this test makes the constant itself a tripwire so the refusal is never
	// the first time anyone finds out.
	assert.ok(TEMPERATURE > 0, `TEMPERATURE is ${TEMPERATURE} — --probe cannot work at 0`);
});

test("keys missing from either side are skipped rather than crashing", () => {
	const sourceFlat = { a: "Save", b: "Open" };
	const found = rankSuspects({ sourceFlat, targetFlat: { a: "Guardar" }, probeFlat: { b: "Abrir" } });
	assert.deepEqual(found, []);
});
