// The confirmation pass — asking the engine about the strings that came back unchanged.
//
// THE PROBLEM. `untranslated` fires when the target string is byte-identical to the source.
// That is the only signal a string comparison can give, and it cannot separate four situations:
//
//   1. not words at all      "A", "H2", "{n}s", "x²"      — a button glyph has no Spanish
//   2. must stay English     "EPUB", "RAG", "JustWrite"   — product and format names
//   3. same word in Spanish  "Color", "Error", "total"    — the translation IS the source
//   4. THE MODEL SKIPPED IT  "books" should be "libros"   — a real defect
//
// Only the fourth is a bug, and it is the one that matters. Today it hides among the other
// three: a fresh catalogue raises ~70 of these, a reviewer sees a wall of correct output, and
// the one genuine miss is invisible inside it. That is the failure this pass exists to prevent
// — not the noise, the miss THE NOISE CONCEALS.
//
// WHY ASK THE ENGINE. The candidate set is free: the translation run already sent every key to
// the model, so everything that came back CHANGED is proven translatable and needs no question.
// Only the identical remainder — about 3% of a catalogue — has anything to decide. Classifying
// the whole source file up front would cost a full run's worth of engine time to answer the
// same question for 97% of keys that were never in doubt.
//
// MEASURED on the JustWrite catalogue, 2026-07-31, gemma-4-26B-A4B-it-qat via Ollama:
//
//   71 genuinely-identical keys   57 cleared, 10 proposed a translation, 4 self-contradictory
//   20 planted long fake skips    20/20 caught
//   40 planted SHORT fake skips   37/40 caught — "?", "OK" and "pan" were falsely cleared
//
// So it removes ~80% of the review pile and catches every long skip, at a measured false-clear
// rate of ~7.5% on short strings. That residue is WHY a cleared key stays visible in the report
// and in the review workspace instead of being silently swallowed.
//
// WHY IT NEVER WRITES A TRANSLATION. Of the 10 translations it proposed, two were wrong and two
// contradicted each other in the same run:
//
//   "{n} w"          -> "{n} min"              — `w` is WORDS. It invented minutes.
//   "TODO"           -> "TODO POR HACER"       — mangled a do-not-translate term.
//   "elevator pitch" -> "discurso de ascensor"
//   "Elevator pitch" -> "Pitch de ascensor"    — same concept, two answers, one run.
//
// A proposal is shown to a human and never applied. That is measured, not cautious.
//
// THE ENGINE NEVER SIGNS OFF. Both outcomes are annotations in `.jah-state.json`; nothing here
// writes `<lang>.accepted.json`, which is the human record and is what makes a check pass. A
// "same" verdict PRE-TICKS a row so seventy keys are one click — the approval recorded is still
// a person's, with their name on it.
//
// WHY NOT ASK TWICE. A second pass at a different temperature was tried as a way to manufacture
// "unsure". It produced 4 disagreements out of 71 and agreed with itself, confidently, on BOTH
// of the answers that were flatly wrong. It doubles the runtime and misses the cases it exists
// to catch. Single pass.

import { acceptanceHash } from "./accepted.js";
import { callModel, parseItems } from "./loop.js";

/** The code the confirmation pass reasons about. Only `untranslated` has this ambiguity. */
export const CONFIRM_CODE = "untranslated";

/**
 * The system prompt. It names the four situations explicitly rather than asking "is this
 * right?" — a model asked to judge itself agrees with itself. Asked to TRANSLATE, it does the
 * job it is good at, and answering "SAME" becomes a deliberate refusal rather than a shrug.
 */
export function buildConfirmPrompt({ targetLang, context, doNotTranslate = [] }) {
	const never = doNotTranslate.length
		? `\nThese terms stay exactly as they are and are always SAME: ${doNotTranslate.join(", ")}.`
		: "";
	return `You are checking ONE user-interface string${context ? ` from ${context}` : ""}.

A translator was asked to translate it from English into ${targetLang} and returned it UNCHANGED.
Decide which of these happened.

It is genuinely unchanged when:
  - it is not words — a button glyph ("A", "H2", "B"), a unit ("5s", "12 w"), a symbol
  - it is a product, brand or file-format name that stays English (EPUB, JSON, RAG)
  - ${targetLang} simply uses the same word (for Spanish: Color, Error, total)

It was SKIPPED when the string is ordinary text that has a perfectly good ${targetLang} word.
"books" is not ${targetLang}. "Save" is not ${targetLang}.${never}

Reply with a single item whose translation field is EXACTLY one of:
  SAME                  — if it is genuinely unchanged
  the ${targetLang}     — if it was skipped, give the correct translation`;
}

/**
 * Did the model say "leave it alone"?
 *
 * Echoing the source back counts as SAME. 15 of 71 answered that way in the measurement — the
 * model treats "return it unchanged" and "say SAME" as the same statement, and scoring an echo
 * as a proposed translation would have turned the pass's best answers into false alarms.
 */
export function isSameVerdict(answer, source) {
	const norm = (s) => String(s ?? "").trim().replace(/[.\s]+$/u, "");
	const a = norm(answer);
	return /^same$/i.test(a) || a === norm(source);
}

/**
 * Asks about one string. Uses the SAME transport as everything else — `callModel` builds the
 * request from the engine profile, so a provider quirk fixed once is fixed here too, and the
 * JSON response schema is the one the loop already enforces.
 *
 * One key per call, never batched. A batch is how the original skip happened; asking inside
 * another batch invites the model to repeat it for the same reason.
 */
export async function confirmOne({ profile, system, source }) {
	const out = await callModel({ profile, system, user: `Translate items: ${JSON.stringify([{ id: 0, text: source }])}` });
	const answer = parseItems(out).get(0);
	if (typeof answer !== "string") throw new Error("no item 0 in the reply");
	return answer;
}

/**
 * Runs the pass over every candidate key.
 *
 * @returns {{cleared: object[], proposed: object[], failed: object[]}}
 *   cleared  — the model says it is correct as-is. An ANNOTATION: it pre-ticks the row in the
 *              review page so a human can approve the obvious ones in one click. It is not a
 *              verdict and it never reaches `<lang>.accepted.json` on its own.
 *   proposed — the model thinks it was skipped, and what it would have written. NEVER applied.
 *   failed   — the engine errored. Left as a finding, exactly like an exhausted retry.
 *
 * `ask` is the transport, defaulting to the real one. A parameter rather than a mock because ES
 * module exports cannot be redefined — and because the routing decision (cleared vs proposed vs
 * failed) is the part worth asserting, and it should be assertable with no model running. Same
 * reasoning that splits `buildRequest` from the fetch in loop.js.
 */
export async function confirmIdentical({ keys, sourceFlat, targetFlat, profile, targetLang, context, doNotTranslate, onProgress, ask = confirmOne }) {
	const system = buildConfirmPrompt({ targetLang, context, doNotTranslate });
	const cleared = [];
	const proposed = [];
	const failed = [];

	for (const key of keys) {
		const src = sourceFlat[key];
		try {
			const answer = await ask({ profile, system, source: src });
			if (isSameVerdict(answer, src)) cleared.push({ key, src, dst: targetFlat[key] });
			else proposed.push({ key, src, dst: targetFlat[key], suggestion: answer });
		} catch (e) {
			failed.push({ key, src, error: e.message });
		}
		onProgress?.({ done: cleared.length + proposed.length + failed.length, total: keys.length });
	}
	return { cleared, proposed, failed };
}

/**
 * Hangs the confirmation pass's annotation on the finding it belongs to, so the terminal report
 * and the review workspace show the same thing without either one calling an engine.
 *
 * A verdict whose hash no longer matches is IGNORED rather than shown — the same expiry rule an
 * acceptance follows. Edit the English or the translation and the machine's opinion about that
 * exact pair retires itself, instead of lingering as advice about text that no longer exists.
 *
 * What it attaches is deliberately named `confirmed`, not `accepted`: it pre-ticks a row for a
 * human, it does not stand in for one.
 */
export function attachConfirmations(findings, verdicts, sourceFlat, targetFlat) {
	if (!verdicts || !Object.keys(verdicts).length) return findings;
	return findings.map((f) => {
		if (f.code !== CONFIRM_CODE) return f;
		const v = verdicts[f.key];
		if (!v) return f;
		const live = acceptanceHash({ key: f.key, code: CONFIRM_CODE, src: sourceFlat[f.key] ?? "", dst: targetFlat[f.key] ?? "" });
		if (v.hash !== live) return f;
		return { ...f, confirmed: v.verdict, suggestion: v.suggestion ?? undefined, confirmedBy: v.engine };
	});
}
