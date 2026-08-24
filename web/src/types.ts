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

  // from the schema, when one is applied

  /** the field's name in the schema */
  name?: string;
  /** how the schema declares it: "string", "repeated Person", "map<string, int32>" */
  declared?: string;
  /** fully-qualified name of the message the children were read as */
  messageType?: string;
  /** the oneof this field belongs to, if any */
  oneOf?: string;
  /** a schema was applied and does not declare this field number */
  unknown?: boolean;
  /** the field comes from an `extend` block rather than the message itself */
  extension?: boolean;
  /** set when the bytes cannot be what the schema says they are */
  mismatch?: string;
}

export interface DecodeRequest {
  fullStrings: boolean;
  /** optional .proto source; when present, fields are named and typed from it */
  schema?: string;
  fileName: string;
  /** the message the payload is an instance of, e.g. "tutorial.Person" */
  rootType?: string;
}

export interface DecodeResult {
  nodes: Node[];
  totalBytes: number;
  consumedBytes: number;
  error?: string;
  truncated: boolean;
  /** the message the top-level fields were read as; absent when no schema was applied */
  rootType?: string;
  /** nothing said which message this was, so it was inferred from the bytes */
  rootGuessed?: boolean;
  /** messages that fit exactly as well; present only when the tie went to declaration order */
  rootAlternatives?: string[];
  schemaErrors?: SchemaError[];
  /** why a supplied schema was not applied */
  schemaNote?: string;
  /** fields the schema does not declare */
  unknownFields: number;
}

/** The message types a schema declares, for the root-type picker. */
export interface SchemaTypesResult {
  types: string[];
  errors: SchemaError[];
  exception?: string;
}
