import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { fill, PARTS } from './site/partials.ts'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** The public pages share a header, footer and prices: <!-- site:name --> and {{NAME}} are filled from site/partials.ts. */
function site(): Plugin {
  return {
    name: 'site-partials',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => fill(html.replace(/<!--\s*site:(\w+)\s*-->/g, (match, name: string) => PARTS[name]?.() ?? match)),
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), svelte(), site()],
  build: {
    // The landing page and its siblings at the root, the app at /app.
    rolldownOptions: {
      input: {
        site: page('./index.html'),
        app: page('./app/index.html'),
        harga: page('./harga/index.html'),
        syarat: page('./syarat/index.html'),
        privasi: page('./privasi/index.html'),
        disclaimer: page('./disclaimer/index.html'),
      },
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    // The Bun API (web/server) runs on 3080 in dev.
    proxy: { '/api': 'http://127.0.0.1:3080' },
  },
})
