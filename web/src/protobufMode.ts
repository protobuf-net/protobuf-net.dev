import type { StreamParser } from '@codemirror/language';

// Based on @codemirror/legacy-modes/mode/protobuf (MIT, marijnh/codemirror5 contributors),
// which stops at early proto3: no oneof/map/group, and nothing from editions. This keeps the
// same trivial tokenizer with a keyword list that knows the whole language, editions included
// (edition, export/local visibility, import option's modifier, reserved to/max).
const keywordArray = [
  'package', 'message', 'import', 'syntax', 'edition',
  'required', 'optional', 'repeated', 'reserved', 'default', 'extensions', 'extend', 'packed',
  'oneof', 'map', 'group', 'to', 'max', 'public', 'weak', 'export', 'local',
  'bool', 'bytes', 'double', 'enum', 'float', 'string',
  'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64',
  'fixed32', 'fixed64', 'sfixed32', 'sfixed64',
  'option', 'service', 'rpc', 'returns', 'stream',
];
const keywords = new RegExp('^((' + keywordArray.join(')|(') + '))\\b');

const identifiers = /^[_A-Za-z\xa1-￿][_A-Za-z0-9\xa1-￿]*/;

export const protobuf: StreamParser<unknown> = {
  name: 'protobuf',
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match(/^[0-9.+-]/, false)) {
      if (stream.match(/^[+-]?0x[0-9a-fA-F]+/)) return 'number';
      if (stream.match(/^[+-]?\d*\.\d+([EeDd][+-]?\d+)?/)) return 'number';
      if (stream.match(/^[+-]?\d+([EeDd][+-]?\d+)?/)) return 'number';
    }

    if (stream.match(/^"([^"]|(""))*"/)) return 'string';
    if (stream.match(/^'([^']|(''))*'/)) return 'string';

    if (stream.match(keywords)) return 'keyword';
    if (stream.match(identifiers)) return 'variable';

    stream.next();
    return null;
  },
  languageData: {
    autocomplete: keywordArray,
  },
};
