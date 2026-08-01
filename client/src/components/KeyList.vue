<script setup>
// The list. Deliberately terse — a key, its language, and a dot per finding. Everything needed
// to JUDGE a translation is in the detail panel; a row's job is only to let you move.
//
// Windowed rather than fully rendered: 2,039 keys of DOM makes keyboard movement stutter, and
// the whole point of j/k is that it feels instant.
import { computed, nextTick, ref, watch } from "vue";
import UiButton from "@delebash/llm-ui/common/components/UiButton.vue";
import UiCheckbox from "@delebash/llm-ui/common/components/UiCheckbox.vue";
import { useReview } from "@/stores/review.js";

const s = useReview();
const scroller = ref(null);
const start = ref(0);
const ROW = 32;
const OVER = 12;
const height = ref(600);

const windowed = computed(() => {
	const n = Math.ceil(height.value / ROW) + OVER * 2;
	const from = Math.max(0, start.value - OVER);
	return { from, items: s.visible.slice(from, from + n) };
});

function onScroll(e) {
	start.value = Math.floor(e.target.scrollTop / ROW);
	height.value = e.target.clientHeight;
}

const pickedCount = computed(() => s.pickedRows.length);
const allPicked = computed(() => s.visible.length > 0 && pickedCount.value === s.visible.length);
const confirmedCount = computed(() => s.visible.filter((r) => r.flags.some((f) => f.confirmed === "same")).length);

/** What the confirmation pass thought about this row — an annotation, never a decision. */
const verdictOf = (r) => r.flags.find((f) => f.confirmed)?.confirmed ?? null;

/** Keeps the selected row on screen when the keyboard moves it past an edge. */
watch(
	() => [s.selectedKey, s.selectedLang],
	async () => {
		await nextTick();
		const el = scroller.value?.querySelector(".row.on");
		el?.scrollIntoView({ block: "nearest" });
	},
);
</script>

<template>
  <div class="listwrap">
    <div v-if="s.bucket === 'identical' && s.visible.length" class="bulkbar">
      <UiCheckbox
        :model-value="allPicked"
        :label="pickedCount ? `${pickedCount} of ${s.visible.length} ticked` : `select all ${s.visible.length}`"
        @update:model-value="s.pickAll($event)"
      />
      <div class="spacer" />
      <UiButton v-if="confirmedCount" size="small" variant="secondary" @click="s.pickConfirmed()">
        tick the {{ confirmedCount }} the engine calls correct
      </UiButton>
      <UiButton :disabled="!pickedCount" size="small" @click="s.acceptPicked()">
        Approve {{ pickedCount || "" }}
      </UiButton>
    </div>

    <div ref="scroller" class="pane list" @scroll="onScroll">
    <div v-if="!s.visible.length" class="empty">
      Nothing here.<br /><small>Try another bucket, or clear the search.</small>
    </div>

    <div v-else :style="{ height: `${s.visible.length * ROW}px`, position: 'relative' }">
      <div :style="{ transform: `translateY(${windowed.from * ROW}px)` }">
        <div
          v-for="r in windowed.items"
          :key="`${r.lang}:${r.key}`"
          class="row"
          :class="{ on: r.key === s.selectedKey && r.lang === s.selectedLang, done: r.status === 'reviewed' }"
          :style="{ height: `${ROW}px` }"
          @click="s.select(r)"
        >
          <UiCheckbox
            v-if="s.bucket === 'identical'"
            :model-value="s.isPicked(r)"
            @click.stop
            @update:model-value="s.togglePick(r)"
          />
          <span v-if="s.langs.length > 1" class="lang">{{ r.lang }}</span>
          <span class="k">{{ r.key }}</span>
          <span v-if="verdictOf(r)" class="verdict" :class="verdictOf(r)">
            {{ verdictOf(r) === "same" ? "correct?" : "skipped?" }}
          </span>
          <span class="dots">
            <i v-for="(f, i) in r.flags.slice(0, 4)" :key="i" class="dot" :class="{ advisory: f.advisory }" :title="f.code" />
          </span>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
