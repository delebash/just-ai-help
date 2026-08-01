// Where everything lives. ONE module, because path resolution was the single largest source
// of confusion in this tool and it was spread across four files that disagreed.
//
// THE RULE: every path resolves against the CONFIG FILE'S OWN DIRECTORY, never against the
// working directory.
//
// What that fixes, measured rather than guessed:
//   · `localesDir` was `resolve(cfg.localesDir)` — relative to wherever you typed the command.
//     That is why every documented command began with a `cd`, and docs/CONFIG.md called it
//     "a real bug, not a convention". It is gone: you can run from anywhere.
//   · `.jah-cache.json` was `resolve(".jah-cache.json")` — same problem, worse consequence.
//     Run from the wrong folder and the tool silently starts with NO cache and re-translates
//     the whole catalogue. That cost 27 minutes and 464 hand-corrected keys on 2026-07-31.
//   · server.js computed `projectRoot = resolve(configPath, "..")` on line 100 and then did
//     `resolve(cfg.localesDir)` on line 101 — it worked out the right anchor and did not use
//     it, so the database landed correctly and the locale files did not.
//
// THE LAYOUT this enables. The tool's whole footprint in a host app becomes one visible folder:
//
//     <app>/just-ai-help/          <- root, next to package.json, obvious to a newcomer
//       config.json                <- the four fields
//       es.accepted.json           <- reviewer verdicts       (committed)
//       es.notes.json              <- per-key knowledge       (committed)
//       es.probe.json              <- second-pass measurement (not committed)
//       .jah-cache.json            <- disposable              (not committed)
//       .jah-state.json            <- workshop state          (not committed)
//
// Your engine connections and API keys are NOT here — they are tool-level, in settings.json
// inside the tool's own folder, because you install once and point at many apps.
//     <app>/src/.../i18n/locales/
//       en.json  es.json           <- APP ASSETS ONLY, nothing else
//
// Keeping the review files out of `locales/` is not tidiness. That folder is loaded by the
// host app, and the fix for "adding a language needs three code edits" is to glob it — a
// plain *.json glob over today's layout registers a phantom language called "es.accepted".
//
// COMPATIBILITY. Existing projects keep working: the review files are looked for beside the
// config FIRST and fall back to `locales/`, so a catalogue that already has them in the old
// place is found and nothing has to move on an upgrade.

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const CACHE_FILE = ".jah-cache.json";

/**
 * Everything derived from one config file path.
 *
 * `source` names the source FILE ("../src/i18n/locales/en.json"). Its folder is the locale
 * folder and its basename is the source language, so that single field replaces the folder +
 * sourceLanguage pair. Older folder-shaped configs are still read, so nothing is invalidated.
 */
export function projectPaths(configPath, cfg) {
	const configDir = resolve(dirname(resolve(configPath)));

	// `source` names the SOURCE FILE, not its folder — you point the tool at en.json, so that is
	// what gets recorded. The folder is its dirname and the source language is its basename, so
	// one field replaces the three (`localesDir` + `sourceLanguage`, or `locales` + the same)
	// that a folder-shaped config needed. Nothing has to agree with anything else, because
	// there is only one fact.
	let localesDir;
	let sourceLanguage;
	let sourceFile;

	if (cfg.source) {
		sourceFile = isAbsolute(cfg.source) ? cfg.source : resolve(configDir, cfg.source);
		localesDir = dirname(sourceFile);
		sourceLanguage = basename(sourceFile, ".json");
	} else {
		// Older folder-shaped configs still work, so upgrading the tool invalidates nothing.
		const rel = cfg.locales ?? cfg.localesDir;
		if (!rel) {
			throw new Error(`config at ${configPath} has no "source" — it must name your en.json`);
		}
		localesDir = isAbsolute(rel) ? rel : resolve(configDir, rel);
		sourceLanguage = cfg.sourceLanguage ?? "en";
		sourceFile = join(localesDir, `${sourceLanguage}.json`);
	}

	// Review artefacts sit beside the config. If a project already keeps them in localesDir —
	// which is where every version before 2026-07-31 put them — that location wins, so
	// upgrading the tool never orphans a reviewer's verdicts.
	//
	// The choice is made ONCE for the whole project, not per file. Deciding per file split a
	// real catalogue across two folders: es.accepted.json stayed in locales/ because it
	// existed, while a newly written es.notes.json went beside the config. Sidecars for one
	// language belong together, and "where are my review files" must have one answer.
	const sidecarNames = /\.(accepted|notes|probe)\.json$/;
	const legacyInUse =
		localesDir !== configDir &&
		existsSync(localesDir) &&
		readdirSync(localesDir).some((f) => sidecarNames.test(f));
	const sidecarDir = legacyInUse ? localesDir : configDir;
	const sidecar = (lang, kind) => join(sidecarDir, `${lang}.${kind}.json`);

	return {
		configDir,
		localesDir,
		sourceLanguage,
		sourceFile,
		targetFile: (lang) => join(localesDir, `${lang}.json`),
		acceptedFile: (lang) => sidecar(lang, "accepted"),
		notesFile: (lang) => sidecar(lang, "notes"),
		probeFile: (lang) => sidecar(lang, "probe"),
		sidecarDir,
		cachePath: join(configDir, CACHE_FILE),
	};
}
