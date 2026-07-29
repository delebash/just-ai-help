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
// Usage:
//   node src/translate.mjs [config.json]                  translate what changed, then check
//                          --force                        re-translate everything
//                          --check-only                   check the files on disk, no engine
//                          --probe                        translate a SECOND time with the same
//                                                         engine and flag where the two passes
//                                                         disagree — the suspects the checks
//                                                         cannot see (see suspects.mjs)
//                          --escalate <profile>           re-translate ONLY the flagged keys
//                                                         with a stronger engine profile

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildContext, runChecks, summarise } from "./checks.mjs";
import { flatten, rebuild } from "./jsonutil.mjs";
import { effectiveTemperature, translateLanguage } from "./loop.mjs";
import { rankSuspects, spread } from "./suspects.mjs";

const argv = process.argv.slice(2);
// --check-only re-runs the output checks over the locale files already on disk, without
// calling any engine. That is what belongs in CI (free, offline, deterministic), and it is
// also how the checks themselves get tested — corrupt a locale file, confirm it fails.
const checkOnly = argv.includes("--check-only");
const force = argv.includes("--force");
// --probe runs the SAME engine over the SAME keys a second time and flags where the two
// passes disagree. It is a FULL second pass over the whole catalogue — force-sampled, so on
// an incremental run it costs more than the delta did — and therefore opt-in; what it buys
// is the only coverage we have of defects no structural check can see (suspects.mjs). The
// result is kept in a sidecar `<lang>.probe.json`, so a later --check-only or review run can
// use it without re-running the engine. Its temperature guard lives after the profile is
// resolved, because only the resolved profile knows the EFFECTIVE temperature.
const probe = argv.includes("--probe");
const escalateTo = argv.includes("--escalate") ? argv[argv.indexOf("--escalate") + 1] : null;
const escalateIdx = escalateTo ? argv.indexOf("--escalate") + 1 : -1;
const configPath = argv.find((a, i) => !a.startsWith("--") && i !== escalateIdx) || "just-ai-help.config.json";

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

/** Resolves an engines.json row into a runnable profile, or exits with a usable message. */
function resolveProfile(name, { applyConfigOverrides }) {
	const base = engines[name];
	if (!base) {
		const known = Object.keys(engines).filter((k) => !k.startsWith("_")).join(", ");
		console.error(`Unknown engine "${name}". Known: ${known}`);
		process.exit(1);
	}
	const profile = { ...base, ...(applyConfigOverrides ? (cfg.profile ?? {}) : {}) };
	if (applyConfigOverrides) {
		// The config may override anything on the profile — the model id above all, because a
		// local server's model id is whatever YOU serve and the profile cannot know it. An
		// ESCALATION profile deliberately takes none of these: the point of escalating is to
		// run somewhere else, and inheriting the config's model would silently defeat it.
		if (cfg.model) profile.model = cfg.model;
		if (cfg.url) profile.url = cfg.url;
		if (cfg.think !== undefined) profile.think = cfg.think;
	}
	if (!profile.model || profile.model.startsWith("REQUIRED")) {
		console.error(`Engine "${name}" needs a model id — set "model" in your config.`);
		process.exit(1);
	}
	if (profile.apiKeyEnv && !process.env[profile.apiKeyEnv]) {
		console.error(`Set ${profile.apiKeyEnv} — the engine "${name}" needs it.`);
		process.exit(1);
	}
	return profile;
}

let hardFailures = 0;

/**
 * Translates `subset` for one language and merges the result over what is already there.
 *
 * `outPath`/`cachePath` are parameters rather than constants because the --probe pass runs
 * this same function into a SIDECAR file with its own cache. Sharing the main cache would
 * be silently destructive: the cache is loaded and written back on every run (loop.mjs:297,
 * :383) and --force overwrites entries (:303, :347), so a probe would replace the real
 * translation's cached values with its own and poison every later delta.
 */
async function translateInto(
	lang,
	subset,
	profile,
	{ force: forceThese, outPath = join(localesDir, `${lang}.json`), cachePath = resolve(".jah-cache.json") },
) {
	const existing = existsSync(outPath) ? flatten(JSON.parse(readFileSync(outPath, "utf8"))) : {};

	const write = (values) => {
		const merged = { ...existing, ...values };
		writeFileSync(outPath, `${JSON.stringify(rebuild(sourceRaw, merged), null, 2)}\n`);
		return merged;
	};

	const { values, failed, requests } = await translateLanguage({
		sourceFlat: subset,
		existingFlat: forceThese ? {} : existing,
		lang,
		profile,
		cfg: { ...cfg, conventionsLine: conventions[lang]?.promptLine ?? "" },
		cachePath,
		force: forceThese,
		// Written after every batch, so an interrupted hour-long run resumes from where it
		// stopped instead of starting over. The file is always complete-and-valid JSON —
		// just with fewer keys until the run finishes.
		onBatch: write,
	});

	const merged = write(values);
	console.log(`${lang}: wrote ${Object.keys(values).length} keys in ${requests} request(s)`);
	if (failed.length) {
		// Left untranslated and said so. Never silently skipped, and the exit code is
		// non-zero — a broken run and a good run must not look the same to CI.
		hardFailures += failed.length;
		console.error(`${lang}: ${failed.length} key(s) exhausted every retry: ${failed.slice(0, 8).join(", ")}${failed.length > 8 ? " …" : ""}`);
	}
	return merged;
}

/** Where the --probe pass keeps its second opinion for one language. */
const probePath = (lang) => join(localesDir, `${lang}.probe.json`);

/**
 * EVERY finding for one language: the structural checks, plus the disagreement suspects
 * when a probe sidecar exists. One function, so the escalate path and the post-check report
 * can never drift into flagging different things — escalation re-translates exactly what
 * the report showed you.
 */
function allFindings(lang, targetFlat) {
	const findings = runChecks({ sourceFlat: src, targetFlat, ctx: buildContext(cfg, conventions, lang) });
	const p = probePath(lang);
	if (!existsSync(p)) return findings;
	return [
		...findings,
		...rankSuspects({
			sourceFlat: src,
			targetFlat,
			probeFlat: flatten(JSON.parse(readFileSync(p, "utf8"))),
			topN: cfg.suspects?.topN ?? 20,
		}),
	];
}

if (escalateTo) {
	// Escalation: check what is on disk, re-translate ONLY what the checks flagged, with a
	// different (stronger, or simply different-failing) engine, then re-check and show the
	// before/after. The cheap half of the catalogue stays where it is; the expensive engine
	// is spent only on the keys that earned it.
	const profile = resolveProfile(escalateTo, { applyConfigOverrides: false });
	console.log(`Escalating flagged keys to "${escalateTo}" (${profile.model})`);
	const started = Date.now();

	for (const lang of cfg.targets) {
		const outPath = join(localesDir, `${lang}.json`);
		if (!existsSync(outPath)) {
			console.error(`${lang}: nothing to escalate — no ${lang}.json yet. Translate first.`);
			hardFailures++;
			continue;
		}
		const ctx = buildContext(cfg, conventions, lang);
		// allFindings, not runChecks: escalation covers the structural flags AND the probe's
		// suspects — "everything flagged plus the top N" (the user's ruling, 2026-07-28).
		const before = allFindings(lang, flatten(JSON.parse(readFileSync(outPath, "utf8"))));
		const keys = [...new Set(before.map((f) => f.key))];
		console.log(`${lang}: ${before.length} finding(s) across ${keys.length} key(s) before`);
		if (!keys.length) continue;

		const subset = Object.fromEntries(keys.map((k) => [k, src[k]]));
		const merged = await translateInto(lang, subset, profile, { force: true });

		// Retire the probe entries for the keys just escalated. A disagreement finding means
		// "THIS engine was unsure here"; once a DIFFERENT engine has redone the key, the old
		// second opinion is not a self-consistency measure of anything — comparing the strong
		// model's answer to the weak model's probe would keep the key flagged forever and make
		// the before/after count meaningless. Dropping the entry says what is true: the
		// question was resolved by redoing it, not by agreeing.
		const pp = probePath(lang);
		if (existsSync(pp)) {
			const probeFlat = flatten(JSON.parse(readFileSync(pp, "utf8")));
			for (const k of keys) delete probeFlat[k];
			writeFileSync(pp, `${JSON.stringify(rebuild(sourceRaw, probeFlat), null, 2)}\n`);
		}
		const after = allFindings(lang, merged);
		console.log(`${lang}: ${before.length} -> ${after.length} finding(s), ${keys.length} -> ${new Set(after.map((f) => f.key)).size} key(s)`);
	}
	console.log(`Elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
} else if (!checkOnly) {
	const profile = resolveProfile(cfg.engine, { applyConfigOverrides: true });
	// Refuse rather than mislead. --probe measures the engine's uncertainty by sampling it
	// twice; at temperature 0 the two passes are the same text by construction, so it would
	// report "nothing disagreed" and mean nothing by it. Guarded on the EFFECTIVE temperature
	// — what the built request actually carries, extraBody overrides included — because a
	// profile that pins temperature 0 via extraBody would defeat a check on the constant.
	// Still before any engine time is spent.
	if (probe && effectiveTemperature(profile) === 0) {
		console.error(
			"--probe needs a non-zero sampling temperature: it compares two samples of the same" +
				" engine, and at temperature 0 they are identical by construction, so the result would" +
				" be a meaningless all-clear. This profile's effective temperature is 0 — check its" +
				" extraBody override, or drop --probe.",
		);
		process.exit(1);
	}
	console.log(`Translating ${cfg.sourceLanguage} -> ${cfg.targets.join(", ")} via ${cfg.engine} (${profile.model})`);
	const started = Date.now();
	for (const lang of cfg.targets) {
		await translateInto(lang, src, profile, { force });
		if (probe) {
			// The SAME engine, a second time. force:true because the point is a fresh sample —
			// served from the cache it would return the first answer and every key would agree
			// with itself. Its own cache file for the reason in translateInto's comment.
			console.log(`${lang}: probe pass — same engine, second opinion`);
			const probed = await translateInto(lang, src, profile, {
				force: true,
				outPath: probePath(lang),
				cachePath: resolve(".jah-probe-cache.json"),
			});

			// Report the RATE, and say so when it is zero. A probe that finds nothing looks
			// exactly like a catalogue with nothing wrong, and those are very different
			// states: the second is worth celebrating, the first means the instrument is
			// broken (temperature 0, a cache mistake, an engine ignoring the sampler). This
			// tool exists because a run that silently did nothing looked like a run that
			// worked — the same failure must not reappear one layer up.
			const target = flatten(JSON.parse(readFileSync(join(localesDir, `${lang}.json`), "utf8")));
			const moved = Object.keys(src).filter(
				(k) => typeof target[k] === "string" && typeof probed[k] === "string" && spread(target[k], probed[k]) > 0,
			).length;
			console.log(`${lang}: probe — ${moved}/${Object.keys(src).length} key(s) differed between the two passes`);
			if (moved === 0) {
				console.warn(
					`${lang}: WARNING — the two passes agreed on EVERY key. At temperature ${effectiveTemperature(profile)} that is` +
						" implausible for a real catalogue; suspect the sampler, the cache or the engine rather than" +
						" reading this as a clean bill of health.",
				);
			}
		}
	}
	console.log(`Elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
if (hardFailures) process.exitCode = 1;

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
	const findings = allFindings(lang, dst);
	const translated = Object.keys(src).filter((k) => dst[k]).length;

	console.log(`\n${lang}: ${translated}/${Object.keys(src).length} translated`);
	for (const [code, list] of summarise(findings)) {
		// `disagreement` is ADVISORY and deliberately does not fail the build. The checks
		// assert a defect; a suspect only says the model was unsure, and plenty of suspects
		// turn out fine. Failing CI on suspicion is exactly how a report gets ignored — the
		// same reasoning that gives checkUntranslated its exemption. It still prints, it
		// still drives --escalate and the review page; it just is not an error.
		if (code !== "disagreement") failed += list.length;
		const keys = list.map((f) => f.key);
		const note = code === "disagreement" ? " [advisory — review or escalate]" : "";
		console.log(`  ${code} (${list.length})${note}: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? " …" : ""}`);
	}
	if (!findings.length) console.log("  all checks passed");
}
// Set the code, don't call process.exit(). Exiting hard while an I/O handle is still
// closing is what tripped a libuv assertion here on 2026-07-27, turning a clean pass into
// exit 127. Letting the loop drain reports the truth.
if (failed) process.exitCode = 1;
