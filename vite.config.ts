import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: 'dist/admin',
    assetsDir: '_app',
    emptyOutDir: true,
    manifest: false,
    rollupOptions: {
      input: { admin: resolve(import.meta.dirname, 'admin/index.html') },
      output: {
        entryFileNames: '_app/admin.[hash].js',
        chunkFileNames: '_app/[name].[hash].js',
        assetFileNames: '_app/[name].[hash][extname]',
      },
    },
  },
  resolve: {
    alias: [
      { find: '$lib/utils', replacement: resolve(import.meta.dirname, 'admin/src/lib/utils') },
      { find: '$lib/components', replacement: resolve(import.meta.dirname, 'admin/src/lib/components') },
      { find: '$lib', replacement: resolve(import.meta.dirname, 'admin/src/lib') },
      { find: '$components', replacement: resolve(import.meta.dirname, 'admin/src/lib') },
    ],
  },
});
