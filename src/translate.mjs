#!/usr/bin/env node
// i18n auto-translate — a thin runner over `i18n-ai-translate`.
//
// Works on ANY app that keeps its strings in standard i18n JSON files. Nothing here
// knows about a framework: the placeholder syntax and the plural separator are config,
// so vue-i18n (`{n}` + `a | b`), i18next (`{{n}}`, no pipes — set pluralSeparator null)
// and anything else are all just settings.
//
// The dependency does the translating. This file exists for the two things it can't do:
//
//   1. ENGINE PROFILES (engines.json) — per-provider facts a generic translator cannot
//      hold. All three fields come from real failures, not theory.
//   2. POST-CHECKS — assertions on the OUTPUT that no translator makes about itself.
//      The one that matters: a plural form whose halves came back identical passes every
//      other check (right separator, right placeholders, right word count) and is still
//      wrong. Observed: "Delete {n} autosave? | Delete {n} autosaves?" translated to
//      "¿Eliminar {n} autoguardados? | ¿Eliminar {n} autoguardados?".

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --check-only re-runs the output checks over the locale files already on disk, without
// calling any engine. That is what belongs in CI (free, offline, deterministic), and it is
// also how the checks themselves get tested — corrupt a locale file, confirm it fails.
const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check-only");
const configPath = argv.find((a) => !a.startsWith("--")) || "just-ai-help.config.json";
if (!existsSync(configPath)) {
	console.error(`No config at ${configPath}`);
	process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const engines = JSON.parse(readFileSync(new URL("./engines.json", import.meta.url), "utf8"));

const profile = checkOnly ? {} : engines[cfg.engine];
if (!profile) {
	console.error(`Unknown engine "${cfg.engine}". Known: ${Object.keys(engines).filter((k) => !k.startsWith("_")).join(", ")}`);
	process.exit(1);
}

const localesDir = resolve(cfg.localesDir);
const sourceFile = join(localesDir, `${cfg.sourceLanguage}.json`);

if (!checkOnly) {
	// The model comes from the profile, EXCEPT for a local server — there the model id is
	// whatever your own llama-server/Ollama serves, so the config has to be able to say.
	const model = cfg.model ?? profile.model;
	if (!model || model.startsWith("REQUIRED")) {
		console.error(`Engine "${cfg.engine}" needs a model id — set "model" in your config.`);
		process.exit(1);
	}

	const apiKey = process.env[profile.apiKeyEnv];
	if (!apiKey) {
		console.error(`Set ${profile.apiKeyEnv} — the engine "${cfg.engine}" needs it.`);
		process.exit(1);
	}

	// The glossary goes to the dependency as its own file; keep it out of the repo's config.
	const work = mkdtempSync(join(tmpdir(), "i18n-tr-"));
	const glossaryPath = join(work, "glossary.json");
	writeFileSync(glossaryPath, JSON.stringify(cfg.glossary ?? {}, null, 2));

	// Run the dependency's own entry with `node` — NOT via npx or a shell. On Windows a
	// shelled-out command does not quote its arguments, so any multi-word value (the
	// `--context` string, a path with spaces) arrives as several separate arguments; and
	// npx would resolve the package against the CALLER's project rather than ours.
	const cli = fileURLToPath(new URL("../node_modules/i18n-ai-translate/build/i18n-ai-translate.js", import.meta.url));

	const args = [
		cli, "translate",
		"-i", sourceFile,
		"-o", ...cfg.targets,
		"-e", profile.engine,
		"-m", model,
		"-k", apiKey,
		"-p", cfg.placeholder.prefix,
		"-s", cfg.placeholder.suffix,
		"--prompt-mode", "json",
		"-n", String(profile.batchSize),
		"--glossary", glossaryPath,
		"--cache",
	];
	if (profile.rateLimitMs) args.push("-r", String(profile.rateLimitMs));
	if (profile.batchMaxTokens) args.push("--batch-max-tokens", String(profile.batchMaxTokens));
	if (cfg.context) args.push("--context", cfg.context);

	const env = { ...process.env };
	if (profile.baseUrlEnv && process.env[profile.baseUrlEnv]) env[profile.baseUrlEnv] = process.env[profile.baseUrlEnv];

	console.log(`Translating ${cfg.sourceLanguage} -> ${cfg.targets.join(", ")} via ${cfg.engine} (${model})`);
	execFileSync(process.execPath, args, { stdio: "inherit", env });
}

// ── post-checks — the dependency exits 0 even when it skipped keys, so verify the FILES.
const flatten = (o, p = "", out = {}) => {
	for (const k in o) {
		const v = o[k], np = p ? `${p}.${k}` : k;
		if (v && typeof v === "object") flatten(v, np, out);
		else out[np] = String(v);
	}
	return out;
};
const placeholders = (s) => (s.match(new RegExp(`\\${cfg.placeholder.prefix}\\w+\\${cfg.placeholder.suffix}`, "g")) || []).sort().join(",");

const src = flatten(JSON.parse(readFileSync(sourceFile, "utf8")));
let failed = 0;
for (const lang of cfg.targets) {
	const outPath = join(localesDir, `${lang}.json`);
	if (!existsSync(outPath)) { console.error(`FAIL ${lang}: no output file`); failed++; continue; }
	const dst = flatten(JSON.parse(readFileSync(outPath, "utf8")));

	const missing = Object.keys(src).filter((k) => !dst[k]);
	const phBad = Object.keys(src).filter((k) => dst[k] && placeholders(src[k]) !== placeholders(dst[k]));

	// Plural forms: same number of halves, and — the real catch — halves that differ.
	const sep = cfg.pluralSeparator;
	const plural = sep ? Object.keys(src).filter((k) => src[k].includes(sep) && dst[k]) : [];
	const countBad = plural.filter((k) => dst[k].split(sep).length !== src[k].split(sep).length);
	const sameBad = plural.filter((k) => {
		const halves = dst[k].split(sep).map((h) => h.trim());
		return new Set(halves).size !== halves.length;
	});

	const notKept = (cfg.glossary?.doNotTranslate ?? [])
		.flatMap((term) => Object.keys(src).filter((k) => src[k].includes(term) && dst[k] && !dst[k].includes(term)));

	const report = [
		["missing", missing],
		["placeholders changed", phBad],
		["plural halves lost", countBad],
		["plural halves IDENTICAL", sameBad],
		["glossary term translated", notKept],
	];
	console.log(`\n${lang}: ${Object.keys(src).length - missing.length}/${Object.keys(src).length} translated`);
	for (const [label, keys] of report) {
		if (!keys.length) continue;
		failed += keys.length;
		console.log(`  ${label} (${keys.length}): ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? " …" : ""}`);
	}
	if (!report.some(([, k]) => k.length)) console.log("  all checks passed");
}
process.exit(failed ? 1 : 0);
