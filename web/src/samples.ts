export interface Sample {
  id: string;
  label: string;
  /** inline source; omitted when the sample is loaded from an embedded resource instead */
  schema?: string;
  /**
   * Import path of a .proto embedded in protobuf-net.Reflection. Used for samples too large to
   * be worth inlining into the bundle — and it guarantees the text matches what the import
   * resolver would use for the same path.
   */
  embedded?: string;
}

export const samples: Sample[] = [
  {
    id: 'basics',
    label: 'Basics — messages, enums, repeated',
    schema: `syntax = "proto3";

package tutorial;

message Person {
  string name = 1;
  int32 id = 2;
  string email = 3;

  enum PhoneType {
    PHONE_TYPE_UNSPECIFIED = 0;
    PHONE_TYPE_MOBILE = 1;
    PHONE_TYPE_HOME = 2;
    PHONE_TYPE_WORK = 3;
  }

  message PhoneNumber {
    string number = 1;
    PhoneType type = 2;
  }

  repeated PhoneNumber phones = 4;
}

message AddressBook {
  repeated Person people = 1;
}
`,
  },
  {
    id: 'wellknown',
    label: 'Well-known types — timestamps, wrappers, Any',
    schema: `syntax = "proto3";

import "google/protobuf/timestamp.proto";
import "google/protobuf/duration.proto";
import "google/protobuf/wrappers.proto";
import "google/protobuf/any.proto";

package events;

message Event {
  string id = 1;
  google.protobuf.Timestamp occurred_at = 2;
  google.protobuf.Duration elapsed = 3;

  // wrappers become nullable value types
  google.protobuf.Int32Value retry_count = 4;
  google.protobuf.StringValue correlation_id = 5;

  google.protobuf.Any payload = 6;
}
`,
  },
  {
    id: 'oneof-map',
    label: 'oneof and map',
    schema: `syntax = "proto3";

package shapes;

message Shape {
  oneof kind {
    Circle circle = 1;
    Rectangle rectangle = 2;
  }
  map<string, string> metadata = 3;
}

message Circle {
  double radius = 1;
}

message Rectangle {
  double width = 1;
  double height = 2;
}
`,
  },
  {
    id: 'grpc',
    label: 'gRPC service',
    schema: `syntax = "proto3";

package greet;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc SayHelloStream (HelloRequest) returns (stream HelloReply);
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
`,
  },
  {
    id: 'proto2',
    label: 'proto2 — optional, required, defaults, groups',
    schema: `syntax = "proto2";

package legacy;

message Order {
  required int32 id = 1;
  optional string customer = 2 [default = "unknown"];
  repeated int32 line_totals = 4 [packed = true];

  enum Status {
    PENDING = 0;
    SHIPPED = 1;
  }
  optional Status status = 5 [default = PENDING];
}
`,
  },
  {
    id: 'editions-2023',
    label: 'Editions 2023 — features, presence, delimited',
    schema: `edition = "2023";

package store;

message Order {
  // explicit presence is the editions default: generated code can tell
  // "absent" from "zero"
  int32 id = 1;
  string customer = 2 [default = "unknown"];

  // opt back in to proto3-style implicit presence, per field
  int32 revision = 3 [features.field_presence = IMPLICIT];

  // DELIMITED is the group wire format - protobuf-net's DataFormat.Group,
  // supported since protobuf-net v1; editions finally gives it a spelling
  Address delivery = 4 [features.message_encoding = DELIMITED];

  repeated int32 line_totals = 5;  // packed by default
  repeated int32 flags = 6 [features.repeated_field_encoding = EXPANDED];

  Status status = 7;
}

message Address {
  string line1 = 1;
  string postcode = 2;
}

// a closed enum keeps proto2 semantics; without the option, editions
// enums are open and must start at zero
enum Status {
  option features.enum_type = CLOSED;
  PENDING = 1;
  SHIPPED = 2;
}
`,
  },
  {
    id: 'editions-2024',
    label: 'Editions 2024 — symbol visibility',
    schema: `edition = "2024";

package catalog;

// edition 2024: 'export' and 'local' control which symbols other files
// may import; nested types default to local here
export message Product {
  string sku = 1;
  int32 quantity = 2;

  local enum Source {
    SOURCE_UNSPECIFIED = 0;
    SOURCE_WAREHOUSE = 1;
    SOURCE_DROPSHIP = 2;
  }
  Source source = 3;
}

local message InternalNote {
  string text = 1;
}

message Inventory {
  repeated Product products = 1;
  repeated InternalNote notes = 2;
}
`,
  },
  {
    id: 'protogen-options',
    label: 'protobuf-net options — control the generated C#',
    schema: `syntax = "proto3";

import "protobuf-net/protogen.proto";

package configured;

option (.protobuf_net.fileopt).namespace = "My.Company.Contracts";

message Customer {
  option (.protobuf_net.msgopt).name = "CustomerDto";

  string name = 1;
  int32 id = 2 [(.protobuf_net.fieldopt).name = "CustomerId"];
}
`,
  },
  {
    id: 'descriptor',
    label: 'descriptor.proto — the canonical schema',
    embedded: 'google/protobuf/descriptor.proto',
  },
];
