import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@assets': fileURLToPath(new URL('../assets', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome120', assetsInlineLimit: 0 },
});
