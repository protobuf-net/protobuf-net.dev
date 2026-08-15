export interface Sample {
  id: string;
  label: string;
  schema: string;
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
];
