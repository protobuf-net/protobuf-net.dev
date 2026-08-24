using System.Text.Json.Serialization;

namespace ProtoGen.Wasm;

// ---- binary decode ----

/// <summary>What the caller asks of a decode: the payload's shape, and optionally its schema.</summary>
internal sealed class DecodeRequest
{
    public bool FullStrings { get; set; }

    /// <summary>Optional .proto source. When present, fields are named and typed from it.</summary>
    public string? Schema { get; set; }

    public string FileName { get; set; } = "payload.proto";

    /// <summary>
    /// The message the payload is an instance of, e.g. <c>tutorial.Person</c>. Without it a schema
    /// cannot be applied: nothing in the bytes says which message they are.
    /// </summary>
    public string? RootType { get; set; }
}

/// <summary>How values are rendered. The walker knows about these; it knows nothing about .proto text.</summary>
internal sealed class DecodeOptions
{
    public bool FullStrings { get; set; }
    public int StringPreviewLength { get; set; } = 48;
    public int MaxHexBytes { get; set; } = 64;
}

internal sealed class DecodeResult
{
    public List<Node> Nodes { get; set; } = [];
    public int TotalBytes { get; set; }
    public int ConsumedBytes { get; set; }
    public string? Error { get; set; }
    public bool Truncated { get; set; }

    /// <summary>The message the top-level fields were read as; null when no schema was applied.</summary>
    public string? RootType { get; set; }

    /// <summary>Diagnostics from parsing the schema, if one was supplied.</summary>
    public List<SchemaError>? SchemaErrors { get; set; }

    /// <summary>Why a supplied schema was not applied — an unknown root type, or a parse failure.</summary>
    public string? SchemaNote { get; set; }

    /// <summary>Fields the schema does not declare. Worth surfacing: it usually means a version skew.</summary>
    public int UnknownFields { get; set; }
}

internal sealed class Node
{
    public int Field { get; set; }
    public string WireType { get; set; } = "";

    /// <summary>Absolute offset of the field tag within the whole payload.</summary>
    public int Start { get; set; }

    /// <summary>Absolute offset just past this field.</summary>
    public int End { get; set; }

    public string TagHex { get; set; } = "";
    public string? LenPrefixHex { get; set; }
    public string? ValueHex { get; set; }
    public string? EndGroupHex { get; set; }

    /// <summary>Byte count of a length-delimited payload; null for other wire types.</summary>
    public int? Length { get; set; }

    public List<Reading> Readings { get; set; } = [];

    public List<Node>? Children { get; set; }

    /// <summary>"message" or "group"; null when there are no children.</summary>
    public string? ChildrenKind { get; set; }

    /// <summary>
    /// What this field actually is: "message", "group", "string", "bytes" or "scalar". With a
    /// schema this is known; without one the wire format cannot distinguish these, so it is a
    /// heuristic and the UI should let the user see the alternatives.
    /// </summary>
    public string Primary { get; set; } = "scalar";

    /// <summary>
    /// True when the payload reads convincingly as more than one thing — typically valid UTF-8 text
    /// that also happens to parse as a message. The UI collapses speculative children by default.
    /// Never set for a field the schema declares: there is nothing left to speculate about.
    /// </summary>
    public bool Speculative { get; set; }

    /// <summary>True when a UTF-8 reading contains no control characters, so it is plausibly text.</summary>
    public bool LooksPrintable { get; set; }

    public string? Note { get; set; }

    // ---- from the schema, when one is applied ----

    /// <summary>The field's name in the schema.</summary>
    public string? Name { get; set; }

    /// <summary>How the schema declares it: "string", "repeated Person", "map&lt;string, int32&gt;".</summary>
    public string? Declared { get; set; }

    /// <summary>Fully-qualified name of the message the children were read as.</summary>
    public string? MessageType { get; set; }

    /// <summary>The oneof this field belongs to, if any.</summary>
    public string? OneOf { get; set; }

    /// <summary>True when a schema was applied and does not declare this field number.</summary>
    public bool Unknown { get; set; }

    /// <summary>True when the field comes from an <c>extend</c> block rather than the message itself.</summary>
    public bool Extension { get; set; }

    /// <summary>
    /// Set when the bytes cannot be what the schema says: a wire type that does not match the
    /// declared one, a string field holding invalid UTF-8, a message that does not parse.
    /// </summary>
    public string? Mismatch { get; set; }
}

/// <summary>One candidate interpretation of a field's bytes.</summary>
internal sealed class Reading(string kind, string value)
{
    public string Kind { get; set; } = kind;
    public string Value { get; set; } = value;
    public bool Truncated { get; set; }
    public int? FullLength { get; set; }
}

/// <summary>The message types a schema declares, for the root-type picker.</summary>
internal sealed class SchemaTypesResult
{
    public List<string> Types { get; set; } = [];
    public List<SchemaError> Errors { get; set; } = [];
    public string? Exception { get; set; }
}

// ---- schema codegen ----

internal sealed class GenerateRequest
{
    public string Schema { get; set; } = "";
    public string FileName { get; set; } = "my.proto";
    public string Language { get; set; } = "csharp";
    public string? LanguageVersion { get; set; }
    public string NamingConvention { get; set; } = "auto";
    public bool Services { get; set; } = true;
    public bool OneOfEnum { get; set; }
    public bool ListSet { get; set; }
    public bool DisableNullWrappers { get; set; }
    public bool DisableCompatLevel { get; set; }
    public bool NullableValueType { get; set; }
    public bool RepeatedAsList { get; set; }
}

internal sealed class GenerateResponse
{
    public List<GeneratedFile> Files { get; set; } = [];
    public List<SchemaError> Errors { get; set; } = [];
    public string? Exception { get; set; }
}

internal sealed class GeneratedFile
{
    public string Name { get; set; } = "";
    public string Text { get; set; } = "";
}

internal sealed class SchemaError
{
    public bool IsError { get; set; }
    public int LineNumber { get; set; }
    public int ColumnNumber { get; set; }
    /// <summary>Length of the offending token, for underlining; 0 when unknown.</summary>
    public int Length { get; set; }
    public string Message { get; set; } = "";
    public int ErrorNumber { get; set; }
    public string File { get; set; } = "";
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(DecodeRequest))]
[JsonSerializable(typeof(DecodeResult))]
[JsonSerializable(typeof(SchemaTypesResult))]
[JsonSerializable(typeof(GenerateRequest))]
[JsonSerializable(typeof(GenerateResponse))]
internal sealed partial class JsonContext : JsonSerializerContext;
