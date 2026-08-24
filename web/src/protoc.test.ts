import { describe, expect, it } from 'vitest';
import { PROTOC_LANGUAGES, protocLanguage, protocValue, readResponse } from './protoc';

describe('language values', () => {
  it('round-trips every target', () => {
    for (const language of PROTOC_LANGUAGES) {
      expect(protocLanguage(protocValue(language))).toBe(language);
    }
  });

  it('does not claim the local generators', () => {
    // protoc has a csharp generator too, which is exactly why the values are namespaced
    expect(protocLanguage('csharp')).toBeUndefined();
    expect(protocLanguage('vb')).toBeUndefined();
  });

  it('ignores a target it does not offer', () => {
    expect(protocLanguage('protoc:fortran')).toBeUndefined();
  });
});

describe('readResponse', () => {
  it('reads a successful generation', () => {
    const response = readResponse(
      200,
      JSON.stringify({ files: [{ name: 'my_pb2.py', text: 'x = 1' }], errors: [] }),
    );
    expect(response.files).toEqual([{ name: 'my_pb2.py', text: 'x = 1' }]);
    expect(response.exception).toBeUndefined();
  });

  it('reads diagnostics, which are an answer rather than a failure', () => {
    const response = readResponse(
      200,
      JSON.stringify({
        files: [],
        errors: [{ isError: true, lineNumber: 2, columnNumber: 3, message: 'Expected ";".' }],
      }),
    );
    expect(response.errors).toHaveLength(1);
    expect(response.exception).toBeUndefined();
  });

  it('keeps an exception the service reports', () => {
    const response = readResponse(429, JSON.stringify({ files: [], errors: [], exception: 'too many requests' }));
    expect(response.exception).toBe('too many requests');
  });

  it('survives a reply that is not the service at all', () => {
    const response = readResponse(502, '<html>Bad gateway</html>');
    expect(response.files).toEqual([]);
    expect(response.exception).toContain('502');
    expect(response.exception).toContain('Bad gateway');
  });

  it('survives an empty body', () => {
    expect(readResponse(504, '').exception).toContain('504');
  });
});
