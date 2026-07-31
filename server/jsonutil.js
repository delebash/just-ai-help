// Shared, because two copies drift. Layer 1 (loop.js), Layer 2 (checks.js) and Layer 3
// (review.js) all need to walk a locale file the same way — if they disagree about what a
// key path is or what counts as a placeholder, the checks stop describing what the loop
// wrote and the review page stops addressing the keys the checks named.

/** Flattens a nested locale object into { "a.b.c": "text" }. */
export function flatten(obj, prefix = "", out = {}) {
	for (const k of Object.keys(obj)) {
		const v = obj[k];
		const path = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
		else out[path] = String(v);
	}
	return out;
}

/**
 * Rebuilds a nested object with the SOURCE's shape and key order, taking each leaf's value
 * from `values` (a flat map). Leaves missing from `values` are dropped, so a key that failed
 * to translate is absent rather than silently English — the checks then report it as missing,
 * which is the point of never faking success.
 */
export function rebuild(source, values, prefix = "") {
	const out = {};
	for (const k of Object.keys(source)) {
		const v = source[k];
		const path = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const child = rebuild(v, values, path);
			if (Object.keys(child).length) out[k] = child;
		} else if (values[path] !== undefined) {
			out[k] = values[path];
		}
	}
	return out;
}

/** Escapes a literal string for use inside a RegExp. */
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The interpolation matcher, built from the config's placeholder syntax. */
export function placeholderRe(placeholder) {
	return new RegExp(`${escapeRe(placeholder.prefix)}[\\s\\S]*?${escapeRe(placeholder.suffix)}`, "g");
}
