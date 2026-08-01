#!/usr/bin/env node
// THE entry point. One command, one page, setup and review in tabs.
//
//     npm start                            open the workspace; point it at an en.json IN the page
//     npm start -- path/to/config.json     open it on a project you already have
//     npm start -- --port 4790 --no-open   pick a port; do not launch a browser
//
// ONE COMMAND, because setup and review are one workflow: the Setup tab is the full config
// editor, the Review tab is the queue, and the server starts with no project so the screen that
// WRITES a config is reachable before one exists.
//
// `server/init.js` holds the derivation the setup screen calls — one implementation, so a config
// cannot depend on which door you came through.
//
// WHY THE UI IS COMMITTED. client/dist is checked in, so running this needs node and nothing
// else — no npm install, no build step, and no checkout of the sibling repo that holds the
// shared component kit. Developing the UI needs all three; using it needs none. A test asserts
// the committed build matches its sources, because a stale artifact that still runs is the
// worst kind of wrong.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorkspaceServer } from "./server.js";

/** The committed build, when there is one. Absent = API only, which is what the tests use. */
export const DEFAULT_UI = resolve(import.meta.dirname, "../client/dist");

export function createReviewServer({ configPath = null, uiDir = DEFAULT_UI, store, settingsRoot } = {}) {
	return createWorkspaceServer({ configPath, uiDir: existsSync(uiDir) ? uiDir : null, store, settingsRoot });
}

/**
 * Opens the page in whatever the OS considers the browser.
 *
 * Detached and unref'd on purpose: the workspace must outlive the browser, and a failure here is
 * a convenience that did not happen — never a reason for the server to stop. The URL is printed
 * either way.
 */
export function openBrowser(url) {
	const [cmd, args] =
		process.platform === "win32"
			? ["cmd", ["/c", "start", "", url]]
			: process.platform === "darwin"
				? ["open", [url]]
				: ["xdg-open", [url]];
	try {
		spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
	} catch {
		/* printed above; nothing here is load-bearing */
	}
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
			// A boolean flag consumes no value, so the next argument is still the config path.
			if (a !== "--no-open") flagPositions.add(i + 1);
		}
	});

	// A config path is OPTIONAL. Without one the server starts anyway and the page opens on
	// Setup — which is the entire reason this entry point exists.
	const given = argv.find((a, i) => !flagPositions.has(i));
	if (given && !existsSync(given)) {
		console.error(`No config at ${given}`);
		process.exit(1);
	}
	const configPath = given ? resolve(given) : null;

	const server = createReviewServer({ configPath });
	const port = Number(flag("--port", 4780));
	server.listen(port, () => {
		const url = `http://localhost:${port}`;
		const jah = server.jah;
		console.log(`just-ai-help — ${url}`);
		if (jah.loaded) {
			console.log(`  reviewing ${jah.langs.join(", ")} in ${jah.localesDir}`);
		} else {
			console.log("  No project yet. In the page: paste the path to your en.json and it writes");
			console.log("  the config for you — targets, context, glossary and engine are all on that tab.");
		}
		if (!existsSync(DEFAULT_UI)) {
			console.log("  NOTE: no UI build found — API only. Run `npm run build:client`.");
		} else if (!argv.includes("--no-open")) {
			openBrowser(url);
		}
	});
}
