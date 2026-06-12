import { defineConfig } from 'vite'

// Relative base so the production build runs from any sub-path or file:// preview.
export default defineConfig({
  base: './',
  server: { open: true },
  // Emit every audio clip as a fingerprinted file (don't inline small ones as base64 in
  // the JS bundle) so they're cache-busted and the bundle stays lean — design 6.6.
  build: { assetsInlineLimit: 0 },
})
