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
    hmr: process.env.VITE_HMR_HOST
      ? { protocol: "wss", host: process.env.VITE_HMR_HOST, port: 443, clientPort: 443 }
      : true,
    allowedHosts: [
      "jirathing14.dev.portnumber53.com",
      "jirathing16.dev.portnumber53.com",
      "mcp-jirathing14.dev.portnumber53.com",
      "mcp-jirathing16.dev.portnumber53.com",
    ],
    proxy: {
      // Auth routes are handled by the wrangler worker (handleFrontendFetch)
      '/api/auth': {
        target: 'http://localhost:18112',
        changeOrigin: true,
      },
      '/callback': {
        target: 'http://localhost:18112',
        changeOrigin: true,
      },
      // Other API routes go to the Go backend
      '/api': {
        target: 'https://api-jirathing14.dev.portnumber53.com',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:18112',
        changeOrigin: true,
      },
    },
  },
});
