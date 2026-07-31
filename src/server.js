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
//   .jah.db         everything else: progress, undo, proposals, runs, connections
//
// A job never writes a locale file. Engine output is staged and applied by a person. Deleting
// the database must not break a build, and there is a test.

import { createServer as httpServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { acceptanceEntry, acceptanceHash, loadAccepted, partitionAccepted, saveAccepted } from "./accepted.js";
import { buildContext, checkOne, runChecks } from "./checks.js";
import { DB_FILE, assertGitignored, listConnections, listProviders, openProject, readConnection, resolveConnection, saveConnection } from "./db.js";
import { flatten, rebuild } from "./jsonutil.js";
import { JobManager } from "./jobs.js";
import {
	actionHistory,
	dropAllProposals,
	dropProposal,
	dropReferences,
	getReference,
	popAction,
	proposalCount,
	proposals,
	putReference,
	recordAction,
	reviewProgress,
	reviewStatuses,
	runHistory,
	setReviewStatus,
} from "./store.js";
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
export function createWorkspaceServer({ configPath, uiDir, db: injectedDb } = {}) {
	const cfg = JSON.parse(readFileSync(configPath, "utf8"));
	const projectRoot = resolve(configPath, "..");
	const localesDir = resolve(cfg.localesDir);
	const conventions = JSON.parse(readFileSync(new URL("./conventions.json", import.meta.url), "utf8"));
	const langs = cfg.targets ?? [];

	const db = injectedDb ?? openProject(projectRoot);
	const jobs = new JobManager({ db });

	const sourceFile = join(localesDir, `${cfg.sourceLanguage}.json`);
	const fileFor = (lang, kind) => join(localesDir, kind ? `${lang}.${kind}.json` : `${lang}.json`);

	const readSourceRaw = () => JSON.parse(readFileSync(sourceFile, "utf8"));
	const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
	const readTargetFlat = (lang) => flatten(readJson(fileFor(lang), {}));
	const readNotes = (lang) => readJson(fileFor(lang, "notes"), {});

	const ctxFor = new Map();
	const context = (lang) => {
		if (!ctxFor.has(lang)) ctxFor.set(lang, buildContext(cfg, conventions, lang));
		return ctxFor.get(lang);
	};

	/** Writes one key back, rebuilding nesting from the SOURCE so the diff is one line. */
	function writeKey(lang, key, value) {
		const values = readTargetFlat(lang);
		values[key] = value;
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
		dropReferences(db, { lang, key });
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

		const { findings: terminology } = checkTerms({ sourceFlat, targetFlat });
		all.push(...terminology);

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
			const statuses = reviewStatuses(db, l);
			const notes = flatten(readNotes(l));

			const byKey = new Map();
			for (const f of findings) {
				if (!byKey.has(f.key)) byKey.set(f.key, []);
				byKey.get(f.key).push({ code: f.code, detail: f.detail, advisory: !!f.advisory });
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
					hasProposal: proposals(db, { lang: l, key }).length > 0,
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
			progress: Object.fromEntries(langs.map((l) => [l, reviewProgress(db, l)])),
			proposals: Object.fromEntries(langs.map((l) => [l, proposalCount(db, l)])),
		}),

		"GET /api/rows": (_b, url) => buildRows({ lang: url.searchParams.get("lang") || null }),

		"GET /api/accepted": (_b, url) => {
			const lang = url.searchParams.get("lang") || langs[0];
			const store = loadAccepted(fileFor(lang, "accepted"));
			return { lang, entries: Object.entries(store).map(([hash, e]) => ({ hash, ...e })) };
		},

		"POST /api/save": (b) => {
			const { lang, key, value } = b ?? {};
			if (typeof lang !== "string" || typeof key !== "string" || typeof value !== "string") return { _code: 400, error: "lang, key and value must be strings" };
			const sourceFlat = flatten(readSourceRaw());
			if (!(key in sourceFlat)) return { _code: 404, error: `no such key: ${key}` };

			const prev = readTargetFlat(lang)[key] ?? null;
			writeKey(lang, key, value);
			recordAction(db, { lang, key, kind: "edit", prev, next: value });
			setReviewStatus(db, { lang, key, status: "reviewed" });

			const flags = checkOne({ key, src: sourceFlat[key], dst: value, ctx: context(lang) }).map((f) => ({ code: f.code, detail: f.detail }));
			return { key, lang, flags };
		},

		"POST /api/accept": (b) => {
			const { lang, key } = b ?? {};
			if (typeof lang !== "string" || typeof key !== "string") return { _code: 400, error: "lang and key must be strings" };
			const sourceFlat = flatten(readSourceRaw());
			if (!(key in sourceFlat)) return { _code: 404, error: `no such key: ${key}` };

			const targetFlat = readTargetFlat(lang);
			const raw = runChecks({ sourceFlat, targetFlat, ctx: context(lang) }).filter((f) => f.key === key);
			const path = fileFor(lang, "accepted");
			const store = loadAccepted(path);
			const added = [];
			for (const f of raw) {
				const entry = acceptanceEntry({ key: f.key, code: f.code, src: sourceFlat[f.key] ?? "", dst: targetFlat[f.key] ?? "" });
				const h = acceptanceHash(entry);
				if (!store[h]) added.push(h);
				store[h] = entry;
			}
			saveAccepted(path, store);
			recordAction(db, { lang, key, kind: "accept", prev: added, next: null });
			setReviewStatus(db, { lang, key, status: "reviewed" });
			return { key, lang, recorded: added.length };
		},

		// The fix for the complaint that started this rebuild. An acceptance was one-way, and
		// accepted keys then vanished from the page entirely, so a decision could never be
		// revisited.
		"DELETE /api/accept": (b) => {
			const { lang, key, code = null } = b ?? {};
			if (typeof lang !== "string" || typeof key !== "string") return { _code: 400, error: "lang and key must be strings" };
			const path = fileFor(lang, "accepted");
			const store = loadAccepted(path);
			const removed = {};
			for (const [h, e] of Object.entries(store)) {
				if (e.key === key && (code === null || e.code === code)) {
					removed[h] = e;
					delete store[h];
				}
			}
			saveAccepted(path, store);
			recordAction(db, { lang, key, kind: "unaccept", prev: removed, next: null });
			return { key, lang, removed: Object.keys(removed).length };
		},

		"POST /api/undo": (b) => {
			const a = popAction(db, { lang: b?.lang ?? null });
			if (!a) return { _code: 404, error: "nothing to undo" };
			if (a.kind === "edit") {
				writeKey(a.lang, a.key, a.prev ?? "");
			} else if (a.kind === "accept") {
				const path = fileFor(a.lang, "accepted");
				const store = loadAccepted(path);
				for (const h of a.prev ?? []) delete store[h];
				saveAccepted(path, store);
			} else if (a.kind === "unaccept") {
				const path = fileFor(a.lang, "accepted");
				saveAccepted(path, { ...loadAccepted(path), ...(a.prev ?? {}) });
			} else if (a.kind === "note") {
				writeNote(a.lang, a.key, a.prev);
			}
			return { undone: a };
		},

		"GET /api/history": (_b, url) => ({ actions: actionHistory(db, { lang: url.searchParams.get("lang") || null }) }),

		"GET /api/proposals": (_b, url) => {
			const lang = url.searchParams.get("lang") || langs[0];
			return { lang, proposals: proposals(db, { lang, key: url.searchParams.get("key") || null }) };
		},

		"POST /api/proposals/apply": (b) => {
			const { lang, keys } = b ?? {};
			if (typeof lang !== "string" || !Array.isArray(keys)) return { _code: 400, error: "lang and keys[] required" };
			const applied = [];
			for (const key of keys) {
				const [p] = proposals(db, { lang, key });
				if (!p) continue;
				const prev = readTargetFlat(lang)[key] ?? null;
				writeKey(lang, key, p.value);
				recordAction(db, { lang, key, kind: "apply", prev, next: p.value });
				dropProposal(db, { lang, key });
				applied.push(key);
			}
			return { lang, applied };
		},

		"DELETE /api/proposals": (b) => {
			const { lang, keys = null } = b ?? {};
			if (typeof lang !== "string") return { _code: 400, error: "lang required" };
			if (keys === null) return { lang, discarded: dropAllProposals(db, lang) };
			for (const key of keys) dropProposal(db, { lang, key });
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
			recordAction(db, { lang, key, kind: "note", prev, next: note || null });
			return { lang, key, note: note || null };
		},

		"GET /api/engines": () => ({
			providers: listProviders(db).map(({ help, ...p }) => ({ ...p, help })),
			connections: listConnections(db),
		}),

		"PUT /api/engines/connection": (b) => {
			const { id, label, provider = null, overrides = {}, apiKey } = b ?? {};
			if (typeof label !== "string") return { _code: 400, error: "label required" };
			// Refuses BEFORE writing. "I assumed it was ignored" is how a key gets published.
			if (apiKey) {
				try {
					assertGitignored(projectRoot, DB_FILE);
				} catch (e) {
					return { _code: 400, error: e.message };
				}
			}
			const newId = saveConnection(db, { id, label, provider, overrides, apiKey });
			return readConnection(db, newId);
		},

		"GET /api/runs": (_b, url) => ({ runs: runHistory(db, { lang: url.searchParams.get("lang") || null }) }),

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
				{
					_why: "Per-key context for the translator, written during review. Injected into the prompt on the next translation of that key, so a fix compounds instead of recurring.",
					...sorted,
				},
				null,
				2,
			)}\n`,
		);
	}

	const server = httpServer(async (req, res) => {
		const url = new URL(req.url, "http://localhost");
		const route = `${req.method} ${url.pathname}`;

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

		if (route === "POST /api/jobs") {
			const b = await body(req);
			if (!b) return json(res, 400, { error: "bad JSON" });
			if (jobs.busy) return json(res, 409, { error: "a job is already running", job: jobs.status() });
			return startJob(b, res);
		}

		const handler = routes[route];
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
		if (uiDir && req.method === "GET") {
			const rel = url.pathname === "/" ? "/index.html" : url.pathname;
			const file = join(uiDir, rel.replace(/^\/+/, ""));
			if (file.startsWith(uiDir) && existsSync(file)) {
				res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
				return res.end(readFileSync(file));
			}
			// SPA fallback so a deep link works.
			const index = join(uiDir, "index.html");
			if (existsSync(index)) {
				res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
				return res.end(readFileSync(index));
			}
		}

		json(res, 404, { error: "not found" });
	});

	/** Resolves a scope into a key subset and hands it to the job manager. */
	function startJob(b, res) {
		const { lang, connectionId = null, engine = null, scope = "flagged", keys = null } = b;
		if (!langs.includes(lang)) return json(res, 400, { error: `unknown language: ${lang}` });

		const profile = connectionId ? resolveConnection(db, connectionId) : null;
		if (connectionId && !profile) return json(res, 404, { error: `no such connection: ${connectionId}` });
		if (profile?.missingProvider) return json(res, 400, { error: `connection references a provider that no longer exists: ${profile.missingProvider}` });

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
				cfg: { ...cfg, conventionsLine: conventions[lang]?.promptLine ?? "" },
				cachePath: join(projectRoot, ".jah-cache.json"),
			});
			return json(res, 202, { job: status });
		} catch (e) {
			return json(res, e.code === "JOB_BUSY" ? 409 : 500, { error: e.message });
		}
	}

	server.jah = { cfg, db, jobs, langs, localesDir, buildRows, findingsFor, writeKey, fileFor };
	return server;
}
