// Deriving a project's config from ITS en.json.
//
// THE CODE BEHIND THE SETUP TAB — `server/server.js` calls `planInit` for the path box's live
// validation and `writeInit` when you save. One derivation, so a config cannot depend on which
// door you came through.
//
// WHY THIS REPLACED A TEMPLATE FILE. Setting a project up used to mean: find
// `docs/config.example.json` inside the TOOL's repo, copy it into a different repo, rename it,
// and hand-edit four values including a relative path. That is the `.env.example` pattern
// applied where it does not fit — `.env.example` works because it sits in the same repo as the
// `.env` it becomes, and exists because `.env` is gitignored. Neither is true here.
//
// Every tool that configures a DIFFERENT directory generates the file instead: `eslint --init`,
// `tsc --init`, `git init`. That is what this is, and it can do the thing a template never
// could — LOOK at your strings. Three of the four fields are already visible in them:
//
//   source    the en.json you pointed at — its folder is the locale folder, its name the
//             source language, so ONE field and nothing can disagree with it
//   targets   the other locale files sitting in it
//   glossary  candidates suggested from the strings; you confirm
//   context   the ONE thing only you know
//
// It also reports the placeholder syntax and plural separator it found. Those are not written
// into the config — they are read from en.json on every run — but seeing them proves the tool
// understood your catalogue before you spend an hour of engine time finding out it did not.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { inferPlaceholder, inferPluralSeparator } from "./infer.js";
import { flatten } from "./jsonutil.js";

export const CONFIG_DIR = "just-ai-help";
export const CONFIG_NAME = "config.json";
/**
 * The engine row `init` writes into a new config, READ from engines.json rather than typed here.
 *
 * One definition, in the file that already owns engine data — so swapping the recommended
 * default is a data edit, exactly like adding a provider. Throws rather than guessing if no row
 * claims it: a silently-wrong default would surface as a failed run in someone else's project.
 */
export function defaultEngine(engines = loadEngines()) {
	const rows = Object.entries(engines).filter(([k, v]) => !k.startsWith("_") && v?.default);
	if (rows.length !== 1) {
		throw new Error(`engines.json must have exactly one row marked "default": true — found ${rows.length}`);
	}
	return rows[0][0];
}

function loadEngines() {
	return JSON.parse(readFileSync(new URL("./config/engines.json", import.meta.url), "utf8"));
}

/**
 * The project root: the nearest ancestor holding a package.json.
 *
 * Walking up is what every JS tool does, and it is the difference between the config landing
 * somewhere visible and it landing five directories deep beside the strings. Returns null when
 * there is no marker — a non-JS project — and the caller then requires an explicit --out
 * rather than guessing.
 */
export function findProjectRoot(startDir, { marker = "package.json" } = {}) {
	let dir = resolve(startDir);
	for (;;) {
		if (existsSync(join(dir, marker))) return dir;
		const up = dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

/** Locale files in a folder: `<code>.json`, never a tooling sidecar like `es.accepted.json`. */
export function localeCodesIn(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.map((f) => f.match(/^([a-z]{2}(?:-[A-Za-z]{2,4})?)\.json$/)?.[1])
		.filter(Boolean)
		.sort();
}

/**
 * Terms worth proposing for the glossary: capitalised words that recur and are never used as an
 * ordinary sentence opener.
 *
 * SUGGESTIONS ONLY, and the CLI never writes them without being told to. The glossary is the
 * most dangerous field in the config — every term also becomes a blanket "never translate this"
 * instruction, and on a real 1,965-key catalogue adding `AI` turned 48 CORRECT translations
 * into findings. A machine cannot tell a brand name from a word that merely starts a sentence,
 * so it proposes and a human decides.
 */
export function glossaryCandidates(values, { minCount = 3, limit = 12 } = {}) {
	const counts = new Map();
	const midSentence = new Set();
	// An inner dot or plus is part of the word — `llama.cpp`, `C++`, `Vue3` — but a TRAILING one
	// is the sentence's punctuation, so "Studio." and "Studio" must not count as two things.
	const WORD = /[\p{Lu}][\p{L}\p{N}]*(?:[.+-][\p{L}\p{N}]+)*/gu;
	for (const v of values) {
		// Sentence-ish chunks, so a capital that is only ever a sentence opener can be told
		// apart from one that appears mid-sentence.
		for (const chunk of String(v).split(/(?<=[.!?:])\s+|\n/)) {
			const words = chunk.match(WORD) ?? [];
			const first = chunk.trim().match(new RegExp(`^(?:${WORD.source})`, "u"))?.[0];
			words.forEach((w, i) => {
				counts.set(w, (counts.get(w) ?? 0) + 1);
				// Capitalised anywhere but the opening position means it is capitalised because
				// of WHAT IT IS, not because a sentence started.
				if (i > 0 || w !== first) midSentence.add(w);
			});
		}
	}
	return [...counts.entries()]
		.filter(([w, n]) => n >= minCount && midSentence.has(w) && w.length > 1)
		.sort(([wa, na], [wb, nb]) => nb - na || wa.localeCompare(wb))
		.slice(0, limit)
		.map(([w]) => w);
}

/**
 * Everything derivable from one en.json, with nothing written to disk.
 *
 * Separated from the CLI so it is testable without a terminal — the prompting half is the part
 * that cannot be tested, so it holds no logic.
 */
export function planInit(sourcePath, { out, targets, context, glossary, engine } = {}) {
	const sourceFile = resolve(sourcePath);
	if (!existsSync(sourceFile)) throw new Error(`no such file: ${sourceFile}`);

	const localesDir = dirname(sourceFile);
	const sourceLanguage = basename(sourceFile, ".json");
	const flat = flatten(JSON.parse(readFileSync(sourceFile, "utf8")));
	const values = Object.values(flat).filter((v) => typeof v === "string");
	if (!values.length) throw new Error(`${sourceFile} holds no strings`);

	const existing = localeCodesIn(localesDir).filter((c) => c !== sourceLanguage);
	const root = out ? resolve(out) : findProjectRoot(localesDir);
	if (!root) {
		throw new Error(
			`no package.json above ${localesDir} — pass --out <dir> to say where the config should go`,
		);
	}

	const configDir = join(root, CONFIG_DIR);
	const configPath = join(configDir, CONFIG_NAME);
	// The SOURCE FILE, relative to the config — you pointed at en.json, so that is what is
	// recorded. Its folder is the locale folder and its name is the source language, so no
	// second field can disagree with it. Forward slashes read the same on every platform.
	const sourceRel = relative(configDir, sourceFile).split(sep).join("/");

	// `engine` names a row in server/config/engines.json. Written with the shipped default
	// rather than left out: a config without it resolves to `undefined` and the very next
	// command dies with "unknown engine" — which is what a new project hit, one step after
	// being told setup was done. A default you can see and change beats a field you discover
	// by failing.
	const cfg = {
		source: sourceRel,
		targets: targets ?? existing,
		context: context ?? "",
		glossary: glossary ?? [],
		engine: engine ?? defaultEngine(),
	};

	return {
		cfg,
		configPath,
		configDir,
		root,
		localesDir,
		sourceLanguage,
		keyCount: Object.keys(flat).length,
		// The flattened source, so a caller can measure how complete an existing locale file is
		// without re-reading and re-flattening the same catalogue.
		sourceFlat: flat,
		existingTargets: existing,
		placeholder: inferPlaceholder(values),
		pluralSeparator: inferPluralSeparator(values),
		candidates: glossaryCandidates(values),
	};
}

/** Writes the config, refusing to clobber one that is already there. */
export function writeInit(plan, { force = false } = {}) {
	if (existsSync(plan.configPath) && !force) {
		throw new Error(`${plan.configPath} already exists — pass --force to overwrite it`);
	}
	mkdirSync(plan.configDir, { recursive: true });
	writeFileSync(plan.configPath, `${JSON.stringify(plan.cfg, null, 2)}\n`, "utf8");
	return plan.configPath;
}

/** The lines a host app should add to .gitignore. Reported, never written — it is their file. */
export function gitignoreLines() {
	// Everything the tool writes that is NOT a decision you made. Committed alongside them are
	// config.json, <lang>.accepted.json and <lang>.notes.json — those are your work and they
	// travel with the repo.
	return [
		`${CONFIG_DIR}/*.probe.json`,
		`${CONFIG_DIR}/.jah-cache.json`,
		`${CONFIG_DIR}/.jah-probe-cache.json`,
		`${CONFIG_DIR}/.jah-state.json`,
	];
}
