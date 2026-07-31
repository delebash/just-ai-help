// Front-matter parsing for the docs extractor — a deliberately SMALL subset of YAML.
//
// This project has zero dependencies, so this is hand-rolled. The danger with a hand-rolled
// parser is not that it fails; it is that it SUCCEEDS on something it does not understand and
// silently drops text — and the text it would drop here is user-facing copy that then never
// reaches a locale file, never gets translated, and shows up as a blank hint in the product.
//
// So the rule is: support a narrow, documented subset, and THROW on anything else. A loud
// failure at build time is cheap; a hint that quietly went missing is not.
//
// Supported:
//
//     ---
//     lede: One sentence describing the surface.
//     hints:
//       fieldName: What this field is for.
//       other: "Quoted when it contains: a colon."
//     ---
//     # The document body, untouched.
//
// Not supported, and each throws: tabs for indentation, YAML lists, anchors, multi-line
// scalars (| and >), nesting deeper than one level, duplicate keys.

const FENCE = /^---[ \t]*\r?\n/;

/** Strips one layer of matching quotes, or returns the string unchanged. */
function unquote(v) {
	const s = v.trim();
	if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
		return s.slice(1, -1);
	}
	return s;
}

function fail(line, n, why) {
	throw new Error(`front-matter line ${n}: ${why}\n  ${line}`);
}

/**
 * Splits `text` into { data, body }. A file with no front-matter fence returns
 * { data: {}, body: text } — that is not an error, most docs will not have one yet.
 */
export function parseFrontMatter(text) {
	if (!FENCE.test(text)) return { data: {}, body: text };

	const afterOpen = text.replace(FENCE, "");
	const close = afterOpen.search(/^---[ \t]*$/m);
	if (close === -1) throw new Error("front-matter: opening --- has no closing ---");

	const block = afterOpen.slice(0, close);
	const body = afterOpen.slice(close).replace(/^---[ \t]*\r?\n?/, "");

	const data = {};
	let parent = null; // the key whose nested map we are inside
	const lines = block.split(/\r?\n/);

	for (const [i, raw] of lines.entries()) {
		const n = i + 2; // +1 for the opening fence, +1 for 1-based
		if (!raw.trim() || raw.trim().startsWith("#")) continue;
		if (raw.includes("\t")) fail(raw, n, "tabs are not allowed — use spaces");
		if (/^\s*-\s/.test(raw)) fail(raw, n, "lists are not supported");

		const indent = raw.length - raw.trimStart().length;
		const colon = raw.indexOf(":");
		if (colon === -1) fail(raw, n, "expected `key: value`");

		const key = raw.slice(0, colon).trim();
		const value = raw.slice(colon + 1);
		if (!key) fail(raw, n, "empty key");
		// The block-scalar indicator is the VALUE, not the line's first character — `lede: |`
		// opens a multi-line string. Testing the line start missed it entirely and the parser
		// then failed one line later blaming an orphan indent, which names the wrong problem
		// and points the author at the wrong line.
		if (/^[|>][-+]?\d*$/.test(value.trim())) {
			fail(raw, n, "multi-line scalars (| and >) are not supported");
		}

		if (indent === 0) {
			if (key in data) fail(raw, n, `duplicate key "${key}"`);
			if (value.trim() === "") {
				data[key] = {};
				parent = key;
			} else {
				data[key] = unquote(value);
				parent = null;
			}
			continue;
		}

		// Indented: must belong to a map opened on a previous line.
		if (!parent) fail(raw, n, "indented line with no parent key above it");
		if (value.trim() === "") fail(raw, n, "nesting deeper than one level is not supported");
		if (key in data[parent]) fail(raw, n, `duplicate key "${parent}.${key}"`);
		data[parent][key] = unquote(value);
	}

	return { data, body };
}
