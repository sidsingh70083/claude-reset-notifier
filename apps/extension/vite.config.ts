import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'path';
import { fileURLToPath } from 'url';
import manifest from './manifest.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@claude-reset/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  // Prevent Vite from mangling service worker global scope
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  build: {
    rollupOptions: {
      input: {
        // offscreen.html is never referenced in manifest.json — chrome.offscreen
        // documents are created programmatically at runtime (see
        // background/notifications/offscreen-manager.ts), so CRXJS's
        // manifest-based auto-detection never finds it. Without this explicit
        // entry, the file silently doesn't exist in the built extension and
        // chrome.offscreen.createDocument() fails at runtime pointing to a
        // path that was never bundled. Confirmed missing from dist/ before
        // adding this — not a guess.
        offscreen: path.resolve(__dirname, 'src/offscreen/offscreen.html'),
      },
    },
  },
});
