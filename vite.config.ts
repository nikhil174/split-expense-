import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Frontend lives in web/; the Worker serves the built files from dist/.
// Shown in the account menu so you can tell which build is live.
// Cloudflare's Git builds provide WORKERS_CI_COMMIT_SHA.
const commit = (process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || "local").slice(0, 7);
const built = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default defineConfig({
  root: "web",
  define: { __BUILD__: JSON.stringify(`${commit} · ${built}`) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    // Vendor code changes rarely; separate chunks stay cached across deploys.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "ui", test: /node_modules[\\/](@radix-ui|radix-ui|vaul|sonner|@floating-ui)[\\/]/ },
          ],
        },
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
