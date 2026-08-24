using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace ProtoGen.Wasm;

/// <summary>
/// The whole JS-visible surface of the WASM module. Everything else is an implementation detail.
/// </summary>
public static partial class Interop
{
    /// <summary>Parses a .proto schema and generates code. Takes and returns JSON.</summary>
    [JSExport]
    internal static string Generate(string requestJson)
    {
        var request = Read(requestJson, JsonContext.Default.GenerateRequest, out var malformed);
        if (malformed is not null)
        {
            return JsonSerializer.Serialize(
                new GenerateResponse { Exception = malformed }, JsonContext.Default.GenerateResponse);
        }

        var response = Codegen.Generate(request);
        return JsonSerializer.Serialize(response, JsonContext.Default.GenerateResponse);
    }

    /// <summary>
    /// Decomposes a raw protobuf payload into a tree. The request may carry a schema and the
    /// message the payload is an instance of; without them the bytes are read on their own terms.
    /// Takes JSON alongside the payload, and returns JSON.
    /// </summary>
    [JSExport]
    internal static string Decode(byte[] data, string requestJson)
    {
        var request = Read(requestJson, JsonContext.Default.DecodeRequest, out var malformed);
        if (malformed is not null)
        {
            return JsonSerializer.Serialize(
                new DecodeResult { SchemaNote = malformed }, JsonContext.Default.DecodeResult);
        }

        var result = Decoder.Decode(data, request);
        return JsonSerializer.Serialize(result, JsonContext.Default.DecodeResult);
    }

    /// <summary>
    /// Lists the message types a schema declares, so the decode view can offer them as root types.
    /// Returns JSON, with the same parse diagnostics the schema view would show.
    /// </summary>
    [JSExport]
    internal static string SchemaTypes(string requestJson)
    {
        var request = Read(requestJson, JsonContext.Default.DecodeRequest, out var malformed);
        if (malformed is not null)
        {
            return JsonSerializer.Serialize(
                new SchemaTypesResult { Exception = malformed }, JsonContext.Default.SchemaTypesResult);
        }

        return JsonSerializer.Serialize(Decoder.Types(request), JsonContext.Default.SchemaTypesResult);
    }

    /// <summary>
    /// Reads a request, or reports why it could not be read. Each export shapes that report into
    /// its own response type, so the caller sees a failure in the shape it was expecting.
    /// </summary>
    private static T Read<T>(string json, JsonTypeInfo<T> type, out string? malformed) where T : new()
    {
        malformed = null;
        try
        {
            return JsonSerializer.Deserialize(json, type) ?? new T();
        }
        catch (JsonException ex)
        {
            malformed = $"malformed request: {ex.Message}";
            return new T();
        }
    }

    /// <summary>
    /// Returns one of the .proto files embedded in protobuf-net.Reflection, by its import path.
    /// </summary>
    /// <remarks>
    /// Lets big samples like <c>google/protobuf/descriptor.proto</c> be offered without inlining
    /// them into the JS bundle or fetching them over the network — and guarantees the sample is
    /// byte-for-byte what the import resolver would use.
    /// </remarks>
    [JSExport]
    internal static string EmbeddedProto(string path)
    {
        // mirrors the library's own rule: only its two embedded trees are addressable
        if (string.IsNullOrWhiteSpace(path)
            || !path.EndsWith(".proto", StringComparison.Ordinal)
            || !(path.StartsWith("google/", StringComparison.Ordinal)
                 || path.StartsWith("protobuf-net/", StringComparison.Ordinal)))
        {
            throw new ArgumentException($"'{path}' is not an embedded schema", nameof(path));
        }

        var resourceName = "ProtoBuf." + path.Replace('/', '.').Replace('-', '_');
        using var stream = typeof(Google.Protobuf.Reflection.FileDescriptorSet).Assembly
            .GetManifestResourceStream(resourceName)
            ?? throw new ArgumentException($"'{path}' is not embedded in protobuf-net.Reflection", nameof(path));

        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    /// <summary>The protobuf-net.Reflection version doing the work, for the footer.</summary>
    [JSExport]
    internal static string EngineVersion()
        => typeof(Google.Protobuf.Reflection.FileDescriptorSet).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
           ?? typeof(Google.Protobuf.Reflection.FileDescriptorSet).Assembly.GetName().Version?.ToString()
           ?? "unknown";
}

internal static class Program
{
    // the runtime stays resident; JS drives everything through [JSExport]
    public static void Main() { }
}
