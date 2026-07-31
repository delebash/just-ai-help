#!/usr/bin/env node
// just-ai-help — translate a standard i18n JSON locale folder, then CHECK what was written.
//
// Works on ANY app that keeps its strings in standard i18n JSON. Nothing here knows about a
// framework: the placeholder syntax and the plural separator are config, so vue-i18n
// (`{n}` + `a | b`), i18next (`{{n}}`, no pipes — set pluralSeparator null) and anything
// else are all just settings.
//
// Three layers:
//   1. TRANSLATE — src/loop.js. Ours, since 2026-07-27. Owning the request body is the
//      whole point; see that file's header for the measurements that decided it.
//   2. VERIFY    — the checks below. The differentiator: no translator makes assertions
//      about its own output. The one that matters most is a plural form whose halves came
//      back IDENTICAL — it passes every structural test and is still wrong.
//   3. REVIEW    — src/review.js, the local triage page.
//
// Usage:
//   node src/translate.js [config.json]                  translate what changed, then check
//                          --force                        re-translate everything
//                          --check-only                   check the files on disk, no engine
//                          --probe                        translate a SECOND time with the same
//                                                         engine and flag where the two passes
//                                                         disagree — the suspects the checks
//                                                         cannot see (see suspects.js)
//                          --escalate <profile>           re-translate ONLY the flagged keys
//                                                         with a stronger engine profile
//                          --accept <key[,key…]>          record this key's CURRENT findings as
//                                                         reviewed-and-correct in
//                                                         <lang>.accepted.json — no engine call
//
// On --accept and the accepted sidecar, read src/accepted.js. The short version: some findings
// are correct output ("No" -> "No" in Spanish), so without a way to clear them a PERFECT
// catalogue can never exit 0 — and --check-only is the CI gate.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acceptanceEntry, acceptanceHash, loadAccepted, partitionAccepted, saveAccepted, UNKNOWN_REVIEWER } from "./accepted.js";
import { buildContext, runChecks, summarise } from "./checks.js";
import { resolveEngineRow } from "./engine.js";
import { inferConfig } from "./infer.js";
import { flatten, rebuild } from "./jsonutil.js";
import { effectiveTemperature, translateLanguage } from "./loop.js";
import { projectPaths } from "./paths.js";
import { rankSuspects, spread } from "./suspects.js";

const argv = process.argv.slice(2);
// --check-only re-runs the output checks over the locale files already on disk, without
// calling any engine. That is what belongs in CI (free, offline, deterministic), and it is
// also how the checks themselves get tested — corrupt a locale file, confirm it fails.
const checkOnly = argv.includes("--check-only");
const force = argv.includes("--force");
// --probe runs the SAME engine over the SAME keys a second time and flags where the two
// passes disagree. It is a FULL second pass over the whole catalogue — force-sampled, so on
// an incremental run it costs more than the delta did — and therefore opt-in; what it buys
// is the only coverage we have of defects no structural check can see (suspects.js). The
// result is kept in a sidecar `<lang>.probe.json`, so a later --check-only or review run can
// use it without re-running the engine. Its temperature guard lives after the profile is
// resolved, because only the resolved profile knows the EFFECTIVE temperature.
const probe = argv.includes("--probe");
const escalateTo = argv.includes("--escalate") ? argv[argv.indexOf("--escalate") + 1] : null;
const escalateIdx = escalateTo ? argv.indexOf("--escalate") + 1 : -1;
// --accept records the CURRENT findings for one or more keys as reviewed-and-correct. It calls
// no engine — it is a check-time verdict, so it runs the same checks --check-only does and then
// writes what they found for those keys into the sidecar. Comma-separated so one flag covers a
// triage batch without complicating the config-path scan below.
const acceptArg = argv.includes("--accept") ? argv[argv.indexOf("--accept") + 1] : null;
const acceptIdx = acceptArg ? argv.indexOf("--accept") + 1 : -1;
const acceptKeys = acceptArg ? acceptArg.split(",").map((k) => k.trim()).filter(Boolean) : [];
// --by names the human recording a verdict. It is only meaningful with --accept, and defaults
// to "unknown" rather than the OS username on purpose — see accepted.js.
const byArg = argv.includes("--by") ? argv[argv.indexOf("--by") + 1] : null;
const byIdx = byArg ? argv.indexOf("--by") + 1 : -1;
const reviewer = byArg || process.env.JAH_REVIEWER || UNKNOWN_REVIEWER;
const configPath =
	argv.find((a, i) => !a.startsWith("--") && i !== escalateIdx && i !== acceptIdx && i !== byIdx) ||
	"just-ai-help.config.json";

if (!existsSync(configPath)) {
	console.error(`No config at ${configPath}`);
	process.exit(1);
}
const rawCfg = JSON.parse(readFileSync(configPath, "utf8"));
const engines = JSON.parse(readFileSync(new URL("./config/engines.json", import.meta.url), "utf8"));

// EVERY path comes from here, anchored to the config file rather than the working directory.
// That is what removes the `cd` this tool used to require, and what stops the cache silently
// vanishing when a command is run from somewhere else.
const paths = projectPaths(configPath, rawCfg);
const localesDir = paths.localesDir;
const sourceFile = paths.sourceFile;
const sourceRaw = JSON.parse(readFileSync(sourceFile, "utf8"));
const src = flatten(sourceRaw);

// Fields the catalogue itself can answer are read from it. An explicit config value always
// wins; inference only fills a gap, and says so rather than deciding quietly.
const { cfg, inferred } = inferConfig(rawCfg, src);
if (inferred.length) console.log(`Read from ${cfg.sourceLanguage ?? "en"}.json: ${inferred.join(", ")}`);

// Conventions the target language requires regardless of what the source did. Read on both
// paths: the loop puts `promptLine` in the prompt, the checks use `pairedPunct` to find out
// whether the model listened. Shipped for Spanish only, on purpose.
const conventions = JSON.parse(readFileSync(new URL("./config/conventions.json", import.meta.url), "utf8"));

/**
 * Resolves an engines.json row into a runnable profile, or exits with a usable message.
 *
 * The merge itself lives in engine.js and is shared with the workspace, so a project config
 * means the same thing whichever door you came through — it did not, before 2026-07-31.
 */
function resolveProfile(name, { applyConfigOverrides }) {
	const { profile, problem } = resolveEngineRow(engines, name, cfg, { applyOverrides: applyConfigOverrides });
	if (problem) {
		console.error(problem);
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
 * be silently destructive: the cache is loaded and written back on every run (loop.js:297,
 * :383) and --force overwrites entries (:303, :347), so a probe would replace the real
 * translation's cached values with its own and poison every later delta.
 */
async function translateInto(
	lang,
	subset,
	profile,
	{ force: forceThese, outPath = paths.targetFile(lang), cachePath = paths.cachePath },
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
		// `notes` is the review workspace's feedback path: a note written while fixing a key is
		// sent with that key next time, so the same defect does not have to be found twice.
		cfg: { ...cfg, conventionsLine: conventions[lang]?.promptLine ?? "", notes: readNotes(lang) },
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
const probePath = (lang) => paths.probeFile(lang);

/**
 * Per-key notes written during review. Committed, unlike the probe sidecar, because a note
 * changes translation output and so belongs with the run that produced it.
 *
 * Absent file = no notes, which is the normal case until someone reviews something.
 */
function readNotes(lang) {
	const path = paths.notesFile(lang);
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		return Object.fromEntries(Object.entries(flatten(raw)).filter(([k]) => !k.startsWith("_")));
	} catch {
		return {};
	}
}
/** Where a language's reviewer verdicts live. Committed, unlike the probe sidecar — see accepted.js. */
const acceptedPath = (lang) => paths.acceptedFile(lang);

/**
 * EVERY finding for one language: the structural checks, plus the disagreement suspects
 * when a probe sidecar exists. One function, so the escalate path and the post-check report
 * can never drift into flagging different things — escalation re-translates exactly what
 * the report showed you.
 */
function allFindings(lang, targetFlat) {
	let findings = runChecks({ sourceFlat: src, targetFlat, ctx: buildContext(cfg, conventions, lang) });
	const p = probePath(lang);
	if (existsSync(p)) {
		findings = [
			...findings,
			...rankSuspects({
				sourceFlat: src,
				targetFlat,
				probeFlat: flatten(JSON.parse(readFileSync(p, "utf8"))),
				topN: cfg.suspects?.topN ?? 20,
			}),
		];
	}
	// Reviewer verdicts come off LAST, so an acceptance can clear a suspect as well as a check
	// — and so --escalate never spends engine time re-doing a key a human already signed off.
	return partitionAccepted(findings, loadAccepted(acceptedPath(lang)), src, targetFlat);
}

if (acceptKeys.length) {
	// A verdict, not a translation: run the checks on what is already on disk and store what
	// they say about these keys. Deliberately CLI-first rather than review-page-only — the
	// sidecar is just JSON, and making the mechanism reachable without a browser is what keeps
	// it testable and keeps a reviewer unblocked if the page needs work.
	let recorded = 0;
	for (const lang of cfg.targets) {
		const outPath = paths.targetFile(lang);
		if (!existsSync(outPath)) {
			console.error(`${lang}: nothing to accept — no ${lang}.json yet.`);
			process.exitCode = 1;
			continue;
		}
		const dst = flatten(JSON.parse(readFileSync(outPath, "utf8")));
		const path = acceptedPath(lang);
		const store = loadAccepted(path);
		// Re-run the checks WITHOUT the acceptance filter: accepting is about what the checks
		// currently say, and filtering first would make a second --accept on the same key a no-op
		// that looks like success.
		const raw = runChecks({ sourceFlat: src, targetFlat: dst, ctx: buildContext(cfg, conventions, lang) });
		for (const key of acceptKeys) {
			const forKey = raw.filter((f) => f.key === key);
			if (!forKey.length) {
				console.log(`${lang}: ${key} — no current findings, nothing to accept`);
				continue;
			}
			for (const f of forKey) {
				const entry = acceptanceEntry({ key, code: f.code, src: src[key] ?? "", dst: dst[key] ?? "", by: reviewer });
				store[acceptanceHash(entry)] = entry;
				console.log(`${lang}: accepted ${f.code} on ${key}`);
				recorded++;
			}
		}
		saveAccepted(path, store);
	}
	console.log(
		`\n${recorded} finding(s) recorded as reviewed by "${reviewer}". Commit ${cfg.targets.map((l) => `${l}.accepted.json`).join(", ")}.`,
	);
	if (reviewer === UNKNOWN_REVIEWER) {
		// Loud rather than silent. An acceptance claims a human looked; when nobody said who,
		// the file should say so and the person running it should know it will.
		console.warn(
			`\nWARNING: recorded as "${UNKNOWN_REVIEWER}" — nobody claimed these verdicts.\n` +
				`  Pass --by <name>, or set JAH_REVIEWER, so the sidecar records who signed them off.\n` +
				`  This matters: on 2026-07-31 an agent wrote 58 verdicts into a real project in bulk,\n` +
				`  and the format could not tell them apart from a human's review.`,
		);
	}
	process.exit(process.exitCode ?? 0);
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
		const outPath = paths.targetFile(lang);
		if (!existsSync(outPath)) {
			console.error(`${lang}: nothing to escalate — no ${lang}.json yet. Translate first.`);
			hardFailures++;
			continue;
		}
		const ctx = buildContext(cfg, conventions, lang);
		// allFindings, not runChecks: escalation covers the structural flags AND the probe's
		// suspects — "everything flagged plus the top N" (the user's ruling, 2026-07-28).
		const { findings: before, accepted: beforeOk } = allFindings(lang, flatten(JSON.parse(readFileSync(outPath, "utf8"))));
		const keys = [...new Set(before.map((f) => f.key))];
		console.log(`${lang}: ${before.length} finding(s) across ${keys.length} key(s) before${beforeOk.length ? ` (${beforeOk.length} accepted, not escalated)` : ""}`);
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
		const { findings: after } = allFindings(lang, merged);
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
				cachePath: join(paths.configDir, ".jah-probe-cache.json"),
			});

			// Report the RATE, and say so when it is zero. A probe that finds nothing looks
			// exactly like a catalogue with nothing wrong, and those are very different
			// states: the second is worth celebrating, the first means the instrument is
			// broken (temperature 0, a cache mistake, an engine ignoring the sampler). This
			// tool exists because a run that silently did nothing looked like a run that
			// worked — the same failure must not reappear one layer up.
			const target = flatten(JSON.parse(readFileSync(paths.targetFile(lang), "utf8")));
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
	const outPath = paths.targetFile(lang);
	if (!existsSync(outPath)) {
		console.error(`FAIL ${lang}: no output file`);
		failed++;
		continue;
	}
	const dst = flatten(JSON.parse(readFileSync(outPath, "utf8")));
	const { findings, accepted: acceptedNow } = allFindings(lang, dst);
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
	// ALWAYS printed, even at zero. Suppression you cannot see is the bug this project exists
	// to prevent; an accepted finding is hidden from the exit code, never from the reader.
	if (acceptedNow.length) {
		console.log(`  ${acceptedNow.length} accepted as correct (in ${lang}.accepted.json), not counted`);
	}
}
// Set the code, don't call process.exit(). Exiting hard while an I/O handle is still
// closing is what tripped a libuv assertion here on 2026-07-27, turning a clean pass into
// exit 127. Letting the loop drain reports the truth.
if (failed) process.exitCode = 1;
