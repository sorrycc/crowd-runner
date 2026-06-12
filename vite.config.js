import { defineConfig } from 'vite'

// Relative base so the production build runs from any sub-path or file:// preview.
export default defineConfig({
  base: './',
  server: { open: true },
})
