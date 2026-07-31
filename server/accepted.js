// Accepted findings — the reviewer's verdict, made durable.
//
// WHY this exists. Some findings are correct output, not defects, and no amount of check
// refinement will decide that for you. Three measured examples from the JustWrite catalogue,
// 2026-07-30:
//
//   untranslated  common.no                "No"                    -> "No"
//   untranslated  settings.sections.general "General"              -> "General"
//   brackets      settings.server.headlessTitle  "Headless access" -> "Acceso sin interfaz (headless)"
//
// The first two are Spanish cognates: the correct translation IS the source. The third is a
// translator adding a parenthetical gloss — a judgement call a human makes once. Across two
// full runs the `untranslated` check raised 20 findings of which exactly ONE was a real
// defect (`sidebar.nav.askTheBook`, still English).
//
// The consequence is worse than noise: a PERFECT catalogue could never exit 0, and
// `--check-only` is THE CI gate. A gate that cannot go green is not a gate — people stop
// reading it, and that is precisely how the next real miss ships.
//
// WHY NOT a per-language list of "words that are identical in Spanish". That was the first
// design and it was wrong. `conventions.json` already says why, about itself: language rules
// written from memory are "exactly how a confident wrong rule ends up applied to every future
// translation. A language is added when someone who knows it says what the rule is." Typing
// ["No", "General", "Error", …] from memory is that mistake, filed in the one place that
// documents why not to make it. It also only ever fixed ONE check, and the bracket gloss above
// needs the same disposal.
//
// WHAT THIS IS INSTEAD. A per-project sidecar, `<lang>.accepted.json`, next to the locale
// files — the same shape as `<lang>.probe.json`. An entry is keyed by a content hash of
// (key, code, source, target), which is the load-bearing property:
//
//   * Accepting `untranslated` on a key does NOT hide `brackets` on the same key.
//   * If the SOURCE changes, the hash changes and the finding comes back. An acceptance is a
//     statement about one exact pair of strings, never a standing exemption for a key.
//   * If the TARGET changes — someone edits the translation — the hash changes and the
//     finding comes back.
//
// And it is never silent. The count is always reported. Suppression you cannot see is the
// bug this whole project was written in response to.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * The content hash for one finding. Includes the CODE so acceptances are per-defect, and both
 * strings so any edit to either side revives the finding.
 *
 * NUL-joined for the same reason `multiset()` in checks.js is: a separator that cannot occur
 * in a locale string, so "a|b" + "c" and "a" + "b|c" can never collide. Written as the
 * ESCAPE "\u0000" rather than a literal NUL byte: checks.js embeds the literal one and is
 * therefore binary to git and invisible to ripgrep. Same behaviour, greppable file.
 */
export function acceptanceHash({ key, code, src, dst }) {
	return createHash("sha1").update([key, code, src, dst].join("\u0000")).digest("hex").slice(0, 16);
}

/** Reads a sidecar, or an empty set if there is none. A corrupt file costs a re-review, never a wrong pass. */
export function loadAccepted(path) {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));
	} catch {
		return {};
	}
}

const SIDECAR_WHY =
	"Findings a reviewer judged CORRECT. NOTHING here was fixed — fixing a translation makes its finding" +
	" disappear on its own and records nothing. These are the opposite case: the translation was already" +
	" right and the CHECK was wrong to flag it (the Spanish for 'No' is 'No'). They are written down" +
	" because the checks have no memory — they re-read the files from scratch every run, so without this" +
	" the same findings fire forever and --check-only can never go green. Committed on purpose: CI runs" +
	" against a fresh clone, so acceptances kept anywhere gitignored would be missing exactly where the" +
	" gate needs them. Each entry is keyed by a hash of (key, code, source, target) — NEVER a per-key" +
	" exemption — so changing the English or editing the translation brings the finding straight back." +
	" Delete an entry to un-accept it. Every run prints how many were hidden." +
	" `by` and `at` record WHO signed each one off: an entry written by a script or an agent says so," +
	" and `unknown` means nobody claimed it. Provenance is outside the hash, so re-accepting under a" +
	" different name updates the entry instead of adding a second one.";

/** Writes the sidecar, metadata first, entries sorted so the diff is stable. */
export function saveAccepted(path, entries) {
	const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1)));
	writeFileSync(path, `${JSON.stringify({ _why: SIDECAR_WHY, ...sorted }, null, 2)}\n`);
}

/**
 * Splits findings into what still counts and what a reviewer has already cleared.
 *
 * `sourceFlat`/`targetFlat` are needed because a finding carries only {key, code, detail} —
 * the strings it was raised about have to be looked up to hash them.
 *
 * @returns {{ findings: object[], accepted: object[] }}
 */
export function partitionAccepted(findings, accepted, sourceFlat, targetFlat) {
	const kept = [];
	const cleared = [];
	for (const f of findings) {
		const hash = acceptanceHash({ key: f.key, code: f.code, src: sourceFlat[f.key] ?? "", dst: targetFlat[f.key] ?? "" });
		if (accepted[hash]) cleared.push({ ...f, hash });
		else kept.push(f);
	}
	return { findings: kept, accepted: cleared };
}

/**
 * Who to record as the author of a verdict, when nobody said.
 *
 * "unknown" on purpose, and NOT the OS username. An automated run under a developer's account
 * would inherit that name and become indistinguishable from the developer's own judgement,
 * which is the exact failure this field exists to make visible.
 */
export const UNKNOWN_REVIEWER = "unknown";

/**
 * Builds the stored entry for one finding — readable in a diff, so a reviewer can audit what
 * was waved through.
 *
 * `by` and `at` are PROVENANCE and are deliberately OUTSIDE the hash. The hash identifies the
 * finding (key, code, source, target); who signed it off is metadata about that identity, so
 * re-accepting the same finding under a different name updates one entry rather than creating
 * a second one that suppresses the same thing twice.
 *
 * Why the field exists at all: on 2026-07-31 an agent wrote 58 verdicts into a real project's
 * sidecar, in bulk, by script. The format could not distinguish them from a human's review,
 * the file reads as "findings a reviewer judged correct", and nobody noticed until the repo
 * owner happened to ask what they were. A `by` field does not prevent that — it makes it
 * visible in the diff the moment it lands, which is the most a file format can do.
 */
export function acceptanceEntry({ key, code, src, dst, by, at }) {
	return {
		key,
		code,
		src,
		dst,
		by: by || UNKNOWN_REVIEWER,
		at: at || new Date().toISOString().slice(0, 10),
	};
}
