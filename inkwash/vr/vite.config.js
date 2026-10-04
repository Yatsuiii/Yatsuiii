import { defineConfig } from 'vite';

// base './' so the built page works from any folder, such as a GitHub Pages project path.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
});
