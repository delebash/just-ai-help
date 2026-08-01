// The project state store. Replaces db.test.js — the SQLite store was removed on 2026-07-31.
//
// Every test here is a way losing or corrupting this file could hurt someone, or a way the
// store could silently become a second writer of something it must never touch.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	ACTION_KINDS,
	STATE_FILE,
	actionHistory,
	confirmations,
	dropAllProposals,
	dropConfirmation,
	dropProposal,
	dropReferences,
	getReference,
	lastAction,
	openProject,
	popAction,
	proposalCount,
	proposalKeys,
	proposals,
	putConfirmation,
	putProposal,
	putReference,
	readJsonSafe,
	recordAction,
	reviewProgress,
	reviewStatuses,
	runHistory,
	setReviewStatus,
	startRun,
	finishRun,
	writeJsonAtomic,
} from "../server/state.js";

const tmp = () => mkdtempSync(join(tmpdir(), "jah-state-"));
const fresh = () => openProject(tmp());

// ── Persistence ─────────────────────────────────────────────────────────────────────────

test("a fresh project has an empty, well-formed state and writes nothing until it must", () => {
	const dir = tmp();
	const s = openProject(dir);
	assert.equal(existsSync(join(dir, STATE_FILE)), false, "opening a project must not create a file");
	assert.deepEqual(reviewProgress(s, "es"), { reviewed: 0, skipped: 0 });
	assert.deepEqual([...proposalKeys(s, "es")], []);
});

test("state survives being reopened — closing the tab must not lose your place", () => {
	const dir = tmp();
	setReviewStatus(openProject(dir), { lang: "es", key: "nav.save", status: "reviewed" });
	const again = openProject(dir);
	assert.equal(reviewStatuses(again, "es")["nav.save"].status, "reviewed");
});

test("BITES: a CORRUPT state file costs your place, never your work", () => {
	// A half-written file must not throw on open — the locale files and acceptances are the
	// work, and they live elsewhere. Losing the cursor is survivable; a crash is not.
	const dir = tmp();
	writeFileSync(join(dir, STATE_FILE), "{ this is not json");
	const s = openProject(dir);
	assert.deepEqual(reviewProgress(s, "es"), { reviewed: 0, skipped: 0 });
	setReviewStatus(s, { lang: "es", key: "k", status: "reviewed" });
	assert.equal(reviewStatuses(openProject(dir), "es").k.status, "reviewed", "it must recover, not stay broken");
});

test("writeJsonAtomic leaves no temp file behind and replaces the old content", () => {
	const dir = tmp();
	const p = join(dir, "x.json");
	writeJsonAtomic(p, { a: 1 });
	writeJsonAtomic(p, { a: 2 });
	assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { a: 2 });
	assert.equal(existsSync(`${p}.tmp`), false, "a temp file was left behind");
});

test("BITES: a mutation RE-READS, so a change from the other process is not clobbered", () => {
	// The CLI and an open review page can both write. Two handles on one file is exactly that
	// case: without a re-read, the second handle's stale copy would erase the first's work.
	const dir = tmp();
	const a = openProject(dir);
	const b = openProject(dir);
	setReviewStatus(a, { lang: "es", key: "one", status: "reviewed" });
	setReviewStatus(b, { lang: "es", key: "two", status: "reviewed" });
	const back = reviewStatuses(openProject(dir), "es");
	assert.ok(back.one, "the first handle's write was lost");
	assert.ok(back.two, "the second handle's write was lost");
});

test("readJsonSafe returns the fallback for missing and for corrupt alike", () => {
	const dir = tmp();
	assert.equal(readJsonSafe(join(dir, "nope.json"), "fallback"), "fallback");
	writeFileSync(join(dir, "bad.json"), "{{{");
	assert.equal(readJsonSafe(join(dir, "bad.json"), "fallback"), "fallback");
});

// ── Review progress ─────────────────────────────────────────────────────────────────────

test("visiting a key is not approving it — a null status is recorded but never counted", () => {
	const s = fresh();
	setReviewStatus(s, { lang: "es", key: "seen", status: null });
	setReviewStatus(s, { lang: "es", key: "done", status: "reviewed" });
	assert.deepEqual(reviewProgress(s, "es"), { reviewed: 1, skipped: 0 });
	assert.ok(!("seen" in reviewStatuses(s, "es")), "an undecided key must not appear as decided");
});

test("progress is per language", () => {
	const s = fresh();
	setReviewStatus(s, { lang: "es", key: "a", status: "reviewed" });
	setReviewStatus(s, { lang: "fr", key: "a", status: "skipped" });
	assert.deepEqual(reviewProgress(s, "es"), { reviewed: 1, skipped: 0 });
	assert.deepEqual(reviewProgress(s, "fr"), { reviewed: 0, skipped: 1 });
});

// ── The action log ──────────────────────────────────────────────────────────────────────

test("BITES: an action with no previous value is REFUSED, not logged", () => {
	// An action that cannot be reversed must fail at the moment it is recorded, not six days
	// later when someone presses undo.
	const s = fresh();
	assert.throws(() => recordAction(s, { lang: "es", key: "k", kind: "edit", prev: undefined }), /could not reverse/);
	assert.throws(() => recordAction(s, { lang: "es", key: "k", kind: "nonsense", prev: null }), /unknown action kind/);
	assert.equal(actionHistory(s).length, 0, "a refused action must not be in the log");
});

test("undo pops newest-first, marks it undone, and stops at the bottom", () => {
	const s = fresh();
	recordAction(s, { lang: "es", key: "a", kind: "edit", prev: "old-a", next: "new-a" });
	recordAction(s, { lang: "es", key: "b", kind: "edit", prev: "old-b", next: "new-b" });
	assert.equal(popAction(s).key, "b");
	assert.equal(popAction(s).key, "a");
	assert.equal(popAction(s), null, "an empty log must return null, not throw");
});

test("undo is per language when asked, and an undone action is not offered twice", () => {
	const s = fresh();
	recordAction(s, { lang: "es", key: "a", kind: "edit", prev: "x" });
	recordAction(s, { lang: "fr", key: "b", kind: "edit", prev: "y" });
	assert.equal(popAction(s, { lang: "es" }).key, "a");
	assert.equal(popAction(s, { lang: "es" }), null);
	assert.equal(lastAction(s, "fr").key, "b", "the other language is untouched");
});

test("an accept survives a reopen — Friday's decision is undoable on Monday", () => {
	const dir = tmp();
	recordAction(openProject(dir), { lang: "es", key: "k", kind: "accept", prev: ["hash1"] });
	const a = popAction(openProject(dir));
	assert.equal(a.kind, "accept");
	assert.deepEqual(a.prev, ["hash1"]);
});

test("every kind the server records is a known kind", () => {
	for (const k of ["edit", "accept", "unaccept", "apply", "discard", "note", "bulk-accept"]) {
		assert.ok(ACTION_KINDS.includes(k), `${k} must be reversible`);
	}
});

// ── Proposals ───────────────────────────────────────────────────────────────────────────

test("proposals stage per (key, engine) and the newest wins for that engine", () => {
	const s = fresh();
	putProposal(s, { lang: "es", key: "k", engine: "ollama", value: "uno" });
	putProposal(s, { lang: "es", key: "k", engine: "ollama", value: "dos" });
	putProposal(s, { lang: "es", key: "k", engine: "openai", value: "tres" });
	const got = proposals(s, { lang: "es", key: "k" });
	assert.equal(got.length, 2, "one row per engine");
	assert.equal(got.find((p) => p.engine === "ollama").value, "dos");
});

test("proposalKeys and proposalCount agree, and dropping cleans up empties", () => {
	const s = fresh();
	putProposal(s, { lang: "es", key: "a", engine: "e", value: "1" });
	putProposal(s, { lang: "es", key: "b", engine: "e", value: "2" });
	assert.equal(proposalCount(s, "es"), 2);
	assert.deepEqual([...proposalKeys(s, "es")].sort(), ["a", "b"]);
	dropProposal(s, { lang: "es", key: "a" });
	assert.equal(proposalCount(s, "es"), 1);
	assert.equal(dropAllProposals(s, "es"), 1);
	assert.equal(proposalCount(s, "es"), 0);
});

// ── Confirmation verdicts ───────────────────────────────────────────────────────────────

test("a confirmation records its verdict, suggestion and which engine decided", () => {
	const s = fresh();
	putConfirmation(s, { lang: "es", key: "g", hash: "h1", verdict: "same", engine: "ollama (x)" });
	putConfirmation(s, { lang: "es", key: "b", hash: "h2", verdict: "translate", suggestion: "libros", engine: "ollama (x)" });
	const c = confirmations(s, "es");
	assert.equal(c.g.verdict, "same");
	assert.equal(c.g.suggestion, null);
	assert.equal(c.b.suggestion, "libros");
	assert.match(c.b.engine, /ollama/, "a machine verdict must say which machine");
});

test("BITES: an unknown verdict is refused", () => {
	const s = fresh();
	assert.throws(() => putConfirmation(s, { lang: "es", key: "k", hash: "h", verdict: "maybe", engine: "e" }), /unknown verdict/);
});

test("dropConfirmation removes only its own key", () => {
	const s = fresh();
	putConfirmation(s, { lang: "es", key: "a", hash: "h", verdict: "same", engine: "e" });
	putConfirmation(s, { lang: "es", key: "b", hash: "h", verdict: "same", engine: "e" });
	dropConfirmation(s, { lang: "es", key: "a" });
	assert.deepEqual(Object.keys(confirmations(s, "es")), ["b"]);
});

// ── Reference cache ─────────────────────────────────────────────────────────────────────

test("BITES: a cached second opinion is dropped when its translation changes", () => {
	// Stale advice about text that no longer exists is worse than no advice.
	const s = fresh();
	putReference(s, { lang: "es", key: "k", engine: "backtranslate", value: "Save" });
	assert.equal(getReference(s, { lang: "es", key: "k", engine: "backtranslate" }).value, "Save");
	dropReferences(s, { lang: "es", key: "k" });
	assert.equal(getReference(s, { lang: "es", key: "k", engine: "backtranslate" }), null);
});

// ── Runs ────────────────────────────────────────────────────────────────────────────────

test("a run records how the catalogue got here, newest first", () => {
	const s = fresh();
	const id = startRun(s, { lang: "es", engine: "ollama", scope: "all" });
	finishRun(s, id, { keys: 12, requests: 3, elapsedMs: 400, failed: 1 });
	startRun(s, { lang: "es", engine: "ollama", scope: "flagged" });
	const runs = runHistory(s, { lang: "es" });
	assert.equal(runs.length, 2);
	assert.equal(runs[0].scope, "flagged", "newest first");
	const done = runs.find((r) => r.id === id);
	assert.equal(done.keys, 12);
	assert.ok(done.finishedAt, "a finished run must be marked finished");
});
