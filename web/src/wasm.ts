import type { DecodeResult, GenerateRequest, GenerateResponse } from './types';

interface Interop {
  Generate(requestJson: string): string;
  Decode(data: Uint8Array, fullStrings: boolean): string;
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

export async function decode(data: Uint8Array, fullStrings: boolean): Promise<DecodeResult> {
  const interop = await loadInterop();
  return JSON.parse(interop.Decode(data, fullStrings)) as DecodeResult;
}

export async function engineVersion(): Promise<string> {
  const interop = await loadInterop();
  return interop.EngineVersion();
}
