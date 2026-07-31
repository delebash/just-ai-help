#!/usr/bin/env node
// Set a project up by POINTING AT ITS en.json.
//
//   node server/init.js path/to/your-app/src/i18n/locales/en.json
//
// WHY THIS REPLACES A TEMPLATE FILE. Setting a project up used to mean: find
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
export function planInit(sourcePath, { out, targets, context, glossary } = {}) {
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

	const cfg = {
		source: sourceRel,
		targets: targets ?? existing,
		context: context ?? "",
		glossary: glossary ?? [],
	};

	return {
		cfg,
		configPath,
		configDir,
		root,
		localesDir,
		sourceLanguage,
		keyCount: Object.keys(flat).length,
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
	return [`${CONFIG_DIR}/*.probe.json`, `${CONFIG_DIR}/.jah-cache.json`, `${CONFIG_DIR}/.jah-probe-cache.json`, `${CONFIG_DIR}/.jah.db`];
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const argv = process.argv.slice(2);
	const flag = (name) => {
		const i = argv.indexOf(name);
		return i === -1 ? undefined : argv[i + 1];
	};
	const taken = new Set();
	argv.forEach((a, i) => {
		if (a.startsWith("--")) {
			taken.add(i);
			if (a !== "--force") taken.add(i + 1);
		}
	});
	const sourcePath = argv.find((a, i) => !taken.has(i));

	if (!sourcePath) {
		console.error("Point this at your en.json:\n");
		console.error("  node server/init.js path/to/your-app/src/i18n/locales/en.json\n");
		console.error("Options:");
		console.error("  --targets es,fr     languages to produce (default: the locale files already there)");
		console.error('  --context "…"       one sentence about your app');
		console.error("  --glossary A,B      terms that must never be translated anywhere");
		console.error("  --out <dir>         where to put the just-ai-help/ folder (default: nearest package.json)");
		console.error("  --force             overwrite an existing config");
		process.exit(1);
	}

	const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);

	let plan;
	try {
		plan = planInit(sourcePath, {
			out: flag("--out"),
			targets: list(flag("--targets")),
			context: flag("--context"),
			glossary: list(flag("--glossary")),
		});
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}

	console.log(`Read ${plan.keyCount} keys from ${plan.sourceLanguage}.json`);
	console.log(`  placeholder       ${plan.placeholder.prefix}…${plan.placeholder.suffix}`);
	console.log(`  plural separator  ${plan.pluralSeparator === null ? "none" : JSON.stringify(plan.pluralSeparator)}`);
	if (plan.existingTargets.length) console.log(`  locales present   ${plan.existingTargets.join(", ")}`);

	try {
		writeInit(plan, { force: argv.includes("--force") });
	} catch (e) {
		console.error(`\n${e.message}`);
		process.exit(1);
	}
	console.log(`\nWrote ${plan.configPath}`);

	// What is still missing is stated plainly rather than left as a silent empty field. A run
	// with no targets does nothing, and a run with no context translates short labels blind.
	const missing = [];
	if (!plan.cfg.targets.length) missing.push('targets  — no other locale files were there. Add e.g. ["es"]');
	if (!plan.cfg.context) missing.push('context  — one sentence about your app. "Beat" is a story beat or a musical one; this is what decides');
	if (missing.length) {
		console.log("\nStill needs you:");
		for (const m of missing) console.log(`  ${m}`);
	}

	if (plan.candidates.length) {
		console.log(`\nPossible glossary terms, for you to accept or ignore:\n  ${plan.candidates.join(", ")}`);
		console.log("  Only add a word that must never be translated ANYWHERE — a term here also becomes a");
		console.log("  blanket instruction to the model, and on a real catalogue adding `AI` turned 48 correct");
		console.log("  translations into findings.");
	}

	console.log(`\nAdd to .gitignore:\n${gitignoreLines().map((l) => `  ${l}`).join("\n")}`);
	// `--check-only` on purpose: it calls no engine, so it is the one command that is safe to
	// suggest before the config has been finished, and it proves the wiring.
	console.log(`\nThen, once targets and context are filled in:`);
	console.log(`  node <just-ai-help>/server/translate.js ${plan.configPath} --check-only`);
}
