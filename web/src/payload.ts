export type PayloadFormat = 'auto' | 'hex' | 'base64';

export interface ParseResult {
  bytes?: Uint8Array;
  /** which format was actually used; useful when the format was 'auto' */
  format?: 'hex' | 'base64';
  error?: string;
}

const HEX_CHARS = /^[0-9a-fA-F]+$/;
const BASE64_CHARS = /^[A-Za-z0-9+/\-_]*={0,2}$/;

/** Separators people put between hex bytes, including the `-` this tool's own output uses. */
const BYTE_SEPARATORS = /[\s,\-_:]+/;
const ONE_BYTE_TOKEN = /^[0-9a-fA-F]{1,2}$/;

/**
 * Reads separated hex where each token is one byte, including unpadded single digits:
 * `8 1 10 4` means `08 01 10 04`, not `81 10 41 86`.
 *
 * Several tools print bytes that way, and simply stripping the separators produces bytes the user
 * never wrote — which then fail somewhere deep in the wire format, blaming the payload rather than
 * the way it was read. Silently misreading input is worse than rejecting it.
 *
 * Only applies when *every* token is one or two hex digits, so it is unambiguous. Anything with a
 * longer run (`0A0268 69`, or an unseparated string) falls through to pairing, unchanged. Input
 * that is already padded (`0A 02 68 69`) reads identically under either rule.
 */
function tokeniseHexBytes(input: string): Uint8Array | undefined {
  const tokens = input
    .trim()
    .split(BYTE_SEPARATORS)
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/^0x/i, ''));

  if (tokens.length === 0 || !tokens.every((token) => ONE_BYTE_TOKEN.test(token))) return undefined;
  return Uint8Array.from(tokens, (token) => Number.parseInt(token, 16));
}

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
  if (tokeniseHexBytes(trimmed) || (HEX_CHARS.test(hexCandidate) && hexCandidate.length % 2 === 0)) {
    return parseHex(trimmed);
  }
  const base64Result = parseBase64(trimmed);
  if (base64Result.bytes) return base64Result;

  // neither worked; report against whichever the input more closely resembles
  return HEX_CHARS.test(hexCandidate) ? parseHex(trimmed) : base64Result;
}

function parseHex(input: string): ParseResult {
  const tokenised = tokeniseHexBytes(input);
  if (tokenised) return { bytes: tokenised, format: 'hex' };

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
