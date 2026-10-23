import { defineConfig } from 'vite';

// The SDK is linked from ../ (file:../) and Vite loads its TypeScript source (../src) directly,
// so SDK changes show up on reload without building the SDK. Vite must be allowed to read ../.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
  },
  preview: { port: 4173, strictPort: true },
});
