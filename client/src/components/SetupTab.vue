<script setup>
// Setup — the whole config, editable. Not a first-run wizard.
//
// THE FULL EDITOR, not a first-run wizard. The config is JSON so git can carry it, not so you
// have to hand-edit it — so everything is here (targets, context, glossary, engine, connections)
// and this screen works on an existing project exactly as on a new one.
//
// WHY A PATH BOX AND NOT "BROWSE…". A browser file input hands JavaScript a File object and
// never a filesystem path, so a real Browse means the server exposing a directory-listing API
// over localhost — a filesystem-read surface nothing else in this tool has, to save typing a
// path once per project.
//
// A BUTTON, NOT A DEBOUNCE. Reading a 2,000-key file on a timer while someone is mid-paste is
// work nobody asked for. You say when.
import { computed, onMounted, ref } from "vue";
import UiButton from "@delebash/llm-ui/common/components/UiButton.vue";
import EngineSettings from "@/components/EngineSettings.vue";
import UiCheckbox from "@delebash/llm-ui/common/components/UiCheckbox.vue";
import UiChip from "@delebash/llm-ui/common/components/UiChip.vue";
import UiField from "@delebash/llm-ui/common/components/UiField.vue";
import UiInput from "@delebash/llm-ui/common/components/UiInput.vue";
import UiSelect from "@delebash/llm-ui/common/components/UiSelect.vue";
import UiTextarea from "@delebash/llm-ui/common/components/UiTextarea.vue";
import UiTag from "@delebash/llm-ui/common/components/UiTag.vue";
import { pushToast } from "@delebash/llm-ui/common/services/toastBridge.js";
import { setup } from "@/services/api.js";

const emit = defineEmits(["loaded"]);

const path = ref("");
const found = ref(null);
const problem = ref(null);
const checking = ref(false);
const saving = ref(false);

const state = ref({ loaded: false, providers: [], connections: [], defaultEngine: "", reviewer: null, languages: [] });
const targets = ref([]);
const context = ref("");
const glossary = ref([]);
const engine = ref("");
const reviewer = ref("");
const langFilter = ref("");
const showAll = ref(false);

/**
 * Language names, derived — never a hardcoded list of English strings.
 *
 * `languages.json` carries CODES only; `Intl.DisplayNames` turns each into a name in the
 * reader's own locale. So the menu reads correctly for a Spanish-speaking user without anyone
 * translating it, and a name here can never drift from what the platform actually calls it.
 */
const nameOf = (code) => {
	try {
		const dn = new Intl.DisplayNames(undefined, { type: "language" });
		const n = dn.of(code);
		return n && n !== code ? `${n} (${code})` : code;
	} catch {
		return code;
	}
};

/**
 * Locale files already sitting beside the source, with how complete each one is.
 *
 * Listed first and never pre-ticked: what is on disk is a fact about the folder, and choosing
 * what to RUN is yours. "es 2039/2039" and "fr 120/2039" are different decisions and the form
 * should not make either of them for you.
 */
const existing = computed(() => found.value?.locales ?? []);

/** Every other language the tool knows about, filtered by what you type. */
const others = computed(() => {
	const have = new Set([...existing.value.map((l) => l.code), found.value?.sourceLanguage]);
	const q = langFilter.value.trim().toLowerCase();
	return state.value.languages
		.filter((c) => !have.has(c))
		.map((c) => ({ code: c, label: nameOf(c) }))
		.filter((o) => !q || o.label.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
		.sort((a, b) => a.label.localeCompare(b.label));
});

function toggleTarget(code) {
	targets.value = targets.value.includes(code) ? targets.value.filter((c) => c !== code) : [...targets.value, code];
}

onMounted(async () => {
	state.value = await setup.state();
	engine.value = state.value.defaultEngine;
	reviewer.value = state.value.reviewer ?? "";
	if (state.value.source) {
		path.value = state.value.source;
		await inspect();
	}
});

/** Explicit. Nothing reads the disk until you ask it to. */
async function inspect() {
	if (!path.value.trim() || checking.value) return;
	checking.value = true;
	problem.value = null;
	try {
		found.value = await setup.inspect(path.value);
	} catch (e) {
		found.value = null;
		problem.value = e.message;
	} finally {
		checking.value = false;
	}
}

const canSave = computed(() => !!found.value && !problem.value && !saving.value);

function toggleTerm(term) {
	glossary.value = glossary.value.includes(term) ? glossary.value.filter((t) => t !== term) : [...glossary.value, term];
}



const showEngines = ref(false);

/** A connection was saved — re-read settings so the list and the picker both see it. */
async function enginesChanged() {
	state.value = await setup.state();
}

async function save() {
	saving.value = true;
	try {
		if (reviewer.value.trim() !== (state.value.reviewer ?? "")) await setup.reviewer(reviewer.value.trim() || null);
		const out = await setup.save({
			path: path.value,
			targets: targets.value,
			context: context.value,
			glossary: glossary.value,
			engine: engine.value,
		});
		pushToast({ kind: "success", text: `Wrote ${out.configPath}` });
		state.value = await setup.state();
		emit("loaded");
	} catch (e) {
		pushToast({ kind: "error", text: e.message });
	} finally {
		saving.value = false;
	}
}
</script>

<template>
  <div class="setuptab">
  <div class="setup">
    <form class="setup__source" @submit.prevent="inspect">
      <h2>Point it at your <code>en.json</code></h2>
      <UiField
        layout="block"
        label="Path to your source locale file"
        hint="The folder it sits in is your locale folder, and its filename is your source language — so one field, and nothing can disagree with anything else."
      >
        <div class="row">
          <UiInput v-model="path" class="grow" placeholder="E:\Dev\Web\my-app\src\i18n\locales\en.json" spellcheck="false" />
          <UiButton type="submit" :disabled="!path.trim() || checking">
            {{ checking ? "Reading…" : "Check" }}
          </UiButton>
        </div>
      </UiField>

      <p v-if="problem" class="bad">{{ problem }}</p>
      <div v-else-if="found" class="tags">
        <UiTag intent="success">{{ found.keyCount }} keys</UiTag>
        <UiTag intent="secondary">source: {{ found.sourceLanguage }}</UiTag>
        <UiTag intent="secondary">placeholder {{ found.placeholder.prefix }}…{{ found.placeholder.suffix }}</UiTag>
        <UiTag intent="secondary">
          plural {{ found.pluralSeparator === null ? "none" : JSON.stringify(found.pluralSeparator) }}
        </UiTag>
        <UiTag v-if="found.exists" intent="info">editing the existing config</UiTag>
      </div>
    </form>

    <!-- Live from the moment the page loads. Only the glossary candidates below need the file
         read first, because they are extracted from your own strings. -->
    <div class="setup__grid">
      <section class="span-all">
        <h2>
          Languages to produce
          <span class="muted">— tick what you want translated. Nothing is chosen for you.</span>
        </h2>

        <div v-if="existing.length" class="langgroup">
          <p class="muted">Already in your locale folder:</p>
          <ul class="langlist">
            <li v-for="l in existing" :key="l.code">
              <UiCheckbox :model-value="targets.includes(l.code)" @update:model-value="toggleTarget(l.code)" />
              <span class="langname">{{ nameOf(l.code) }}</span>
              <UiTag v-if="!l.missing" intent="success">complete · {{ l.done }}/{{ l.total }}</UiTag>
              <UiTag v-else-if="l.done" intent="warn">{{ l.missing }} missing · {{ l.done }}/{{ l.total }}</UiTag>
              <UiTag v-else intent="secondary">empty · 0/{{ l.total }}</UiTag>
            </li>
          </ul>
        </div>
        <p v-else-if="found" class="muted">No other locale files beside your source yet.</p>

        <div class="langgroup">
          <div class="row">
            <UiInput v-model="langFilter" class="grow filter" placeholder="filter languages…" />
            <UiButton variant="secondary" @click="showAll = !showAll">
              {{ showAll ? "Hide" : "Add another language" }}
            </UiButton>
          </div>
          <ul v-if="showAll || langFilter" class="langlist scroll">
            <li v-for="o in others" :key="o.code">
              <UiCheckbox :model-value="targets.includes(o.code)" @update:model-value="toggleTarget(o.code)" />
              <span class="langname">{{ o.label }}</span>
            </li>
            <li v-if="!others.length" class="muted">nothing matches "{{ langFilter }}"</li>
          </ul>
        </div>

        <p v-if="targets.length" class="chips">
          <UiChip v-for="t in targets" :key="t" selected @click="toggleTarget(t)">{{ nameOf(t) }} ✕</UiChip>
        </p>
        <p v-else class="muted">Nothing ticked — a run with no targets does nothing.</p>
      </section>

      <section>
        <h2>What is this app?</h2>
        <UiField
          layout="block"
          hint='One sentence. It is what decides whether "Beat" is a story beat or a musical one — the tool cannot know this and will not guess.'
        >
          <UiTextarea v-model="context" rows="2" placeholder="a desktop app for writing novels — chapters, scenes, characters" />
        </UiField>
      </section>

      <section>
        <h2>Engine</h2>
        <UiField layout="block" hint="Which engine THIS project uses. The row names a provider; the connection below says how to reach it.">
          <UiSelect v-model="engine" :options="state.providers.map((p) => ({ label: p.name, value: p.name }))" />
        </UiField>

        <!-- Tool-level: set a connection up once and every app you point this at uses it. -->
        <div class="conns">
          <p v-if="!state.connections.length" class="muted">
            No connection yet. Ollama on this machine needs none; anything with an API key does.
          </p>
          <ul v-else class="connlist">
            <li v-for="c in state.connections" :key="c.id">
              <strong>{{ c.label }}</strong>
              <span class="muted">{{ c.provider ?? "custom" }}</span>
              <UiTag :intent="c.hasKey ? 'success' : 'secondary'">{{ c.hasKey ? "key set" : "no key" }}</UiTag>
            </li>
          </ul>
          <UiButton variant="secondary" @click="showEngines = !showEngines">
            {{ showEngines ? "Close" : state.connections.length ? "Add or edit a connection" : "Set up a connection" }}
          </UiButton>
        </div>

        <EngineSettings
          v-if="showEngines"
          :providers="state.providers"
          :connections="state.connections"
          @saved="enginesChanged"
          @close="showEngines = false"
        />
      </section>

      <section>
        <h2>Your name</h2>
        <UiField
          layout="block"
          hint="Recorded on every approval you make. Asked for rather than taken from your account, so a machine-made verdict can never be mistaken for yours."
        >
          <UiInput v-model="reviewer" placeholder="danel" />
        </UiField>
      </section>

      <section class="span-all">
        <h2>Glossary <span class="muted">— optional, and the most dangerous field here</span></h2>
        <p class="warn">
          A term here is also written into the prompt as <em>never translate this</em>, so the model applies it to forms
          the substitution never touches. Measured on a 1,965-key catalogue: adding <code>AI</code> turned
          <strong>48 correct translations into findings</strong>. Only add a word that must stay English
          <em>everywhere</em>, including mid-sentence.
        </p>
        <div v-if="found?.candidates.length" class="chips">
          <UiChip v-for="c in found.candidates" :key="c" :selected="glossary.includes(c)" @click="toggleTerm(c)">
            {{ c }}
          </UiChip>
        </div>
        <p v-else class="muted">
          {{ found ? "no recurring capitalised terms found" : "candidates from your own strings appear here" }}
        </p>
      </section>
    </div>

      <section v-if="found" class="span-all">
        <details>
          <summary class="muted">Add to your app's .gitignore</summary>
          <pre>{{ found.gitignore.join("\n") }}</pre>
        </details>
      </section>
    </div>
  </div>

  <footer class="setup__save">
    <UiButton size="large" :disabled="!canSave" @click="save">
      {{ saving ? "Saving…" : found?.exists ? "Save changes" : "Create config" }}
    </UiButton>
    <span v-if="found" class="muted">writes <code>{{ found.configPath }}</code></span>
    <span v-else class="muted">press <strong>Check</strong> to read your en.json — then this saves</span>
  </footer>
</template>

<style scoped>
/* Two rows: a scroller, and a save bar that never scrolls away. */
.setuptab {
  flex: 1 1 auto;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
}

/* One scroller for this area, sized by the flex parent — no height declared here. */
.setup {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
  padding: 1.25rem 1.5rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

/* Prose stays at a readable measure; ch is the unit that actually means "line length". */
.setup__source { max-inline-size: 70ch; }

/* auto-fit + minmax is the whole layout: the browser decides the column count from the space
   available, so there is no breakpoint to maintain and no width to guess wrong. */
.setup__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
  gap: 1.75rem 2.5rem;
  align-items: start;
}
.span-all { grid-column: 1 / -1; }


/* Out of the scroll flow: the primary action of the page is always reachable. */
.langgroup { margin-block: .6rem; }
.langlist { list-style: none; margin: .35rem 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr)); gap: .2rem .75rem; }
.langlist li { display: flex; align-items: center; gap: .45rem; font-size: .9rem; }
.langlist.scroll { max-block-size: 14rem; overflow-y: auto; padding-inline-end: .5rem; }
.langname { flex: 1 1 auto; min-inline-size: 0; }
.filter { max-inline-size: 18rem; }

.conns { margin-block-start: .75rem; display: flex; flex-direction: column; gap: .5rem; align-items: start; }
.connlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
.connlist li { display: flex; align-items: center; gap: .5rem; font-size: .9rem; }

.setup__save {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .75rem;
  padding: .75rem 1.5rem;
  border-block-start: 1px solid var(--border);
  background: var(--surface-1, var(--surface-2));
}

h2 { font-size: 1rem; margin: 0 0 .5rem; }
.row { display: flex; gap: .5rem; align-items: center; }
.grow { flex: 1 1 auto; min-inline-size: 0; }
.chips { display: flex; flex-wrap: wrap; gap: .4rem; margin-block: .4rem; }
.tags { display: flex; flex-wrap: wrap; gap: .4rem; margin-block-start: .5rem; }
.muted { color: var(--muted); font-size: .85rem; }
.bad { color: var(--danger-ink, crimson); font-size: .9rem; margin-block-start: .5rem; }
.warn {
  font-size: .85rem; line-height: 1.5; margin-block: .5rem;
  border-inline-start: 3px solid var(--warn-line); padding-inline-start: .75rem;
}
pre { font-size: .8rem; background: var(--surface-2); padding: .5rem; border-radius: 4px; overflow-x: auto; }
code { font-size: .85em; }
</style>
