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
      // All API and auth routes go to the local Go backend
      '/api': {
        target: process.env.VITE_BACKEND_ORIGIN || 'http://localhost:18111',
        changeOrigin: true,
      },
      '/callback': {
        target: process.env.VITE_BACKEND_ORIGIN || 'http://localhost:18111',
        changeOrigin: true,
      },
      // MCP routes go directly to the Node MCP server (bypasses Worker)
      '/mcp': {
        target: process.env.MCP_SERVER_URL || 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '/sse': {
        target: process.env.MCP_SERVER_URL || 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
