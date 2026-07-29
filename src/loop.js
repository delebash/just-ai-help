// The translate loop — Layer 1. Owned, on purpose.
//
// This replaced a dependency after a measured comparison, and the reason is one sentence:
// every quality failure of 2026-07-27 came from not owning the request body. `--think`
// unreachable, `chat_template_kwargs` unreachable, a stale model id baked into a constant,
// a rate limit tuned for a different provider — one disease, four symptoms. And the
// adoption candidate that got a fair spike (lingo.dev, 2026-07-27) failed on the other
// axis: it posts the payload as raw JSON with NO placeholder shielding, and on the 40-key
// corpus the model rewrote "{n} notes" as "{3} notas" despite a system prompt forbidding
// exactly that. Shielding is not a prompt instruction. It is a substitution.
//
// So: Node 20+ global fetch, zero dependencies, two transports, and the request body is a
// literal object in this file that any engine profile can add to via `extraBody`.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { escapeRe, placeholderRe } from "./jsonutil.js";

// ── placeholder shielding ────────────────────────────────────────────────────────────
// Interpolations are swapped for ⟦0⟧, ⟦1⟧ … before the model sees them and restored by
// index afterwards. Two reasons this beats asking nicely: a model that has never seen the
// token has nothing to translate it INTO, and an index is checkable — if the restored
// string does not carry every token exactly once, the item failed and we know it.
//
// The brackets are U+27E6/U+27E7 (MATHEMATICAL WHITE SQUARE BRACKET), chosen because they
// occur in no UI string and no natural language, so a false positive is not possible.

const SHIELD_RE = /⟦\s*(\d+)\s*⟧/g; // tolerant of a model inserting spaces

/**
 * Replaces each interpolation — and each do-not-translate term — with an indexed shield
 * token.
 *
 * The glossary is shielded for the same reason placeholders are, and the evidence is
 * blunt. Told in the system prompt by name never to translate "Strands", lingo.dev's
 * qwen3:8b run wrote "Hilos", and so did one of this loop's own runs while an earlier run
 * of the identical code got it right. A rule the model may or may not follow is not a
 * guarantee; a substitution is. Terms are matched longest-first so a term that contains
 * another is shielded whole, and only at non-letter boundaries so a brand name inside a
 * longer word is left alone.
 */
export function shield(text, re, terms = []) {
	const tokens = [];
	const take = (m) => {
		tokens.push(m);
		return `⟦${tokens.length - 1}⟧`;
	};
	let shielded = text.replace(re, take);
	for (const term of [...terms].sort((a, b) => b.length - a.length)) {
		shielded = shielded.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "gu"), take);
	}
	return { shielded, tokens };
}

/**
 * Restores shield tokens. Returns null when the model did not reproduce every token
 * exactly once — a null here is what routes the item into the retry path.
 */
export function restore(text, tokens) {
	const seen = new Set();
	let bad = false;
	const restored = text.replace(SHIELD_RE, (_m, n) => {
		const i = Number(n);
		if (!(i in tokens) || seen.has(i)) {
			bad = true;
			return "";
		}
		seen.add(i);
		return tokens[i];
	});
	if (bad || seen.size !== tokens.length) return null;
	return restored;
}

// ── the prompt ───────────────────────────────────────────────────────────────────────
// One template, slots filled from config. Every rule in it exists because something got
// it wrong on the corpus: placeholders (lingo.dev wrote {3}), the glossary (it wrote
// "Hilos" for "Strands"), the conventions line (qwen3 missed the opening ¿ 5 times out of
// 5), and plural pipes (an engine that splits the halves apart translates them
// inconsistently — every engine that saw the whole string kept the structure).

export function buildSystemPrompt({ source, targetLang, doNotTranslate, conventionsLine }) {
	const rules = [
		"tokens like ⟦0⟧ are untouchable placeholders — reproduce each exactly once",
		doNotTranslate?.length ? `never translate these terms: ${doNotTranslate.join(", ")}` : "",
		conventionsLine || "",
		'a string containing " | " holds plural forms — translate each half and keep the separator',
		"output ONLY JSON matching the schema",
	].filter(Boolean);
	return `You are a professional software-UI translator, ${source}→${targetLang}. Rules: ${rules.join("; ")}.`;
}

// The response contract. Both transports get the same schema — ids come back so a
// reordered or partial answer is detectable rather than silently misaligned.
const RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		items: {
			type: "array",
			items: {
				type: "object",
				properties: { id: { type: "integer" }, translation: { type: "string" } },
				required: ["id", "translation"],
				additionalProperties: false,
			},
		},
	},
	required: ["items"],
	additionalProperties: false,
};

// Exported because --probe DEPENDS on the sampling temperature being non-zero: that pass
// re-translates the same keys with the same engine and treats any difference as uncertainty,
// so at temperature 0 both passes would be identical and the feature would report "nothing
// disagreed" — an all-clear that measured nothing. translate.js guards on
// effectiveTemperature(profile) rather than on this constant, because extraBody can override
// what is actually sent.
export const TEMPERATURE = 0.2;

// ── transport ────────────────────────────────────────────────────────────────────────
// Two kinds, one function, and the body is right here where anyone can read it. Both
// request shapes were proven accepted on 2026-07-27 (llama-server, Gemini, Ollama).
//
// `url` is the API BASE as that provider publishes it: for openai-compat that is the
// thing an OpenAI client calls baseURL and it already carries the version segment
// (https://api.openai.com/v1, https://generativelanguage.googleapis.com/v1beta/openai),
// so the loop appends "/chat/completions" and nothing else. Hardcoding "/v1" here would
// make Google's compat endpoint unexpressible, which is not a hypothetical — it is the
// one cloud row we have a key for.

/**
 * Builds the URL, headers and request body for one call. Separated from the fetch so it can
 * be asserted on without a model running — owning the request body is the entire reason this
 * loop exists, which would be an odd thing to leave untested.
 */
export function buildRequest({ profile, system, user }) {
	const key = profile.apiKeyEnv ? process.env[profile.apiKeyEnv] : "";
	const messages = [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];

	let url;
	let body;
	const headers = { "content-type": "application/json", ...(profile.headers ?? {}) };

	if (profile.kind === "ollama") {
		url = `${profile.url}/api/chat`;
		body = {
			model: profile.model,
			messages,
			stream: false,
			format: RESPONSE_SCHEMA,
			options: { temperature: TEMPERATURE, num_predict: profile.maxOutputTokens ?? 8192 },
		};
		// Omitted when undefined — that leaves the model's own default alone, which is
		// deliberate: thinking off is 13x faster and measurably WORSE on placeholders.
		if (profile.think !== undefined) body.think = profile.think;
	} else if (profile.kind === "openai-compat") {
		url = `${profile.url}/chat/completions`;
		if (key) headers.authorization = `Bearer ${key}`;
		body = {
			model: profile.model,
			messages,
			temperature: TEMPERATURE,
			max_tokens: profile.maxOutputTokens ?? 16000,
			response_format: {
				type: "json_schema",
				json_schema: { name: "translations", strict: true, schema: RESPONSE_SCHEMA },
			},
		};
	} else {
		throw new Error(`Unknown profile kind "${profile.kind}" — expected "ollama" or "openai-compat".`);
	}

	// LAST, verbatim. The general pass-through: think:false, chat_template_kwargs,
	// reasoning_effort, a provider's private knob — all of them are config, not code.
	Object.assign(body, profile.extraBody ?? {});
	// …with ONE exception. `options` is where Ollama keeps num_ctx, num_predict, temperature
	// and seed, so a verbatim overwrite of it would silently drop the temperature and the
	// output cap the moment anyone set num_ctx — precisely the class of invisible
	// request-body damage this loop exists to prevent. It merges one level deep instead.
	if (profile.kind === "ollama" && profile.extraBody?.options) {
		body.options = {
			temperature: TEMPERATURE,
			num_predict: profile.maxOutputTokens ?? 8192,
			...profile.extraBody.options,
		};
	}
	return { url, headers, body };
}

/**
 * The temperature one call will ACTUALLY sample at, extraBody overrides included. Read from
 * the built request body rather than re-derived from the merge rules — a second copy of the
 * precedence logic would drift, and the --probe guard that reads this would then wave through
 * exactly the meaningless all-clear it exists to refuse.
 */
export function effectiveTemperature(profile) {
	const { body } = buildRequest({ profile, system: "", user: "" });
	return profile.kind === "ollama" ? body.options.temperature : body.temperature;
}

async function callModel({ profile, system, user }) {
	const { url, headers, body } = buildRequest({ profile, system, user });

	// An explicit controller, not AbortSignal.timeout(). The convenience form leaves a live
	// timer behind after the fetch resolves, and a process that then calls process.exit()
	// while that handle is closing trips a libuv assertion on Windows
	// (`!(handle->flags & UV_HANDLE_CLOSING)`, exit code 127) — observed 2026-07-27 on Node
	// v26.5.0 immediately after a run that had otherwise passed every check. A CI gate whose
	// exit code is decided by a race is worse than no gate.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), profile.timeoutMs ?? 300000);
	const signal = controller.signal;

	try {
		const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`${res.status} ${res.statusText} from ${url}${text ? ` — ${text.slice(0, 400)}` : ""}`);
		}
		const data = await res.json();
		const content = profile.kind === "ollama" ? data?.message?.content : data?.choices?.[0]?.message?.content;
		if (typeof content !== "string" || !content.trim()) {
			throw new Error(`Empty content from ${url}. A thinking model with no output budget does this.`);
		}
		return content;
	} finally {
		clearTimeout(timer);
	}
}

/** Parses the model's JSON into a Map(id -> translation). Throws on anything unusable. */
function parseItems(content) {
	let parsed;
	try {
		parsed = JSON.parse(content);
	} catch {
		// Some servers wrap JSON in a fence even under a schema. One salvage attempt, then fail.
		const m = content.match(/\{[\s\S]*\}/);
		if (!m) throw new Error(`Response was not JSON: ${content.slice(0, 200)}`);
		parsed = JSON.parse(m[0]);
	}
	if (!Array.isArray(parsed?.items)) throw new Error("Response JSON had no `items` array.");
	const out = new Map();
	for (const it of parsed.items) {
		if (typeof it?.id !== "number" || typeof it?.translation !== "string") continue;
		out.set(it.id, it.translation);
	}
	return out;
}

// ── cache ────────────────────────────────────────────────────────────────────────────
// The delta. A key is skipped when its target already exists AND the hash of everything
// that could change its translation is unchanged: the source text, the language, the
// context sentence and the glossary. Change the context and every key re-translates,
// which is correct — the context is part of the instruction the translation came from.

const sha1 = (s) => createHash("sha1").update(s).digest("hex");

export function cacheKey({ text, lang, contextHash, glossaryHash }) {
	return sha1(`${text}|${lang}|${contextHash}|${glossaryHash}`);
}

function loadCache(path) {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {}; // a corrupt cache costs a re-run, never a wrong answer
	}
}

// ── the loop ─────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Translates one language.
 *
 * Retry ladder, and the last rung is the important one: batch ×3, then the batch's items
 * as singletons ×2, then the key is LEFT UNTRANSLATED and reported. It is never silently
 * skipped and the run never exits 0 pretending otherwise — that exact bug ("exits 0 even
 * when it skipped keys") is why this project re-reads its own output at all.
 *
 * @returns {Promise<{values: Record<string,string>, failed: string[], requests: number}>}
 */
export async function translateLanguage({
	sourceFlat,
	existingFlat = {},
	lang,
	profile,
	cfg,
	cachePath,
	force = false,
	log = console.log,
	onBatch,
}) {
	const re = placeholderRe(cfg.placeholder);
	const contextHash = sha1(cfg.context ?? "");
	const glossaryHash = sha1(JSON.stringify(cfg.glossary ?? {}));
	const conventionsLine = cfg.conventionsLine ?? "";
	const system = buildSystemPrompt({
		source: cfg.sourceLanguage,
		targetLang: lang,
		doNotTranslate: cfg.glossary?.doNotTranslate,
		conventionsLine,
	});

	// Always LOAD the cache, even under --force. `force` means "re-translate these keys
	// anyway", not "throw away what every other key and language already learned" — starting
	// from {} and then writing the file back would delete all of it as a side effect.
	const cache = loadCache(cachePath);
	const values = {};
	const todo = [];

	for (const [key, text] of Object.entries(sourceFlat)) {
		const ck = cacheKey({ text, lang, contextHash, glossaryHash });
		if (!force && existingFlat[key] !== undefined && cache[ck] !== undefined) {
			values[key] = existingFlat[key];
			continue;
		}
		todo.push({ key, text, ck });
	}

	log(`${lang}: ${Object.keys(sourceFlat).length - todo.length} unchanged, ${todo.length} to translate`);
	if (!todo.length) return { values, failed: [], requests: 0 };

	const batchSize = profile.batchSize ?? 16;
	const batches = [];
	for (let i = 0; i < todo.length; i += batchSize) batches.push(todo.slice(i, i + batchSize));

	const failed = [];
	let requests = 0;
	let lastCall = 0;

	/**
	 * Sends one group and returns the keys it could not deliver. A key counts as
	 * delivered only when the shield tokens all came back — a translation that lost a
	 * placeholder is a FAILURE, not a result, because the checks would flag it anyway
	 * and a retry is cheaper than a human fixing it later.
	 */
	async function attempt(group) {
		const shielded = group.map((it, i) => ({ ...it, i, ...shield(it.text, re, cfg.glossary?.doNotTranslate ?? []) }));
		const user = `Context: ${cfg.context ?? "a software application"}. Translate items: ${JSON.stringify(
			shielded.map((s) => ({ id: s.i, text: s.shielded })),
		)}`;

		const wait = (profile.rateLimitMs ?? 0) - (Date.now() - lastCall);
		if (wait > 0) await sleep(wait);
		lastCall = Date.now();
		requests++;

		const items = parseItems(await callModel({ profile, system, user }));

		const stillMissing = [];
		for (const s of shielded) {
			const raw = items.get(s.i);
			const restored = raw === undefined ? null : restore(raw, s.tokens);
			if (restored === null || !restored.trim()) stillMissing.push(s);
			else {
				values[s.key] = restored;
				cache[s.ck] = restored;
			}
		}
		return stillMissing;
	}

	for (const [bi, batch] of batches.entries()) {
		let pending = batch;
		for (let tryNo = 1; tryNo <= 3 && pending.length; tryNo++) {
			try {
				pending = await attempt(pending);
				if (pending.length) log(`  batch ${bi + 1}: ${pending.length} item(s) unresolved, retry ${tryNo}/3`);
			} catch (err) {
				log(`  batch ${bi + 1}: ${err.message} (attempt ${tryNo}/3)`);
				if (tryNo === 3) break;
				await sleep(1000 * tryNo);
			}
		}
		// Singletons: a batch that keeps failing is usually ONE pathological string, and
		// sending it alone both isolates it and gives the model the whole budget for it.
		for (const item of pending) {
			let done = false;
			for (let tryNo = 1; tryNo <= 2 && !done; tryNo++) {
				try {
					done = (await attempt([item])).length === 0;
				} catch (err) {
					log(`  ${item.key}: ${err.message} (singleton ${tryNo}/2)`);
				}
			}
			if (!done) failed.push(item.key);
		}
		// Flush after every batch, not once at the end. A full catalogue is an hour of local
		// generation and a crash at minute 55 must not throw away 54 minutes of it. BOTH
		// halves are needed for that: the cache alone would not resume anything, because the
		// delta skips a key only when the cache entry AND the existing target value are
		// present — so `onBatch` is what writes the partial locale file.
		writeFileSync(cachePath, JSON.stringify(cache, null, 2));
		onBatch?.(values);
		log(`  ${lang}: ${Object.keys(values).length}/${Object.keys(sourceFlat).length} done (batch ${bi + 1}/${batches.length})`);
	}

	return { values, failed, requests };
}
