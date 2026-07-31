// Review state — the part of a review session that outlives the browser tab.
//
// Everything here is database-backed on purpose. A reviewer works a 200-key queue over several
// days; if closing the tab loses your place, your undo stack and the proposals a bulk run
// staged, the tool has failed at the one job it was rebuilt for.
//
// The DIVISION with the JSON files is absolute and is tested: this module never writes a
// translation. Applying a proposal hands the value back to the caller, which writes the locale
// file through the existing path. Nothing here is load-bearing for `--check-only`.
//
// THE ACTION LOG is the spine. Every mutation a reviewer makes records what the value was
// before, so undo is a replay rather than a guess — and because it lives in SQLite rather than
// in server memory, an accept made on Friday is still undoable on Monday. Undo was the first
// complaint that started this rebuild, and the shallow version (a button that only works until
// you refresh) would have missed the point.

/** The mutations an undo has to be able to reverse. */
export const ACTION_KINDS = ["edit", "accept", "unaccept", "apply", "discard", "note"];

const now = () => new Date().toISOString();

// ── Review progress ─────────────────────────────────────────────────────────────────────

/**
 * Marks where a reviewer has been. `status` is 'reviewed' | 'skipped' | null, where null means
 * "seen but undecided" — visiting a key must not silently count as approving it.
 */
export function setReviewStatus(db, { lang, key, status }) {
	db.prepare(`
		INSERT INTO review_state (lang, key, status, visited_at) VALUES (?,?,?,?)
		ON CONFLICT(lang, key) DO UPDATE SET status = excluded.status, visited_at = excluded.visited_at
	`).run(lang, key, status, now());
}

/** Every recorded status for a language, as a plain map for the UI to merge over its rows. */
export function reviewStatuses(db, lang) {
	return Object.fromEntries(
		db
			.prepare("SELECT key, status, visited_at FROM review_state WHERE lang = ? AND status IS NOT NULL")
			.all(lang)
			.map((r) => [r.key, { status: r.status, visitedAt: r.visited_at }]),
	);
}

/** Counts for the progress bar: how much of this queue has actually been decided. */
export function reviewProgress(db, lang) {
	const rows = db
		.prepare("SELECT status, COUNT(*) AS n FROM review_state WHERE lang = ? AND status IS NOT NULL GROUP BY status")
		.all(lang);
	const out = { reviewed: 0, skipped: 0 };
	for (const r of rows) if (r.status in out) out[r.status] = r.n;
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
export function recordAction(db, { lang, key = null, kind, prev, next = null }) {
	if (!ACTION_KINDS.includes(kind)) throw new Error(`unknown action kind: ${kind}`);
	if (prev === undefined) throw new Error(`action "${kind}" recorded without a previous value — undo could not reverse it`);
	const r = db
		.prepare("INSERT INTO actions (lang, key, kind, prev, next, at) VALUES (?,?,?,?,?,?)")
		.run(lang, key, kind, JSON.stringify(prev ?? null), JSON.stringify(next), now());
	return Number(r.lastInsertRowid);
}

const hydrate = (r) =>
	r && {
		id: r.id,
		lang: r.lang,
		key: r.key,
		kind: r.kind,
		prev: JSON.parse(r.prev),
		next: JSON.parse(r.next),
		at: r.at,
		undone: !!r.undone,
	};

/** The most recent still-undone action, or null. */
export function lastAction(db, lang = null) {
	const sql = lang
		? "SELECT * FROM actions WHERE undone = 0 AND lang = ? ORDER BY id DESC LIMIT 1"
		: "SELECT * FROM actions WHERE undone = 0 ORDER BY id DESC LIMIT 1";
	return hydrate(lang ? db.prepare(sql).get(lang) : db.prepare(sql).get());
}

/** Session history for the undo panel, newest first. */
export function actionHistory(db, { lang = null, limit = 50 } = {}) {
	const sql = lang
		? "SELECT * FROM actions WHERE lang = ? ORDER BY id DESC LIMIT ?"
		: "SELECT * FROM actions ORDER BY id DESC LIMIT ?";
	return (lang ? db.prepare(sql).all(lang, limit) : db.prepare(sql).all(limit)).map(hydrate);
}

/**
 * Marks an action undone and returns it, so the caller can put `prev` back where it came from.
 *
 * This module does NOT perform the reversal itself: undoing an edit writes a locale file and
 * undoing an accept rewrites a sidecar, both of which belong to the code that owns those files.
 * Keeping the log ignorant of them is what stops it becoming a second, competing writer.
 */
export function popAction(db, { lang = null } = {}) {
	const a = lastAction(db, lang);
	if (!a) return null;
	db.prepare("UPDATE actions SET undone = 1 WHERE id = ?").run(a.id);
	return a;
}

// ── Proposals ───────────────────────────────────────────────────────────────────────────

/**
 * Stages engine output. NOTHING here reaches a locale file until a human applies it — that is
 * the governing principle of the whole design, and it is what makes a 50-minute bulk run safe
 * to cancel and a placeholder-mangling MT result harmless.
 */
export function putProposal(db, { lang, key, engine, value }) {
	db.prepare(`
		INSERT INTO proposals (lang, key, engine, value, at) VALUES (?,?,?,?,?)
		ON CONFLICT(lang, key, engine) DO UPDATE SET value = excluded.value, at = excluded.at
	`).run(lang, key, engine, value, now());
}

/** Staged output, optionally for one key. */
export function proposals(db, { lang, key = null }) {
	const rows = key
		? db.prepare("SELECT * FROM proposals WHERE lang = ? AND key = ? ORDER BY at DESC").all(lang, key)
		: db.prepare("SELECT * FROM proposals WHERE lang = ? ORDER BY key, at DESC").all(lang);
	return rows.map((r) => ({ lang: r.lang, key: r.key, engine: r.engine, value: r.value, at: r.at }));
}

/** How many keys have something waiting — the badge on "review proposals". */
export function proposalCount(db, lang) {
	return db.prepare("SELECT COUNT(DISTINCT key) AS n FROM proposals WHERE lang = ?").get(lang).n;
}

export function dropProposal(db, { lang, key, engine = null }) {
	if (engine) db.prepare("DELETE FROM proposals WHERE lang=? AND key=? AND engine=?").run(lang, key, engine);
	else db.prepare("DELETE FROM proposals WHERE lang=? AND key=?").run(lang, key);
}

export function dropAllProposals(db, lang) {
	const n = proposalCount(db, lang);
	db.prepare("DELETE FROM proposals WHERE lang = ?").run(lang);
	return n;
}

// ── Reference cache ─────────────────────────────────────────────────────────────────────

/**
 * Second opinions, cached per (lang, key, engine). A reviewer moving back and forth through a
 * queue should not re-fetch the same reading, and for the unofficial Google endpoint that is
 * not merely wasteful — it is the difference between a handful of requests and enough to get
 * rate-limited.
 */
export function putReference(db, { lang, key, engine, value }) {
	db.prepare(`
		INSERT INTO reference_cache (lang, key, engine, value, at) VALUES (?,?,?,?,?)
		ON CONFLICT(lang, key, engine) DO UPDATE SET value = excluded.value, at = excluded.at
	`).run(lang, key, engine, value, now());
}

export function getReference(db, { lang, key, engine }) {
	const r = db.prepare("SELECT value, at FROM reference_cache WHERE lang=? AND key=? AND engine=?").get(lang, key, engine);
	return r ? { value: r.value, at: r.at } : null;
}

/** Drops cached readings for a key — called when its translation changes, so stale advice cannot linger. */
export function dropReferences(db, { lang, key }) {
	db.prepare("DELETE FROM reference_cache WHERE lang=? AND key=?").run(lang, key);
}

// ── Runs ────────────────────────────────────────────────────────────────────────────────

/**
 * Run history. Currently thrown away entirely, which is why "how did this catalogue get here"
 * has been unanswerable — two full catalogue runs in July 2026 were unreproducible for exactly
 * this reason.
 */
export function startRun(db, { lang, engine, scope }) {
	const r = db
		.prepare("INSERT INTO runs (lang, engine, scope, started_at) VALUES (?,?,?,?)")
		.run(lang, engine, scope, now());
	return Number(r.lastInsertRowid);
}

export function finishRun(db, id, { keys = 0, requests = 0, elapsedMs = 0, failed = 0 }) {
	db.prepare("UPDATE runs SET keys=?, requests=?, elapsed_ms=?, failed=?, finished_at=? WHERE id=?").run(
		keys,
		requests,
		elapsedMs,
		failed,
		now(),
		id,
	);
}

export function runHistory(db, { lang = null, limit = 20 } = {}) {
	const rows = lang
		? db.prepare("SELECT * FROM runs WHERE lang=? ORDER BY id DESC LIMIT ?").all(lang, limit)
		: db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit);
	return rows.map((r) => ({
		id: r.id,
		lang: r.lang,
		engine: r.engine,
		scope: r.scope,
		keys: r.keys,
		requests: r.requests,
		elapsedMs: r.elapsed_ms,
		failed: r.failed,
		startedAt: r.started_at,
		finishedAt: r.finished_at,
	}));
}
