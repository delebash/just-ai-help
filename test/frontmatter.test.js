// The parser's whole job is to REFUSE what it does not understand. A permissive parser that
// quietly drops an unsupported line is the failure mode that matters here: the dropped text
// is user-facing copy, it never reaches a locale file, it is never translated, and it shows
// up as a blank hint in the product with nothing anywhere reporting a problem.
//
// So every unsupported construct gets a test asserting it THROWS, not that it degrades.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import test from "node:test";
import { parseFrontMatter } from "../server/frontmatter.js";

test("a doc with no front-matter is not an error — most docs have none yet", () => {
	const { data, body } = parseFrontMatter("# Writing\n\nSome prose.\n");
	assert.deepEqual(data, {});
	assert.equal(body, "# Writing\n\nSome prose.\n");
});

test("scalars and a one-level map parse, and the body survives untouched", () => {
	const { data, body } = parseFrontMatter(
		["---", "lede: The heart of the app.", "hints:", "  status: Whether it is done.", "  part: Which part it belongs to.", "---", "# Writing", "", "Prose."].join("\n"),
	);
	assert.equal(data.lede, "The heart of the app.");
	assert.deepEqual(data.hints, { status: "Whether it is done.", part: "Which part it belongs to." });
	assert.equal(body, "# Writing\n\nProse.");
});

test("quotes are stripped, and a colon inside a quoted value survives", () => {
	const { data } = parseFrontMatter(['---', 'lede: "Note: this matters."', "---", ""].join("\n"));
	assert.equal(data.lede, "Note: this matters.");
});

test("comments and blank lines are ignored", () => {
	const { data } = parseFrontMatter(["---", "# a comment", "", "lede: Text.", "---", ""].join("\n"));
	assert.deepEqual(data, { lede: "Text." });
});

test("BITES: an unterminated fence throws rather than swallowing the document", () => {
	assert.throws(() => parseFrontMatter("---\nlede: Text.\n\n# Writing\n"), /no closing ---/);
});

test("BITES: tabs throw — they are the classic silent YAML corruption", () => {
	assert.throws(() => parseFrontMatter(["---", "hints:", "\tstatus: Text.", "---", ""].join("\n")), /tabs/);
});

test("BITES: lists throw rather than being read as a scalar", () => {
	assert.throws(() => parseFrontMatter(["---", "hints:", "  - one", "---", ""].join("\n")), /lists/);
});

test("BITES: multi-line scalars throw rather than losing every line but the first", () => {
	assert.throws(() => parseFrontMatter(["---", "lede: |", "  line one", "  line two", "---", ""].join("\n")), /multi-line/);
});

test("BITES: nesting deeper than one level throws instead of silently flattening", () => {
	assert.throws(
		() => parseFrontMatter(["---", "hints:", "  group:", "    inner: Text.", "---", ""].join("\n")),
		/deeper than one level/,
	);
});

test("BITES: a duplicate key throws — last-wins would silently discard authored copy", () => {
	assert.throws(() => parseFrontMatter(["---", "lede: One.", "lede: Two.", "---", ""].join("\n")), /duplicate/);
	assert.throws(
		() => parseFrontMatter(["---", "hints:", "  a: One.", "  a: Two.", "---", ""].join("\n")),
		/duplicate/,
	);
});

test("BITES: an indented line with no parent throws", () => {
	assert.throws(() => parseFrontMatter(["---", "  orphan: Text.", "---", ""].join("\n")), /no parent/);
});

test("BITES: a line with no colon throws instead of being skipped", () => {
	assert.throws(() => parseFrontMatter(["---", "just some words", "---", ""].join("\n")), /expected/);
});
