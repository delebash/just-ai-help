#!/usr/bin/env node
// Layer 3 — the review workspace. Triage what Layer 2 flagged, fix it, re-check, move on.
//
//     node server/review.js config.json [--port 4780]
//
// The API lives in server.js and the interface in review-ui/. This file is the CLI entry: it
// resolves the config, points the server at the committed UI build, and prints where to go.
//
// WHY THE UI IS COMMITTED. client/dist is checked in, so running this needs node and nothing
// else — no npm install, no build step, and no checkout of the sibling repo that holds the
// shared component kit. Developing the UI needs all three; using it needs none. A test asserts
// the committed build matches its sources, because a stale artifact that still runs is the
// worst kind of wrong.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorkspaceServer } from "./server.js";

/** The committed build, when there is one. Absent = API only, which is what the tests use. */
export const DEFAULT_UI = resolve(import.meta.dirname, "../client/dist");

export function createReviewServer({ configPath, uiDir = DEFAULT_UI, db } = {}) {
	return createWorkspaceServer({ configPath, uiDir: existsSync(uiDir) ? uiDir : null, db });
}

// Only listen when run directly — tests import the factory and pick their own port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 ? fallback : argv[i + 1];
	};
	const flagPositions = new Set();
	argv.forEach((a, i) => {
		if (a.startsWith("--")) {
			flagPositions.add(i);
			flagPositions.add(i + 1);
		}
	});
	const configPath = argv.find((a, i) => !flagPositions.has(i)) ?? "just-ai-help.config.json";

	if (!existsSync(configPath)) {
		console.error(`No config at ${configPath}. Pass one: node server/review.js <config.json>`);
		process.exit(1);
	}

	const server = createReviewServer({ configPath });
	const port = Number(flag("--port", 4780));
	server.listen(port, () => {
		const { langs, localesDir } = server.jah;
		console.log(`Review ${langs.join(", ")} at http://localhost:${port}`);
		console.log(`  editing ${localesDir}`);
		if (!existsSync(DEFAULT_UI)) {
			console.log("  NOTE: no UI build found — API only. Run `npm run build:ui`.");
		}
	});
}
