// Mirrors the contracts in src/ProtoGen.Wasm/Contracts.cs (camelCase over the JSON boundary).

export interface GenerateRequest {
  schema: string;
  fileName: string;
  language: 'csharp' | 'vb';
  languageVersion?: string | null;
  namingConvention: 'auto' | 'noplural' | 'original';
  services: boolean;
  oneOfEnum: boolean;
  listSet: boolean;
  disableNullWrappers: boolean;
  disableCompatLevel: boolean;
  nullableValueType: boolean;
  repeatedAsList: boolean;
}

export interface GeneratedFile {
  name: string;
  text: string;
}

export interface SchemaError {
  isError: boolean;
  lineNumber: number;
  columnNumber: number;
  /** length of the offending token, for underlining; 0 when unknown */
  length: number;
  message: string;
  errorNumber: number;
  file: string;
}

export interface GenerateResponse {
  files: GeneratedFile[];
  errors: SchemaError[];
  exception?: string;
}

export interface Reading {
  kind: string;
  value: string;
  truncated: boolean;
  fullLength?: number;
}

export type Primary = 'message' | 'group' | 'string' | 'bytes' | 'scalar';

export interface Node {
  field: number;
  wireType: 'VARINT' | 'I64' | 'LEN' | 'SGROUP' | 'EGROUP' | 'I32' | string;
  /** absolute offset of the field tag within the whole payload */
  start: number;
  /** absolute offset just past this field */
  end: number;
  tagHex: string;
  lenPrefixHex?: string;
  valueHex?: string;
  endGroupHex?: string;
  length?: number;
  readings: Reading[];
  children?: Node[];
  childrenKind?: 'message' | 'group';
  primary: Primary;
  /** reads convincingly as more than one thing; the UI collapses these by default */
  speculative: boolean;
  looksPrintable: boolean;
  note?: string;
}

export interface DecodeResult {
  nodes: Node[];
  totalBytes: number;
  consumedBytes: number;
  error?: string;
  truncated: boolean;
}
