// Terminology consistency — the check that reads the catalogue as its own glossary.
//
// WHY IT EXISTS. Every other check in this project compares one string against its source. None
// of them can see the defect where a translation is perfectly good on its own and disagrees with
// the other two thousand strings around it. Measured on 2026-07-31: a careful hand-written
// improvement to `settings.backups.dataFolderHint` used `guardado automático`, which appears
// ZERO times in the catalogue against FIFTEEN for `autoguardado`. Nothing in the pipeline would
// have caught it. HANDOFF names the same class from the other direction — `autoconservado`
// where eleven other strings say `autoguardado` — and says plainly: "no check compares a term
// against its own catalogue."
//
// WHY IT IS NOT A DICTIONARY. `conventions.json` warns, about itself, that language rules
// written from memory are "exactly how a confident wrong rule ends up applied to every future
// translation". So this check knows nothing about Spanish, or any language. It only knows what
// THIS catalogue already does, which makes it correct in every language for free — and wrong
// only in the direction of silence when a catalogue is too small to have a convention yet.
//
// HOW. Align on co-occurrence. If an English term appears in many keys and one target term
// appears in almost all of their translations, that pairing is the catalogue's established
// choice. A key that carries the English term but not the established target term is the odd
// one out. That is the entire idea; there is no linguistics in it.
//
// THE THRESHOLDS ARE DELIBERATELY TIMID, because this project already has a check running at an
// 8-in-9 false-positive rate and the lesson was expensive: a term must appear in at least four
// keys before it counts as a convention, and the established translation must cover at least
// three quarters of them. Findings are ADVISORY — they never fail the gate, exactly like
// `disagreement`.

/**
 * How dominant a rendering must be before it counts as the catalogue's convention.
 *
 * CHOSEN BY MEASUREMENT on the real 2,039-key JustWrite catalogue, 2026-07-31 — not picked to
 * feel safe. The column that matters is whether the threshold still catches the defect this
 * check was built for (`autosave` rendered `guardado automático` where 8 of 9 keys say
 * `autoguardado`, coverage 89%):
 *
 *     dominance   findings   catches the measured defect
 *       0.75         66              yes
 *       0.80         57              yes
 *       0.85         30              yes      <- shipped
 *       0.90         15              NO
 *       0.95          7              NO
 *
 * Above 0.85 the check goes quiet by ceasing to work. Below it, the extra findings are
 * overwhelmingly polysemy — English words with several senses ("shows up" vs "shows",
 * "features them" vs "features") where a paraphrase is correct and the check cannot know it.
 * 30 findings on 2,039 keys is ~1.5%, and every one is ADVISORY.
 */
export const DOMINANCE = 0.85;

/** Interpolations are not words. Strip them before anything else looks at the string. */
const stripPlaceholders = (s) => s.replace(/\{[^}]*\}/g, " ");

/**
 * Content words only. Five characters is a blunt instrument for skipping function words without
 * shipping a stopword list per language — which would be exactly the lexical claim from memory
 * that this project bans.
 */
export function terms(text, min = 5) {
	return new Set(
		stripPlaceholders(String(text))
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((w) => w.length >= min),
	);
}

/**
 * A crude stem: the first five characters.
 *
 * MEASURED NECESSITY, not a refinement. Without it this check reported 102 findings on the real
 * catalogue and the great majority were inflection, not defects — `personaje` vs `personajes`,
 * `auditoría` vs `auditar`, `encontrado` vs `encontrada`. Exact token matching cannot see that
 * those are the same word, and a check with that false-positive rate is one people stop reading.
 *
 * Five characters is deliberately dumb. A real stemmer is per-language, and a per-language rule
 * written from memory is the thing `conventions.json` forbids. Over-merging is the safe failure
 * direction here: it makes the check quieter, never wronger, because a merged pair only ever
 * removes a finding.
 */
export const stem = (w) => w.slice(0, 5);

/** The stems of a string's content words. */
const stemsOf = (text, min) => new Set([...terms(text, min)].map(stem));

/**
 * Builds the catalogue's own glossary: source term -> the target term that habitually
 * accompanies it, with the evidence for that claim.
 *
 * Counting is done on STEMS so inflections agree, while the reported term is the commonest full
 * form — a finding has to name a word a human recognises, not a five-letter fragment.
 *
 * @returns {Map<string, {target: string, stem: string, hits: number, keys: number, coverage: number}>}
 */
export function termIndex({ sourceFlat, targetFlat, minKeys = 4, dominance = DOMINANCE, minLen = 5 }) {
	// source term -> keys it appears in
	const bySource = new Map();
	for (const [key, src] of Object.entries(sourceFlat)) {
		if (targetFlat[key] === undefined) continue;
		for (const t of terms(src, minLen)) {
			if (!bySource.has(t)) bySource.set(t, []);
			bySource.get(t).push(key);
		}
	}

	const index = new Map();
	for (const [srcTerm, keys] of bySource) {
		if (keys.length < minKeys) continue;

		// Which target stems ride along with this source term, and in how many of its keys?
		const counts = new Map();
		const forms = new Map(); // stem -> {full form -> n}, to report a readable word
		for (const key of keys) {
			const seen = new Set();
			for (const full of terms(targetFlat[key], minLen)) {
				const s = stem(full);
				if (!seen.has(s)) {
					counts.set(s, (counts.get(s) ?? 0) + 1);
					seen.add(s);
				}
				if (!forms.has(s)) forms.set(s, new Map());
				const f = forms.get(s);
				f.set(full, (f.get(full) ?? 0) + 1);
			}
		}

		let best = null;
		for (const [s, n] of counts) if (!best || n > best.hits) best = { stem: s, hits: n };
		if (!best) continue;

		const coverage = best.hits / keys.length;
		// Not dominant enough to be a convention. Several fair renderings of a common word is
		// the normal case and must not be reported as a defect.
		if (coverage < dominance || best.hits < minKeys) continue;

		const commonest = [...forms.get(best.stem)].sort((a, b) => b[1] - a[1])[0][0];
		index.set(srcTerm, { target: commonest, stem: best.stem, hits: best.hits, keys: keys.length, coverage });
	}
	return index;
}

/**
 * Findings for one key against an already-built index.
 *
 * Split from the sweep so the review panel can ask about the key on screen without rebuilding
 * the index for two thousand keys on every keystroke.
 */
export function checkKeyTerms({ key, src, dst, index, minLen = 5 }) {
	if (dst === undefined || dst === null) return [];
	const dstStems = stemsOf(dst, minLen);
	const out = [];
	for (const t of terms(src, minLen)) {
		const conv = index.get(t);
		if (!conv) continue;
		if (dstStems.has(conv.stem)) continue;
		out.push({
			key,
			code: "terminology",
			advisory: true,
			detail: `"${t}" is rendered "${conv.target}" in ${conv.hits} of ${conv.keys} other keys (${Math.round(
				conv.coverage * 100,
			)}%); this one does not use it`,
			term: t,
			expected: conv.target,
		});
	}
	return out;
}

/**
 * Sweeps the whole catalogue. Returns findings plus the index, because the caller usually wants
 * both and building it twice on 2,039 keys is pure waste.
 */
export function checkTerms({ sourceFlat, targetFlat, minKeys = 4, dominance = DOMINANCE }) {
	const index = termIndex({ sourceFlat, targetFlat, minKeys, dominance });
	const findings = [];
	for (const [key, src] of Object.entries(sourceFlat)) {
		if (targetFlat[key] === undefined) continue;
		findings.push(...checkKeyTerms({ key, src, dst: targetFlat[key], index }));
	}
	return { findings, index };
}

/**
 * The other half of the panel: how a term is actually rendered across the catalogue, so a
 * reviewer can see the distribution rather than being told an answer.
 *
 * This is the honest form of the feature. The check says "this disagrees with 15 other keys";
 * this says "here are those 15, go look" — and sometimes the fifteen are the ones that are
 * wrong.
 */
export function termUsage({ sourceFlat, targetFlat, term }) {
	const t = term.toLowerCase();
	const counts = new Map();
	const examples = new Map();
	for (const [key, src] of Object.entries(sourceFlat)) {
		if (targetFlat[key] === undefined || !terms(src).has(t)) continue;
		for (const tgt of terms(targetFlat[key])) {
			counts.set(tgt, (counts.get(tgt) ?? 0) + 1);
			if (!examples.has(tgt)) examples.set(tgt, key);
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([target, n]) => ({ target, count: n, example: examples.get(target) }));
}
