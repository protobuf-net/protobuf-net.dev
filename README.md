# protogen site

The site behind **[protogen.marcgravell.com](https://protogen.marcgravell.com)**: generate C# and
VB.NET from `.proto` schemas, and pull apart raw protobuf payloads without a schema.

Everything runs in the browser. There is no server, no API and no upload — schemas and payloads
never leave the machine they were pasted on. The site is a folder of static files.

This replaces the older ASP.NET-hosted site that lived in the
[protobuf-net](https://github.com/protobuf-net/protobuf-net) repo under `src/protogen.site`.

## How it works

| Layer | What it is |
| --- | --- |
| `src/ProtoGen.Wasm` | .NET 10 targeting `net10.0-browser` via `Microsoft.NET.Sdk.WebAssembly` — **not** Blazor. Exposes three `[JSExport]` methods and nothing else. |
| `web` | Plain TypeScript + Vite. CodeMirror 6 for both editors. No UI framework. |

The schema work is done by the published [`protobuf-net.Reflection`](https://www.nuget.org/packages/protobuf-net.Reflection)
package — the same parser and generators as the `protogen` command-line tool. Imports of
`google/**` and `protobuf-net/**` resolve from resources embedded in that package, so the common
cases need no network access.

The payload decomposition is local to this repo (`WireWalker.cs`). It deliberately does not use
`ProtoReader`: an analysis tool needs exact byte offsets for every component and partial results on
malformed input, neither of which a serializer's reader is built to give.

Total download is roughly 1.7 MB brotli-compressed, most of which is the .NET runtime, cached
after first visit.

## Building

Requires the .NET 10 SDK and Node 20+.

```sh
cd web
npm install
npm run dev      # publishes the WASM project, then starts Vite on :5180
npm run build    # -> web/dist, ready to serve as static files
```

`npm run wasm` alone re-publishes the .NET side into `web/public/_framework`. That folder is
generated and git-ignored; it is copied verbatim rather than bundled, because the .NET boot process
resolves its own content-hashed filenames.

## Deployment

GitHub Actions builds on push to `main` and publishes `web/dist` to GitHub Pages
(`.github/workflows/deploy.yml`).

Three details that matter for Pages:

- The Vite build uses a **relative base**, so one artifact works both at the root of the custom
  domain and under the `/protogen-site/` subpath of the default `*.github.io` URL. Anything that
  resolves the .NET runtime at load time must go through `import.meta.env.BASE_URL`; a leading
  slash silently breaks the subpath case.
- `web/public/CNAME` carries the custom domain. It only takes effect once the domain is set in
  the repo's Pages settings *and* DNS has a `CNAME` record for `protogen` pointing at
  `protobuf-net.github.io`.
- `web/public/.nojekyll` stops Jekyll stripping the `_framework` directory, which would otherwise
  be ignored for starting with an underscore. The artifact-based deploy does not run Jekyll, but
  the file guards against a future switch to branch-based publishing.

## Scope

**C# and VB.NET only.** The old site also offered C++, Java, JavaScript, Objective-C, PHP, Python
and Ruby by shelling out to `protoc` on the server. `protoc` is a native executable and cannot run
client-side, so those targets are gone rather than quietly broken.

Compiling `protoc` itself to WebAssembly was investigated and parked. There is no maintained build:
`kwonoj/protobuf-wasm` and `mjz20/protobuf_wasm` patch the protobuf *runtime* for Emscripten and
explicitly do not build the compiler, and the one recent attempt at the compiler proper
([protobuf#20819](https://github.com/protocolbuffers/protobuf/issues/20819)) produces a `protoc.js`
that builds but fails code generation on path resolution. The real work is MEMFS plumbing for
`--proto_path` and generated outputs, unmaintained upstream, on top of a C++ binary that links
every language generator and would likely dwarf the .NET runtime.

If a target language is ever worth restoring, JavaScript/TypeScript is the cheap one: `protobufjs`
and `@bufbuild/protobuf` generate it in pure JS with no `protoc` involved.

See [`docs/trimming.md`](docs/trimming.md) for why the build suppresses `IL2104`.

## Licence

Apache-2.0, matching protobuf-net.
