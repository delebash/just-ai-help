// The workshop store. Everything the review workspace needs to remember between sessions,
// and nothing that git should be looking at.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE:
//
//     If git should see it, it is a FILE. If it is workshop state, it is the DATABASE.
//
// `<lang>.json` is loaded by the real app through vue-i18n and `--check-only` is the CI gate
// reading those files, so translations, acceptances and notes stay as committed JSON. What
// lives here is the stuff files handle badly: where you were in a 200-key review when you
// closed the tab on Friday, an undo stack that outlives the browser, staged proposals from a
// bulk run, the history of how this catalogue got here, and your engine connections.
//
// Deleting this database must never break a build. That is asserted by a test.
//
// WHY node:sqlite. SQLite is what JustWrite already uses (justwrite_server/database.py), and
// node:sqlite ships INSIDE node — so the app needs no install step at all: the UI is a
// committed dist and the database is part of the runtime. `better-sqlite3` would be the
// alternative and compiles on install, which is more setup, not less.
//
// PROVIDERS vs CONNECTIONS — the split is the whole design of the settings screen:
//
//   providers    what the TOOL knows: Groq is at this URL, speaks this transport, this model
//                needs `think:false`. Seeded from engines.json and REPLACED WHOLESALE on every
//                startup, so a stale model id or a moved endpoint is fixed by updating the
//                tool. Nobody edits this by hand.
//   connections  what YOU chose: which provider, your key, and ONLY the fields you changed.
//                Never touched by a re-seed, which is what makes the wholesale replace safe.
//
// Resolution is preset-then-overrides, the same merge translate.js:93 already performs for
// `{...base, ...cfg.profile}`. Not a new rule — the existing one, moved.

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Bumped when the schema changes. Migrations arrive when there is something to migrate. */
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS providers (
  name              TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  url               TEXT,
  model             TEXT,
  api_key_env       TEXT,
  think             TEXT,            -- JSON: false | true | "low" — JSON so that false survives
  batch_size        INTEGER,
  rate_limit_ms     INTEGER,
  timeout_ms        INTEGER,
  max_output_tokens INTEGER,
  extra_body        TEXT,            -- JSON, merged into the request verbatim
  headers           TEXT,            -- JSON
  help              TEXT             -- the _note/_why prose, surfaced as field help in the UI
);

CREATE TABLE IF NOT EXISTS connections (
  id         INTEGER PRIMARY KEY,
  label      TEXT NOT NULL,
  provider   TEXT,                   -- NULL = fully custom, holds all its own fields
  overrides  TEXT NOT NULL DEFAULT '{}',
  api_key    TEXT,                   -- never leaves the server; see readConnection()
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_state (
  lang       TEXT NOT NULL,
  key        TEXT NOT NULL,
  status     TEXT,                   -- 'reviewed' | 'skipped' | NULL
  visited_at TEXT,
  PRIMARY KEY (lang, key)
);

CREATE TABLE IF NOT EXISTS actions (
  id     INTEGER PRIMARY KEY,
  lang   TEXT NOT NULL,
  key    TEXT,
  kind   TEXT NOT NULL,              -- accept | unaccept | edit | apply | discard
  prev   TEXT,                       -- JSON of what it was, so undo restores exactly
  next   TEXT,
  at     TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proposals (
  lang   TEXT NOT NULL,
  key    TEXT NOT NULL,
  engine TEXT NOT NULL,
  value  TEXT NOT NULL,
  at     TEXT NOT NULL,
  PRIMARY KEY (lang, key, engine)
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY,
  lang        TEXT,
  engine      TEXT,
  scope       TEXT,
  keys        INTEGER,
  requests    INTEGER,
  elapsed_ms  INTEGER,
  failed      INTEGER,
  started_at  TEXT,
  finished_at TEXT
);

-- Cached second opinions. Named _cache because "references" is reserved in SQL.
CREATE TABLE IF NOT EXISTS reference_cache (
  lang   TEXT NOT NULL,
  key    TEXT NOT NULL,
  engine TEXT NOT NULL,
  value  TEXT NOT NULL,
  at     TEXT NOT NULL,
  PRIMARY KEY (lang, key, engine)
);

CREATE TABLE IF NOT EXISTS prefs (
  k TEXT PRIMARY KEY,
  v TEXT
);
`;

/**
 * Opens (creating if needed) the workshop database and brings the schema up to date.
 * `CREATE TABLE IF NOT EXISTS` throughout, so a second run adds what is missing rather than
 * clobbering what is there — asserted by a test, because "migrates rather than clobbers" is
 * the difference between resuming a review and losing one.
 */
export function openDb(path) {
	const db = new DatabaseSync(path);
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(SCHEMA);
	db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
	return db;
}

/** The schema version the file on disk was written with. */
export function schemaVersion(db) {
	return db.prepare("PRAGMA user_version").get().user_version;
}

// ── Providers ───────────────────────────────────────────────────────────────────────────

/** engines.json keys that are documentation, not rows. */
const isMeta = (k) => k.startsWith("_");

/** Gathers a row's `_note`/`_why`/`_setup` prose into one help string for the settings UI. */
function helpText(row) {
	return (
		Object.entries(row)
			.filter(([k, v]) => isMeta(k) && typeof v === "string")
			.map(([k, v]) => `${k.replace(/^_/, "")}: ${v}`)
			.join("\n\n") || null
	);
}

/** JSON, or null — used for the columns that hold arbitrary structure. */
const jsonOrNull = (v) => (v === undefined ? null : JSON.stringify(v));

/**
 * Replaces the provider table wholesale from an engines.json object.
 *
 * WHOLESALE is the point: this is how a tool update fixes a moved endpoint or a stale model id
 * for everyone. It is safe precisely because a user's key and overrides live in `connections`
 * and are not touched here — a connection referencing a deleted provider is handled by
 * resolveConnection(), which reports it rather than silently running with half a profile.
 */
export function seedProviders(db, engines) {
	const rows = Object.entries(engines).filter(([name]) => !isMeta(name));
	db.exec("BEGIN");
	try {
		db.exec("DELETE FROM providers");
		const ins = db.prepare(`
			INSERT INTO providers
				(name, kind, url, model, api_key_env, think, batch_size, rate_limit_ms,
				 timeout_ms, max_output_tokens, extra_body, headers, help)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
		`);
		for (const [name, r] of rows) {
			ins.run(
				name,
				r.kind ?? null,
				r.url ?? null,
				r.model ?? null,
				r.apiKeyEnv ?? null,
				jsonOrNull(r.think),
				r.batchSize ?? null,
				r.rateLimitMs ?? null,
				r.timeoutMs ?? null,
				r.maxOutputTokens ?? null,
				jsonOrNull(r.extraBody),
				jsonOrNull(r.headers),
				helpText(r),
			);
		}
		db.exec("COMMIT");
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}
	return rows.length;
}

/** One provider preset in profile shape, or null. Reverses the column mapping of seedProviders. */
export function readProvider(db, name) {
	const r = db.prepare("SELECT * FROM providers WHERE name = ?").get(name);
	if (!r) return null;
	const out = { name: r.name, kind: r.kind };
	if (r.url !== null) out.url = r.url;
	if (r.model !== null) out.model = r.model;
	if (r.api_key_env !== null) out.apiKeyEnv = r.api_key_env;
	// `think` is deliberately JSON: `false` is a meaningful value and must not read as absent.
	if (r.think !== null) out.think = JSON.parse(r.think);
	if (r.batch_size !== null) out.batchSize = r.batch_size;
	if (r.rate_limit_ms !== null) out.rateLimitMs = r.rate_limit_ms;
	if (r.timeout_ms !== null) out.timeoutMs = r.timeout_ms;
	if (r.max_output_tokens !== null) out.maxOutputTokens = r.max_output_tokens;
	if (r.extra_body !== null) out.extraBody = JSON.parse(r.extra_body);
	if (r.headers !== null) out.headers = JSON.parse(r.headers);
	if (r.help !== null) out.help = r.help;
	return out;
}

/** Every preset, for the "add connection" menu. */
export function listProviders(db) {
	return db
		.prepare("SELECT name FROM providers ORDER BY name")
		.all()
		.map((r) => readProvider(db, r.name));
}

// ── Connections ─────────────────────────────────────────────────────────────────────────

/**
 * Saves a connection. `overrides` holds ONLY the fields the user changed — storing a full copy
 * of the preset instead is what would make a re-seed unable to fix anything.
 */
export function saveConnection(db, { id, label, provider = null, overrides = {}, apiKey }) {
	const now = new Date().toISOString();
	if (id) {
		// A key of `undefined` means "leave it alone"; `null` means "clear it". Without that
		// distinction, editing a label would silently wipe the key.
		if (apiKey === undefined) {
			db.prepare("UPDATE connections SET label=?, provider=?, overrides=? WHERE id=?").run(label, provider, JSON.stringify(overrides), id);
		} else {
			db.prepare("UPDATE connections SET label=?, provider=?, overrides=?, api_key=? WHERE id=?").run(
				label,
				provider,
				JSON.stringify(overrides),
				apiKey,
				id,
			);
		}
		return id;
	}
	const r = db
		.prepare("INSERT INTO connections (label, provider, overrides, api_key, created_at) VALUES (?,?,?,?,?)")
		.run(label, provider, JSON.stringify(overrides), apiKey ?? null, now);
	return Number(r.lastInsertRowid);
}

/**
 * A connection as the UI may see it: **never includes the key**, only whether one is set.
 * Every path that serialises toward a browser goes through this, so there is one place to audit.
 */
export function readConnection(db, id) {
	const r = db.prepare("SELECT * FROM connections WHERE id = ?").get(id);
	if (!r) return null;
	return {
		id: r.id,
		label: r.label,
		provider: r.provider,
		overrides: JSON.parse(r.overrides),
		hasKey: r.api_key !== null && r.api_key !== "",
		createdAt: r.created_at,
	};
}

/** Every connection, key-free. */
export function listConnections(db) {
	return db
		.prepare("SELECT id FROM connections ORDER BY id")
		.all()
		.map((r) => readConnection(db, r.id));
}

/**
 * The runnable profile for a connection: preset fields, then the user's overrides on top.
 *
 * Same merge order as translate.js:93 — base then config — so a connection behaves exactly as
 * an engines.json row with config overrides always has. A connection whose provider has
 * vanished from a re-seed returns its overrides with `missingProvider` set, rather than a
 * half-built profile that would fail somewhere further down with a worse message.
 */
export function resolveConnection(db, id) {
	const c = db.prepare("SELECT * FROM connections WHERE id = ?").get(id);
	if (!c) return null;
	const overrides = JSON.parse(c.overrides);
	if (c.provider === null) return { ...overrides, _custom: true };
	const preset = readProvider(db, c.provider);
	if (!preset) return { ...overrides, missingProvider: c.provider };
	const { help, name, ...profile } = preset;
	return { ...profile, ...overrides };
}

// ── Secrets ─────────────────────────────────────────────────────────────────────────────

/**
 * Refuses to store a key unless the database file is genuinely gitignored.
 *
 * Not politeness. A key committed to a public repo is unrecoverable — it must be rotated, and
 * this project already has one on record that passed through a chat log and had to be. The
 * check reads .gitignore rather than trusting that someone added the line, because "I assumed
 * it was ignored" is exactly how it happens.
 */
export function assertGitignored(projectRoot, dbFile) {
	const gitignore = join(projectRoot, ".gitignore");
	if (!existsSync(gitignore)) {
		throw new Error(`refusing to store a key: no .gitignore in ${projectRoot}. Add one containing "${dbFile}".`);
	}
	const lines = readFileSync(gitignore, "utf8")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"));
	const covered = lines.some((l) => l === dbFile || l === `/${dbFile}` || l === "*.db" || l === `${dbFile}*`);
	if (!covered) {
		throw new Error(`refusing to store a key: .gitignore does not cover "${dbFile}". Add that line first.`);
	}
	return true;
}

/**
 * Puts every stored key into `process.env` under its provider's `apiKeyEnv` name.
 *
 * This is the ENTIRE integration with the translation pipeline. The key is read in exactly two
 * places, both as `process.env[profile.apiKeyEnv]` (loop.js:137, translate.js:107), so making
 * the environment true at startup means no translation code changes at all.
 */
export function loadSecretsIntoEnv(db, env = process.env) {
	const rows = db
		.prepare(`
			SELECT c.api_key AS key, COALESCE(json_extract(c.overrides, '$.apiKeyEnv'), p.api_key_env) AS name
			FROM connections c LEFT JOIN providers p ON p.name = c.provider
			WHERE c.api_key IS NOT NULL AND c.api_key != ''
		`)
		.all();
	let n = 0;
	for (const r of rows) {
		if (!r.name) continue;
		env[r.name] = r.key;
		n++;
	}
	return n;
}

// ── Prefs ───────────────────────────────────────────────────────────────────────────────

/** The remembered dropdown, and anything else small and scalar. Values are JSON. */
export function setPref(db, k, v) {
	db.prepare("INSERT INTO prefs (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v));
}

export function getPref(db, k, fallback = null) {
	const r = db.prepare("SELECT v FROM prefs WHERE k = ?").get(k);
	return r ? JSON.parse(r.v) : fallback;
}

// ── Bootstrap ───────────────────────────────────────────────────────────────────────────

/** Where the workshop store lives for a given project. */
export const DB_FILE = ".jah.db";

/**
 * Opens the store for a project, re-seeds the provider presets from the shipped engines.json,
 * and makes stored keys visible to the pipeline.
 *
 * Re-seeding on EVERY open is deliberate: it is the update mechanism, and it costs a handful of
 * inserts on a table with a few rows.
 */
export function openProject(projectRoot, { enginesPath } = {}) {
	const root = resolve(projectRoot);
	const db = openDb(join(root, DB_FILE));
	const engines = JSON.parse(readFileSync(enginesPath ?? new URL("./engines.json", import.meta.url), "utf8"));
	seedProviders(db, engines);
	loadSecretsIntoEnv(db);
	return db;
}
