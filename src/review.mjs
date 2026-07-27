#!/usr/bin/env node
// Layer 3 — the review page. Triage what Layer 2 flagged, fix it, re-check, move on.
//
//     node src/review.mjs config.json --lang es [--port 4780]
//
// One node:http server, one HTML page served inline, no framework, no build step, no
// dependencies, no accounts and no database. The JSON files ARE the state — the same files
// git already tracks — so there is nothing to sync and nothing to lose.
//
// Why ours rather than an existing editor: the value of this page is that it shows OUR
// flags, in OUR order, with the reason attached. An adopted translation editor discards
// exactly that and gives back a spreadsheet. (Checked 2026-07-27: intlayer's editor cannot
// read external vue-i18n JSON at all — it writes its own content-declaration format.)

import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildContext, checkOne, runChecks } from "./checks.mjs";
import { flatten, rebuild } from "./jsonutil.mjs";

const json = (res, code, body) => {
	res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
};

const page = (lang) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>just-ai-help review — ${lang}</title>
<style>
 :root { color-scheme: light dark; --line:#8884; }
 body { font:14px/1.5 system-ui,sans-serif; margin:0; }
 header { position:sticky; top:0; background:Canvas; border-bottom:1px solid var(--line); padding:12px 16px; display:flex; gap:16px; align-items:baseline; flex-wrap:wrap; }
 h1 { font-size:15px; margin:0; font-weight:600; }
 .count { opacity:.7; }
 .count b { font-variant-numeric:tabular-nums; }
 main { padding:0 16px 64px; }
 table { border-collapse:collapse; width:100%; }
 th { text-align:left; font-weight:600; opacity:.7; padding:8px 8px 8px 0; border-bottom:1px solid var(--line); position:sticky; top:49px; background:Canvas; }
 td { vertical-align:top; padding:8px 8px 8px 0; border-bottom:1px solid var(--line); }
 tr.flagged { background:color-mix(in srgb, Canvas 92%, orange); }
 .key { font-family:ui-monospace,monospace; font-size:12px; opacity:.75; word-break:break-all; width:22%; }
 .src { width:32%; white-space:pre-wrap; }
 textarea { width:100%; font:inherit; min-height:3em; box-sizing:border-box; background:Canvas; color:CanvasText; border:1px solid var(--line); border-radius:4px; padding:6px; }
 textarea.saving { opacity:.5; }
 .chips { display:flex; gap:4px; flex-wrap:wrap; margin-top:4px; }
 .chip { font-size:11px; padding:1px 6px; border-radius:10px; background:color-mix(in srgb, Canvas 70%, orange); }
 .chip[data-ok] { background:color-mix(in srgb, Canvas 80%, green); }
 .filter { margin-left:auto; }
</style></head><body>
<header>
 <h1>just-ai-help review — <code>${lang}</code></h1>
 <span class="count"><b id="nflag">–</b> flagged / <b id="ntotal">–</b> keys, <b id="nfind">–</b> findings</span>
 <label class="filter"><input type="checkbox" id="only" checked> flagged only</label>
</header>
<main><table><thead><tr><th class="key">key</th><th class="src">source</th><th>translation — edits save on blur</th></tr></thead><tbody id="rows"></tbody></table></main>
<script>
const $ = (id) => document.getElementById(id);
let data = { rows: [] };

// The box fits the string. A fixed two-row textarea hides the end of exactly the long
// paragraphs most likely to be wrong, and a reviewer cannot fix what they cannot see.
function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
}

function chips(flags) {
  if (!flags.length) return '<div class="chips"><span class="chip" data-ok>ok</span></div>';
  return '<div class="chips">' + flags.map(f =>
    '<span class="chip" title="' + f.detail.replace(/"/g, '&quot;') + '">' + f.code + '</span>').join('') + '</div>';
}

function render() {
  const onlyFlagged = $('only').checked;
  const rows = onlyFlagged ? data.rows.filter(r => r.flags.length) : data.rows;
  $('rows').innerHTML = rows.map(r =>
    '<tr class="' + (r.flags.length ? 'flagged' : '') + '" data-key="' + r.key + '">' +
      '<td class="key">' + r.key + '</td>' +
      '<td class="src"></td>' +
      '<td><textarea rows="2"></textarea>' + chips(r.flags) + '</td>' +
    '</tr>').join('');
  // Text goes in via textContent/value, never innerHTML — a locale file is untrusted input
  // as far as this page is concerned, and it is full of quotes and angle brackets.
  [...$('rows').children].forEach((tr, i) => {
    tr.querySelector('.src').textContent = rows[i].source;
    const ta = tr.querySelector('textarea');
    ta.value = rows[i].target;
    autosize(ta);
  });
  $('nflag').textContent = data.flagged;
  $('ntotal').textContent = data.total;
  $('nfind').textContent = data.findings;
}

async function load() {
  data = await (await fetch('/api/data')).json();
  render();
}

$('rows').addEventListener('blur', async (e) => {
  const ta = e.target;
  if (ta.tagName !== 'TEXTAREA') return;
  const tr = ta.closest('tr');
  const key = tr.dataset.key;
  const row = data.rows.find(r => r.key === key);
  if (!row || row.target === ta.value) return;
  ta.classList.add('saving');
  const res = await fetch('/api/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value: ta.value })
  });
  const out = await res.json();
  ta.classList.remove('saving');
  row.target = ta.value;
  row.flags = out.flags;
  tr.className = out.flags.length ? 'flagged' : '';
  tr.querySelector('.chips').outerHTML = chips(out.flags);
  data.flagged = out.flagged; data.findings = out.findings;
  $('nflag').textContent = out.flagged; $('nfind').textContent = out.findings;
}, true);

$('rows').addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') autosize(e.target); });
$('only').addEventListener('change', render);
load();
</script></body></html>`;

/**
 * Builds the review server for one config + language. A factory, not module-level state, so
 * the tests can point it at a temp directory and pick their own port — an untestable server
 * is how the save path silently stops preserving structure.
 */
export function createReviewServer({ configPath, lang: langArg } = {}) {
	const cfg = JSON.parse(readFileSync(configPath, "utf8"));
	const lang = langArg ?? cfg.targets[0];
	const conventions = JSON.parse(readFileSync(new URL("./conventions.json", import.meta.url), "utf8"));
	const ctx = buildContext(cfg, conventions, lang);

	const localesDir = resolve(cfg.localesDir);
	const sourceFile = join(localesDir, `${cfg.sourceLanguage}.json`);
	const targetFile = join(localesDir, `${lang}.json`);

	const readSourceRaw = () => JSON.parse(readFileSync(sourceFile, "utf8"));
	const readTargetFlat = () => (existsSync(targetFile) ? flatten(JSON.parse(readFileSync(targetFile, "utf8"))) : {});

	/**
	 * Writes one key back. The nested structure is rebuilt from the SOURCE file's shape, so
	 * key order and nesting are the source's rather than an artefact of edit order — the diff
	 * a reviewer produces is one line, which is what makes reviewing their work possible.
	 */
	function saveKey(key, value) {
		const values = readTargetFlat();
		values[key] = value;
		writeFileSync(targetFile, `${JSON.stringify(rebuild(readSourceRaw(), values), null, 2)}\n`);
	}

	/** Everything the page renders: flagged rows first, each with its reasons. */
	function buildRows() {
		const sourceFlat = flatten(readSourceRaw());
		const targetFlat = readTargetFlat();
		const findings = runChecks({ sourceFlat, targetFlat, ctx });

		const byKey = new Map();
		for (const f of findings) {
			if (!byKey.has(f.key)) byKey.set(f.key, []);
			byKey.get(f.key).push({ code: f.code, detail: f.detail });
		}

		const rows = Object.entries(sourceFlat).map(([key, source]) => ({
			key,
			source,
			target: targetFlat[key] ?? "",
			flags: byKey.get(key) ?? [],
		}));
		// Flagged first — a review session should start with the work, not scroll to it.
		rows.sort((a, b) => b.flags.length - a.flags.length || a.key.localeCompare(b.key));
		return { rows, flagged: byKey.size, total: rows.length, findings: findings.length };
	}

	const server = createServer(async (req, res) => {
		if (req.url === "/" || req.url === "/index.html") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			return res.end(page(lang));
		}
		if (req.url === "/api/data") return json(res, 200, buildRows());
		if (req.url === "/api/save" && req.method === "POST") {
			let body = "";
			for await (const chunk of req) body += chunk;
			let parsed;
			try {
				parsed = JSON.parse(body);
			} catch {
				return json(res, 400, { error: "bad JSON" });
			}
			if (typeof parsed?.key !== "string" || typeof parsed?.value !== "string") {
				return json(res, 400, { error: "key and value must be strings" });
			}
			const sourceFlat = flatten(readSourceRaw());
			if (!(parsed.key in sourceFlat)) return json(res, 404, { error: `no such key: ${parsed.key}` });

			saveKey(parsed.key, parsed.value);
			const flags = checkOne({ key: parsed.key, src: sourceFlat[parsed.key], dst: parsed.value, ctx }).map((f) => ({
				code: f.code,
				detail: f.detail,
			}));
			const { flagged, findings } = buildRows();
			return json(res, 200, { key: parsed.key, flags, flagged, findings });
		}
		json(res, 404, { error: "not found" });
	});
	server.jah = { lang, targetFile };
	return server;
}

// Only listen when run directly — the tests import the factory and pick their own port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const argv = process.argv.slice(2);
	const flagValue = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 ? fallback : argv[i + 1];
	};
	const flagPositions = new Set();
	argv.forEach((a, i) => {
		if (a.startsWith("--")) {
			flagPositions.add(i);
			flagPositions.add(i + 1);
		}
	});
	const configPath = argv.find((a, i) => !flagPositions.has(i)) ?? "just-ai-help.config.json";
	const server = createReviewServer({ configPath, lang: flagValue("--lang", undefined) });
	const port = Number(flagValue("--port", 4780));
	server.listen(port, () => {
		console.log(`Review ${server.jah.lang} at http://localhost:${port}  (editing ${server.jah.targetFile})`);
	});
}
