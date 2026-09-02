import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist/admin',
    assetsDir: '_app',
    emptyOutDir: true,
    manifest: false,
    rollupOptions: {
      input: { admin: resolve(__dirname, 'admin/index.html') },
    },
  },
  resolve: { alias: { $lib: resolve(__dirname, 'admin/src/lib') } },
});
