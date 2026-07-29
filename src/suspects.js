// Layer 2b — the SUSPECT list. What the checks CANNOT see.
//
// checks.js is pofilter's list, which is about FORM: placeholders, plurals, punctuation,
// brackets. A translation can pass every one of them and still be wrong, and the two worst
// cases measured on 2026-07-28 both did:
//
//   settings.backups.deleteSelectedTitle
//     en  "Delete {n} autosave? | Delete {n} autosaves?"
//     es  "¿Eliminar autosave {n}?"          <- "delete autosave NUMBER 3", not "delete 3"
//   chapters.ai.clearStrikesDesc
//     es  "...los originales de aquellos PROYECTOS aún pendientes..."   <- invented noun
//
// The placeholder is present exactly once, no number changed, both plural halves differ,
// the punctuation is right. Nothing structural can object. A human reading Spanish catches
// both in seconds — which does not scale to 846 keys, and does not exist at all for a
// language nobody on the team reads.
//
// THE SIGNAL: self-consistency. Translate the same key twice with the SAME model (the loop
// runs at temperature 0.2, loop.js:112) and compare. Where the model is sure it repeats
// itself exactly; where it is guessing it wanders. Measured over the 40-key corpus, 30 of 40
// keys came back byte-identical, and the two invisible defects above ranked #1 and #3 of the
// ones that moved. The known FALSE positive (`· {n} tokens`, correctly left alone by every
// model) sank to #18, because agreement is the signal.
//
// Two different models was tried and is WORSE: they word everything differently, so real
// defects drown in stylistic noise — "Contraer" vs "Colapsar" outranked the hallucination.
// Same model twice also needs no second model chosen, downloaded or configured, and reuses
// the one already resident.
//
// Findings come back in the SAME { key, code, detail } shape as every check, so the review
// page renders them and `--escalate` re-translates them with no new concepts anywhere.

/** Word set, case- and punctuation-insensitive. Unicode-aware so accents are not stripped. */
const tokens = (s) =>
	new Set(
		String(s)
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.split(/\s+/)
			.filter(Boolean),
	);

/**
 * How far apart two renderings are: 0 = the same words, 1 = nothing in common.
 * Token-set Jaccard rather than string equality, so word-order and punctuation differences
 * still register while spacing does not.
 */
export function spread(a, b) {
	const x = tokens(a);
	const y = tokens(b);
	let inter = 0;
	for (const t of x) if (y.has(t)) inter++;
	const union = x.size + y.size - inter;
	return union === 0 ? 0 : 1 - inter / union;
}

/**
 * Split keys into `bandCount` length bands using the corpus's OWN sorted source lengths,
 * so there are no magic character-count constants and a corpus of tooltips bands
 * differently from a corpus of paragraphs.
 */
function bandsOf(keys, sourceFlat, bandCount) {
	const sorted = [...keys].sort((a, b) => String(sourceFlat[a]).length - String(sourceFlat[b]).length);
	const out = [];
	const size = Math.ceil(sorted.length / bandCount) || 1;
	for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
	return out;
}

const clip = (s, n = 80) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

/**
 * Rank the keys whose two passes disagree and return the top `topN` as findings.
 *
 * Length-normalised: raw spread correlates with source length at r~0.42 (measured), so a
 * flat ranking spends the whole budget on long paragraphs while the nastiest defects hide
 * in short strings — the "End" -> "Finalizar" error is three characters of source. Taking
 * from each band evenly fixes that without discarding the measure.
 *
 * A key whose two passes are IDENTICAL is never a suspect: that is the model telling us it
 * is sure, and it is the majority of any catalogue.
 */
export function rankSuspects({ sourceFlat, targetFlat, probeFlat, topN = 20, bandCount = 3 }) {
	const scored = [];
	for (const key of Object.keys(sourceFlat)) {
		const a = targetFlat[key];
		const b = probeFlat[key];
		if (typeof a !== "string" || typeof b !== "string") continue;
		const s = spread(a, b);
		if (s === 0) continue;
		scored.push({ key, s, alt: b });
	}
	if (!scored.length || topN <= 0) return [];

	const byKey = new Map(scored.map((r) => [r.key, r]));
	const bands = bandsOf(
		scored.map((r) => r.key),
		sourceFlat,
		bandCount,
	);
	// Round-robin across bands, each handing over its next-highest-spread key, until the
	// budget is spent or every band is exhausted. Short strings therefore get the same
	// number of slots as long ones instead of losing every tie.
	const queues = bands.map((band) => band.map((k) => byKey.get(k)).sort((x, y) => y.s - x.s));
	const picked = [];
	for (let i = 0; picked.length < topN; i++) {
		let moved = false;
		for (const q of queues) {
			if (i < q.length) {
				picked.push(q[i]);
				moved = true;
				if (picked.length >= topN) break;
			}
		}
		if (!moved) break;
	}

	return picked
		.sort((x, y) => y.s - x.s)
		.map((r) => ({
			key: r.key,
			code: "disagreement",
			// The alternative rendering IS the useful part: a reviewer needs to see what the
			// second pass said to judge which is right. A bare score would send them digging.
			detail: `a second pass wrote "${clip(r.alt)}" (spread ${r.s.toFixed(2)})`,
		}));
}
