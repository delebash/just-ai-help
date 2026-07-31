<script setup>
// Engine connections.
//
// This screen was designed and then not built, which made three features unreachable: with no
// connection there is nothing in the toolbar's engine dropdown, so Start stays disabled and
// re-translate, escalate and back-translation cannot be used at all. The endpoint, the guard
// and the tests all existed; the screen did not.
//
// PRESETS vs CONNECTIONS is the whole model. A preset is what the tool knows about a provider
// — URL, transport, default model, the odd flags like `think`. Picking one fills all of that in.
// A connection is what YOU chose: which preset, your key, and only the fields you changed.
// A tool update rewrites presets and never touches connections.
//
// Only props verified against each component's own defineProps are used here — UiButton takes
// `intent`, not `variant`, and getting that wrong once already made every button render as a
// solid primary.
import { computed, ref } from "vue";
import UiButton from "@delebash/llm-ui/common/components/UiButton.vue";
import UiInput from "@delebash/llm-ui/common/components/UiInput.vue";
import UiSelect from "@delebash/llm-ui/common/components/UiSelect.vue";
import { pushToast } from "@delebash/llm-ui/common/services/toastBridge.js";
import { api } from "@/services/api.js";

const props = defineProps({
	providers: { type: Array, default: () => [] },
	connections: { type: Array, default: () => [] },
});
const emit = defineEmits(["saved", "close"]);

const label = ref("");
const provider = ref(null);
const apiKey = ref("");
const model = ref("");
const busy = ref(false);
const error = ref(null);

const preset = computed(() => props.providers.find((p) => p.name === provider.value) ?? null);
const needsKey = computed(() => !!preset.value?.apiKeyEnv);
/** A preset whose model is a "REQUIRED — …" placeholder cannot run until you name one. */
const needsModel = computed(() => String(preset.value?.model ?? "").startsWith("REQUIRED"));
const options = computed(() => props.providers.map((p) => ({ value: p.name, label: p.name })));

function pick(name) {
	provider.value = name;
	if (!label.value) label.value = name;
	model.value = "";
	error.value = null;
}

async function save() {
	if (!provider.value || !label.value.trim()) return;
	busy.value = true;
	error.value = null;
	try {
		const overrides = {};
		if (model.value.trim()) overrides.model = model.value.trim();
		await api.saveConnection({
			label: label.value.trim(),
			provider: provider.value,
			overrides,
			// Omitted entirely when blank — passing "" would CLEAR a key rather than leave it.
			...(apiKey.value ? { apiKey: apiKey.value } : {}),
		});
		pushToast({ title: "Connection saved", description: label.value.trim() });
		label.value = "";
		provider.value = null;
		apiKey.value = "";
		model.value = "";
		emit("saved");
	} catch (e) {
		// The commonest failure is the key guard refusing because git does not ignore the
		// database. Showing it verbatim is the point — it says exactly what to fix.
		error.value = e.message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
  <div class="settings">
    <header>
      <strong>Engine connections</strong>
      <UiButton size="small" intent="ghost" @click="emit('close')">Close</UiButton>
    </header>

    <div v-if="connections.length" class="existing">
      <div v-for="c in connections" :key="c.id" class="conn">
        <span class="nm">{{ c.label }}</span>
        <span class="pv">{{ c.provider ?? 'custom' }}</span>
        <span class="key" :class="{ set: c.hasKey }">{{ c.hasKey ? 'key set' : 'no key' }}</span>
      </div>
    </div>
    <p v-else class="none">
      No connections yet — which is why the engine dropdown is empty and <strong>Start</strong> is
      disabled. Local engines need no key.
    </p>

    <div class="form">
      <label>Provider</label>
      <UiSelect :model-value="provider" :options="options" width="name" placeholder="pick one" @update:model-value="pick" />

      <template v-if="preset">
        <label>Name it</label>
        <UiInput v-model="label" placeholder="e.g. groq" />

        <label v-if="needsModel">Model <em>— this preset needs one</em></label>
        <UiInput v-if="needsModel" v-model="model" placeholder="model id" />

        <label v-if="needsKey">API key <em>— stored locally, never committed</em></label>
        <UiInput v-if="needsKey" v-model="apiKey" type="password" :placeholder="preset.apiKeyEnv" />

        <p v-if="preset.help" class="hint">{{ preset.help.split("\n\n")[0].slice(0, 240) }}</p>
      </template>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="row">
        <UiButton intent="primary" size="small" :loading="busy" :disabled="!provider || !label.trim()" @click="save">
          Save connection
        </UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings { position: absolute; right: 12px; top: 46px; z-index: 40; width: 380px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
  box-shadow: 0 10px 30px var(--shadow-medium); padding: 12px 14px 14px; }
.settings header { display: flex; align-items: center; margin-bottom: 10px; }
.settings header strong { font-size: 13px; }
.settings header :last-child { margin-left: auto; }
.existing { display: grid; gap: 4px; margin-bottom: 10px; }
.conn { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: baseline;
  padding: 5px 8px; background: var(--surface-2); border-radius: var(--r-sm); font-size: 12.5px; }
.conn .pv { color: var(--muted); font-size: 11.5px; }
.conn .key { font-size: 11px; color: var(--muted); }
.conn .key.set { color: var(--success-ink); }
.none { font-size: 12.5px; color: var(--muted); margin: 0 0 10px; line-height: 1.5; }
.form { display: grid; gap: 6px; }
.form label { font: 600 10.5px/1 var(--font-ui); letter-spacing: .07em; text-transform: uppercase;
  color: var(--muted); margin-top: 4px; }
.form label em { font-style: normal; text-transform: none; letter-spacing: 0; font-weight: 400; }
.hint { font-size: 11.5px; color: var(--muted); line-height: 1.45; margin: 4px 0 0; }
.err { font-size: 12px; color: var(--danger-ink); background: var(--danger-bg);
  border: 1px solid var(--danger-line); border-radius: var(--r-sm); padding: 7px 9px; margin: 6px 0 0; }
.row { margin-top: 8px; }
</style>
