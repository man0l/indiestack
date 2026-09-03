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
      input: { admin: resolve(__dirname, 'admin/index.html') },
      output: {
        entryFileNames: '_app/admin.js',
        chunkFileNames: '_app/[name].js',
        assetFileNames: '_app/[name][extname]',
      },
    },
  },
  resolve: {
    alias: [
      { find: '$lib/utils', replacement: resolve(__dirname, 'admin/src/lib/utils') },
      { find: '$lib/components', replacement: resolve(__dirname, 'admin/src/lib/components') },
      { find: '$lib', replacement: resolve(__dirname, 'admin/src/lib') },
      { find: '$components', replacement: resolve(__dirname, 'admin/src/lib') },
    ],
  },
});
