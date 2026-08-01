// Long runs, and the three things a reviewer needs from one.
//
// A full catalogue is ~52 minutes on the shipped local model. That single number rules out the
// obvious implementation: a POST that translates and then responds is a request that times out,
// a tab that cannot be closed, and a cancel button that cannot exist. So a run is a JOB —
// started, streamed, cancellable, and rejoinable after a reload.
//
// THREE RULES, each of which is a test:
//
//   1. A job writes ONLY proposals. The locale file is byte-identical when it finishes. That is
//      the governing principle of the whole design and it is what makes the other two safe.
//   2. ONE job at a time. A second start gets 409. Two concurrent runs would both be writing
//      the proposals table for overlapping keys, and the loser's work would vanish silently —
//      which is the exact bug class this project exists to prevent.
//   3. Cancelling loses nothing. It stops on a batch boundary, keeps every proposal already
//      staged, and leaves the catalogue untouched.
//
// Subscribers are plain callbacks; server.js adapts them to SSE. Keeping transport out of here
// is what lets the tests drive a whole job without a socket.

import { EventEmitter } from "node:events";
import { translateLanguage } from "./loop.js";
import { finishRun, putProposal, startRun } from "./state.js";

/** A job that has ended, one way or another. */
const TERMINAL = new Set(["done", "cancelled", "failed"]);

export class JobManager {
	constructor({ store, log = () => {} } = {}) {
		this.store = store;
		this.log = log;
		this.current = null;
		this.events = new EventEmitter();
		// A long job with no listener attached would otherwise warn; and a browser with several
		// tabs open is a legitimate case.
		this.events.setMaxListeners(0);
	}

	/** What a reloaded page asks for, so it can rejoin a run it did not start. */
	status() {
		if (!this.current) return null;
		const { id, lang, engine, scope, total, done, requests, startedAt, state, error, failed } = this.current;
		return { id, lang, engine, scope, total, done, requests, startedAt, state, error, failed: [...failed] };
	}

	/** True while a run is in flight — the 409 test. */
	get busy() {
		return !!this.current && !TERMINAL.has(this.current.state);
	}

	subscribe(fn) {
		this.events.on("event", fn);
		return () => this.events.off("event", fn);
	}

	#emit(type, data) {
		this.events.emit("event", { type, ...data });
	}

	/**
	 * Starts a run over `subset` and stages every result as a proposal.
	 *
	 * `translate` is injectable so the tests can drive the whole lifecycle — progress, cancel,
	 * failure, rejoin — without an engine. A job manager that can only be tested against a live
	 * model is one that never gets tested against the interesting paths.
	 */
	start({ lang, engine, profile, scope, subset, cfg, cachePath, translate = translateLanguage }) {
		if (this.busy) {
			const err = new Error("a job is already running");
			err.code = "JOB_BUSY";
			throw err;
		}

		const controller = new AbortController();
		const total = Object.keys(subset).length;
		const runId = this.store ? startRun(this.store, { lang, engine, scope }) : null;

		const job = {
			id: `job-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
			runId,
			lang,
			engine,
			scope,
			total,
			done: 0,
			requests: 0,
			failed: [],
			startedAt: new Date().toISOString(),
			startedMs: Date.now(),
			state: "running",
			error: null,
			controller,
		};
		this.current = job;
		this.#emit("start", { job: this.status() });

		// Deliberately NOT awaited: start() returns immediately with a job id, which is what
		// makes the endpoint a 202 rather than a 50-minute hang.
		job.promise = this.#run(job, { profile, subset, cfg, cachePath, translate });
		return this.status();
	}

	async #run(job, { profile, subset, cfg, cachePath, translate }) {
		const seen = new Set();
		try {
			const { values, failed, requests, cancelled } = await translate({
				sourceFlat: subset,
				existingFlat: {},
				lang: job.lang,
				profile,
				cfg,
				cachePath,
				force: true,
				log: this.log,
				signal: job.controller.signal,
				// Called after every batch with everything translated so far. Staging here rather
				// than at the end is what lets a reviewer start work while the run continues, and
				// what makes a cancel keep the work already done.
				onBatch: (partial) => {
					for (const [key, value] of Object.entries(partial)) {
						if (seen.has(key)) continue;
						seen.add(key);
						if (this.store) putProposal(this.store, { lang: job.lang, key, engine: job.engine, value });
						this.#emit("item", { key, value, lang: job.lang, engine: job.engine });
					}
					job.done = seen.size;
					this.#emit("progress", { done: job.done, total: job.total });
				},
			});

			// The final flush: onBatch fires after each batch, but the last values are also
			// returned, and a run of one short batch would otherwise stage nothing.
			for (const [key, value] of Object.entries(values)) {
				if (seen.has(key)) continue;
				seen.add(key);
				if (this.store) putProposal(this.store, { lang: job.lang, key, engine: job.engine, value });
				this.#emit("item", { key, value, lang: job.lang, engine: job.engine });
			}

			job.done = seen.size;
			job.requests = requests;
			job.failed = failed ?? [];
			job.state = cancelled ? "cancelled" : "done";
		} catch (err) {
			job.state = "failed";
			job.error = err.message;
			this.#emit("error", { message: err.message });
		} finally {
			if (this.store && job.runId) {
				finishRun(this.store, job.runId, {
					keys: job.done,
					requests: job.requests,
					elapsedMs: Date.now() - job.startedMs,
					failed: job.failed.length,
				});
			}
			// Named by key, never swallowed — a run that could not deliver a key says which one.
			// The silent-skip bug is the reason this whole project exists.
			this.#emit("done", { job: this.status() });
		}
		return this.status();
	}

	/** Stops after the batch in flight. Everything already staged stays staged. */
	cancel() {
		if (!this.busy) return null;
		this.current.controller.abort();
		this.#emit("cancelling", { id: this.current.id });
		return this.status();
	}

	/** Waits for the active run — tests only; nothing in the server blocks on a job. */
	async settled() {
		if (this.current?.promise) await this.current.promise;
		return this.status();
	}
}
