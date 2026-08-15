import { describe, it, expect } from 'vitest';
import { parsePayload, toHex, formatBytes } from './payload';

const bytes = (result: ReturnType<typeof parsePayload>) => [...(result.bytes ?? [])];

describe('hex, one byte per token', () => {
  // the case from protobuf-net#934: unpadded single digits, as several tools print them
  it('reads unpadded single digits as whole bytes', () => {
    const result = parsePayload('8 1 10 4 18 6 20 8 28 0', 'hex');
    expect(bytes(result)).toEqual([0x08, 0x01, 0x10, 0x04, 0x18, 0x06, 0x20, 0x08, 0x28, 0x00]);
  });

  it('does not re-pair the digits across separators', () => {
    // the old behaviour produced 81 10 41 86 ... which is not what anyone wrote
    expect(bytes(parsePayload('8 1', 'hex'))).toEqual([0x08, 0x01]);
    expect(bytes(parsePayload('8 1', 'hex'))).not.toEqual([0x81]);
  });

  it('reads padded input identically to before', () => {
    expect(bytes(parsePayload('0A 02 68 69', 'hex'))).toEqual([0x0a, 0x02, 0x68, 0x69]);
  });

  it('accepts the dash-separated form this tool prints', () => {
    expect(bytes(parsePayload('0A-02-68-69', 'hex'))).toEqual([0x0a, 0x02, 0x68, 0x69]);
  });

  it('accepts commas, colons and 0x prefixes', () => {
    expect(bytes(parsePayload('0x08, 0x01, 0x10', 'hex'))).toEqual([0x08, 0x01, 0x10]);
    expect(bytes(parsePayload('08:01:10', 'hex'))).toEqual([0x08, 0x01, 0x10]);
  });

  it('accepts a lone short token', () => {
    expect(bytes(parsePayload('8', 'hex'))).toEqual([0x08]);
  });
});

describe('hex, falling back to pairing', () => {
  it('pairs an unseparated string', () => {
    expect(bytes(parsePayload('0A026869', 'hex'))).toEqual([0x0a, 0x02, 0x68, 0x69]);
  });

  it('pairs when any token is longer than two digits', () => {
    // mixed shapes are ambiguous per-token, so the whole input is compacted and paired
    expect(bytes(parsePayload('0A0268 69', 'hex'))).toEqual([0x0a, 0x02, 0x68, 0x69]);
  });

  it('rejects an odd number of digits when it cannot tokenise', () => {
    const result = parsePayload('ABC', 'hex');
    expect(result.bytes).toBeUndefined();
    expect(result.error).toMatch(/odd number of digits/);
  });

  it('names the offending character', () => {
    const result = parsePayload('0A 0Z', 'hex');
    expect(result.bytes).toBeUndefined();
    expect(result.error).toMatch(/'Z'/);
  });
});

describe('base-64', () => {
  it('decodes standard base-64', () => {
    expect(bytes(parsePayload('CgJoaQ==', 'base64'))).toEqual([0x0a, 0x02, 0x68, 0x69]);
  });

  it('decodes base64url and tolerates missing padding', () => {
    expect(bytes(parsePayload('CgJoaQ', 'base64'))).toEqual([0x0a, 0x02, 0x68, 0x69]);
  });

  it('reports an invalid character', () => {
    const result = parsePayload('not base64!!', 'base64');
    expect(result.bytes).toBeUndefined();
    expect(result.error).toMatch(/'!'/);
  });
});

describe('auto-detection', () => {
  it('picks hex for separated bytes, including odd total digit counts', () => {
    const result = parsePayload('8 1 10 4', 'auto');
    expect(result.format).toBe('hex');
    expect(bytes(result)).toEqual([0x08, 0x01, 0x10, 0x04]);
  });

  it('picks hex for a padded hex string', () => {
    expect(parsePayload('0A 02 68 69', 'auto').format).toBe('hex');
  });

  it('picks base-64 when the input is not hex', () => {
    const result = parsePayload('CgJoaRCWAQ==', 'auto');
    expect(result.format).toBe('base64');
    expect(bytes(result)).toEqual([0x0a, 0x02, 0x68, 0x69, 0x10, 0x96, 0x01]);
  });

  it('refuses empty input', () => {
    expect(parsePayload('   ', 'auto').error).toBe('nothing to decode');
  });
});

describe('helpers', () => {
  it('round-trips through toHex', () => {
    const original = '0A-02-68-69';
    expect(toHex(parsePayload(original, 'hex').bytes!)).toBe(original);
  });

  it('formats byte counts', () => {
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(2)).toBe('2 bytes');
    expect(formatBytes(2048)).toBe('2.0 KiB');
  });
});
