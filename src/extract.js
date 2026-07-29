#!/usr/bin/env node
// Function 2 — author the help system ONCE, in the docs, and let it become locale keys.
//
//     node src/extract.js [config.json]            write the generated keys into the source locale
//     node src/extract.js [config.json] --check    CI: fail if they are stale, write nothing
//
// THE PROBLEM. The same sentence gets written three times: in the help article, as the
// surface's one-line lede, and as a field's inline hint. Three copies drift, and each drifts
// into a different translation, so the Spanish hint ends up describing something the Spanish
// help article no longer says.
//
// THE FIX. The doc's front-matter is the single authoring home:
//
//     ---
//     lede: Everything about your manuscript's characters, in one place.
//     hints:
//       lifeStatus: Whether the character is alive at the story's end.
//     ---
//     # Characters
//
// This tool extracts those into `lede.<slug>` and `hints.<slug>.<name>` in the SOURCE locale
// file — the same file the translator reads. That composition is the whole point: docs →
// extract → en.json → translate → es.json. A changed hint re-translates as an ordinary key
// delta, and the translator never knows docs exist.
//
// OWNERSHIP, and why it is narrow. This tool OWNS the two generated prefixes and nothing
// else: on every run it removes every key under them and rewrites them from the docs. So a
// hint deleted from a doc disappears from the locale instead of lingering forever, getting
// translated into nine languages and shown to nobody. Every other key in the file is
// untouched, because a generator that can clobber hand-written copy is a generator nobody
// dares run.
//
// It runs at BUILD time. Runtime stays plain vue-i18n; nothing parses markdown in the app.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontMatter } from "./frontmatter.js";

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const configPath = argv.find((a) => !a.startsWith("--")) || "just-ai-help.config.json";

if (!existsSync(configPath)) {
	console.error(`No config at ${configPath}`);
	process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, "utf8"));

const docsDir = resolve(cfg.docsDir ?? "docs");
const localesDir = resolve(cfg.localesDir);
const sourceFile = join(localesDir, `${cfg.sourceLanguage}.json`);
const LEDE = cfg.ledePrefix ?? "lede";
const HINTS = cfg.hintsPrefix ?? "hints";

if (!existsSync(docsDir)) {
	console.error(`No docs directory at ${docsDir} — set "docsDir" in your config.`);
	process.exit(1);
}
if (!existsSync(sourceFile)) {
	console.error(`No source locale at ${sourceFile}`);
	process.exit(1);
}

const raw = JSON.parse(readFileSync(sourceFile, "utf8"));

// Locale files come in two shapes in the wild: genuinely nested objects (vue-i18n's usual
// form) and flat maps whose keys contain literal dots. Detected rather than configured,
// because guessing wrong would restructure the whole file — and a generator that reformats
// 800 hand-written keys to add two of its own is not one anyone will run twice.
const FLAT = Object.keys(raw).some((k) => k.includes("."));

function setKey(obj, path, value) {
	if (FLAT) {
		obj[path] = value;
		return;
	}
	const parts = path.split(".");
	let node = obj;
	for (const p of parts.slice(0, -1)) {
		if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
		node = node[p];
	}
	node[parts.at(-1)] = value;
}

/** Every existing key under `prefix`, removed. Returns how many went. */
function clearPrefix(obj, prefix) {
	if (FLAT) {
		let n = 0;
		for (const k of Object.keys(obj)) {
			if (k === prefix || k.startsWith(`${prefix}.`)) {
				delete obj[k];
				n++;
			}
		}
		return n;
	}
	const count = (o) =>
		typeof o === "object" && o !== null ? Object.values(o).reduce((a, v) => a + count(v), 0) : 1;
	if (!(prefix in obj)) return 0;
	const n = count(obj[prefix]);
	delete obj[prefix];
	return n;
}

// ── read the docs ────────────────────────────────────────────────────────────────────
const files = readdirSync(docsDir).filter((f) => f.endsWith(".md")).sort();
const generated = {};
let docsWithFrontMatter = 0;

for (const file of files) {
	const slug = file.replace(/\.md$/, "");
	let data;
	try {
		({ data } = parseFrontMatter(readFileSync(join(docsDir, file), "utf8")));
	} catch (err) {
		// Loud, and names the file: a doc whose front-matter does not parse must not be
		// skipped silently, or its copy vanishes from the product with nothing to notice.
		console.error(`${file}: ${err.message}`);
		process.exit(1);
	}
	if (!Object.keys(data).length) continue;
	docsWithFrontMatter++;

	if (typeof data.lede === "string" && data.lede.trim()) {
		generated[`${LEDE}.${slug}`] = data.lede.trim();
	}
	if (data.hints && typeof data.hints === "object") {
		for (const [name, text] of Object.entries(data.hints)) {
			if (typeof text === "string" && text.trim()) generated[`${HINTS}.${slug}.${name}`] = text.trim();
		}
	}
}

// ── apply ────────────────────────────────────────────────────────────────────────────
const before = JSON.stringify(raw);
const removed = clearPrefix(raw, LEDE) + clearPrefix(raw, HINTS);
for (const [k, v] of Object.entries(generated)) setKey(raw, k, v);
const after = JSON.stringify(raw);
const changed = before !== after;

const keys = Object.keys(generated).length;
console.log(
	`${files.length} doc(s), ${docsWithFrontMatter} with front-matter → ${keys} key(s)` +
		` (${Object.keys(generated).filter((k) => k.startsWith(`${LEDE}.`)).length} lede,` +
		` ${Object.keys(generated).filter((k) => k.startsWith(`${HINTS}.`)).length} hints), ${removed} replaced`,
);

if (checkOnly) {
	// The CI contract. Not "are the docs valid" — that is checked above by parsing — but
	// "does the committed locale match the docs". A stale generated key is exactly as
	// broken as a missing one, and neither is visible by reading either file alone.
	if (changed) {
		console.error(
			`STALE: ${sourceFile} does not match ${docsDir}. Run: node src/extract.js ${configPath}`,
		);
		process.exit(1);
	}
	console.log("up to date");
} else if (changed) {
	writeFileSync(sourceFile, `${JSON.stringify(raw, null, 2)}\n`);
	console.log(`wrote ${sourceFile}`);
} else {
	console.log("no change");
}
