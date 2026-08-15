import { defineConfig } from 'vite';

export default defineConfig({
  // served from a custom domain at the root; change if this ever moves to a subpath
  base: '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    // the .NET runtime in public/_framework is already compressed and hashed by the SDK;
    // warning about its size every build is just noise
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5180,
  },
});
