<script setup>
// The queue. Buckets with live counts, plus a per-check breakdown — findings cluster by check,
// and ten spurious questions are ten instances of the same decision, so working one code at a
// time is far faster than context-switching between defect classes.
import { computed } from "vue";
import UiInput from "@delebash/llm-ui/common/components/UiInput.vue";
import { BUCKETS, useReview } from "@/stores/review.js";

const s = useReview();

/** Check codes present in the current bucket, so the breakdown never offers an empty filter. */
const codes = computed(() => {
	const b = BUCKETS.find((x) => x.id === s.bucket);
	const n = {};
	for (const r of s.rows) {
		if (b && !b.match(r)) continue;
		for (const f of r.flags) n[f.code] = (n[f.code] ?? 0) + 1;
	}
	return Object.entries(n).sort((a, b2) => b2[1] - a[1]);
});

function pickBucket(id) {
	s.bucket = id;
	s.code = null;
	s.select(s.visible[0] ?? null);
}
</script>

<template>
  <nav class="pane queue">
    <h3>Queue</h3>
    <button
      v-for="b in BUCKETS"
      :key="b.id"
      class="bucket"
      :class="{ on: s.bucket === b.id && !s.code }"
      @click="pickBucket(b.id)"
    >
      {{ b.label }}
      <span class="n">{{ s.bucketCounts[b.id] ?? 0 }}</span>
    </button>

    <template v-if="codes.length">
      <h3>By check</h3>
      <button
        v-for="[c, n] in codes"
        :key="c"
        class="bucket"
        :class="{ on: s.code === c }"
        @click="s.code = s.code === c ? null : c; s.select(s.visible[0] ?? null)"
      >
        {{ c }}
        <span class="n">{{ n }}</span>
      </button>
    </template>

    <h3>Language</h3>
    <button class="bucket" :class="{ on: s.lang === null }" @click="s.lang = null; s.refresh()">
      All
      <span class="n">{{ s.langs.length }}</span>
    </button>
    <button
      v-for="l in s.langs"
      :key="l"
      class="bucket"
      :class="{ on: s.lang === l }"
      @click="s.lang = l; s.refresh()"
    >
      {{ l }}
      <span class="n">{{ (s.progress[l]?.reviewed ?? 0) }}</span>
    </button>

    <h3>Search</h3>
    <div style="padding: 0 6px">
      <UiInput v-model="s.search" placeholder="key or text…" />
    </div>
  </nav>
</template>
