<script setup>
// The detail panel — where the reviewing actually happens.
//
// Everything here answers a question a reviewer had to leave the page to answer:
//
//   why is this flagged      the code, plus what that check looks for in plain English
//   what does it say         source with placeholders marked, so what must survive is visible
//   what do others say       Google's reading, the local second pass, back-translation
//   is this word right       terminology against the catalogue's own usage
//   how do neighbours do it  siblings — how the "Why:" defect was actually proven
//   why was it wrong         a note that feeds the NEXT translation of this key
import { computed, ref, watch } from "vue";
import UiButton from "@delebash/llm-ui/common/components/UiButton.vue";
import UiTextarea from "@delebash/llm-ui/common/components/UiTextarea.vue";
import { pushToast } from "@delebash/llm-ui/common/services/toastBridge.js";
import { api, gtFrameUrl } from "@/api.js";
import { useReview } from "@/stores/review.js";

const s = useReview();
const draft = ref("");
const note = ref("");
const siblings = ref([]);
const proposal = ref(null);
const showGoogle = ref(false);
const back = ref(null);
const backBusy = ref(false);

/** Plain-English for the check codes. A code alone tells a reviewer nothing. */
const WHY = {
	"spurious-interrogative": "the source is a statement, but the translation is a question",
	startpunc: "Spanish opens questions and exclamations with ¿ or ¡ — one is missing or unpaired",
	endpunc: "the source and the translation end with different punctuation",
	untranslated: "the translation is identical to the English",
	placeholders: "an interpolation like {count} was lost, changed or duplicated",
	plural: "the two halves either side of | are the same, so the plural does nothing",
	glossary: "a do-not-translate term was translated",
	numbers: "a digit in the source is missing from the translation",
	brackets: "the bracket counts do not match",
	blank: "the translation is empty",
	missing: "this key has no translation at all",
	disagreement: "a second pass worded this differently — the model was unsure here",
	terminology: "this uses a different word than the rest of the catalogue does for the same term",
};

const sel = computed(() => s.selected);

/** Placeholders marked, so what must survive translation is impossible to miss. */
const marked = computed(() => {
	const t = sel.value?.source ?? "";
	return t.split(/(\{[^}]*\})/g).map((part, i) => ({ part, ph: i % 2 === 1 }));
});

const hard = computed(() => (sel.value?.flags ?? []).filter((f) => !f.advisory));
const soft = computed(() => (sel.value?.flags ?? []).filter((f) => f.advisory));

watch(
	sel,
	async (r) => {
		draft.value = r?.target ?? "";
		note.value = r?.note ?? "";
		siblings.value = [];
		proposal.value = null;
		showGoogle.value = false;
		back.value = null;
		if (!r) return;
		try {
			const [sib, props] = await Promise.all([api.siblings(r.lang, r.key), api.proposals(r.lang, r.key)]);
			if (sel.value?.key !== r.key) return; // the reviewer moved on while we fetched
			siblings.value = sib.siblings;
			proposal.value = props.proposals[0] ?? null;
		} catch {
			/* a missing sibling list must never block reviewing */
		}
	},
	{ immediate: true },
);

async function commit() {
	if (!sel.value || draft.value === sel.value.target) return;
	const row = sel.value;
	await s.save(row, draft.value);
	pushToast({ title: "Saved", description: row.key, action: { label: "Undo", fn: () => s.undo() } });
}

async function doAccept() {
	const row = sel.value;
	await s.accept(row);
	pushToast({ title: "Accepted as correct", description: row.key, action: { label: "Undo", fn: () => s.unaccept(row) } });
}

async function saveNote() {
	if (!sel.value) return;
	await s.note(sel.value, note.value);
	pushToast({ title: "Note saved", description: "It will be sent with this key on the next translation." });
}

/**
 * What the translation actually SAYS, back in English.
 *
 * For a reviewer who does not read the target language fluently this is the difference between
 * judging a translation and taking its word for it. It catches wrong-word defects. It does NOT
 * catch everything — measured 2026-07-31, a correct and an incorrect rendering of one hint
 * back-translated to identical English, because the ambiguity was in the source — so the panel
 * says what it is rather than implying more.
 */
async function backtranslate() {
	if (!sel.value || backBusy.value) return;
	backBusy.value = true;
	try {
		const conn = (await api.engines()).connections[0];
		const r = await api.backtranslate(sel.value.lang, sel.value.key, conn?.id ?? null);
		back.value = r.english;
	} catch (e) {
		back.value = `— ${e.message}`;
	} finally {
		backBusy.value = false;
	}
}

/** Takes the staged value into the box — never applied automatically. */
function useValue(v) {
	draft.value = v;
}

defineExpose({ focusEditor: () => document.querySelector("textarea.tgt")?.focus(), commit, doAccept, backtranslate, toggleGoogle: () => (showGoogle.value = !showGoogle.value) });
</script>

<template>
  <section class="pane detail">
    <div v-if="!sel" class="empty">
      Nothing selected.<br /><small>Pick a key, or press <span class="kbd">j</span> to start.</small>
    </div>

    <template v-else>
      <div class="key">{{ sel.key }}</div>
      <div class="crumb">{{ sel.lang }} · {{ sel.key.split('.').slice(0, -1).join(' › ') || 'root' }}</div>

      <div class="section" v-if="sel.flags.length">
        <div v-for="(f, i) in hard" :key="`h${i}`" class="flag hard">
          <span class="code">{{ f.code }}</span>
          <span class="why">{{ WHY[f.code] ?? f.detail }}</span>
        </div>
        <div v-for="(f, i) in soft" :key="`s${i}`" class="flag soft">
          <span class="code">{{ f.code }}</span>
          <span class="why">{{ f.detail }}</span>
        </div>
      </div>

      <div class="section">
        <span class="lbl">English</span>
        <div class="src"><template v-for="(m, i) in marked" :key="i"><mark v-if="m.ph">{{ m.part }}</mark><template v-else>{{ m.part }}</template></template></div>
      </div>

      <div class="section">
        <label class="lbl" for="tgt">{{ sel.lang }} — saves when you click away</label>
        <textarea id="tgt" v-model="draft" class="tgt" rows="3" @blur="commit" />
      </div>

      <div class="section" v-if="proposal">
        <span class="lbl">Proposed by {{ proposal.engine }}</span>
        <div class="opinion">
          <div class="val">{{ proposal.value }}</div>
          <header>
            <UiButton size="small" intent="secondary" @click="useValue(proposal.value)">Use this</UiButton>
            <UiButton size="small" intent="ghost" @click="s.discardProposal(sel)">Discard</UiButton>
          </header>
        </div>
      </div>

      <div class="section">
        <span class="lbl">Second opinion</span>
        <div class="opinion">
          <header>
            <span>Google Translate</span>
            <UiButton size="small" intent="ghost" style="margin-left:auto" @click="showGoogle = !showGoogle">
              {{ showGoogle ? 'Hide' : 'Show' }}
            </UiButton>
          </header>
          <div v-if="showGoogle" class="gtclip">
            <iframe :src="gtFrameUrl(sel.source, sel.lang)" title="Google Translate" />
          </div>
          <div v-else class="val" style="color: var(--muted); font-size: 12.5px">
            An independent reading. Neither source is reliably better — on one measured key the
            local model was right and Google wrong; on another, the reverse. Copy it across only
            if you agree.
          </div>
        </div>
      </div>

      <div class="section">
        <span class="lbl">What it says in English</span>
        <div class="opinion">
          <header>
            <span>Back-translation</span>
            <UiButton size="small" intent="ghost" style="margin-left:auto" :loading="backBusy" @click="backtranslate">
              {{ back ? 'Again' : 'Read it back' }}
            </UiButton>
          </header>
          <div class="val" :style="back ? '' : 'color: var(--muted); font-size: 12.5px'">
            {{ back || 'Renders your translation back into English with the local model. Catches wrong words — not every defect, since an ambiguous source round-trips unchanged.' }}
          </div>
        </div>
      </div>

      <div class="section" v-if="siblings.length">
        <span class="lbl">Siblings in this namespace</span>
        <div class="sib">
          <div v-for="sb in siblings" :key="sb.key" class="row2">
            <span class="kk">{{ sb.key.split('.').at(-1) }}</span>
            <span class="vv">{{ sb.source }} → <em>{{ sb.target || '—' }}</em></span>
          </div>
        </div>
      </div>

      <div class="section">
        <label class="lbl" for="note">Note for future runs</label>
        <UiTextarea id="note" v-model="note" :rows="2" placeholder="e.g. a label above the reasoning, not a question" @blur="saveNote" />
      </div>

      <div class="actions">
        <UiButton intent="primary" @click="doAccept">Accept as correct</UiButton>
        <UiButton v-if="sel.flags.some(f => f.code !== 'missing')" intent="secondary" @click="s.unaccept(sel)">Un-accept</UiButton>
        <UiButton intent="ghost" @click="s.move(1)">Skip</UiButton>
        <UiButton intent="ghost" style="margin-left:auto" @click="s.undo()">Undo last</UiButton>
      </div>
    </template>
  </section>
</template>
