// The extractor OWNS two prefixes in the source locale and must not touch anything else.
// Both halves of that are dangerous if wrong: a generator that clobbers hand-written copy is
// one nobody dares run, and a generator that leaves deleted hints behind ships text to nine
// languages that no document says any more.
//
// Runs the real CLI as a child process against a temp fixture — the file-writing behaviour
// IS the feature, so testing the module in isolation would test the wrong thing.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const EXTRACT = fileURLToPath(new URL("../src/extract.js", import.meta.url));

/** A temp app: docs/ + locales/en.json + a config. Returns its paths. */
function fixture({ docs, en }) {
	const dir = mkdtempSync(join(tmpdir(), "jah-extract-"));
	const docsDir = join(dir, "docs");
	const locales = join(dir, "locales");
	mkdirSync(docsDir, { recursive: true });
	mkdirSync(locales, { recursive: true });
	for (const [name, text] of Object.entries(docs)) writeFileSync(join(docsDir, name), text);
	writeFileSync(join(locales, "en.json"), `${JSON.stringify(en, null, 2)}\n`);
	writeFileSync(
		join(dir, "config.json"),
		JSON.stringify({ docsDir: "docs", localesDir: "locales", sourceLanguage: "en" }, null, 2),
	);
	return { dir, enPath: join(locales, "en.json") };
}

const run = (dir, ...args) =>
	execFileSync(process.execPath, [EXTRACT, "config.json", ...args], { cwd: dir, encoding: "utf8" });

const readEn = (p) => JSON.parse(readFileSync(p, "utf8"));

test("extracts lede and hints into the source locale, keyed by slug", () => {
	const { dir, enPath } = fixture({
		docs: {
			"writing.md": ["---", "lede: The heart of the app.", "hints:", "  status: Whether it is done.", "---", "# Writing"].join("\n"),
		},
		en: { common: { save: "Save" } },
	});
	run(dir);
	const en = readEn(enPath);
	assert.equal(en.lede.writing, "The heart of the app.");
	assert.equal(en.hints.writing.status, "Whether it is done.");
	// and it left the hand-written key alone
	assert.equal(en.common.save, "Save");
});

test("BITES: a hint deleted from the doc is REMOVED from the locale", () => {
	const { dir, enPath } = fixture({
		docs: { "writing.md": ["---", "hints:", "  a: One.", "  b: Two.", "---", "# W"].join("\n") },
		en: {},
	});
	run(dir);
	assert.equal(readEn(enPath).hints.writing.b, "Two.");

	writeFileSync(join(dir, "docs", "writing.md"), ["---", "hints:", "  a: One.", "---", "# W"].join("\n"));
	run(dir);
	const en = readEn(enPath);
	assert.equal(en.hints.writing.a, "One.");
	assert.equal(en.hints.writing.b, undefined, "a deleted hint must not linger in the locale");
});

test("BITES: --check exits non-zero when the locale is stale, and writes nothing", () => {
	const { dir, enPath } = fixture({
		docs: { "writing.md": ["---", "lede: New text.", "---", "# W"].join("\n") },
		en: { common: { save: "Save" } },
	});
	const before = readFileSync(enPath, "utf8");
	assert.throws(() => run(dir, "--check"), /STALE|Command failed/);
	assert.equal(readFileSync(enPath, "utf8"), before, "--check must not write");

	run(dir); // now make it current
	const out = run(dir, "--check");
	assert.match(out, /up to date/);
});

test("BITES: a doc whose front-matter is broken fails the run and names the file", () => {
	const { dir } = fixture({
		docs: { "bad.md": ["---", "hints:", "\tstatus: Tabbed.", "---", "# Bad"].join("\n") },
		en: {},
	});
	assert.throws(
		() => run(dir),
		(err) => /bad\.md/.test(err.stderr) && /tabs/.test(err.stderr),
		"a doc that will not parse must fail loudly and say which one",
	);
});

test("docs with no front-matter are simply skipped", () => {
	const { dir, enPath } = fixture({
		docs: { "plain.md": "# Plain\n\nJust prose.\n", "withfm.md": ["---", "lede: Yes.", "---", "# X"].join("\n") },
		en: {},
	});
	run(dir);
	const en = readEn(enPath);
	assert.equal(en.lede.withfm, "Yes.");
	assert.equal(en.lede.plain, undefined);
});

test("a FLAT locale (literal dotted keys) is not restructured", () => {
	// Detected, not configured: reshaping 800 hand-written keys to add two of its own is how
	// a generator gets banned from a repo.
	const { dir, enPath } = fixture({
		docs: { "writing.md": ["---", "lede: Text.", "---", "# W"].join("\n") },
		en: { "common.save": "Save", "common.cancel": "Cancel" },
	});
	run(dir);
	const en = readEn(enPath);
	assert.equal(en["common.save"], "Save", "existing flat keys must stay flat");
	assert.equal(en["lede.writing"], "Text.", "generated keys must follow the file's own shape");
	assert.equal(en.lede, undefined, "must not nest into a file that is flat");
});
