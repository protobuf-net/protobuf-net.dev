/**
 * Schema-and-payload pairs for the decode view.
 *
 * A payload on its own demonstrates the guessing; the point of these is the pair, so loading one
 * has to fill in the schema, the root type and the bytes together or it shows nothing.
 */
export interface DecodeSample {
  id: string;
  label: string;
  schema: string;
  /** the message the payload is an instance of */
  rootType: string;
  /** hex, as the payload box accepts it */
  payload: string;
}

export const decodeSamples: DecodeSample[] = [
  {
    id: 'person',
    label: 'Person — names, enums, nested messages, a map',
    rootType: 'tutorial.Person',
    schema: `syntax = "proto3";

package tutorial;

message Person {
  string name = 1;
  int32 id = 2;
  string email = 3;
  repeated PhoneNumber phones = 4;
  map<string, string> labels = 5;

  enum PhoneType {
    PHONE_TYPE_UNSPECIFIED = 0;
    PHONE_TYPE_MOBILE = 1;
    PHONE_TYPE_HOME = 2;
  }

  message PhoneNumber {
    string number = 1;
    PhoneType type = 2;
  }
}
`,
    payload:
      '0A 0C 41 64 61 20 4C 6F 76 65 6C 61 63 65 10 97 0E 1A 0F 61 64 61 40 65 78 61 6D 70 6C ' +
      '65 2E 63 6F 6D 22 0C 0A 08 35 35 35 2D 34 38 31 36 10 01 22 0C 0A 08 35 35 35 2D 30 31 ' +
      '30 30 10 02 2A 11 0A 04 74 65 61 6D 12 09 61 6E 61 6C 79 74 69 63 73',
  },
  {
    id: 'skew',
    label: 'Version skew — a payload with fields the schema has never heard of',
    rootType: 'metrics.Sample',
    schema: `syntax = "proto3";

package metrics;

// Fields 9 and 10 are in the payload but not here, the way a service that has moved on
// from the schema you have to hand would send them.
message Sample {
  repeated int32 buckets = 1;
  double total = 2;
  bytes checksum = 3;
}
`,
    payload:
      '0A 05 04 9A 05 2A 00 11 00 00 00 00 00 64 89 40 1A 04 DE AD BE EF 4A 0B 63 6F 6C 6C 65 ' +
      '63 74 6F 72 2D 37 50 01',
  },
];
