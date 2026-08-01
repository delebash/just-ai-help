import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceHash } from "../server/accepted.js";
import {
	attachConfirmations,
	buildConfirmPrompt,
	CONFIRM_CODE,
	confirmIdentical,
	isSameVerdict,
} from "../server/confirm.js";

// ── isSameVerdict — the classifier the whole pass turns on ──────────────────────────────

test("isSameVerdict accepts the literal SAME, in any case, with or without a full stop", () => {
	for (const a of ["SAME", "same", "Same", "SAME.", " SAME "]) {
		assert.equal(isSameVerdict(a, "A"), true, `${JSON.stringify(a)} should read as SAME`);
	}
});

test("isSameVerdict treats an ECHO of the source as SAME", () => {
	// 15 of 71 answered this way in the 2026-07-31 measurement: the model returns the string
	// unchanged instead of saying SAME. Scoring that as a proposed translation would have
	// turned the pass's best answers into false alarms.
	assert.equal(isSameVerdict("Color", "Color"), true);
	assert.equal(isSameVerdict("{n} tokens", "{n} tokens"), true);
});

test("isSameVerdict BITES — a real translation is never read as SAME", () => {
	// The check that must fail when handed a defect. If this ever passes, every skipped string
	// in a catalogue gets silently signed off as correct.
	assert.equal(isSameVerdict("libros", "books"), false);
	assert.equal(isSameVerdict("Guardar", "Save"), false);
	assert.equal(isSameVerdict("Eliminar el capítulo", "Delete the chapter"), false);
	// Nearly-the-source is still not the source.
	assert.equal(isSameVerdict("Colores", "Color"), false);
});

test("isSameVerdict survives a null or missing answer without claiming SAME", () => {
	assert.equal(isSameVerdict(undefined, "books"), false);
	assert.equal(isSameVerdict(null, "books"), false);
	// …but an empty source is not a licence to clear an empty answer as a real verdict either.
	assert.equal(isSameVerdict("", "books"), false);
});

// ── the prompt ──────────────────────────────────────────────────────────────────────────

test("buildConfirmPrompt names the target language and the app context", () => {
	const p = buildConfirmPrompt({ targetLang: "es", context: "a novel-writing app" });
	assert.match(p, /es/);
	assert.match(p, /a novel-writing app/);
	assert.match(p, /SAME/);
});

test("buildConfirmPrompt lists do-not-translate terms as always-SAME", () => {
	const p = buildConfirmPrompt({ targetLang: "es", context: "", doNotTranslate: ["EPUB", "RAG"] });
	assert.match(p, /EPUB, RAG/);
	// TODO -> "TODO POR HACER" was a measured failure. The prompt must say these stay put.
	assert.match(p, /always SAME/);
});

// ── confirmIdentical — routing, with a stubbed engine ───────────────────────────────────

/** A stand-in engine keyed by the SOURCE string, so a test states the reply with no model up. */
const fakeEngine = (answers) => async ({ source }) => {
	if (!(source in answers)) throw new Error(`connection refused`);
	return answers[source];
};

test("confirmIdentical routes SAME to cleared and a translation to proposed", async () => {
	const out = await confirmIdentical({
		keys: ["a", "b", "c"],
		sourceFlat: { a: "A", b: "books", c: "Color" },
		targetFlat: { a: "A", b: "books", c: "Color" },
		profile: { kind: "ollama", url: "http://x", model: "m" },
		targetLang: "es",
		context: "",
		ask: fakeEngine({ A: "SAME", books: "libros", Color: "Color" }),
	});

	assert.deepEqual(out.cleared.map((c) => c.key), ["a", "c"], "A and Color are correct as-is");
	assert.deepEqual(out.proposed.map((p) => p.key), ["b"], "books was skipped");
	assert.equal(out.proposed[0].suggestion, "libros");
	assert.equal(out.failed.length, 0);
});

test("confirmIdentical BITES — an engine error leaves the key as a finding, never cleared", async () => {
	const out = await confirmIdentical({
		keys: ["a"],
		sourceFlat: { a: "books" },
		targetFlat: { a: "books" },
		profile: { kind: "ollama", url: "http://x", model: "m" },
		targetLang: "es",
		context: "",
		ask: fakeEngine({}), // nothing answers
	});
	// The failure this asserts: a dead engine must NEVER be read as "everything is fine".
	assert.equal(out.cleared.length, 0, "an unreachable engine cleared a key");
	assert.equal(out.proposed.length, 0);
	assert.equal(out.failed.length, 1);
	assert.match(out.failed[0].error, /connection refused/);
});

// ── attachConfirmations — the annotation, and its expiry ────────────────────────────────

/** Builds the verdict map the state store returns, with a hash matching these exact strings. */
const verdictFor = ({ key, src, dst, verdict, suggestion = null }) => ({
	[key]: {
		hash: acceptanceHash({ key, code: CONFIRM_CODE, src, dst }),
		verdict,
		suggestion,
		engine: "ollama (test)",
	},
});

test("a 'same' verdict marks the row confirmed and says which engine said so", () => {
	const v = verdictFor({ key: "k", src: "Color", dst: "Color", verdict: "same" });
	const [f] = attachConfirmations([{ key: "k", code: CONFIRM_CODE, detail: "identical" }], v, { k: "Color" }, { k: "Color" });
	assert.equal(f.confirmed, "same");
	assert.match(f.confirmedBy, /ollama/, "a machine opinion must name the machine");
	assert.equal(f.suggestion, undefined);
});

test("a 'translate' verdict carries the suggestion the engine would have written", () => {
	const v = verdictFor({ key: "k", src: "books", dst: "books", verdict: "translate", suggestion: "libros" });
	const [f] = attachConfirmations([{ key: "k", code: CONFIRM_CODE, detail: "identical" }], v, { k: "books" }, { k: "books" });
	assert.equal(f.confirmed, "translate");
	assert.equal(f.suggestion, "libros");
});

test("BITES: the annotation is NOT an approval — the finding is still a finding", () => {
	// The whole correction of 2026-07-31. A machine verdict pre-ticks a row; it must never make
	// the finding disappear, because that is what turning a check green without a human means.
	const v = verdictFor({ key: "k", src: "Color", dst: "Color", verdict: "same" });
	const out = attachConfirmations([{ key: "k", code: CONFIRM_CODE, detail: "identical" }], v, { k: "Color" }, { k: "Color" });
	assert.equal(out.length, 1, "the finding was removed by a machine verdict");
	assert.equal(out[0].code, CONFIRM_CODE);
});

test("BITES: a verdict EXPIRES the moment either string changes", () => {
	// A stale opinion about text that no longer exists is worse than none. Same rule an
	// acceptance follows, for the same reason.
	const v = verdictFor({ key: "k", src: "books", dst: "books", verdict: "translate", suggestion: "libros" });
	const [edited] = attachConfirmations([{ key: "k", code: CONFIRM_CODE }], v, { k: "books" }, { k: "libros" });
	assert.equal(edited.confirmed, undefined, "a stale verdict survived an edit to the translation");
	const [reworded] = attachConfirmations([{ key: "k", code: CONFIRM_CODE }], v, { k: "tomes" }, { k: "books" });
	assert.equal(reworded.confirmed, undefined, "a stale verdict survived an edit to the English");
});

test("attachConfirmations never touches a finding of another code", () => {
	const v = verdictFor({ key: "k", src: "x", dst: "x", verdict: "same" });
	const [f] = attachConfirmations([{ key: "k", code: "endpunc" }], v, { k: "x" }, { k: "x" });
	assert.equal(f.confirmed, undefined);
});

test("no verdicts at all returns the findings untouched", () => {
	const findings = [{ key: "k", code: CONFIRM_CODE }];
	assert.equal(attachConfirmations(findings, {}, {}, {}), findings);
});
