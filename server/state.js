// Project state — everything the tool remembers about ONE app, in one JSON file.
//
// WHY NOT SQLITE. This replaced a `node:sqlite` database on 2026-07-31, and the reasoning is
// worth keeping because "we already have a database" is the kind of argument that reinstates one.
//
// Three files in a project MUST be committed text — `config.json`, `<lang>.accepted.json`,
// `<lang>.notes.json` — because they hold decisions only a human can make, they live in the
// app's own git repo, and one of them would carry an API key into it. So JSON exists no matter
// what. Adding a database therefore does not REPLACE a storage mechanism, it adds a second one.
//
// And nothing here needs SQL. One user, one project, ~2,000 keys — small enough that every
// query is a `.filter()` over an object already in memory. There are no foreign keys and no
// cascades in the schema that was removed. The largest, most-written dataset in the whole tool
// — the translation cache — was a plain JSON file the entire time the database existed, and
// never had a problem. `store.js` even carried a comment about optimising away "154 round
// trips", a cost that only existed BECAUSE it was a database.
//
// WHAT IS AND IS NOT IN HERE. This file is gitignored. It holds only what a re-run can rebuild:
// the review cursor, the undo log, staged proposals, confirmation verdicts, cached second
// opinions, run history. Delete it and you lose your place in a review, never your work. The
// translation cache stays in its own `.jah-cache.json`, unchanged — it is written once per
// translate run while this file is written on every keypress during review, and there is no
// reason to rewrite 350 KB of cache to record that you looked at a key.
//
// CONCURRENCY. A CLI run and an open review page can both write. Every mutation RE-READS the
// file, applies its change and writes atomically (temp file + rename), so the window for a lost
// update is one mutation rather than one process lifetime. That is the same exposure
// `.jah-cache.json` has always had. It is not a lock, and the docs say so rather than implying
// safety that is not here.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const STATE_FILE = ".jah-state.json";
export const STATE_VERSION = 1;

/** The mutations an undo has to be able to reverse. */
export const ACTION_KINDS = ["edit", "accept", "unaccept", "apply", "discard", "note", "bulk-accept"];

const now = () => new Date().toISOString();

const EMPTY = () => ({
	version: STATE_VERSION,
	review: {},
	actions: [],
	nextActionId: 1,
	proposals: {},
	confirmations: {},
	references: {},
	runs: [],
	nextRunId: 1,
});

/**
 * Writes via a temp file and a rename.
 *
 * `renameSync` is atomic on both Windows and POSIX, so a crash mid-write leaves the previous
 * file intact rather than a truncated one. Whole-file JSON writes without this are how a cache
 * gets corrupted, and a corrupted cache is what cost 27 minutes and 464 hand-corrected keys.
 */
export function writeJsonAtomic(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	try {
		renameSync(tmp, path);
	} catch (e) {
		try {
			unlinkSync(tmp);
		} catch {}
		throw e;
	}
}

/** Reads a JSON file, or returns `fallback` for missing OR corrupt. A corrupt file costs state, never work. */
export function readJsonSafe(path, fallback) {
	if (!existsSync(path)) return fallback;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return fallback;
	}
}

/**
 * A handle over one JSON file.
 *
 * `mutate` re-reads before applying, so a change made by the other process between this
 * handle's last read and now is not silently discarded.
 */
export class JsonStore {
	constructor(path, empty) {
		this.path = path;
		this.empty = empty;
		this.data = readJsonSafe(path, null) ?? empty();
	}
	read() {
		this.data = readJsonSafe(this.path, null) ?? this.empty();
		return this.data;
	}
	mutate(fn) {
		const d = this.read();
		const out = fn(d);
		writeJsonAtomic(this.path, d);
		return out;
	}
	/** Present so callers written against the old database handle can be closed the same way. */
	close() {}
}

/** Opens (or creates) the state file for one project. `projectRoot` is the config's own folder. */
export function openProject(projectRoot) {
	return new JsonStore(join(projectRoot, STATE_FILE), EMPTY);
}

// ── Review progress ─────────────────────────────────────────────────────────────────────

/**
 * Marks where a reviewer has been. `status` is 'reviewed' | 'skipped' | null, where null means
 * "seen but undecided" — visiting a key must not silently count as approving it.
 */
export function setReviewStatus(s, { lang, key, status }) {
	s.mutate((d) => {
		(d.review[lang] ??= {})[key] = { status, visitedAt: now() };
	});
}

/** Every recorded status for a language, as a plain map for the UI to merge over its rows. */
export function reviewStatuses(s, lang) {
	const all = s.read().review[lang] ?? {};
	return Object.fromEntries(Object.entries(all).filter(([, v]) => v.status != null));
}

/** Counts for the progress bar: how much of this queue has actually been decided. */
export function reviewProgress(s, lang) {
	const out = { reviewed: 0, skipped: 0 };
	for (const v of Object.values(s.read().review[lang] ?? {})) {
		if (v.status in out) out[v.status]++;
	}
	return out;
}

// ── The action log ──────────────────────────────────────────────────────────────────────

/**
 * Records one reversible mutation.
 *
 * `prev` is the whole point: it is what undo restores. A caller that passes `undefined` for it
 * is recording something it cannot reverse, which is a bug in the caller, so it throws rather
 * than quietly logging an action that will fail when someone presses undo six days later.
 */
export function recordAction(s, { lang, key = null, kind, prev, next = null }) {
	if (!ACTION_KINDS.includes(kind)) throw new Error(`unknown action kind: ${kind}`);
	if (prev === undefined) throw new Error(`action "${kind}" recorded without a previous value — undo could not reverse it`);
	return s.mutate((d) => {
		const id = d.nextActionId++;
		d.actions.push({ id, lang, key, kind, prev: prev ?? null, next, at: now(), undone: false });
		return id;
	});
}

/** The most recent still-undone action, or null. */
export function lastAction(s, lang = null) {
	const acts = s.read().actions;
	for (let i = acts.length - 1; i >= 0; i--) {
		const a = acts[i];
		if (a.undone) continue;
		if (lang && a.lang !== lang) continue;
		return a;
	}
	return null;
}

/** Session history for the undo panel, newest first. */
export function actionHistory(s, { lang = null, limit = 50 } = {}) {
	return s
		.read()
		.actions.filter((a) => !lang || a.lang === lang)
		.slice(-limit)
		.reverse();
}

/**
 * Marks an action undone and returns it, so the caller can put `prev` back where it came from.
 *
 * This module does NOT perform the reversal itself: undoing an edit writes a locale file and
 * undoing an accept rewrites the accepted file, both of which belong to the code that owns
 * those files. Keeping the log ignorant of them is what stops it becoming a second, competing
 * writer.
 */
export function popAction(s, { lang = null } = {}) {
	return s.mutate((d) => {
		for (let i = d.actions.length - 1; i >= 0; i--) {
			const a = d.actions[i];
			if (a.undone) continue;
			if (lang && a.lang !== lang) continue;
			a.undone = true;
			return a;
		}
		return null;
	});
}

// ── Proposals ───────────────────────────────────────────────────────────────────────────

/**
 * Stages engine output. NOTHING here reaches a locale file until a human applies it — that is
 * the governing principle of the whole design, and it is what makes a 50-minute bulk run safe
 * to cancel and a placeholder-mangling result harmless.
 */
export function putProposal(s, { lang, key, engine, value }) {
	s.mutate((d) => {
		(((d.proposals[lang] ??= {})[key] ??= {}))[engine] = { value, at: now() };
	});
}

/** Staged output, optionally for one key. */
export function proposals(s, { lang, key = null }) {
	const forLang = s.read().proposals[lang] ?? {};
	const keys = key ? (forLang[key] ? [key] : []) : Object.keys(forLang).sort();
	const out = [];
	for (const k of keys) {
		for (const [engine, v] of Object.entries(forLang[k])) {
			out.push({ lang, key: k, engine, value: v.value, at: v.at });
		}
	}
	return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** The set of keys with something staged. */
export function proposalKeys(s, lang) {
	return new Set(Object.keys(s.read().proposals[lang] ?? {}));
}

/** How many keys have something waiting — the badge on "review proposals". */
export function proposalCount(s, lang) {
	return Object.keys(s.read().proposals[lang] ?? {}).length;
}

export function dropProposal(s, { lang, key, engine = null }) {
	s.mutate((d) => {
		const forKey = d.proposals[lang]?.[key];
		if (!forKey) return;
		if (engine) delete forKey[engine];
		else delete d.proposals[lang][key];
		if (forKey && !Object.keys(forKey).length) delete d.proposals[lang][key];
	});
}

export function dropAllProposals(s, lang) {
	return s.mutate((d) => {
		const n = Object.keys(d.proposals[lang] ?? {}).length;
		delete d.proposals[lang];
		return n;
	});
}

// ── Confirmation verdicts ───────────────────────────────────────────────────────────────
//
// The confirmation pass asks the engine about keys whose translation came back byte-identical
// to the English — the one finding a string comparison cannot resolve, because a glyph ("A"),
// a name that stays English ("EPUB"), a word Spanish shares ("Color") and a genuinely skipped
// "books" all look the same to it.
//
// A verdict is workshop state, NOT a decision: it never turns the check green on its own. It
// pre-sorts the pile so a human can approve the obvious ones in one click. `hash` is over
// (key, src, dst) so a verdict expires the moment either string changes — the same rule an
// acceptance follows.

export function putConfirmation(s, { lang, key, hash, verdict, suggestion = null, engine }) {
	if (verdict !== "same" && verdict !== "translate") throw new Error(`unknown verdict: ${verdict}`);
	s.mutate((d) => {
		(d.confirmations[lang] ??= {})[key] = { hash, verdict, suggestion, engine, at: now() };
	});
}

/** Verdicts for a language, keyed by key. Callers check `hash` before trusting one. */
export function confirmations(s, lang) {
	return s.read().confirmations[lang] ?? {};
}

export function dropConfirmation(s, { lang, key }) {
	s.mutate((d) => {
		if (d.confirmations[lang]) delete d.confirmations[lang][key];
	});
}

// ── Reference cache ─────────────────────────────────────────────────────────────────────

/**
 * Second opinions, cached per (lang, key, engine). A reviewer moving back and forth through a
 * queue should not re-fetch the same reading, and for the unofficial Google endpoint that is
 * not merely wasteful — it is the difference between a handful of requests and enough to get
 * rate-limited.
 */
export function putReference(s, { lang, key, engine, value }) {
	s.mutate((d) => {
		(((d.references[lang] ??= {})[key] ??= {}))[engine] = { value, at: now() };
	});
}

export function getReference(s, { lang, key, engine }) {
	return s.read().references[lang]?.[key]?.[engine] ?? null;
}

/** Drops cached readings for a key — called when its translation changes, so stale advice cannot linger. */
export function dropReferences(s, { lang, key }) {
	s.mutate((d) => {
		if (d.references[lang]) delete d.references[lang][key];
	});
}

// ── Runs ────────────────────────────────────────────────────────────────────────────────

/**
 * Run history — "how did this catalogue get here". Two full catalogue runs in July 2026 were
 * unreproducible because nothing recorded what produced them.
 */
export function startRun(s, { lang, engine, scope }) {
	return s.mutate((d) => {
		const id = d.nextRunId++;
		d.runs.push({ id, lang, engine, scope, keys: 0, requests: 0, elapsedMs: 0, failed: 0, startedAt: now(), finishedAt: null });
		return id;
	});
}

export function finishRun(s, id, { keys = 0, requests = 0, elapsedMs = 0, failed = 0 }) {
	s.mutate((d) => {
		const r = d.runs.find((x) => x.id === id);
		if (r) Object.assign(r, { keys, requests, elapsedMs, failed, finishedAt: now() });
	});
}

export function runHistory(s, { lang = null, limit = 20 } = {}) {
	return s
		.read()
		.runs.filter((r) => !lang || r.lang === lang)
		.slice(-limit)
		.reverse();
}
