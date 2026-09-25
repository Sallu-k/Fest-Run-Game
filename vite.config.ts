import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps the built dist/ relocatable: serve the folder with any static
// server (python3 -m http.server) and it works offline.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
