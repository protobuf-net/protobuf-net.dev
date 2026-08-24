# protobuf-net.dev

The site behind **[protobuf-net.dev](https://protobuf-net.dev)**: generate C# and
VB.NET from `.proto` schemas, reach `protoc` for the languages Google's compiler provides, and
pull apart raw protobuf payloads without a schema.

The site is a folder of static files. C#, VB.NET and payload decoding run in the browser through
WebAssembly, so a schema or payload pasted into either of those never leaves the machine it was
pasted on. The `protoc` targets are the exception and cannot be otherwise — `protoc` is a native
executable — so they are compiled by
[protoc.protobuf-net.dev](https://github.com/protobuf-net/protoc.protobuf-net.dev), and only when
the user picks one of those languages and presses Generate.

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
npm test         # vitest, unit tests for the payload parsing
npm run build    # wasm + typecheck + tests + bundle -> web/dist
```

The `protoc` targets point at the live service by default. To develop against a local one, set
`VITE_PROTOC_ENDPOINT` — `VITE_PROTOC_ENDPOINT=http://localhost:8787 npm run dev` alongside
`wrangler dev` in the
[service repo](https://github.com/protobuf-net/protoc.protobuf-net.dev).

`npm run wasm` alone re-publishes the .NET side into `web/public/_framework`. That folder is
generated and git-ignored; it is copied verbatim rather than bundled, because the .NET boot process
resolves its own content-hashed filenames.

## Updating protobuf-net.Reflection

The engine version is shown in the site footer, so what is deployed is always checkable.

### A version bump with no new options

Most updates — parser fixes, better generated code — need one line:

```sh
# src/ProtoGen.Wasm/ProtoGen.Wasm.csproj
<PackageReference Include="protobuf-net.Reflection" Version="3.3.9" />
```

Commit, push to `main`, done. Worth building locally first (`cd web && npm run build`), because a
new version can change generated output or surface fresh trim warnings — and `TreatWarningsAsErrors`
means a new warning fails the build rather than shipping quietly.

Two NuGet timing traps when bumping on release day: the package's *dependencies*
(`protobuf-net.Core`) index separately and can lag it by a few minutes, and a restore attempted
before everything indexed leaves a stale negative result in the local cache — `NU1102` with a
confidently wrong "nearest version", even after the package is live. `dotnet nuget locals
http-cache --clear` fixes the second.

### A version bump that adds language syntax

When the *language* grows — editions was the big one — the bump alone makes parsing and codegen
work, but two things in `web/src` describe the language independently and need to keep up:

| File | What to add |
| --- | --- |
| `web/src/samples.ts` | a sample showing the new syntax (inline `schema`, or `embedded` naming a `.proto` that ships inside protobuf-net.Reflection) |
| `web/src/protobufMode.ts` | any new keywords, so the editor highlights them |

`protobufMode.ts` is a local copy of the trivial `@codemirror/legacy-modes` protobuf tokenizer —
vendored precisely because the upstream keyword list stops at early proto3 (it predates even
`oneof` and `map`), and a sample demonstrating new syntax looks broken when its keywords render
as plain identifiers.

### A version bump that adds a generator option

`CodeGenerator.Generate` takes an options dictionary, so new switches need wiring through five
places. All mechanical, but missing one leaves an option that renders and does nothing:

| File | What to add |
| --- | --- |
| `src/ProtoGen.Wasm/Contracts.cs` | property on `GenerateRequest` |
| `src/ProtoGen.Wasm/Codegen.cs` | mapping in `BuildOptions` to the option key protobuf-net expects |
| `web/src/types.ts` | matching field on the `GenerateRequest` interface |
| `web/index.html` | the control, inside `#schema-options`, with `name` matching the property |
| `web/src/schema.ts` | read it in `buildRequest` |

Checkboxes are read with `data.has(name)`, so if the `name` attribute matches the property, the
last step is a single line.

Check the option key against protobuf-net's own generator rather than guessing — the names on the
wire (`listset`, `nullwrappers`, `compatlevel`) do not always match the UI wording.

## Deployment

GitHub Actions builds on push to `main` and publishes `web/dist` to GitHub Pages
(`.github/workflows/deploy.yml`). There is no manual step: push, and roughly two minutes later it
is live.

`index.html` is served with `Cache-Control: max-age=600`, so a returning visitor can see the
previous version for up to ten minutes. Everything else is content-hashed and updates immediately.

Three details that matter for Pages:

- The Vite build uses a **relative base**, so one artifact works both at the root of the custom
  domain and under the `/protobuf-net.dev/` subpath of the default `*.github.io` URL. Anything that
  resolves the .NET runtime at load time must go through `import.meta.env.BASE_URL`; a leading
  slash silently breaks the subpath case.
- `web/public/CNAME` names the custom domain. With artifact-based deploys this file does not by
  itself change anything — the domain in the repo's Pages settings is what takes effect. Keep them
  in agreement.
- `web/public/.nojekyll` stops Jekyll stripping the `_framework` directory, which would otherwise
  be ignored for starting with an underscore. The artifact-based deploy does not run Jekyll, but
  the file guards against a future switch to branch-based publishing.

### DNS for the apex domain

`protobuf-net.dev` is an apex (naked) domain, so it cannot use a `CNAME` record — that is only
valid for subdomains. Point it at GitHub's Pages addresses instead:

```
A     protobuf-net.dev    185.199.108.153
A     protobuf-net.dev    185.199.109.153
A     protobuf-net.dev    185.199.110.153
A     protobuf-net.dev    185.199.111.153

AAAA  protobuf-net.dev    2606:50c0:8000::153
AAAA  protobuf-net.dev    2606:50c0:8001::153
AAAA  protobuf-net.dev    2606:50c0:8002::153
AAAA  protobuf-net.dev    2606:50c0:8003::153
```

If the DNS host supports `ALIAS`/`ANAME` at the apex, a single record to `protobuf-net.github.io`
is preferable — it tracks GitHub's addresses if they ever change.

Optionally add `CNAME  www  protobuf-net.github.io`; GitHub redirects `www` to the apex.

`.dev` is on the HSTS preload list, so browsers will only ever load this over HTTPS. GitHub
provisions the certificate automatically once DNS resolves; until then the site is unreachable on
the custom domain, which is why the domain should be set in Pages settings *after* the records
are live.

## Scope

**C# and VB.NET locally; everything else through `protoc`.** protobuf-net generates the first two,
in the browser. C++, Java, Kotlin, Objective-C, PHP, Python, Ruby and Google's own C# come from
`protoc`, which is a native executable and cannot run client-side, so they are compiled by
[protoc.protobuf-net.dev](https://github.com/protobuf-net/protoc.protobuf-net.dev) — a Cloudflare
Worker in front of a container. That repository documents the service; what matters here is the
contract:

- `web/src/protoc.ts` holds the target list, the endpoint and the response reader. Adding a target
  protoc already supports means one entry there and one in the service's own table.
- The service answers with the same `GenerateResponse` shape the WebAssembly path returns, so both
  render through `applyResponse` in `web/src/schema.ts` and there is one code path for output,
  diagnostics and the editor gutter.
- Nothing is sent while typing. Choosing a `protoc` target generates once, because choosing it is
  the decision to use it; after that the output is marked stale on edit and re-sent only when the
  user presses Generate.
- The service carries the same `.proto` corpus that `protobuf-net.Reflection` embeds, so imports of
  `google/**` and `protobuf-net/**` resolve identically on both paths. Nothing about imports is
  sent from here.

Compiling `protoc` itself to WebAssembly — which would have avoided the server altogether — was
investigated and parked. There is no maintained build: `kwonoj/protobuf-wasm` and
`mjz20/protobuf_wasm` patch the protobuf *runtime* for Emscripten and explicitly do not build the
compiler, and the one recent attempt at the compiler proper
([protobuf#20819](https://github.com/protocolbuffers/protobuf/issues/20819)) produces a `protoc.js`
that builds but fails code generation on path resolution. The real work is MEMFS plumbing for
`--proto_path` and generated outputs, unmaintained upstream, on top of a C++ binary that links
every language generator and would likely dwarf the .NET runtime. If that ever lands, the service
becomes unnecessary rather than merely unfortunate.

JavaScript and TypeScript are on neither list: `protoc` dropped its JavaScript generator in v21.
`protobufjs` and `@bufbuild/protobuf` generate both in pure JS, so that one belongs back in the
browser if it is ever worth having.

PHP output is not syntax-highlighted. `@codemirror/legacy-modes` has no PHP mode, and
`@codemirror/lang-php` brings the HTML, CSS and JavaScript parsers with it — too much weight for
colouring output that is read once and copied.

See [`docs/trimming.md`](docs/trimming.md) for why the build suppresses `IL2104`.

## Licence

Apache-2.0, matching protobuf-net.
