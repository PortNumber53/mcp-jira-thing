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
      // All API and auth routes go to the Go backend
      '/api': {
        target: 'https://api-jirathing14.dev.portnumber53.com',
        changeOrigin: true,
      },
      '/callback': {
        target: 'https://api-jirathing14.dev.portnumber53.com',
        changeOrigin: true,
      },
    },
  },
});
