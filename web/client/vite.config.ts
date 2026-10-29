import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  server: {
    port: 5180,
    strictPort: true,
    // The Bun API (web/server) runs on 3080 in dev.
    proxy: { '/api': 'http://127.0.0.1:3080' },
  },
})
