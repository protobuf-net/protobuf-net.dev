import { defineConfig } from 'vite';

export default defineConfig({
  // relative, so one build works both at the root of the custom domain and under the
  // /protogen-site/ subpath of the default *.github.io URL. Anything resolving the runtime at
  // load time must go through import.meta.env.BASE_URL rather than assuming a leading slash.
  base: './',
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
