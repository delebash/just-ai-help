import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			// The shared kit, consumed FROM SOURCE via a path alias — the same mechanism
			// JustWrite uses (justwrite-app/vite.config.js:31). @delebash/llm-ui is private and
			// unpublished, so this is the only route today. That is why dist/ is committed:
			// anyone can RUN the tool without this sibling repo, and only developing the UI
			// needs it.
			"@delebash/llm-ui": here("../../just-llm-runner/ui/src"),
			"@": here("./src"),
		},
	},
	build: {
		// Served by src/server.js as static files.
		outDir: "dist",
		emptyOutDir: true,
		// One file each, so the committed diff is legible and the freshness hash is stable.
		rollupOptions: {
			output: {
				entryFileNames: "app.js",
				chunkFileNames: "app-[name].js",
				assetFileNames: "app.[ext]",
			},
		},
	},
});
