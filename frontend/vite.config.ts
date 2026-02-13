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
    host: true,
    port: 18110,
    hmr: {
      protocol: "wss",
      host: "jirathing14.dev.portnumber53.com",
      port: 443,
      clientPort: 443,
    },
    allowedHosts: [
      "jirathing14.dev.portnumber53.com",
      "jirathing16.dev.portnumber53.com",
      "mcp-jirathing14.dev.portnumber53.com",
      "mcp-jirathing16.dev.portnumber53.com",
    ],
    proxy: {
      // Proxy API requests to the Cloudflare Worker
      '/api': {
        target: 'https://mcp-jirathing14.dev.portnumber53.com',
        changeOrigin: true,
      },
      '/auth': {
        target: 'https://mcp-jirathing14.dev.portnumber53.com',
        changeOrigin: true,
      },
    },
  },
});
