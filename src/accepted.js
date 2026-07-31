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
	"Findings a reviewer judged CORRECT, not defects. Written by `--accept <key>` or the review page's" +
	" \"correct as-is\" button. Each entry is keyed by a hash of (key, code, source, target): change the" +
	" English or edit the translation and the finding comes back, because the acceptance was about those" +
	" exact strings. Delete an entry to un-accept it. The run always prints how many were hidden.";

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

/** Builds the stored entry for one finding — readable in a diff, so a reviewer can audit what was waved through. */
export function acceptanceEntry({ key, code, src, dst }) {
	return { key, code, src, dst };
}
