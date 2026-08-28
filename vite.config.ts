import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	// Relative asset paths so the build works from a GitHub Pages subpath
	// (https://<user>.github.io/<repo>/) without hardcoding the repo name.
	base: "./",
});
