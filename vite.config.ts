import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/ unless a custom domain is set.
  base: process.env.PIPEDREAMZ_BASE ?? '/PipeDreamz/',
  server: {
    port: 4000,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
