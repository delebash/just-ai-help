import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Standard Vite layout: index.html and this config at the package root, code in src/.
// client/ is its own npm package with its own node_modules, so vite runs from here and needs
// no root override — `npm run build:client` at the repo root just delegates via --prefix.
export default defineConfig({
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
		outDir: "dist",
		emptyOutDir: true,
		// Fixed names, so the committed diff is legible and the freshness hash is stable.
		rollupOptions: { output: { entryFileNames: "app.js", chunkFileNames: "app-[name].js", assetFileNames: "app.[ext]" } },
	},
});
