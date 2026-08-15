using System.Text.Json.Serialization;

namespace ProtoGen.Wasm;

// ---- binary decode ----

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
    /// Best guess at what this field actually is: "message", "group", "string", "bytes" or "scalar".
    /// The wire format cannot distinguish these, so this is a heuristic and the UI should let the
    /// user see the alternatives.
    /// </summary>
    public string Primary { get; set; } = "scalar";

    /// <summary>
    /// True when the payload reads convincingly as more than one thing — typically valid UTF-8 text
    /// that also happens to parse as a message. The UI collapses speculative children by default.
    /// </summary>
    public bool Speculative { get; set; }

    /// <summary>True when a UTF-8 reading contains no control characters, so it is plausibly text.</summary>
    public bool LooksPrintable { get; set; }

    public string? Note { get; set; }
}

/// <summary>One candidate interpretation of a field's bytes.</summary>
internal sealed class Reading(string kind, string value)
{
    public string Kind { get; set; } = kind;
    public string Value { get; set; } = value;
    public bool Truncated { get; set; }
    public int? FullLength { get; set; }
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
[JsonSerializable(typeof(DecodeResult))]
[JsonSerializable(typeof(GenerateRequest))]
[JsonSerializable(typeof(GenerateResponse))]
internal sealed partial class JsonContext : JsonSerializerContext;
