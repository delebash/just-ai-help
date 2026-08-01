// The one fetch layer. Every call to the workspace API goes through here so there is a single
// place that handles errors, and so a failure surfaces as a toast rather than a silent no-op —
// a review tool that quietly fails to save is worse than one that cannot save at all.

const jsonHeaders = { "content-type": "application/json" };

async function call(method, path, payload) {
	const res = await fetch(path, {
		method,
		...(payload !== undefined ? { headers: jsonHeaders, body: JSON.stringify(payload) } : {}),
	});
	let body = null;
	try {
		body = await res.json();
	} catch {
		/* a 204 or an HTML error page */
	}
	if (!res.ok) {
		const err = new Error(body?.error ?? `${res.status} ${res.statusText}`);
		err.status = res.status;
		err.body = body;
		throw err;
	}
	return body;
}

export const api = {
	state: () => call("GET", "/api/state"),
	rows: (lang) => call("GET", `/api/rows${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`),
	accepted: (lang) => call("GET", `/api/accepted?lang=${encodeURIComponent(lang)}`),

	save: (lang, key, value) => call("POST", "/api/save", { lang, key, value }),
	// keys[] on purpose: a fresh catalogue raises ~70 identical-string findings that are almost
	// all correct output, and one-at-a-time is why a session once scripted 58 of them unasked.
	accept: (lang, keys) => call("POST", "/api/accept", { lang, keys: Array.isArray(keys) ? keys : [keys] }),
	unaccept: (lang, key, code = null) => call("DELETE", "/api/accept", { lang, key, code }),
	undo: (lang = null) => call("POST", "/api/undo", { lang }),
	history: (lang) => call("GET", `/api/history${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`),

	note: (lang, key, note) => call("PUT", "/api/notes", { lang, key, note }),
	siblings: (lang, key) => call("GET", `/api/siblings?lang=${encodeURIComponent(lang)}&key=${encodeURIComponent(key)}`),
	terms: (lang, key) => call("GET", `/api/terms?lang=${encodeURIComponent(lang)}&key=${encodeURIComponent(key)}`),
	termUsage: (lang, term) => call("GET", `/api/terms?lang=${encodeURIComponent(lang)}&term=${encodeURIComponent(term)}`),

	proposals: (lang, key = null) => call("GET", `/api/proposals?lang=${encodeURIComponent(lang)}${key ? `&key=${encodeURIComponent(key)}` : ""}`),
	applyProposals: (lang, keys) => call("POST", "/api/proposals/apply", { lang, keys }),
	discardProposals: (lang, keys = null) => call("DELETE", "/api/proposals", { lang, keys }),

	backtranslate: (lang, key, connectionId) => call("POST", "/api/backtranslate", { lang, key, connectionId }),
	reference: (lang, key) => call("GET", `/api/reference?lang=${encodeURIComponent(lang)}&key=${encodeURIComponent(key)}`),

	engines: () => call("GET", "/api/engines"),
	reviewer: () => call("GET", "/api/reviewer"),
	setReviewer: (reviewer) => call("PUT", "/api/reviewer", { reviewer }),
	saveConnection: (conn) => call("PUT", "/api/engines/connection", conn),
	runs: (lang) => call("GET", `/api/runs${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`),

	startJob: (payload) => call("POST", "/api/jobs", payload),
	currentJob: () => call("GET", "/api/jobs/current"),
	cancelJob: () => call("POST", "/api/jobs/cancel", {}),
};

/**
 * Subscribes to the running job's event stream.
 *
 * A reloaded page rejoins rather than losing the run: the server holds job state, and the
 * stream replays its current status on connect. Closing the tab must not kill an hour of work.
 */
export function jobStream(onEvent) {
	const es = new EventSource("/api/jobs/stream");
	for (const type of ["hello", "start", "progress", "item", "error", "cancelling", "done"]) {
		es.addEventListener(type, (e) => {
			let data = null;
			try {
				data = JSON.parse(e.data);
			} catch {
				/* keep-alive */
			}
			onEvent(type, data);
		});
	}
	return () => es.close();
}

/** The URL of the same-origin page that hosts the Google Translate widget. */
/** Setup — the only calls that work with NO project loaded. */
export const setup = {
	state: () => call("GET", "/api/setup/state"),
	inspect: (path) => call("POST", "/api/setup/inspect", { path }),
	save: (payload) => call("POST", "/api/setup/save", payload),
	reviewer: (reviewer) => call("PUT", "/api/setup/reviewer", { reviewer }),
};

export const gtFrameUrl = (text, tl) => `/gt-frame?text=${encodeURIComponent(text)}&tl=${encodeURIComponent(tl)}`;
