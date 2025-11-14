import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
  server: {
    port: 18110,
    proxy: {
      // Proxy API requests to the Cloudflare Worker
      '/api': {
        target: 'http://localhost:18112',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:18112',
        changeOrigin: true,
      },
    },
  },
});
