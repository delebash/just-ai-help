// The loop's pure parts, tested without a model: shielding, restore, the prompt, the cache
// key, and the request body each transport builds. The body matters most — owning it is the
// entire reason this loop exists, so an untested body would be an odd place to stop.

import assert from "node:assert/strict";
import test from "node:test";
import { TEMPERATURE, buildRequest, buildSystemPrompt, buildUserMessage, cacheKey, effectiveTemperature, restore, shield } from "../src/loop.js";
import { placeholderRe } from "../src/jsonutil.js";

const re = placeholderRe({ prefix: "{", suffix: "}" });

test("shield swaps interpolations and restore puts them back", () => {
	const src = 'Its {n} chapter will move to "{into}". | Its {n} chapters will move to "{into}".';
	const { shielded, tokens } = shield(src, re);
	assert.equal(shielded, 'Its ⟦0⟧ chapter will move to "⟦1⟧". | Its ⟦2⟧ chapters will move to "⟦3⟧".');
	assert.deepEqual(tokens, ["{n}", "{into}", "{n}", "{into}"]);
	assert.equal(restore(shielded, tokens), src);
});

test("restore returns null when a token is lost, duplicated or invented", () => {
	const { tokens } = shield("a {x} b {y}", re);
	assert.equal(restore("solo ⟦0⟧", tokens), null, "lost a token");
	assert.equal(restore("⟦0⟧⟦0⟧⟦1⟧", tokens), null, "duplicated a token");
	assert.equal(restore("⟦0⟧⟦1⟧⟦9⟧", tokens), null, "invented a token");
});

test("restore tolerates a model adding spaces inside the brackets", () => {
	const { tokens } = shield("a {x}", re);
	assert.equal(restore("hola ⟦ 0 ⟧", tokens), "hola {x}");
});

test("glossary terms are shielded too — the measured Strands -> Hilos failure", () => {
	const { shielded, tokens } = shield("Open JustWrite Strands", re, ["JustWrite", "Strands"]);
	assert.equal(shielded, "Open ⟦0⟧ ⟦1⟧");
	assert.equal(restore(shielded, tokens), "Open JustWrite Strands");
});

test("a glossary term inside a longer word is left alone", () => {
	const { shielded } = shield("Strandsville and Strands", re, ["Strands"]);
	assert.equal(shielded, "Strandsville and ⟦0⟧");
});

test("longer glossary terms win over shorter ones they contain", () => {
	const { shielded, tokens } = shield("Ask the book now", re, ["Ask", "Ask the book"]);
	assert.equal(shielded, "⟦0⟧ now");
	assert.equal(restore(shielded, tokens), "Ask the book now");
});

test("the prompt carries every rule, and drops the empty slots", () => {
	const full = buildSystemPrompt({
		source: "en",
		targetLang: "es",
		doNotTranslate: ["JustWrite"],
		conventionsLine: "Spanish opens questions with ¿",
	});
	assert.match(full, /en→es/);
	assert.match(full, /untouchable placeholders/);
	assert.match(full, /never translate these terms: JustWrite/);
	assert.match(full, /Spanish opens questions with ¿/);
	assert.match(full, /plural forms/);

	const bare = buildSystemPrompt({ source: "en", targetLang: "fr" });
	assert.doesNotMatch(bare, /never translate these terms/);
	assert.doesNotMatch(bare, /; ;/, "an empty slot must not leave a dangling separator");
});

test("the cache key changes when anything that could change the answer changes", () => {
	const base = { text: "Save", lang: "es", contextHash: "c", glossaryHash: "g" };
	const k = cacheKey(base);
	assert.notEqual(cacheKey({ ...base, text: "Save now" }), k);
	assert.notEqual(cacheKey({ ...base, lang: "fr" }), k);
	assert.notEqual(cacheKey({ ...base, contextHash: "c2" }), k, "a changed context must re-translate");
	assert.notEqual(cacheKey({ ...base, glossaryHash: "g2" }), k, "a changed glossary must re-translate");
	assert.equal(cacheKey(base), k, "and it is stable");
});

test("the ollama body: native endpoint, schema in `format`, think omitted by default", () => {
	const { url, body } = buildRequest({
		profile: { kind: "ollama", url: "http://127.0.0.1:11434", model: "gemma3:12b", maxOutputTokens: 8192 },
		system: "S",
		user: "U",
	});
	assert.equal(url, "http://127.0.0.1:11434/api/chat");
	assert.equal(body.stream, false);
	assert.equal(body.options.temperature, 0.2);
	assert.equal(body.options.num_predict, 8192);
	assert.ok(body.format.properties.items, "the JSON schema goes in `format`");
	assert.ok(!("think" in body), "omitted leaves the model's own default alone");
});

test("the ollama body sends think when the profile asks for it", () => {
	const mk = (think) => buildRequest({ profile: { kind: "ollama", url: "u", model: "m", think }, system: "S", user: "U" }).body;
	assert.equal(mk(false).think, false, "false must be SENT, not omitted — that was the runner's bug too");
	assert.equal(mk("high").think, "high");
});

test("extraBody merges verbatim, but ollama `options` merges one level deep", () => {
	const { body } = buildRequest({
		profile: {
			kind: "ollama",
			url: "u",
			model: "m",
			maxOutputTokens: 4096,
			extraBody: { keep_alive: "10m", options: { num_ctx: 16384 } },
		},
		system: "S",
		user: "U",
	});
	assert.equal(body.keep_alive, "10m", "a novel top-level key passes straight through");
	assert.equal(body.options.num_ctx, 16384);
	assert.equal(body.options.temperature, 0.2, "clobbering `options` would silently drop this");
	assert.equal(body.options.num_predict, 4096, "and this");
});

test("effectiveTemperature reads what the built body carries — the --probe guard depends on it", () => {
	assert.equal(effectiveTemperature({ kind: "ollama", url: "u", model: "m" }), TEMPERATURE);
	assert.equal(effectiveTemperature({ kind: "openai-compat", url: "u", model: "m" }), TEMPERATURE);
	// An extraBody override to 0 must be SEEN — a guard on the constant alone would wave it
	// through and --probe would report a meaningless all-clear.
	assert.equal(effectiveTemperature({ kind: "ollama", url: "u", model: "m", extraBody: { options: { temperature: 0 } } }), 0);
	assert.equal(effectiveTemperature({ kind: "openai-compat", url: "u", model: "m", extraBody: { temperature: 0 } }), 0);
});

test("the openai-compat body: url gets only the endpoint, key becomes a bearer header", () => {
	process.env.JAH_TEST_KEY = "sekrit";
	const { url, body, headers } = buildRequest({
		profile: {
			kind: "openai-compat",
			url: "https://generativelanguage.googleapis.com/v1beta/openai",
			model: "gemini-3.6-flash",
			apiKeyEnv: "JAH_TEST_KEY",
			maxOutputTokens: 16000,
			extraBody: { reasoning_effort: "low" },
		},
		system: "S",
		user: "U",
	});
	// Appending a hardcoded "/v1" here would make Google's compat base unexpressible.
	assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
	assert.equal(headers.authorization, "Bearer sekrit");
	assert.equal(body.response_format.type, "json_schema");
	assert.equal(body.max_tokens, 16000);
	assert.equal(body.reasoning_effort, "low");
	delete process.env.JAH_TEST_KEY;
});

test("an unknown profile kind fails loudly", () => {
	assert.throws(() => buildRequest({ profile: { kind: "carrier-pigeon" }, system: "S", user: "U" }), /carrier-pigeon/);
});

// ── Per-key notes ───────────────────────────────────────────────────────────────────────
//
// The feedback loop that closes the review workspace: a note written while fixing a key is
// sent WITH that key next time, so the same defect does not have to be found twice.
//
// This exists because `cfg.context` is one sentence for the whole catalogue, so a
// four-character label and a two-hundred-character paragraph arrive with identical context.
// That is how "Why:" — a label above a reasoning block — came back as "¿Por qué?".

test("A NOTE IS ATTACHED TO ITS KEY AND TO NO OTHER", () => {
	const msg = buildUserMessage({
		shielded: [
			{ i: 0, key: "characterAudit.why", shielded: "Why:" },
			{ i: 1, key: "settings.save", shielded: "Save" },
		],
		cfg: { context: "an app", notes: { "characterAudit.why": "a label above the reasoning, not a question" } },
	});
	const items = JSON.parse(msg.match(/Translate items: (\[.*\])$/s)[1]);
	assert.equal(items[0].note, "a label above the reasoning, not a question", "the noted key carries its note");
	assert.ok(!("note" in items[1]), "an un-noted key must not carry one — batches stay small for the 99% that need nothing");
});

test("no notes at all changes nothing about the message", () => {
	const shielded = [{ i: 0, key: "a", shielded: "Save" }];
	assert.equal(buildUserMessage({ shielded, cfg: { context: "an app" } }), buildUserMessage({ shielded, cfg: { context: "an app", notes: {} } }));
});

test("the system prompt tells the model what a note IS", () => {
	const p = buildSystemPrompt({ source: "en", targetLang: "es" });
	assert.match(p, /note/, "a field the model is never told about is a field it ignores");
});
