<script setup>
// The shell, and the keyboard.
//
// Keys are not a garnish here. A reviewer works a queue of a couple of hundred items, and doing
// that with a mouse is the difference between a tool people use and one they abandon after the
// first session.
import { onBeforeUnmount, onMounted, ref } from "vue";
import Toast from "@delebash/llm-ui/common/components/Toast.vue";
import DetailPane from "@/components/DetailPane.vue";
import KeyList from "@/components/KeyList.vue";
import QueuePane from "@/components/QueuePane.vue";
import TopBar from "@/components/TopBar.vue";
import { useReview } from "@/stores/review.js";

const s = useReview();
const detail = ref(null);
let stopJob = null;

/** True when the user is typing, so j/k do not steal characters out of a textarea. */
const editing = () => {
	const el = document.activeElement;
	return el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
};

function onKey(e) {
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
	s.refresh();
	stopJob = s.watchJob();
	window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKey);
	stopJob?.();
});
</script>

<template>
  <div class="shell">
    <TopBar />
    <div class="panes">
      <QueuePane />
      <KeyList />
      <DetailPane ref="detail" />
    </div>
    <Toast />
  </div>
</template>
