import type { GenerateResponse } from './types';
import type { LanguageName } from './editor';

/**
 * The language targets that come from Google's compiler rather than from protobuf-net.
 *
 * protoc is a native executable, so unlike everything else on this site these cannot run in the
 * browser: the schema is posted to protoc.protobuf-net.dev, which runs protoc in a container and
 * hands back what it wrote. That service carries the same .proto corpus protobuf-net.Reflection
 * embeds, so an import that resolves locally resolves there too.
 *
 * See https://github.com/protobuf-net/protoc.protobuf-net.dev.
 */
const ENDPOINT: string = import.meta.env['VITE_PROTOC_ENDPOINT'] ?? 'https://protoc.protobuf-net.dev';

/** The single virtual file the service compiles; it names the diagnostics that come back, too. */
export const SCHEMA_FILE = 'my.proto';

/** Namespaces the picker's values: protoc's `csharp` is not protobuf-net's `csharp`. */
const PREFIX = 'protoc:';

export interface ProtocLanguage {
  /** what the service calls it */
  id: string;
  /** what the picker shows */
  label: string;
  /** how the output pane highlights it */
  editor: LanguageName;
}

export const PROTOC_LANGUAGES: readonly ProtocLanguage[] = [
  { id: 'cpp', label: 'C++', editor: 'cpp' },
  // Google's C# generator, which emits Google.Protobuf types — a genuinely different answer to
  // the same question as the C# above it, and worth being able to compare against
  { id: 'csharp', label: 'C# (Google.Protobuf)', editor: 'csharp' },
  { id: 'java', label: 'Java', editor: 'java' },
  { id: 'kotlin', label: 'Kotlin', editor: 'kotlin' },
  { id: 'objc', label: 'Objective-C', editor: 'objectiveC' },
  { id: 'php', label: 'PHP', editor: 'php' },
  { id: 'python', label: 'Python', editor: 'python' },
  { id: 'ruby', label: 'Ruby', editor: 'ruby' },
];

/** The picker value for a target, e.g. `protoc:cpp`. */
export function protocValue(language: ProtocLanguage): string {
  return PREFIX + language.id;
}

/** The target a picker value names, or undefined when it is one of the local generators. */
export function protocLanguage(value: string): ProtocLanguage | undefined {
  if (!value.startsWith(PREFIX)) return undefined;
  const id = value.slice(PREFIX.length);
  return PROTOC_LANGUAGES.find((language) => language.id === id);
}

/**
 * Reads the service's answer. It replies with a GenerateResponse whether the schema compiled or
 * not — a schema that does not compile is an answer, not a failure — but anything between here
 * and there (a cold start that times out, a proxy, an outage) will reply with something else
 * entirely, so the body is not assumed to be JSON.
 */
export function readResponse(status: number, body: string): GenerateResponse {
  let parsed: Partial<GenerateResponse> | undefined;
  try {
    parsed = JSON.parse(body) as Partial<GenerateResponse>;
  } catch {
    parsed = undefined;
  }

  if (!parsed || !Array.isArray(parsed.files) || !Array.isArray(parsed.errors)) {
    const detail = body.trim().slice(0, 200) || '(no detail)';
    return { files: [], errors: [], exception: `protoc.protobuf-net.dev replied ${status}: ${detail}` };
  }
  return { files: parsed.files, errors: parsed.errors, ...(parsed.exception ? { exception: parsed.exception } : {}) };
}

export async function generateWithProtoc(
  language: ProtocLanguage,
  schema: string,
  signal: AbortSignal,
): Promise<GenerateResponse> {
  const response = await fetch(`${ENDPOINT}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      language: language.id,
      files: { [SCHEMA_FILE]: schema },
      entry: [SCHEMA_FILE],
    }),
    signal,
  });
  return readResponse(response.status, await response.text());
}
