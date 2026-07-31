import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Standard Vite layout: index.html and this config at the project root, code in src/.
// `root` is set explicitly because the config is invoked from the repo root
// (`vite build --config ui/vite.config.js`) so that one package.json serves both halves.
export default defineConfig({
	root: here("."),
	plugins: [vue()],
	resolve: {
		alias: {
			// The shared kit, consumed FROM SOURCE via a path alias — the same mechanism
			// JustWrite uses. @delebash/llm-ui is private and unpublished, so this is the only
			// route. It is also why dist/ is committed: running the tool needs neither this
			// sibling repo nor an install.
			"@delebash/llm-ui": here("../../just-llm-runner/ui/src"),
			"@": here("./src"),
		},
	},
	build: {
		outDir: here("dist"),
		emptyOutDir: true,
		// Fixed names, so the committed diff is legible and the freshness hash is stable.
		rollupOptions: { output: { entryFileNames: "app.js", chunkFileNames: "app-[name].js", assetFileNames: "app.[ext]" } },
	},
});
