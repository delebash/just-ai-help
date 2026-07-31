// The job runner. Every test here corresponds to a way a 50-minute run can hurt someone:
// it overwrites the catalogue, a second run silently eats the first, cancelling throws away
// work, a failure looks like a success, or a reload loses the run entirely.
//
// The translate function is injected, so the whole lifecycle is exercised without an engine.
// A job manager testable only against a live model is one whose interesting paths never get
// tested at all.
//
// node --test, zero dependencies.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDb, seedProviders, DB_FILE } from "../src/db.js";
import { JobManager } from "../src/jobs.js";
import { proposals, proposalCount, runHistory } from "../src/store.js";

const tmp = () => mkdtempSync(join(tmpdir(), "jah-jobs-"));
const fresh = () => openDb(join(tmp(), DB_FILE));

const SUBSET = { "a.one": "One", "a.two": "Two", "a.three": "Three" };

/** A stand-in engine: two batches, honouring the abort signal exactly as the real loop does. */
function fakeTranslate({ batches = [{ "a.one": "Uno", "a.two": "Dos" }, { "a.three": "Tres" }], throws = null } = {}) {
	return async ({ onBatch, signal }) => {
		if (throws) throw new Error(throws);
		const values = {};
		let requests = 0;
		for (const b of batches) {
			if (signal?.aborted) return { values, failed: [], requests, cancelled: true };
			Object.assign(values, b);
			requests++;
			onBatch?.(values);
			await new Promise((r) => setImmediate(r));
		}
		return { values, failed: [], requests };
	};
}

const startJob = (jm, over = {}) =>
	jm.start({
		lang: "es",
		engine: "gemma3",
		profile: { model: "test" },
		scope: "flagged",
		subset: SUBSET,
		cfg: {},
		cachePath: join(tmp(), "cache.json"),
		translate: fakeTranslate(),
		...over,
	});

test("start returns immediately with a job id — a 52-minute run is not a request", () => {
	const jm = new JobManager({ db: fresh() });
	const s = startJob(jm);
	assert.ok(s.id);
	assert.equal(s.state, "running");
	assert.equal(s.total, 3);
});

test("A JOB WRITES ONLY PROPOSALS — the locale file is untouched", async () => {
	const dir = tmp();
	const locale = join(dir, "es.json");
	const before = JSON.stringify({ a: { one: "original" } }, null, 2);
	writeFileSync(locale, before);

	const db = fresh();
	const jm = new JobManager({ db });
	startJob(jm);
	await jm.settled();

	assert.equal(readFileSync(locale, "utf8"), before, "the catalogue must be byte-identical after a run");
	assert.equal(proposalCount(db, "es"), 3, "and every result must be staged instead");
});

test("results are staged as they arrive, so review can start before the run ends", async () => {
	const db = fresh();
	const jm = new JobManager({ db });
	const seen = [];
	jm.subscribe((e) => e.type === "item" && seen.push(e.key));
	startJob(jm);
	await jm.settled();
	assert.deepEqual(seen.sort(), ["a.one", "a.three", "a.two"]);
	assert.equal(proposals(db, { lang: "es", key: "a.one" })[0].value, "Uno");
});

test("A SECOND START IS REFUSED — two runs would silently eat each other's work", () => {
	const jm = new JobManager({ db: fresh() });
	startJob(jm);
	assert.throws(() => startJob(jm), /already running/);
	try {
		startJob(jm);
	} catch (e) {
		assert.equal(e.code, "JOB_BUSY", "the server turns this into a 409");
	}
});

test("a finished job releases the slot", async () => {
	const jm = new JobManager({ db: fresh() });
	startJob(jm);
	await jm.settled();
	assert.equal(jm.busy, false);
	assert.doesNotThrow(() => startJob(jm));
});

test("CANCELLING KEEPS WHAT WAS ALREADY STAGED", async () => {
	const db = fresh();
	const jm = new JobManager({ db });
	// Cancel the moment the first batch lands, so the second never runs.
	jm.subscribe((e) => {
		if (e.type === "progress") jm.cancel();
	});
	startJob(jm);
	const end = await jm.settled();

	assert.equal(end.state, "cancelled");
	assert.equal(proposalCount(db, "es"), 2, "the first batch survives; cancelling costs nothing");
});

test("progress is reported against a known total", async () => {
	const jm = new JobManager({ db: fresh() });
	const ticks = [];
	jm.subscribe((e) => e.type === "progress" && ticks.push(`${e.done}/${e.total}`));
	startJob(jm);
	await jm.settled();
	assert.deepEqual(ticks, ["2/3", "3/3"]);
});

test("a failing engine ends the job as FAILED and says why — never as a quiet success", async () => {
	const jm = new JobManager({ db: fresh() });
	const errors = [];
	jm.subscribe((e) => e.type === "error" && errors.push(e.message));
	startJob(jm, { translate: fakeTranslate({ throws: "engine unreachable" }) });
	const end = await jm.settled();

	assert.equal(end.state, "failed");
	assert.equal(end.error, "engine unreachable");
	assert.deepEqual(errors, ["engine unreachable"]);
});

test("keys the engine could not deliver are NAMED, not swallowed", async () => {
	const jm = new JobManager({ db: fresh() });
	startJob(jm, {
		translate: async ({ onBatch }) => {
			onBatch?.({ "a.one": "Uno" });
			return { values: { "a.one": "Uno" }, failed: ["a.two", "a.three"], requests: 1 };
		},
	});
	const end = await jm.settled();
	assert.deepEqual(end.failed, ["a.two", "a.three"], "the silent-skip bug is why this project exists");
});

test("A RELOADED PAGE CAN REJOIN — status survives the browser, not the process", async () => {
	const jm = new JobManager({ db: fresh() });
	const started = startJob(jm);
	const rejoined = jm.status();
	assert.equal(rejoined.id, started.id);
	assert.equal(rejoined.state, "running");
	await jm.settled();
	assert.equal(jm.status().state, "done", "and it can still be read after it ends");
});

test("status never leaks the AbortController or the promise", () => {
	const jm = new JobManager({ db: fresh() });
	const s = startJob(jm);
	assert.ok(!("controller" in s));
	assert.ok(!("promise" in s));
});

test("run history records what happened, which was previously thrown away", async () => {
	const db = fresh();
	const jm = new JobManager({ db });
	startJob(jm);
	await jm.settled();

	const [run] = runHistory(db, { lang: "es" });
	assert.equal(run.engine, "gemma3");
	assert.equal(run.scope, "flagged");
	assert.equal(run.keys, 3);
	assert.equal(run.failed, 0);
	assert.ok(run.finishedAt, "an unfinished run is indistinguishable from a crashed one");
});

test("subscribers can unsubscribe without breaking the run", async () => {
	const jm = new JobManager({ db: fresh() });
	let n = 0;
	const off = jm.subscribe(() => n++);
	startJob(jm);
	off();
	await jm.settled();
	assert.ok(n >= 1, "it received at least the start event");
	assert.equal(jm.status().state, "done", "and the job finished regardless");
});

test("no database is not a crash — the manager still runs and reports", async () => {
	// Guards the design rule that deleting .jah.db must never break anything.
	const jm = new JobManager({});
	startJob(jm);
	const end = await jm.settled();
	assert.equal(end.state, "done");
});
