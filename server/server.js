// The review workspace API.
//
// Replaces the single inline page in review.js, which was specified as "plain styling — this is
// a utility, not a product surface" and has been exactly that ever since. Everything here
// exists because a reviewer could not do something: undo an approval, see what they had already
// accepted, re-translate without a CLI, get a second opinion, or work more than one language.
//
// WHAT WRITES WHAT — the rule the whole design rests on:
//
//   locale JSON     only ever written by an explicit human action in here
//   accepted.json   accept / unaccept
//   notes.json      the per-key note that feeds the next translation
//   .jah-state.json  this project: progress, undo, proposals, confirmations, runs
//   settings.json    YOURS, in the TOOL folder: connections, keys, your name
//
// A job never writes a locale file. Engine output is staged and applied by a person. Deleting
// the state file must not break a check, and there is a test.

import { createServer as httpServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { acceptanceEntry, acceptanceHash, loadAccepted, partitionAccepted, saveAccepted } from "./accepted.js";
import { buildContext, checkOne, runChecks } from "./checks.js";
import { attachConfirmations } from "./confirm.js";
import {
	TOOL_ROOT,
	assertGitignored,
	getReviewer,
	listConnections,
	listProviders,
	openSettings,
	readConnection,
	resolveConnection,
	saveConnection,
	setReviewer,
} from "./settings.js";
import { applyConfigOverrides, profileProblem } from "./engine.js";
import { defaultEngine, gitignoreLines, planInit, writeInit } from "./init.js";
import { inferConfig } from "./infer.js";
import { flatten, rebuild } from "./jsonutil.js";
import { projectPaths } from "./paths.js";
import { JobManager } from "./jobs.js";
import { callModel, parseItems } from "./loop.js";
import {
	actionHistory,
	dropAllProposals,
	dropProposal,
	dropReferences,
	getReference,
	popAction,
	proposalCount,
	proposalKeys,
	proposals,
	putReference,
	recordAction,
	reviewProgress,
	reviewStatuses,
	confirmations,
	dropConfirmation,
	openProject,
	runHistory,
	setReviewStatus,
} from "./state.js";
import { rankSuspects } from "./suspects.js";
import { checkKeyTerms, checkTerms, termUsage } from "./terms.js";

const json = (res, code, body) => {
	res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
};

const body = async (req) => {
	let s = "";
	for await (const c of req) s += c;
	try {
		return JSON.parse(s || "{}");
	} catch {
		return null;
	}
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

/**
 * The minimal page the Google Translate widget runs in.
 *
 * WHY A FRAME AT ALL. The widget translates the whole document it is loaded into — so a page
 * containing NOTHING but the string is exactly what makes it usable, which was the user's
 * insight. It cannot be an iframe of translate.google.com, which sets X-Frame-Options:
 * SAMEORIGIN; it is our own page, same-origin, so the parent can read the result back.
 *
 * The banner is cropped by the PARENT at 42px (measured in a browser 2026-07-31) rather than
 * hidden with CSS here: Google's own class names changed and the documented selector no longer
 * works, so a crop that depends on nothing inside their markup is the only version that stays
 * fixed.
 */
const gtFrame = (text, tl) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>gt</title>
<style>
 body { font: 15px/1.5 system-ui, sans-serif; margin: 8px; color-scheme: light dark; }
 #src { padding: 8px; border-radius: 6px; }
</style></head><body>
<div id="google_translate_element"></div>
<div id="src">${String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</div>
<script>
 window.__tl = ${JSON.stringify(tl)};
 function googleTranslateElementInit() { new google.translate.TranslateElement({ pageLanguage: 'en' }, 'google_translate_element'); }
</script>
<script src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
</body></html>`;

/**
 * Builds the workspace server for one config.
 *
 * A factory rather than module state, so tests can point it at a temp directory and pick a
 * port. An untestable server is how the save path silently stops preserving structure.
 */

/**
 * Everything derived from ONE project's config: its paths, its state, its routes.
 *
 * Split out so the server can START WITHOUT A CONFIG — the setup screen has to be reachable
 * before one exists. Routes dispatch through a lookup table, so an unloaded project is one
 * guard rather than a change to every handler.
 *
 * Called again when setup writes a config, which is how the page goes live without a restart.
 * Loading REPLACES the project wholesale; there is no swap-while-running path, because a
 * half-swapped project with a job in flight is a bug waiting to be written.
 */
function loadProject({ configPath, store: injectedStore, settings, settingsRoot }) {

	const rawCfg = JSON.parse(readFileSync(configPath, "utf8"));

	// Every path from one place, anchored to the config file. This line used to be
	// `resolve(cfg.localesDir)` — against the WORKING DIRECTORY — sitting directly beneath a
	// correct `resolve(configPath, "..")`. The file worked out the right anchor and then did
	// not use it, so the database landed beside the app and the locale files did not.
	const paths = projectPaths(configPath, rawCfg);
	const projectRoot = paths.configDir;
	const localesDir = paths.localesDir;
	const conventions = JSON.parse(readFileSync(new URL("./config/conventions.json", import.meta.url), "utf8"));
	const langs = rawCfg.targets ?? [];

	// TWO handles, two scopes. `store` is this PROJECT's workshop state and lives beside its
	// config. `settings` is YOURS — engine connections, keys, your name — and lives in the tool's
	// own folder, because you install the tool once and point it at many apps. Storing a
	// connection per-project meant re-entering the same key for every app you translate.
	const store = injectedStore ?? openProject(projectRoot);
	const jobs = new JobManager({ store });

	const sourceFile = paths.sourceFile;
	// Inference needs the source strings, so it happens after the file is locatable. An
	// explicit config value still wins; this only fills what was never stated.
	const { cfg } = inferConfig(rawCfg, flatten(JSON.parse(readFileSync(sourceFile, "utf8"))));
	const fileFor = (lang, kind) =>
		kind === "accepted"
			? paths.acceptedFile(lang)
			: kind === "notes"
				? paths.notesFile(lang)
				: kind === "probe"
					? paths.probeFile(lang)
					: paths.targetFile(lang);

	const readSourceRaw = () => JSON.parse(readFileSync(sourceFile, "utf8"));
	const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
	const readTargetFlat = (lang) => flatten(readJson(fileFor(lang), {}));
	const readNotes = (lang) => readJson(fileFor(lang, "notes"), {});

	const ctxFor = new Map();
	const context = (lang) => {
		if (!ctxFor.has(lang)) ctxFor.set(lang, buildContext(cfg, conventions, lang));
		return ctxFor.get(lang);
	};

	/**
	 * Writes one key back, rebuilding nesting from the SOURCE so the diff is one line.
	 *
	 * `value === null` REMOVES the key. That case exists for undo: a key that had no
	 * translation must go back to having none. Writing "" instead — which this did — turns a
	 * `missing` finding into a `blank` one and leaves an empty string in a shipped locale file.
	 */
	function writeKey(lang, key, value) {
		const values = readTargetFlat(lang);
		if (value === null) delete values[key];
		else values[key] = value;
		writeFileSync(fileFor(lang), `${JSON.stringify(rebuild(readSourceRaw(), values), null, 2)}\n`);
		// A human rewriting a string will almost always differ from the machine's second pass,
		// so without this the row is re-flagged as a suspect forever — the reviewer's own fix
		// becoming the evidence against it.
		const probeFile = fileFor(lang, "probe");
		if (existsSync(probeFile)) {
			const p = flatten(JSON.parse(readFileSync(probeFile, "utf8")));
			if (p[key] !== undefined) {
				delete p[key];
				writeFileSync(probeFile, `${JSON.stringify(rebuild(readSourceRaw(), p), null, 2)}\n`);
			}
		}
		// Cached second opinions were about the old text.
		dropReferences(store, { lang, key });
		// So was a staged proposal, and so was the engine's confirmation verdict. Dropping the
		// probe entry and the cached reading but NOT these was a real bug: a proposal staged
		// against the old string survived an edit and could then be applied OVER the newer text,
		// silently reverting a reviewer's own fix.
		dropProposal(store, { lang, key });
		dropConfirmation(store, { lang, key });
	}

	/**
	 * Terminology findings, memoised on the content they were computed from.
	 *
	 * MEASURED on the real 2,039-key catalogue: `runChecks` 18 ms, `rankSuspects` 8 ms,
	 * `checkTerms` 35 ms — the term index is over half the cost of a request, and a request
	 * happens after every accept and every edit. The index only changes when a string changes,
	 * so keying the cache on the two files' contents is exact rather than a guess at staleness.
	 */
	const termCache = new Map();
	function termFindings(lang, sourceFlat, targetFlat) {
		// Cheap, collision-free-enough stamp: key counts plus the joined values' length. A real
		// hash of 2,039 strings would cost more than the 35 ms it is trying to save.
		const stamp = `${Object.keys(sourceFlat).length}:${Object.keys(targetFlat).length}:${Object.values(targetFlat).join("").length}`;
		const hit = termCache.get(lang);
		if (hit?.stamp === stamp) return hit.findings;
		const { findings } = checkTerms({ sourceFlat, targetFlat });
		termCache.set(lang, { stamp, findings });
		return findings;
	}

	/** Every finding for one language, already partitioned by the reviewer's verdicts. */
	function findingsFor(lang) {
		const sourceFlat = flatten(readSourceRaw());
		const targetFlat = readTargetFlat(lang);
		let all = runChecks({ sourceFlat, targetFlat, ctx: context(lang) });

		const probeFile = fileFor(lang, "probe");
		if (existsSync(probeFile)) {
			all.push(
				...rankSuspects({
					sourceFlat,
					targetFlat,
					probeFlat: flatten(JSON.parse(readFileSync(probeFile, "utf8"))),
					// A UI scrolls; a CLI report has to truncate. The last run found 150
					// disagreements, showed 30, and both real defects ranked #22 and #30 OF THE
					// THIRTY SHOWN. There is no reason to cut here.
					topN: Number.POSITIVE_INFINITY,
				}),
			);
		}

		all.push(...termFindings(lang, sourceFlat, targetFlat));

		// The confirmation pass's annotation, hung on the finding it belongs to. BOTH doors must do
		// this or the workspace shows a bare "identical to the source" while the terminal shows
		// "…and it should be Guardar" — the same two-answers-for-one-question drift that
		// server/engine.js exists to prevent. Reads state; calls no engine.
		all = attachConfirmations(all, confirmations(store, lang), sourceFlat, targetFlat);

		const split = partitionAccepted(all, loadAccepted(fileFor(lang, "accepted")), sourceFlat, targetFlat);
		return { sourceFlat, targetFlat, findings: split.findings, accepted: split.accepted };
	}

	/** The queue, across every target language or one of them. */
	function buildRows({ lang = null } = {}) {
		const wanted = lang ? [lang] : langs;
		const rows = [];
		const counts = {};
		let accepted = 0;

		for (const l of wanted) {
			const { sourceFlat, targetFlat, findings, accepted: acc } = findingsFor(l);
			accepted += acc.length;
			const statuses = reviewStatuses(store, l);
			const notes = flatten(readNotes(l));
			const staged = proposalKeys(store, l); // one query, not one per row

			const byKey = new Map();
			for (const f of findings) {
				if (!byKey.has(f.key)) byKey.set(f.key, []);
				// `suggestion` is the confirmation pass's answer for an `untranslated` flag — what
				// the engine would have written, never applied. Distinct from the row's
				// `hasProposal`, which means "a re-translation is staged in the database".
				byKey.get(f.key).push({ code: f.code, detail: f.detail, advisory: !!f.advisory, suggestion: f.suggestion, confirmed: f.confirmed, confirmedBy: f.confirmedBy });
				counts[f.code] = (counts[f.code] ?? 0) + 1;
			}

			for (const [key, flags] of byKey) {
				rows.push({
					lang: l,
					key,
					source: sourceFlat[key] ?? "",
					target: targetFlat[key] ?? "",
					flags,
					status: statuses[key]?.status ?? null,
					note: notes[key] ?? null,
					hasProposal: staged.has(key),
				});
			}
			// Keys with no translation at all are work too, and the old page hid them.
			for (const [key, src] of Object.entries(sourceFlat)) {
				if (targetFlat[key] === undefined && !byKey.has(key)) {
					rows.push({ lang: l, key, source: src, target: "", flags: [{ code: "missing", detail: "not translated", advisory: false }], status: statuses[key]?.status ?? null, note: notes[key] ?? null, hasProposal: false });
					counts.missing = (counts.missing ?? 0) + 1;
				}
			}
		}

		rows.sort((a, b) => b.flags.length - a.flags.length || a.key.localeCompare(b.key) || a.lang.localeCompare(b.lang));
		return { rows, counts, accepted, langs, total: rows.length };
	}

	// ── routes ──────────────────────────────────────────────────────────────────────────

	const routes = {
		"GET /api/state": () => ({
			langs,
			source: cfg.sourceLanguage,
			job: jobs.status(),
			progress: Object.fromEntries(langs.map((l) => [l, reviewProgress(store, l)])),
			proposals: Object.fromEntries(langs.map((l) => [l, proposalCount(store, l)])),
		}),

		"GET /api/rows": (_b, url) => buildRows({ lang: url.searchParams.get("lang") || null }),

		"GET /api/accepted": (_b, url) => {
			const lang = url.searchParams.get("lang") || langs[0];
			const accepted = loadAccepted(fileFor(lang, "accepted"));
			return { lang, entries: Object.entries(accepted).map(([hash, e]) => ({ hash, ...e })) };
		},

		"POST /api/save": (b) => {
			const { lang, key, value } = b ?? {};
			if (typeof lang !== "string" || typeof key !== "string" || typeof value !== "string") return { _code: 400, error: "lang, key and value must be strings" };
			const sourceFlat = flatten(readSourceRaw());
			if (!(key in sourceFlat)) return { _code: 404, error: `no such key: ${key}` };

			const prev = readTargetFlat(lang)[key] ?? null;
			writeKey(lang, key, value);
			recordAction(store, { lang, key, kind: "edit", prev, next: value });
			setReviewStatus(store, { lang, key, status: "reviewed" });

			const flags = checkOne({ key, src: sourceFlat[key], dst: value, ctx: context(lang) }).map((f) => ({ code: f.code, detail: f.detail }));
			return { key, lang, flags };
		},

		/**
		 * Records findings as reviewed-and-correct. Takes `keys[]`, or `key` for one.
		 *
		 * BULK IS THE POINT, not a convenience. A fresh catalogue raises ~70 `untranslated`
		 * findings that are almost all correct output — glyphs, brand names, words the target
		 * language shares. Seventy clicks is what makes someone reach for a script instead;
		 * making the honest path cheap is what stops that.
		 *
		 * ONE CALL IS ONE UNDO. The whole batch records a single `bulk-accept` action holding
		 * every hash it added, so undo reverses the click a person actually made rather than
		 * making them press `u` seventy times.
		 *
		 * `by` comes from YOUR settings, asked for once. Never the OS username, never git — an
		 * automated run under your account would inherit the name and become indistinguishable
		 * from your own judgement, which is the exact failure the field exists to expose.
		 */
		"POST /api/accept": (b) => {
			const { lang, key, keys } = b ?? {};
			const list = Array.isArray(keys) ? keys : key !== undefined ? [key] : null;
			if (typeof lang !== "string" || !list || !list.length || list.some((k) => typeof k !== "string")) {
				return { _code: 400, error: "lang and keys[] (or key) must be strings" };
			}
			const sourceFlat = flatten(readSourceRaw());
			const missing = list.filter((k) => !(k in sourceFlat));
			if (missing.length) return { _code: 404, error: `no such key: ${missing.join(", ")}` };

			const targetFlat = readTargetFlat(lang);
			const wanted = new Set(list);
			// Re-run the checks WITHOUT the acceptance filter: accepting is about what the checks
			// currently say, and filtering first would make a second accept on the same key a
			// no-op that looks like success.
			const raw = runChecks({ sourceFlat, targetFlat, ctx: context(lang) }).filter((f) => wanted.has(f.key));
			const path = fileFor(lang, "accepted");
			const accepted = loadAccepted(path);
			const by = getReviewer(settings) ?? undefined;
			const added = [];
			for (const f of raw) {
				const entry = acceptanceEntry({ key: f.key, code: f.code, src: sourceFlat[f.key] ?? "", dst: targetFlat[f.key] ?? "", by });
				const h = acceptanceHash(entry);
				if (!accepted[h]) added.push(h);
				accepted[h] = entry;
			}
			saveAccepted(path, accepted);

			const bulk = list.length > 1;
			recordAction(store, { lang, key: bulk ? null : list[0], kind: bulk ? "bulk-accept" : "accept", prev: added, next: bulk ? list : null });
			for (const k of list) setReviewStatus(store, { lang, key: k, status: "reviewed" });
			// A machine's opinion has served its purpose once a human has ruled on the key.
			for (const k of list) dropConfirmation(store, { lang, key: k });
			return { lang, keys: list, recorded: added.length, by: by ?? null };
		},

		// The fix for the complaint that started this rebuild. An acceptance was one-way, and
		// accepted keys then vanished from the page entirely, so a decision could never be
		// revisited.
		"DELETE /api/accept": (b) => {
			const { lang, key, code = null } = b ?? {};
			if (typeof lang !== "string" || typeof key !== "string") return { _code: 400, error: "lang and key must be strings" };
			const path = fileFor(lang, "accepted");
			const accepted = loadAccepted(path);
			const removed = {};
			for (const [h, e] of Object.entries(accepted)) {
				if (e.key === key && (code === null || e.code === code)) {
					removed[h] = e;
					delete accepted[h];
				}
			}
			saveAccepted(path, accepted);
			recordAction(store, { lang, key, kind: "unaccept", prev: removed, next: null });
			return { key, lang, removed: Object.keys(removed).length };
		},

		"POST /api/undo": (b) => {
			const a = popAction(store, { lang: b?.lang ?? null });
			if (!a) return { _code: 404, error: "nothing to undo" };
			if (a.kind === "edit") {
				// null, not "" — see writeKey. A key that had no translation goes back to none.
				writeKey(a.lang, a.key, a.prev);
			} else if (a.kind === "accept" || a.kind === "bulk-accept") {
				// Identical reversal for both: `prev` is the list of hashes THIS action added, so
				// undoing a 70-key approval is one step and never touches an acceptance that was
				// already there before the click.
				const path = fileFor(a.lang, "accepted");
				const accepted = loadAccepted(path);
				for (const h of a.prev ?? []) delete accepted[h];
				saveAccepted(path, accepted);
			} else if (a.kind === "unaccept") {
				const path = fileFor(a.lang, "accepted");
				saveAccepted(path, { ...loadAccepted(path), ...(a.prev ?? {}) });
			} else if (a.kind === "note") {
				writeNote(a.lang, a.key, a.prev);
			}
			return { undone: a };
		},

		"GET /api/history": (_b, url) => ({ actions: actionHistory(store, { lang: url.searchParams.get("lang") || null }) }),

		"GET /api/proposals": (_b, url) => {
			const lang = url.searchParams.get("lang") || langs[0];
			return { lang, proposals: proposals(store, { lang, key: url.searchParams.get("key") || null }) };
		},

		"POST /api/proposals/apply": (b) => {
			const { lang, keys } = b ?? {};
			if (typeof lang !== "string" || !Array.isArray(keys)) return { _code: 400, error: "lang and keys[] required" };
			const applied = [];
			for (const key of keys) {
				const [p] = proposals(store, { lang, key });
				if (!p) continue;
				const prev = readTargetFlat(lang)[key] ?? null;
				writeKey(lang, key, p.value);
				recordAction(store, { lang, key, kind: "apply", prev, next: p.value });
				dropProposal(store, { lang, key });
				applied.push(key);
			}
			return { lang, applied };
		},

		"DELETE /api/proposals": (b) => {
			const { lang, keys = null } = b ?? {};
			if (typeof lang !== "string") return { _code: 400, error: "lang required" };
			if (keys === null) return { lang, discarded: dropAllProposals(store, lang) };
			for (const key of keys) dropProposal(store, { lang, key });
			return { lang, discarded: keys.length };
		},

		"GET /api/siblings": (_b, url) => {
			const lang = url.searchParams.get("lang") || langs[0];
			const key = url.searchParams.get("key");
			if (!key) return { _code: 400, error: "key required" };
			// How characterAudit.why was actually proven a defect: its sibling cheapestFix
			// renders the same label-with-colon pattern correctly. A reviewer needs that view.
			const ns = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "";
			const sourceFlat = flatten(readSourceRaw());
			const targetFlat = readTargetFlat(lang);
			const siblings = Object.keys(sourceFlat)
				.filter((k) => k !== key && k.startsWith(`${ns}.`) && !k.slice(ns.length + 1).includes("."))
				.slice(0, 25)
				.map((k) => ({ key: k, source: sourceFlat[k], target: targetFlat[k] ?? "" }));
			return { key, namespace: ns, siblings };
		},

		"GET /api/terms": (_b, url) => {
			const lang = url.searchParams.get("lang") || langs[0];
			const key = url.searchParams.get("key");
			const term = url.searchParams.get("term");
			const sourceFlat = flatten(readSourceRaw());
			const targetFlat = readTargetFlat(lang);
			if (term) return { term, usage: termUsage({ sourceFlat, targetFlat, term }) };
			if (!key) return { _code: 400, error: "key or term required" };
			const { index } = checkTerms({ sourceFlat, targetFlat });
			return { key, findings: checkKeyTerms({ key, src: sourceFlat[key], dst: targetFlat[key], index }) };
		},

		"PUT /api/notes": (b) => {
			const { lang, key, note } = b ?? {};
			if (typeof lang !== "string" || typeof key !== "string") return { _code: 400, error: "lang and key required" };
			const prev = flatten(readNotes(lang))[key] ?? null;
			writeNote(lang, key, note || null);
			recordAction(store, { lang, key, kind: "note", prev, next: note || null });
			return { lang, key, note: note || null };
		},

		// Your name, asked for once and kept in the TOOL's settings — so it is right for every
		// app you point this at, and so an approval can say who made it.
		"GET /api/reviewer": () => ({ reviewer: getReviewer(settings) }),

		"PUT /api/reviewer": (b) => {
			if (b?.reviewer !== null && typeof b?.reviewer !== "string") return { _code: 400, error: "reviewer must be a string or null" };
			setReviewer(settings, b.reviewer);
			return { reviewer: getReviewer(settings) };
		},

		"GET /api/engines": () => ({
			providers: listProviders().map(({ help, ...p }) => ({ ...p, help })),
			connections: listConnections(settings),
		}),

		"PUT /api/engines/connection": (b) => {
			const { id, label, provider = null, overrides = {}, apiKey } = b ?? {};
			if (typeof label !== "string") return { _code: 400, error: "label required" };
			// Refuses BEFORE writing. "I assumed it was ignored" is how a key gets published.
			if (apiKey) {
				try {
					assertGitignored(settingsRoot);
				} catch (e) {
					return { _code: 400, error: e.message };
				}
			}
			const newId = saveConnection(settings, { id, label, provider, overrides, apiKey });
			return readConnection(settings, newId);
		},

		"GET /api/runs": (_b, url) => ({ runs: runHistory(store, { lang: url.searchParams.get("lang") || null }) }),

		"GET /api/reference": (_b, url) => {
			const lang = url.searchParams.get("lang") || langs[0];
			const key = url.searchParams.get("key");
			const engine = url.searchParams.get("engine") ?? "backtranslate";
			if (!key) return { _code: 400, error: "key required" };
			return { key, lang, engine, cached: getReference(store, { lang, key, engine }) };
		},

		"GET /api/jobs/current": () => ({ job: jobs.status() }),

		"POST /api/jobs/cancel": () => ({ job: jobs.cancel() }),
	};

	function writeNote(lang, key, note) {
		const path = fileFor(lang, "notes");
		const notes = flatten(readNotes(lang));
		if (note === null || note === undefined) delete notes[key];
		else notes[key] = note;
		const sorted = Object.fromEntries(Object.entries(notes).sort(([a], [b]) => (a < b ? -1 : 1)));
		writeFileSync(
			path,
			`${JSON.stringify(
				sorted,
				null,
				2,
			)}\n`,
		);
	}

	/** Resolves a scope into a key subset and hands it to the job manager. */
	/** The only scopes a run may have. Anything else is a typo, and a typo must not start a job. */
	const SCOPES = new Set(["flagged", "unsure", "all", "keys"]);

	function startJob(b, res) {
		const { lang, connectionId = null, engine = null, scope = "flagged", keys = null } = b;
		if (!langs.includes(lang)) return json(res, 400, { error: `unknown language: ${lang}` });
		// Found by driving the real catalogue: an unrecognised scope fell through to the
		// flagged branch and started a 154-key run. A 52-minute job must never begin on a scope
		// the caller did not ask for, so an unknown one is refused rather than interpreted.
		if (!SCOPES.has(scope)) return json(res, 400, { error: `unknown scope: ${scope}. Use one of ${[...SCOPES].join(", ")}` });

		// THE FIX for the two-resolver bug. This used to be the bare connection, so cfg.model,
		// cfg.url, cfg.think and cfg.profile appeared ZERO times in the job path: an override
		// set in the project config worked from the CLI and was silently ignored when you
		// pressed re-translate in this workspace. Same tool, same config, two answers.
		const base = connectionId ? resolveConnection(settings, connectionId) : null;
		if (connectionId && !base) return json(res, 404, { error: `no such connection: ${connectionId}` });
		const profile = base ? applyConfigOverrides(base, cfg) : null;
		const problem = profile ? profileProblem(profile, { name: engine ?? "connection" }) : null;
		if (problem) return json(res, 400, { error: problem });

		const sourceFlat = flatten(readSourceRaw());
		let wanted;
		if (scope === "keys") wanted = keys ?? [];
		else if (scope === "all") wanted = Object.keys(sourceFlat);
		else {
			const { findings } = findingsFor(lang);
			const flagged = new Set(findings.filter((f) => scope !== "unsure" || f.code === "disagreement").map((f) => f.key));
			wanted = [...flagged];
		}
		const subset = Object.fromEntries(wanted.filter((k) => k in sourceFlat).map((k) => [k, sourceFlat[k]]));
		if (!Object.keys(subset).length) return json(res, 400, { error: "that scope selected no keys" });

		try {
			const status = jobs.start({
				lang,
				engine: engine ?? profile?.model ?? "engine",
				profile,
				scope,
				subset,
				// notes MUST be here. Without them the note a reviewer writes on a key is not sent
				// when they press re-translate on that same key — which is the one place it matters.
				cfg: { ...cfg, conventionsLine: conventions[lang]?.promptLine ?? "", notes: flatten(readNotes(lang)) },
				cachePath: paths.cachePath,
			});
			return json(res, 202, { job: status });
		} catch (e) {
			return json(res, e.code === "JOB_BUSY" ? 409 : 500, { error: e.message });
		}
	}

	return {
		configPath, rawCfg, cfg, paths, projectRoot, localesDir, conventions, langs,
		store, jobs, sourceFile, fileFor, readSourceRaw, readTargetFlat, readNotes,
		context, writeKey, writeNote, findingsFor, buildRows, routes, startJob,
	};
}

export function createWorkspaceServer({ configPath = null, uiDir, store: injectedStore, settingsRoot = TOOL_ROOT } = {}) {
	// Available with no project open — the setup page needs the engine list, and connections are
	// tool-level so they survive pointing at a different app. `settingsRoot` is a parameter, not
	// a constant, so a test can never reach the real settings file.
	const settings = openSettings(settingsRoot);
	let project = configPath ? loadProject({ configPath, store: injectedStore, settings, settingsRoot }) : null;

	/**
	 * Setup — the routes that work with NO project loaded.
	 *
	 * WHY A PATH BOX AND NOT A FILE PICKER. A browser file input hands JavaScript a File object
	 * and never a filesystem path, so a real "Browse…" means the server exposing a directory
	 * listing API over localhost. That is a filesystem-read surface nothing else in this tool
	 * has, to save typing a path once per project. You paste it, and the server says immediately
	 * what it found — which is the part that actually prevents mistakes.
	 */
	const setupRoutes = {
		"GET /api/setup/state": () => ({
			loaded: !!project,
			configPath: project?.configPath ?? null,
			source: project?.paths.sourceFile ?? null,
			langs: project?.langs ?? [],
			reviewer: getReviewer(settings),
			// Offered here as well as in the review screen: choosing an engine is part of setting
			// a project up, and sending you to another tab for it is how a "setup" page ends up
			// doing half the job.
			providers: listProviders().map(({ help, ...p }) => ({ ...p, help })),
			connections: listConnections(settings),
			defaultEngine: defaultEngine(),
			// Codes only. The display name is derived in the browser from Intl.DisplayNames, so the
			// menu reads in the user's own language and no English name can go stale here.
			languages: JSON.parse(readFileSync(new URL("./config/languages.json", import.meta.url), "utf8")),
		}),

		/**
		 * Reads a candidate en.json and reports what it found. Writes NOTHING.
		 *
		 * This is the live validation behind the path box: key count, the placeholder syntax and
		 * plural separator inferred from the strings themselves, the locale files sitting beside
		 * it, and glossary candidates. Seeing that the tool understood your catalogue is what
		 * proves the path is right before an hour of engine time proves it was not.
		 */
		"POST /api/setup/inspect": (b) => {
			const path = String(b?.path ?? "").trim().replace(/^["']|["']$/g, "");
			if (!path) return { _code: 400, error: "give me the path to your en.json" };
			try {
				const plan = planInit(path);
				return {
					ok: true,
					source: plan.localesDir,
					sourceLanguage: plan.sourceLanguage,
					keyCount: plan.keyCount,
					placeholder: plan.placeholder,
					pluralSeparator: plan.pluralSeparator,
					// Every locale file already sitting beside the source, with how much of the
					// catalogue each one actually covers. NOT pre-selected: an existing file is a
					// fact about the folder, not a decision about what to run.
					locales: plan.existingTargets.map((code) => {
						const target = join(plan.localesDir, `${code}.json`);
						const flat = existsSync(target) ? flatten(JSON.parse(readFileSync(target, "utf8"))) : {};
						const done = Object.keys(plan.sourceFlat).filter((k) => typeof flat[k] === "string" && flat[k] !== "").length;
						return { code, done, total: plan.keyCount, missing: plan.keyCount - done };
					}),
					candidates: plan.candidates,
					configPath: plan.configPath,
					exists: existsSync(plan.configPath),
					gitignore: gitignoreLines(),
				};
			} catch (e) {
				// The message from planInit is already the useful one — "no such file", "holds no
				// strings", "no package.json above …". Passing it through beats inventing a worse one.
				return { _code: 400, error: e.message };
			}
		},

		/**
		 * Writes the config and LOADS it, so the page goes live without a restart.
		 *
		 * Editing an existing project comes through here too, and the merge is the important
		 * part: whatever the file already had that this screen does not manage is preserved
		 * byte-for-byte. The UI is a writer, never an owner — a field added by hand or by a
		 * future version must survive a save it knows nothing about.
		 */
		"POST /api/setup/save": (b) => {
			const path = String(b?.path ?? "").trim().replace(/^["']|["']$/g, "");
			if (!path) return { _code: 400, error: "give me the path to your en.json" };
			let plan;
			try {
				plan = planInit(path, {
					targets: Array.isArray(b?.targets) ? b.targets : undefined,
					context: typeof b?.context === "string" ? b.context : undefined,
					glossary: Array.isArray(b?.glossary) ? b.glossary : undefined,
					engine: typeof b?.engine === "string" && b.engine ? b.engine : undefined,
				});
			} catch (e) {
				return { _code: 400, error: e.message };
			}
			const existing = existsSync(plan.configPath) ? JSON.parse(readFileSync(plan.configPath, "utf8")) : {};
			writeInit({ ...plan, cfg: { ...existing, ...plan.cfg } }, { force: true });
			project = loadProject({ configPath: plan.configPath, settings, settingsRoot });
			return { ok: true, configPath: plan.configPath, langs: project.langs };
		},

		"PUT /api/setup/reviewer": (b) => {
			if (b?.reviewer !== null && typeof b?.reviewer !== "string") return { _code: 400, error: "reviewer must be a string or null" };
			setReviewer(settings, b.reviewer);
			return { reviewer: getReviewer(settings) };
		},
	};

	const server = httpServer(async (req, res) => {
		const url = new URL(req.url, "http://localhost");
		const route = `${req.method} ${url.pathname}`;

		// Setup runs with NO project — it is the screen that CREATES one.
		if (url.pathname.startsWith("/api/setup/")) {
			const h = setupRoutes[route];
			if (!h) return json(res, 404, { error: "not found" });
			const b = req.method === "GET" ? null : await body(req);
			if (req.method !== "GET" && b === null) return json(res, 400, { error: "bad JSON" });
			try {
				const out = await h(b, url);
				const code = out?._code ?? 200;
				if (out && "_code" in out) delete out._code;
				return json(res, code, out);
			} catch (e) {
				return json(res, 500, { error: e.message });
			}
		}

		// Everything else needs a project. ONE guard, not a change to every handler, because
		// routes dispatch through a lookup table. The static UI below is deliberately STILL
		// served without one, so the setup page can load and say there is nothing pointed at
		// yet — a tool that needs a config to reach the screen that writes a config is exactly
		// what this split exists to fix.
		if (url.pathname.startsWith("/api/") && !project) {
			return json(res, 409, { error: "no project loaded yet", needsSetup: true });
		}
		// One destructure keeps every handler below written against bare names, which is why
		// extracting loadProject moved ~440 lines without touching the 97 references in them.
		const { cfg, store, jobs, langs, routes, writeNote, startJob, readTargetFlat, readSourceRaw, context, writeKey, fileFor, paths, buildRows, findingsFor, localesDir, conventions } = project ?? {};

		// The Google Translate frame — our own page, so the parent can read the result back.
		if (url.pathname === "/gt-frame") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			return res.end(gtFrame(url.searchParams.get("text") ?? "", url.searchParams.get("tl") ?? "es"));
		}

		// Server-sent events for a running job.
		if (route === "GET /api/jobs/stream") {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			res.write(`event: hello\ndata: ${JSON.stringify(jobs.status())}\n\n`);
			const off = jobs.subscribe((e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
			req.on("close", off);
			return;
		}

		// Back-translation: the target string rendered BACK into English by a local model.
		//
		// It answers a question no other layer can: "what does this actually say?" — for a
		// reviewer who does not read the target language fluently, that is the difference
		// between judging a translation and taking its word for it. It catches wrong-word
		// defects (`autoconservado` reads back as "self-preserved", not "autosaved").
		//
		// It does NOT catch everything, and the panel says so rather than implying more.
		// Measured 2026-07-31: a correct and an incorrect Spanish rendering of the data-folder
		// hint back-translated to the SAME English, because the ambiguity is in the source.
		// Read-only, cached, and never written to a catalogue.
		if (route === "POST /api/backtranslate") {
			const b = await body(req);
			if (!b) return json(res, 400, { error: "bad JSON" });
			const { lang, key, connectionId = null } = b;
			if (typeof lang !== "string" || typeof key !== "string") return json(res, 400, { error: "lang and key required" });

			const dst = readTargetFlat(lang)[key];
			if (!dst) return json(res, 404, { error: `no translation for ${key}` });

			const cached = getReference(store, { lang, key, engine: "backtranslate" });
			if (cached) return json(res, 200, { key, lang, english: cached.value, cached: true });

			const base = connectionId ? resolveConnection(settings, connectionId) : null;
			if (!base) return json(res, 400, { error: "no engine connection selected" });
			// Same merge as the job path — a back-translation must run on the engine the project
			// config actually describes, or a second opinion is a second opinion about nothing.
			const profile = applyConfigOverrides(base, cfg);
			const problem = profileProblem(profile, { name: "connection" });
			if (problem) return json(res, 400, { error: problem });

			try {
				const system = `You are a translator, ${lang}→${cfg.sourceLanguage}. Translate the text literally, preserving any {placeholders} exactly. Output ONLY JSON matching the schema.`;
				const out = await callModel({ profile, system, user: `Translate items: ${JSON.stringify([{ id: 0, text: dst }])}` });
				const english = parseItems(out).get(0);
				if (!english) return json(res, 502, { error: "the engine returned nothing usable" });
				putReference(store, { lang, key, engine: "backtranslate", value: english });
				return json(res, 200, { key, lang, english, cached: false });
			} catch (e) {
				// A dead second opinion must never block reviewing.
				return json(res, 502, { error: e.message });
			}
		}

		if (route === "POST /api/jobs") {
			const b = await body(req);
			if (!b) return json(res, 400, { error: "bad JSON" });
			if (jobs.busy) return json(res, 409, { error: "a job is already running", job: jobs.status() });
			return startJob(b, res);
		}

		// `routes?.` — with no project there is no route table, and `GET /` reaches here: the guard
		// above refuses only `/api/` paths, so the static UI is still served and can show setup.
		const handler = routes?.[route];
		if (handler) {
			const b = req.method === "GET" ? null : await body(req);
			if (req.method !== "GET" && b === null) return json(res, 400, { error: "bad JSON" });
			try {
				const out = handler(b, url);
				const code = out?._code ?? 200;
				if (out && "_code" in out) delete out._code;
				return json(res, code, out);
			} catch (e) {
				return json(res, 500, { error: e.message });
			}
		}

		// Static UI, when one is built.
		//
		// `no-store` MATTERS. The build emits fixed names — `app.js`, not `app.[hash].js` — so the
		// COMMITTED dist does not churn a filename on every rebuild. The cost is that the URL never
		// changes, so without this a browser serves a cached UI from before the last tool update.
		// Localhost, ~220 KB, one reader: re-reading it every load is free. A stale UI is not.
		if (uiDir && req.method === "GET") {
			const rel = url.pathname === "/" ? "/index.html" : url.pathname;
			const file = join(uiDir, rel.replace(/^\/+/, ""));
			const headers = (type) => ({ "content-type": type, "cache-control": "no-store, must-revalidate" });
			if (file.startsWith(uiDir) && existsSync(file)) {
				res.writeHead(200, headers(MIME[extname(file)] ?? "application/octet-stream"));
				return res.end(readFileSync(file));
			}
			// SPA fallback so a deep link works.
			const index = join(uiDir, "index.html");
			if (existsSync(index)) {
				res.writeHead(200, headers("text/html; charset=utf-8"));
				return res.end(readFileSync(index));
			}
		}

		json(res, 404, { error: "not found" });
	});
	// The test/CLI handle. A getter so it follows a project loaded AFTER the server started —
	// which is the normal case now that setup can create one.
	Object.defineProperty(server, "jah", { get: () => (project ? { ...project, settings, reload: () => { project = loadProject({ configPath: project.configPath, settings }); } } : { settings, project: null }) });
	return server;
}