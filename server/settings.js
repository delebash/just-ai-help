// YOUR settings — connections, API keys, your name. Tool-level, not per-project.
//
// WHY THIS IS NOT IN THE PROJECT. You download this tool ONCE and point it at as many apps as
// you like. An engine connection is a property of you and your machine, not of JustWrite: with
// it stored per-project you would re-enter the same Ollama URL and the same API key for every
// app, and changing one would mean changing all of them. That was the actual complaint, and it
// is why this file exists.
//
// WHY NOT A HOME DIRECTORY. `~/.just-ai-help/` and `%APPDATA%` are rejected on purpose: deleting
// the tool has to delete everything it ever wrote, and dotfiles in a home directory are exactly
// the litter that survives an uninstall. This file lives INSIDE the tool's own folder, and it is
// gitignored — so `git pull` updates the tool and never touches your settings, and removing the
// clone removes your keys with it.
//
// WHAT IS NOT HERE. Which engine a project USES is the project's business and stays in its
// `config.json` (`"engine": "ollama"`). This file only says how to REACH an engine — url, model,
// key. So a project config never carries a credential, and two apps can use different engines
// without duplicating your setup.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./state.js";

export const SETTINGS_FILE = "settings.json";
export const SETTINGS_VERSION = 1;

/** The tool's own directory — the parent of `server/`. Settings live beside the code, not in $HOME. */
export const TOOL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const now = () => new Date().toISOString();

const EMPTY = () => ({ version: SETTINGS_VERSION, reviewer: null, connections: [], nextConnectionId: 1 });

/** Opens (or creates) the tool's settings file. */
export function openSettings(toolRoot = TOOL_ROOT) {
	return new JsonStore(join(toolRoot, SETTINGS_FILE), EMPTY);
}

// ── Providers — shipped presets, read straight from engines.json ────────────────────────
//
// The file IS the catalogue, read directly — no copy, no seeding step — so `git pull` ships a
// fixed endpoint to everyone and nothing has to be re-seeded for it to take effect.

export function loadEngines(toolRoot = TOOL_ROOT) {
	return JSON.parse(readFileSync(join(toolRoot, "server", "config", "engines.json"), "utf8"));
}

/** One preset in profile shape, or null. Underscore-prefixed keys are prose and never profile fields. */
export function readProvider(name, engines = loadEngines()) {
	const row = engines[name];
	if (!row || name.startsWith("_")) return null;
	const out = { name };
	for (const [k, v] of Object.entries(row)) if (!k.startsWith("_") && k !== "default") out[k] = v;
	return out;
}

/** Every preset, for the "add connection" menu. */
export function listProviders(engines = loadEngines()) {
	return Object.keys(engines)
		.filter((k) => !k.startsWith("_"))
		.sort()
		.map((k) => readProvider(k, engines));
}

// ── Connections ─────────────────────────────────────────────────────────────────────────

/**
 * Saves a connection. `overrides` holds ONLY the fields you changed — storing a full copy of the
 * preset instead is what would stop a tool update from ever fixing a moved endpoint.
 */
export function saveConnection(s, { id = null, label, provider = null, overrides = {}, apiKey }) {
	return s.mutate((d) => {
		if (id) {
			const c = d.connections.find((x) => x.id === id);
			if (!c) throw new Error(`no connection ${id}`);
			c.label = label;
			c.provider = provider;
			c.overrides = overrides;
			// `undefined` means "leave the key alone"; `null` means "clear it". Without that
			// distinction, editing a label would silently wipe the key.
			if (apiKey !== undefined) c.apiKey = apiKey;
			return id;
		}
		const newId = d.nextConnectionId++;
		d.connections.push({ id: newId, label, provider, overrides, apiKey: apiKey ?? null, createdAt: now() });
		return newId;
	});
}

/**
 * A connection as the UI may see it: **never includes the key**, only whether one is set.
 * Every path that serialises toward a browser goes through this, so there is one place to audit.
 */
export function readConnection(s, id) {
	const c = s.read().connections.find((x) => x.id === id);
	if (!c) return null;
	return { id: c.id, label: c.label, provider: c.provider, overrides: c.overrides, hasKey: !!c.apiKey, createdAt: c.createdAt };
}

/** Every connection, key-free. */
export function listConnections(s) {
	return s.read().connections.map((c) => readConnection(s, c.id));
}

export function dropConnection(s, id) {
	s.mutate((d) => {
		d.connections = d.connections.filter((x) => x.id !== id);
	});
}

/**
 * The runnable profile for a connection: preset fields, then your overrides on top.
 *
 * Same merge order as the CLI — base then overrides — so a connection behaves exactly as an
 * engines.json row with config overrides always has. A connection whose provider has vanished
 * returns its overrides with `missingProvider` set, rather than a half-built profile that would
 * fail further down with a worse message.
 */
export function resolveConnection(s, id, engines = loadEngines()) {
	const c = s.read().connections.find((x) => x.id === id);
	if (!c) return null;
	if (c.provider === null) return { ...c.overrides, _custom: true, apiKey: c.apiKey ?? undefined };
	const preset = readProvider(c.provider, engines);
	if (!preset) return { ...c.overrides, missingProvider: c.provider };
	const { name, ...profile } = preset;
	return { ...profile, ...c.overrides, ...(c.apiKey ? { apiKey: c.apiKey } : {}) };
}

// ── The reviewer's name ─────────────────────────────────────────────────────────────────

/**
 * Who gets recorded on an approval.
 *
 * Deliberately asked for once and stored, NOT taken from the OS or from git. An automated run
 * under your account would inherit that name and become indistinguishable from your own
 * judgement — which is the exact failure the `by` field exists to make visible, after an agent
 * wrote 58 verdicts into a real project in bulk.
 */
export function getReviewer(s) {
	return s.read().reviewer ?? null;
}

export function setReviewer(s, name) {
	s.mutate((d) => {
		d.reviewer = name && String(name).trim() ? String(name).trim() : null;
	});
}

// ── The key guard ───────────────────────────────────────────────────────────────────────

/**
 * Refuses to store a key unless the settings file is genuinely gitignored.
 *
 * Not politeness. A key committed to a public repo is unrecoverable — it must be rotated, and
 * scrubbing history is the least of it. The check ASKS GIT rather than parsing .gitignore: an
 * earlier hand-rolled parser was wrong in the direction that matters, refusing where git itself
 * said the file was ignored, because real gitignore semantics include parent directories,
 * negation, globs and nested files.
 */
export function assertGitignored(toolRoot = TOOL_ROOT, file = SETTINGS_FILE) {
	const target = join(toolRoot, file);
	const r = spawnSync("git", ["check-ignore", "-q", "--", target], { cwd: toolRoot });
	if (r.status === 0) return true;
	if (r.status === 1) throw new Error(`refusing to store a key: git does not ignore "${target}". Add "${file}" to .gitignore first.`);
	// Outside a git repo there is nothing to leak a key INTO, so refusing would be theatre — but
	// say so, because a silent pass is exactly the assumption this guard exists to prevent.
	if (r.error || r.status === 128) return { ok: true, reason: "not a git repository — nothing to commit a key into" };
	throw new Error(`refusing to store a key: could not ask git whether "${target}" is ignored (exit ${r.status}).`);
}

