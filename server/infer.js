// Reading the source catalogue to work out what the config used to have to state.
//
// WHY. `placeholder` and `pluralSeparator` were required config, and both were traps:
//
//   · omit `placeholder` and jsonutil.js threw `Cannot read properties of undefined
//     (reading 'prefix')` — a raw TypeError, no message telling you which field was missing;
//   · `pluralSeparator` was honoured by the CHECKS (checks.js) and ignored by the PROMPT,
//     which had `" | "` typed into it (loop.js). Keep the default and it works by
//     coincidence. Set ";" and the model is told the separator is a pipe, does not preserve
//     yours, and the checker then reports `plural-halves-lost` — the tool blaming the model
//     for obeying the instruction the tool gave it.
//
// Both facts are sitting in en.json. Reading them is twenty lines and removes two fields
// nobody can get right by hand.
//
// PRECEDENCE: an explicit config value always wins. Inference is a default, never an override
// — a catalogue mid-migration might contain both `{n}` and `{{n}}`, and the human knows which
// one is being moved to.

/** The interpolation syntaxes worth detecting, longest delimiter first so `{{` beats `{`. */
const SYNTAXES = [
	{ prefix: "{{", suffix: "}}", re: /\{\{[^{}]+\}\}/g }, // i18next
	{ prefix: "{", suffix: "}", re: /\{[^{}]+\}/g }, // vue-i18n, ICU
	{ prefix: "%{", suffix: "}", re: /%\{[^{}]+\}/g }, // ruby-i18n / polyglot
];

/**
 * Which interpolation syntax this catalogue uses.
 *
 * Counts real matches rather than stopping at the first hit: a vue-i18n catalogue containing
 * one literal `{{` in prose must not be read as i18next.
 */
export function inferPlaceholder(values) {
	const text = values.join("\n");
	let best = null;
	for (const s of SYNTAXES) {
		const n = (text.match(s.re) ?? []).length;
		// `{{a}}` also matches the single-brace pattern, so i18next wins ties by being tested
		// first and requiring a strictly greater count to be displaced.
		if (n > 0 && (!best || n > best.n)) best = { prefix: s.prefix, suffix: s.suffix, n };
	}
	if (!best) return { prefix: "{", suffix: "}" };
	return { prefix: best.prefix, suffix: best.suffix };
}

/** Separators worth detecting, in the order a framework is likely to use them. */
const SEPARATORS = [" | ", "|", " || ", "||"];

/**
 * The plural separator this catalogue uses, or null when it has no plural forms.
 *
 * null is a real answer, not a failure: i18next stores plurals as separate keys, so a
 * catalogue can legitimately have none — and the checks correctly skip plural checking when
 * the separator is null.
 */
export function inferPluralSeparator(values) {
	for (const sep of SEPARATORS) {
		// A separator has to split a string into parts that both have content, or it is just a
		// pipe character inside prose.
		const hits = values.filter((v) => {
			if (!v.includes(sep)) return false;
			return v.split(sep).every((half) => half.trim().length > 0);
		});
		if (hits.length) return sep;
	}
	return null;
}

/**
 * Fills in what the config did not state, from the source strings themselves.
 * Returns the config plus an `_inferred` list, so a run can SAY what it guessed rather than
 * quietly deciding — the whole complaint about this tool was invisible decisions.
 */
export function inferConfig(cfg, sourceFlat) {
	const values = Object.values(sourceFlat).filter((v) => typeof v === "string");
	const out = { ...cfg };
	const inferred = [];

	if (!out.placeholder) {
		out.placeholder = inferPlaceholder(values);
		inferred.push(`placeholder ${out.placeholder.prefix}…${out.placeholder.suffix}`);
	}
	if (!("pluralSeparator" in out)) {
		out.pluralSeparator = inferPluralSeparator(values);
		inferred.push(`pluralSeparator ${out.pluralSeparator === null ? "none" : JSON.stringify(out.pluralSeparator)}`);
	}
	// `glossary` accepts a bare array as well as { doNotTranslate: [...] } — the nesting bought
	// nothing and the array is what every config actually wants to write.
	if (Array.isArray(out.glossary)) out.glossary = { doNotTranslate: out.glossary };

	return { cfg: out, inferred };
}
