import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * A build id for the .NET runtime, used to cache-bust `_framework/dotnet.js`.
 *
 * Every other file the runtime loads is content-hashed by the SDK, but `dotnet.js` is not — and it
 * is the file that *names* all the hashed ones. GitHub Pages serves it with `max-age=14400` and
 * offers no way to say otherwise per path, so a returning visitor can hold a four-hour-old
 * `dotnet.js` that asks for assemblies this deploy no longer has. That is a 404 during boot and a
 * site that never finishes loading, for exactly the people who have been here before.
 *
 * Hashing `dotnet.js` itself is the precise invalidation key: the hashed names are embedded in it,
 * so it changes when, and only when, something it loads does.
 */
function frameworkId(): string {
  try {
    const path = fileURLToPath(new URL('./public/_framework/dotnet.js', import.meta.url));
    return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 8);
  } catch {
    // nothing published yet: both `npm run dev` and `npm run build` publish first, so this is only
    // reached by running vite directly, where a stale cache is not a concern anyway
    return 'dev';
  }
}

export default defineConfig({
  // relative, so one build works both at the root of the custom domain and under the
  // /protogen-site/ subpath of the default *.github.io URL. Anything resolving the runtime at
  // load time must go through import.meta.env.BASE_URL rather than assuming a leading slash.
  base: './',
  define: {
    __FRAMEWORK_ID__: JSON.stringify(frameworkId()),
  },
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
