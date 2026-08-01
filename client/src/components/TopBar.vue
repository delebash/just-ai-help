<script setup>
// The toolbar: progress, the bulk run, and undo.
//
// The scope selector states exactly what it is about to do, because a 52-minute job started on
// the wrong scope is an expensive mistake — and "re-translate" with a filter active must mean
// the filtered set, not everything.
import { computed, onMounted, ref } from "vue";
import UiButton from "@delebash/llm-ui/common/components/UiButton.vue";
import UiSelect from "@delebash/llm-ui/common/components/UiSelect.vue";
import { pushToast } from "@delebash/llm-ui/common/services/toastBridge.js";
import { api } from "@/services/api.js";
import { useReview } from "@/stores/review.js";

const s = useReview();
const providers = ref([]);
const connections = ref([]);
const connectionId = ref(null);
const scope = ref("flagged");

const SCOPES = [
	{ value: "flagged", label: "all flagged" },
	{ value: "unsure", label: "everything unsure" },
	{ value: "all", label: "whole catalogue" },
];

/** Re-read after saving a connection, so a new one appears without a reload. */
async function loadEngines() {
	try {
		const { providers: p, connections: c } = await api.engines();
		providers.value = p;
		connections.value = c;
		connectionId.value = c.find((x) => x.id === connectionId.value)?.id ?? c[0]?.id ?? null;
	} catch {
		/* the toolbar must still render when engines cannot be read */
	}
}
onMounted(loadEngines);

const running = computed(() => s.job.state === "running");
const pct = computed(() => (s.job.total ? Math.round((s.job.done / s.job.total) * 100) : 0));

const reviewed = computed(() => Object.values(s.progress).reduce((n, p) => n + (p?.reviewed ?? 0), 0));
const queue = computed(() => s.bucketCounts.all ?? 0);

async function run() {
	try {
		await s.startJob({ scope: scope.value, connectionId: connectionId.value });
	} catch (e) {
		pushToast({ title: "Could not start", description: e.message });
	}
}
</script>

<template>
  <header class="topbar">
    <span class="brand">Translation review</span>

    <span class="meter">
      <span>{{ reviewed }} / {{ reviewed + queue }} reviewed</span>
      <span class="bar"><i :style="{ width: `${(reviewed + queue) ? (reviewed / (reviewed + queue)) * 100 : 0}%` }" /></span>
    </span>

    <span class="spacer" />

    <template v-if="running">
      <span class="meter">
        <span>Translating {{ s.job.done }} / {{ s.job.total }}</span>
        <span class="bar"><i :style="{ width: `${pct}%` }" /></span>
      </span>
      <UiButton size="small" intent="danger-outline" @click="s.cancelJob()">Cancel</UiButton>
    </template>

    <template v-else>
      <span style="font-size:12px;color:var(--muted)">Re-translate</span>
      <UiSelect v-model="scope" :options="SCOPES" width="name" />
      <span style="font-size:12px;color:var(--muted)">with</span>
      <UiSelect
        v-model="connectionId"
        :options="connections.map(c => ({ value: c.id, label: c.label }))"
        width="name"
        placeholder="no engine"
      />
      <UiButton
        size="small"
        intent="primary"
        :disabled="!connectionId"
        :title="connectionId ? 'Start' : 'Add an engine connection first — the gear button'"
        @click="run"
      >Start</UiButton>
    </template>

    <UiButton size="small" intent="ghost" title="Undo last action (u)" @click="s.undo()">Undo</UiButton>
  </header>
</template>
