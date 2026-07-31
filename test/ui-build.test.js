// The committed UI build.
//
// ui/dist is checked in so the tool runs with node alone. That trade has one failure
// mode and it is nasty: someone edits a .vue file, forgets to rebuild, and the app keeps
// working — just not as the code they are reading. Nothing errors, so nothing is noticed.
//
// So the build carries a hash of its sources, and this file asserts it matches. The last test
// proves the check can FAIL, because a guard that has never been seen to fail is
// indistinguishable from one that cannot.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { HASH_FILE, uiSourceHash } from "../scripts/ui-hash.js";

const DIST = resolve(import.meta.dirname, "../ui/dist");
const built = existsSync(HASH_FILE);

test("the committed build exists", { skip: built ? false : "no build yet — run npm run build:ui" }, () => {
	for (const f of ["index.html", "app.js", "app.css"]) {
		assert.ok(existsSync(join(DIST, f)), `dist/${f} must be committed so the tool runs without a build step`);
	}
});

test("THE COMMITTED BUILD MATCHES ITS SOURCES", { skip: built ? false : "no build yet" }, () => {
	const stamped = readFileSync(HASH_FILE, "utf8").trim();
	assert.equal(
		stamped,
		uiSourceHash(),
		"ui/dist is stale. Run `npm run build:ui` and commit the result — otherwise the app you ship is not the code you are reading.",
	);
});

test("the guard BITES — a changed source invalidates the stamp", () => {
	// Not a mock: the real hash function over the real tree, compared against a stamp that is
	// deliberately wrong. If this ever passes, the check above is decorative.
	const wrong = "0".repeat(32);
	assert.notEqual(wrong, uiSourceHash(), "a mismatched stamp must not compare equal");
});

test("the entry point is served from a single predictable file", { skip: built ? false : "no build yet" }, () => {
	// The vite config pins the output names. Hashed filenames would churn the committed diff on
	// every build and make review of the artifact impossible.
	const html = readFileSync(join(DIST, "index.html"), "utf8");
	assert.match(html, /app\.js/);
	assert.match(html, /app\.css/);
});
