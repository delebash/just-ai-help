<script setup>
// The shell, and the keyboard.
//
// Keys are not a garnish here. A reviewer works a queue of a couple of hundred items, and doing
// that with a mouse is the difference between a tool people use and one they abandon after the
// first session.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Toast from "@delebash/llm-ui/common/components/Toast.vue";
import UiSegmented from "@delebash/llm-ui/common/components/UiSegmented.vue";
import SetupTab from "@/components/SetupTab.vue";
import { setup } from "@/services/api.js";
import DetailPane from "@/components/DetailPane.vue";
import KeyList from "@/components/KeyList.vue";
import QueuePane from "@/components/QueuePane.vue";
import TopBar from "@/components/TopBar.vue";
import { useReview } from "@/stores/review.js";

const s = useReview();
const detail = ref(null);
let stopJob = null;

// ONE entry point. The server no longer needs a config to start, so this page opens on Setup
// when nothing is pointed at yet — a tool that required a config to reach the screen that
// writes a config is what this replaced.
const tab = ref("setup");
const hasProject = ref(false);
const projectLabel = computed(() => (s.langs.length ? `${s.langs.join(", ")} — ${s.rows.length} to review` : "project loaded"));
const TABS = [
	{ label: "Setup", value: "setup" },
	{ label: "Review", value: "review" },
];

async function checkProject() {
	try {
		const st = await setup.state();
		hasProject.value = st.loaded;
		tab.value = st.loaded ? "review" : "setup";
		if (st.loaded) await s.refresh();
	} catch {
		hasProject.value = false;
		tab.value = "setup";
	}
}

/** Setup wrote a config — the project is live with no restart, so just load its queue. */
async function onProjectLoaded() {
	hasProject.value = true;
	await s.refresh();
	tab.value = "review";
}

/** True when the user is typing, so j/k do not steal characters out of a textarea. */
const editing = () => {
	const el = document.activeElement;
	return el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
};

function onKey(e) {
	if (tab.value !== "review") return;
	if (e.metaKey || e.ctrlKey) {
		if (e.key === "z") {
			e.preventDefault();
			s.undo();
		}
		return;
	}
	if (editing()) {
		if (e.key === "Escape") document.activeElement.blur();
		return;
	}
	const go = {
		j: () => s.move(1),
		k: () => s.move(-1),
		ArrowDown: () => s.move(1),
		ArrowUp: () => s.move(-1),
		a: () => detail.value?.doAccept(),
		u: () => s.undo(),
		e: () => detail.value?.focusEditor(),
		g: () => detail.value?.toggleGoogle(),
		b: () => detail.value?.backtranslate(),
		"/": () => document.querySelector('input[placeholder^="key or text"]')?.focus(),
	}[e.key];
	if (go) {
		e.preventDefault();
		go();
	}
}

onMounted(() => {
	// Follow the OS unless the kit's appearance engine says otherwise.
	if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
	checkProject();
	stopJob = s.watchJob();
	window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKey);
	stopJob?.();
});
</script>

<template>
  <div class="shell tabbed">
    <div class="tabs">
      <UiSegmented v-model="tab" :options="TABS" size="small" aria-label="Setup or review" />
      <span v-if="!hasProject" class="muted">no project yet — fill in Setup and press Create config</span>
      <span v-else class="muted">{{ projectLabel }}</span>
    </div>

    <!-- v-show, NOT v-if: switching tabs must not unmount the form and lose what is typed in it. -->
    <div class="body">
      <SetupTab v-show="tab === 'setup'" @loaded="onProjectLoaded" />

      <div v-show="tab === 'review'" class="reviewpane">
        <template v-if="hasProject">
          <TopBar />
          <div class="panes">
            <QueuePane />
            <KeyList />
            <DetailPane ref="detail" />
          </div>
        </template>
        <div v-else class="empty">
          Nothing to review yet.<br /><small>Open <strong>Setup</strong>, point it at your en.json, and press <strong>Create config</strong>.</small>
        </div>
      </div>
    </div>
    <Toast />
  </div>
</template>
