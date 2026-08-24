import type {
  DecodeRequest,
  DecodeResult,
  GenerateRequest,
  GenerateResponse,
  SchemaTypesResult,
} from './types';

interface Interop {
  Generate(requestJson: string): string;
  Decode(data: Uint8Array, requestJson: string): string;
  SchemaTypes(requestJson: string): string;
  EmbeddedProto(path: string): string;
  EngineVersion(): string;
}

interface DotnetHost {
  create(): Promise<{
    getAssemblyExports(name: string): Promise<{ ProtoGen: { Wasm: { Interop: Interop } } }>;
    getConfig(): { mainAssemblyName: string };
  }>;
}

let interopPromise: Promise<Interop> | undefined;

/**
 * Boots the .NET runtime once and caches the result. `_framework` is emitted by the .NET SDK and
 * copied verbatim into public/, so it is loaded at runtime rather than bundled - the boot process
 * resolves its own content-hashed filenames and must not be rewritten by Vite.
 */
export function loadInterop(): Promise<Interop> {
  interopPromise ??= (async () => {
    // resolved against the document, not this module: the bundle lives under assets/, whereas
    // _framework sits beside index.html. BASE_URL keeps this correct whether the site is served
    // from a domain root or a subpath.
    const runtimeUrl = new URL(`${import.meta.env.BASE_URL}_framework/dotnet.js`, document.baseURI).href;
    const { dotnet } = (await import(/* @vite-ignore */ runtimeUrl)) as { dotnet: DotnetHost };

    const { getAssemblyExports, getConfig } = await dotnet.create();
    const exports = await getAssemblyExports(getConfig().mainAssemblyName);
    return exports.ProtoGen.Wasm.Interop;
  })();
  return interopPromise;
}

export async function generate(request: GenerateRequest): Promise<GenerateResponse> {
  const interop = await loadInterop();
  return JSON.parse(interop.Generate(JSON.stringify(request))) as GenerateResponse;
}

export async function decode(data: Uint8Array, request: DecodeRequest): Promise<DecodeResult> {
  const interop = await loadInterop();
  return JSON.parse(interop.Decode(data, JSON.stringify(request))) as DecodeResult;
}

/**
 * Lists the messages a schema declares, so the decode view can offer them as root types. The
 * engine remembers the last schema it parsed, so asking this and then decoding costs one parse.
 */
export async function schemaTypes(request: DecodeRequest): Promise<SchemaTypesResult> {
  const interop = await loadInterop();
  return JSON.parse(interop.SchemaTypes(JSON.stringify(request))) as SchemaTypesResult;
}

/** Reads a .proto embedded in protobuf-net.Reflection, e.g. "google/protobuf/descriptor.proto". */
export async function embeddedProto(path: string): Promise<string> {
  const interop = await loadInterop();
  return interop.EmbeddedProto(path);
}

export async function engineVersion(): Promise<string> {
  const interop = await loadInterop();
  return interop.EngineVersion();
}
