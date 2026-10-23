import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The example loads the SDK's TypeScript source (../src) through the alias below, not the published dist/,
// so SDK changes show up on reload without building the SDK. Vite must be allowed to read ../.
export default defineConfig({
  resolve: { alias: { '@rivium/storage-web': fileURLToPath(new URL('../src/index.ts', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
  },
  preview: { port: 4173, strictPort: true },
});
