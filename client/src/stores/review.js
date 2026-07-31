// The review store. One place holding the queue, the filters, the selection and the job, so
// every component reads the same truth and a mutation refreshes everything at once.

import { computed, reactive, ref } from "vue";
import { defineStore } from "pinia";
import { api, jobStream } from "@/services/api.js";

/** Bucket definitions for the queue. `match` decides which rows a bucket contains. */
export const BUCKETS = [
	{ id: "needs", label: "Needs review", match: (r) => r.flags.some((f) => !f.advisory) },
	{ id: "unsure", label: "Unsure", match: (r) => r.flags.some((f) => f.code === "disagreement") },
	{ id: "terminology", label: "Terminology", match: (r) => r.flags.some((f) => f.code === "terminology") },
	{ id: "missing", label: "Missing", match: (r) => r.flags.some((f) => f.code === "missing") },
	{ id: "proposals", label: "Proposed", match: (r) => r.hasProposal },
	{ id: "all", label: "All flagged", match: () => true },
];

export const useReview = defineStore("review", () => {
	const rows = ref([]);
	const counts = ref({});
	const langs = ref([]);
	const progress = ref({});
	const proposalCounts = ref({});
	const accepted = ref([]);
	const loading = ref(false);
	const error = ref(null);

	const lang = ref(null); // null = every language, the default
	const bucket = ref("needs");
	const code = ref(null); // a specific check code within the bucket
	const search = ref("");
	const selectedKey = ref(null);
	const selectedLang = ref(null);

	const job = reactive({ active: null, done: 0, total: 0, state: null, error: null });

	/** The rows the list actually shows, after bucket, code and search. */
	const visible = computed(() => {
		const b = BUCKETS.find((x) => x.id === bucket.value) ?? BUCKETS.at(-1);
		const q = search.value.trim().toLowerCase();
		return rows.value.filter((r) => {
			if (!b.match(r)) return false;
			if (code.value && !r.flags.some((f) => f.code === code.value)) return false;
			if (!q) return true;
			return r.key.toLowerCase().includes(q) || r.source.toLowerCase().includes(q) || r.target.toLowerCase().includes(q);
		});
	});

	const selected = computed(() => visible.value.find((r) => r.key === selectedKey.value && r.lang === selectedLang.value) ?? null);

	const bucketCounts = computed(() =>
		Object.fromEntries(BUCKETS.map((b) => [b.id, rows.value.filter((r) => b.match(r)).length])),
	);

	function select(row) {
		selectedKey.value = row?.key ?? null;
		selectedLang.value = row?.lang ?? null;
	}

	/** Moves the selection by `delta` within the visible list — the j/k path. */
	function move(delta) {
		const list = visible.value;
		if (!list.length) return;
		const i = list.findIndex((r) => r.key === selectedKey.value && r.lang === selectedLang.value);
		select(list[Math.min(list.length - 1, Math.max(0, (i === -1 ? 0 : i) + delta))]);
	}

	async function refresh() {
		loading.value = true;
		error.value = null;
		try {
			const [s, r] = await Promise.all([api.state(), api.rows(lang.value)]);
			langs.value = s.langs;
			progress.value = s.progress ?? {};
			proposalCounts.value = s.proposals ?? {};
			rows.value = r.rows;
			counts.value = r.counts;
			// Keep the selection if it survived the refresh; otherwise take the first row, so
			// the panel is never blank while there is work.
			if (!selected.value) select(visible.value[0] ?? null);
		} catch (e) {
			error.value = e.message;
		} finally {
			loading.value = false;
		}
	}

	async function loadAccepted() {
		if (!langs.value.length) return;
		const l = lang.value ?? langs.value[0];
		accepted.value = (await api.accepted(l)).entries;
	}

	/** Every mutation refreshes, so counts and buckets can never drift from the files. */
	const mutate = async (fn) => {
		await fn();
		await refresh();
	};

	const save = (row, value) => mutate(() => api.save(row.lang, row.key, value));
	const accept = (row) => mutate(() => api.accept(row.lang, row.key));
	const unaccept = (row) => mutate(() => api.unaccept(row.lang, row.key));
	const undo = () => mutate(() => api.undo(lang.value));
	const note = (row, text) => mutate(() => api.note(row.lang, row.key, text));
	const applyProposal = (row) => mutate(() => api.applyProposals(row.lang, [row.key]));
	const discardProposal = (row) => mutate(() => api.discardProposals(row.lang, [row.key]));

	/** Starts a bulk run. Results arrive as proposals, never as writes. */
	async function startJob({ scope, connectionId, keys = null }) {
		const l = lang.value ?? langs.value[0];
		const { job: j } = await api.startJob({ lang: l, scope, connectionId, keys });
		Object.assign(job, { active: j.id, done: 0, total: j.total, state: j.state, error: null });
	}

	async function cancelJob() {
		await api.cancelJob();
	}

	/** Attaches to the job stream. Called once at boot, so a reload rejoins a running job. */
	function watchJob() {
		return jobStream((type, data) => {
			if (type === "hello" && data) Object.assign(job, { active: data.id, done: data.done, total: data.total, state: data.state });
			if (type === "start") Object.assign(job, { active: data.job.id, done: 0, total: data.job.total, state: "running", error: null });
			if (type === "progress") Object.assign(job, { done: data.done, total: data.total });
			if (type === "error") job.error = data.message;
			if (type === "done") {
				Object.assign(job, { state: data.job?.state ?? "done", active: null });
				refresh();
			}
		});
	}

	return {
		rows, counts, langs, progress, proposalCounts, accepted, loading, error,
		lang, bucket, code, search, selectedKey, selectedLang, job,
		visible, selected, bucketCounts,
		select, move, refresh, loadAccepted,
		save, accept, unaccept, undo, note, applyProposal, discardProposal,
		startJob, cancelJob, watchJob,
	};
});
