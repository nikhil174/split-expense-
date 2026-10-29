import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Frontend lives in web/; the Worker serves the built files from dist/.
export default defineConfig({
  root: "web",
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
