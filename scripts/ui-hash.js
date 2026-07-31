#!/usr/bin/env node
// The freshness stamp for the committed UI build.
//
// `client/dist` is COMMITTED so that running the tool needs only node — no npm install, no
// sibling repo. The cost of that decision is the classic one: a build artifact in the tree goes
// stale the moment someone edits a source file and forgets to rebuild, and nothing complains.
// The symptom is the worst kind — the app runs, it just quietly is not the code you are reading.
//
// So the hash of every UI source file is written into the build and checked by a test.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const UI = join(ROOT, "client");
/** Everything that can change what the build produces. node_modules is pinned by the lockfile. */
const WATCHED = ["src", "index.html", "vite.config.js"];

function walk(path, out = []) {
	const st = statSync(path, { throwIfNoEntry: false });
	if (!st) return out;
	if (st.isFile()) {
		out.push(path);
		return out;
	}
	for (const name of readdirSync(path).sort()) walk(join(path, name), out);
	return out;
}

/** A stable hash over the UI sources: sorted relative paths plus contents. */
export function uiSourceHash() {
	const h = createHash("sha256");
	for (const entry of WATCHED) {
		for (const file of walk(join(UI, entry))) {
			h.update(relative(UI, file).replace(/\\/g, "/"));
			h.update("\0");
			h.update(readFileSync(file));
			h.update("\0");
		}
	}
	return h.digest("hex").slice(0, 32);
}

export const HASH_FILE = join(UI, "dist", ".buildhash");

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
	const hash = uiSourceHash();
	writeFileSync(HASH_FILE, `${hash}\n`);
	console.log(`ui build hash ${hash}`);
}
