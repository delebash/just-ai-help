// Accepted findings. The bar here is the same as every other check in this project: a
// mechanism that has never been seen to STOP suppressing is indistinguishable from one that
// suppresses forever, and forever is the dangerous direction. So the load-bearing tests are
// not "an acceptance is quiet" — they are the three ways an acceptance must EXPIRE.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acceptanceEntry, acceptanceHash, loadAccepted, partitionAccepted, saveAccepted } from "../src/accepted.js";

/** Accepts every finding in `findings` against the given strings, and returns the store. */
function accept(findings, sourceFlat, targetFlat) {
	const store = {};
	for (const f of findings) {
		const entry = acceptanceEntry({ key: f.key, code: f.code, src: sourceFlat[f.key], dst: targetFlat[f.key] });
		store[acceptanceHash(entry)] = entry;
	}
	return store;
}

const SRC = { "common.no": "No" };
const DST = { "common.no": "No" };
const FINDING = [{ key: "common.no", code: "untranslated", detail: "identical to the source string" }];

test("an accepted finding stops counting — but is still returned, never dropped", () => {
	const store = accept(FINDING, SRC, DST);
	const { findings, accepted } = partitionAccepted(FINDING, store, SRC, DST);
	assert.deepEqual(findings, []);
	// The caller can always report it. A suppression the reader cannot see is the bug this
	// project was written in response to, so the mechanism refuses to make one possible.
	assert.equal(accepted.length, 1);
	assert.equal(accepted[0].key, "common.no");
});

test("BITES: changing the SOURCE revives the acceptance", () => {
	// The whole reason acceptances are hashed rather than keyed by name. "No" -> "No" is
	// correct Spanish; "No chapters" -> "No chapters" is a skipped string, and a standing
	// per-key exemption would have hidden it forever.
	const store = accept(FINDING, SRC, DST);
	const movedSrc = { "common.no": "No chapters" };
	const { findings, accepted } = partitionAccepted(FINDING, store, movedSrc, DST);
	assert.equal(findings.length, 1, "a changed source must come back as a finding");
	assert.equal(accepted.length, 0);
});

test("BITES: editing the TARGET revives the acceptance", () => {
	// Someone hand-edits the translation in the review page. Whatever a reviewer signed off on
	// is no longer what is in the file, so the verdict does not carry over.
	const store = accept(FINDING, SRC, DST);
	const editedDst = { "common.no": "Nope" };
	const { findings } = partitionAccepted(FINDING, store, SRC, editedDst);
	assert.equal(findings.length, 1, "an edited target must come back as a finding");
});

test("BITES: accepting one code does NOT hide a different code on the same key", () => {
	// Measured shape from the JustWrite catalogue: settings.server.headlessTitle raised
	// `brackets` for an added gloss. Waving that through must not also silence, say, a
	// placeholder defect that appears on the same key later.
	const src = { "a.k": "Headless access" };
	const dst = { "a.k": "Acceso sin interfaz (headless)" };
	const brackets = [{ key: "a.k", code: "brackets", detail: "…" }];
	const store = accept(brackets, src, dst);

	const both = [...brackets, { key: "a.k", code: "placeholder-changed", detail: "…" }];
	const { findings, accepted } = partitionAccepted(both, store, src, dst);
	assert.deepEqual(findings.map((f) => f.code), ["placeholder-changed"]);
	assert.deepEqual(accepted.map((f) => f.code), ["brackets"]);
});

test("the hash separates fields that would otherwise concatenate the same", () => {
	// key "a|b" + code "c" must not collide with key "a" + code "b|c".
	const a = acceptanceHash({ key: "a|b", code: "c", src: "x", dst: "y" });
	const b = acceptanceHash({ key: "a", code: "b|c", src: "x", dst: "y" });
	assert.notEqual(a, b);
	// …and it is stable, or a sidecar would stop matching itself between runs.
	assert.equal(a, acceptanceHash({ key: "a|b", code: "c", src: "x", dst: "y" }));
});

test("a sidecar round-trips, keeps its _why, and ignores metadata keys on read", () => {
	const dir = mkdtempSync(join(tmpdir(), "jah-accepted-"));
	const path = join(dir, "es.accepted.json");
	saveAccepted(path, accept(FINDING, SRC, DST));

	const onDisk = JSON.parse(readFileSync(path, "utf8"));
	assert.ok(onDisk._why.length > 0, "the file explains itself to whoever finds it in a diff");
	// The entry is human-readable, so a reviewer can audit what was waved through.
	const entry = Object.values(onDisk).find((v) => typeof v === "object");
	assert.deepEqual(entry, { key: "common.no", code: "untranslated", src: "No", dst: "No" });

	const loaded = loadAccepted(path);
	assert.equal(Object.keys(loaded).length, 1, "_why must not be read back as an acceptance");
	assert.deepEqual(partitionAccepted(FINDING, loaded, SRC, DST).findings, []);
});

test("a corrupt or missing sidecar costs a re-review, never a wrong pass", () => {
	const dir = mkdtempSync(join(tmpdir(), "jah-accepted-"));
	assert.deepEqual(loadAccepted(join(dir, "nope.json")), {});

	const bad = join(dir, "es.accepted.json");
	writeFileSync(bad, "{ not json");
	assert.deepEqual(loadAccepted(bad), {});
	// Fails toward showing the finding, which is the only safe direction.
	assert.equal(partitionAccepted(FINDING, loadAccepted(bad), SRC, DST).findings.length, 1);
});
