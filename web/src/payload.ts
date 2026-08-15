export type PayloadFormat = 'auto' | 'hex' | 'base64';

export interface ParseResult {
  bytes?: Uint8Array;
  /** which format was actually used; useful when the format was 'auto' */
  format?: 'hex' | 'base64';
  error?: string;
}

const HEX_CHARS = /^[0-9a-fA-F]+$/;
const BASE64_CHARS = /^[A-Za-z0-9+/\-_]*={0,2}$/;

/** Strips whitespace and the separators people paste alongside hex (0x, commas, dashes). */
function compactHex(input: string): string {
  return input
    .replace(/0x/gi, '')
    .replace(/[\s,\-_:]/g, '');
}

function compactBase64(input: string): string {
  return input.replace(/\s/g, '');
}

export function parsePayload(input: string, format: PayloadFormat): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { error: 'nothing to decode' };

  if (format === 'hex') return parseHex(trimmed);
  if (format === 'base64') return parseBase64(trimmed);

  // auto: hex is the stricter grammar, so try it first and fall back to base64.
  const hexCandidate = compactHex(trimmed);
  if (HEX_CHARS.test(hexCandidate) && hexCandidate.length % 2 === 0) {
    return parseHex(trimmed);
  }
  const base64Result = parseBase64(trimmed);
  if (base64Result.bytes) return base64Result;

  // neither worked; report against whichever the input more closely resembles
  return HEX_CHARS.test(hexCandidate) ? parseHex(trimmed) : base64Result;
}

function parseHex(input: string): ParseResult {
  const compact = compactHex(input);
  if (!HEX_CHARS.test(compact)) {
    const bad = [...compact].find((c) => !/[0-9a-fA-F]/.test(c));
    return { error: `not valid hex: unexpected character '${bad}'` };
  }
  if (compact.length % 2 !== 0) {
    return { error: `not valid hex: odd number of digits (${compact.length})` };
  }
  const bytes = new Uint8Array(compact.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(compact.substring(i * 2, i * 2 + 2), 16);
  }
  return { bytes, format: 'hex' };
}

function parseBase64(input: string): ParseResult {
  let compact = compactBase64(input);
  if (!BASE64_CHARS.test(compact)) {
    const bad = [...compact].find((c) => !/[A-Za-z0-9+/\-_=]/.test(c));
    return { error: `not valid base-64: unexpected character '${bad}'` };
  }
  // accept base64url as well; atob only understands the standard alphabet
  compact = compact.replace(/-/g, '+').replace(/_/g, '/');
  if (compact.length % 4 !== 0) compact = compact.padEnd(compact.length + ((4 - (compact.length % 4)) % 4), '=');

  try {
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, format: 'base64' };
  } catch {
    return { error: 'not valid base-64' };
  }
}

export function toHex(bytes: Uint8Array, separator = '-'): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(separator);
}

export function formatBytes(count: number): string {
  if (count < 1024) return `${count} byte${count === 1 ? '' : 's'}`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KiB`;
  return `${(count / (1024 * 1024)).toFixed(1)} MiB`;
}
