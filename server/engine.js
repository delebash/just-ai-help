// Engine resolution. ONE merge, used by both doors into this tool.
//
// THE BUG THIS EXISTS TO KILL. There were two resolvers that did not agree:
//
//   CLI        engines.json row  +  cfg.profile  +  cfg.model/url/think     key from env
//   workspace  providers row     +  connection.overrides                    key from the DB
//
// `startJob` in server.js resolved only a connection — `cfg.model`, `cfg.url` and `cfg.think`
// appeared ZERO times in that path. So setting an override in your project config and pressing
// re-translate in the UI silently ignored it: same tool, same config, different answer
// depending on which door you came through. Nothing warned, because neither side knew the
// other existed.
//
// Now both call `applyConfigOverrides()`, so a project config means the same thing everywhere.
//
// WHY THE PRECEDENCE IS THIS WAY. Narrowest wins, because that is the order of knowledge:
//   1. the engine row / provider  — what the TOOL knows about a provider, shipped and reseeded
//   2. connection overrides       — what YOU chose in the workspace, and your key
//   3. cfg.profile               — what THIS PROJECT needs (batchSize, rateLimitMs, extraBody)
//   4. cfg.model / url / think   — the explicit per-project overrides, most specific of all
//
// `model` is last for a measured reason: a local server's model id is whatever YOU serve, and
// no shipped row can know it.

/**
 * Layers a project config's overrides onto a base profile.
 *
 * @param base  a resolved engines.json row or a resolved connection
 * @param cfg   the project config
 */
export function applyConfigOverrides(base, cfg) {
	if (!cfg) return { ...base };
	const profile = { ...base, ...(cfg.profile ?? {}) };
	if (cfg.model) profile.model = cfg.model;
	if (cfg.url) profile.url = cfg.url;
	if (cfg.think !== undefined) profile.think = cfg.think;
	return profile;
}

/**
 * Whether a profile is runnable, and why not if it is not.
 *
 * Returns a message rather than exiting, so the CLI can print-and-exit while the server can
 * answer 400 — the previous version called process.exit() inside a function the HTTP layer
 * also needed, which is why the server had to duplicate the logic instead of sharing it.
 */
export function profileProblem(profile, { name = "engine", env = process.env } = {}) {
	if (!profile) return `no such ${name}`;
	if (profile.missingProvider) return `connection references a provider that no longer exists: ${profile.missingProvider}`;
	if (!profile.model || String(profile.model).startsWith("REQUIRED")) {
		return `engine "${name}" needs a model id — set "model" in your config`;
	}
	// A key is only required when the row names an env var to find it in. A connection carries
	// its own key from the database, so it has no apiKeyEnv and correctly skips this.
	if (profile.apiKeyEnv && !profile.apiKey && !env[profile.apiKeyEnv]) {
		return `set ${profile.apiKeyEnv} — the engine "${name}" needs it`;
	}
	return null;
}

/**
 * Resolves a named row from engines.json into a runnable profile.
 *
 * `applyOverrides: false` is what --escalate passes. Escalation deliberately inherits none of
 * the project's engine overrides: the point of escalating is to run somewhere ELSE, and
 * inheriting cfg.model would silently defeat it by running the same model twice.
 */
export function resolveEngineRow(engines, name, cfg, { applyOverrides = true } = {}) {
	const base = engines[name];
	if (!base) {
		const known = Object.keys(engines).filter((k) => !k.startsWith("_")).join(", ");
		return { profile: null, problem: `unknown engine "${name}". Known: ${known}` };
	}
	const profile = applyOverrides ? applyConfigOverrides(base, cfg) : { ...base };
	return { profile, problem: profileProblem(profile, { name }) };
}
