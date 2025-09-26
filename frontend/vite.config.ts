import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import cloudflare from '@cloudflare/vite-plugin'

const cloudflarePlugin = (cloudflare as unknown as () => PluginOption)()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflarePlugin],
})
