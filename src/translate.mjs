#!/usr/bin/env node
// just-ai-help — translate a standard i18n JSON locale folder, then CHECK what was written.
//
// Works on ANY app that keeps its strings in standard i18n JSON. Nothing here knows about a
// framework: the placeholder syntax and the plural separator are config, so vue-i18n
// (`{n}` + `a | b`), i18next (`{{n}}`, no pipes — set pluralSeparator null) and anything
// else are all just settings.
//
// Three layers:
//   1. TRANSLATE — src/loop.mjs. Ours, since 2026-07-27. Owning the request body is the
//      whole point; see that file's header for the measurements that decided it.
//   2. VERIFY    — the checks below. The differentiator: no translator makes assertions
//      about its own output. The one that matters most is a plural form whose halves came
//      back IDENTICAL — it passes every structural test and is still wrong.
//   3. REVIEW    — src/review.mjs, the local triage page.
//
// Usage:  node src/translate.mjs [config.json] [--check-only] [--force]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildContext, runChecks, summarise } from "./checks.mjs";
import { flatten, rebuild } from "./jsonutil.mjs";
import { translateLanguage } from "./loop.mjs";

const argv = process.argv.slice(2);
// --check-only re-runs the output checks over the locale files already on disk, without
// calling any engine. That is what belongs in CI (free, offline, deterministic), and it is
// also how the checks themselves get tested — corrupt a locale file, confirm it fails.
const checkOnly = argv.includes("--check-only");
const force = argv.includes("--force");
const configPath = argv.find((a) => !a.startsWith("--")) || "just-ai-help.config.json";

if (!existsSync(configPath)) {
	console.error(`No config at ${configPath}`);
	process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const engines = JSON.parse(readFileSync(new URL("./engines.json", import.meta.url), "utf8"));

const localesDir = resolve(cfg.localesDir);
const sourceFile = join(localesDir, `${cfg.sourceLanguage}.json`);
const sourceRaw = JSON.parse(readFileSync(sourceFile, "utf8"));
const src = flatten(sourceRaw);

// Conventions the target language requires regardless of what the source did. Read on both
// paths: the loop puts `promptLine` in the prompt, the checks use `pairedPunct` to find out
// whether the model listened. Shipped for Spanish only, on purpose.
const conventions = JSON.parse(readFileSync(new URL("./conventions.json", import.meta.url), "utf8"));

if (!checkOnly) {
	const base = engines[cfg.engine];
	if (!base) {
		const known = Object.keys(engines).filter((k) => !k.startsWith("_")).join(", ");
		console.error(`Unknown engine "${cfg.engine}". Known: ${known}`);
		process.exit(1);
	}

	// The config may override anything on the profile — the model id above all, because a
	// local server's model id is whatever YOU serve and the profile cannot know it.
	const profile = { ...base, ...(cfg.profile ?? {}) };
	if (cfg.model) profile.model = cfg.model;
	if (cfg.url) profile.url = cfg.url;
	if (cfg.think !== undefined) profile.think = cfg.think;

	if (!profile.model || profile.model.startsWith("REQUIRED")) {
		console.error(`Engine "${cfg.engine}" needs a model id — set "model" in your config.`);
		process.exit(1);
	}
	if (profile.apiKeyEnv && !process.env[profile.apiKeyEnv]) {
		console.error(`Set ${profile.apiKeyEnv} — the engine "${cfg.engine}" needs it.`);
		process.exit(1);
	}

	console.log(`Translating ${cfg.sourceLanguage} -> ${cfg.targets.join(", ")} via ${cfg.engine} (${profile.model})`);
	const started = Date.now();
	let hardFailures = 0;

	for (const lang of cfg.targets) {
		const outPath = join(localesDir, `${lang}.json`);
		const existing = existsSync(outPath) ? flatten(JSON.parse(readFileSync(outPath, "utf8"))) : {};
		const conv = conventions[lang];

		const { values, failed, requests } = await translateLanguage({
			sourceFlat: src,
			existingFlat: existing,
			lang,
			profile,
			cfg: { ...cfg, conventionsLine: conv?.promptLine ?? "" },
			cachePath: resolve(".jah-cache.json"),
			force,
		});

		writeFileSync(outPath, `${JSON.stringify(rebuild(sourceRaw, values), null, 2)}\n`);
		console.log(`${lang}: wrote ${Object.keys(values).length} keys in ${requests} request(s)`);
		if (failed.length) {
			// Left untranslated and said so. Never silently skipped, and the exit code below
			// is non-zero — a broken run and a good run must not look the same to CI.
			hardFailures += failed.length;
			console.error(`${lang}: ${failed.length} key(s) exhausted every retry: ${failed.slice(0, 8).join(", ")}${failed.length > 8 ? " …" : ""}`);
		}
	}
	console.log(`Elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
	if (hardFailures) process.exitCode = 1;
}

// ── post-checks — verify the FILES that were written, not the run that wrote them ──────
let failed = 0;
for (const lang of cfg.targets) {
	const outPath = join(localesDir, `${lang}.json`);
	if (!existsSync(outPath)) {
		console.error(`FAIL ${lang}: no output file`);
		failed++;
		continue;
	}
	const dst = flatten(JSON.parse(readFileSync(outPath, "utf8")));
	const findings = runChecks({ sourceFlat: src, targetFlat: dst, ctx: buildContext(cfg, conventions, lang) });
	const translated = Object.keys(src).filter((k) => dst[k]).length;

	console.log(`\n${lang}: ${translated}/${Object.keys(src).length} translated`);
	for (const [code, list] of summarise(findings)) {
		failed += list.length;
		const keys = list.map((f) => f.key);
		console.log(`  ${code} (${list.length}): ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? " …" : ""}`);
	}
	if (!findings.length) console.log("  all checks passed");
}
// Set the code, don't call process.exit(). Exiting hard while an I/O handle is still
// closing is what tripped a libuv assertion here on 2026-07-27, turning a clean pass into
// exit 127. Letting the loop drain reports the truth.
if (failed) process.exitCode = 1;
