using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;

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
        GenerateRequest request;
        try
        {
            request = JsonSerializer.Deserialize(requestJson, JsonContext.Default.GenerateRequest)
                ?? new GenerateRequest();
        }
        catch (JsonException ex)
        {
            var bad = new GenerateResponse { Exception = $"malformed request: {ex.Message}" };
            return JsonSerializer.Serialize(bad, JsonContext.Default.GenerateResponse);
        }

        var response = Codegen.Generate(request);
        return JsonSerializer.Serialize(response, JsonContext.Default.GenerateResponse);
    }

    /// <summary>Decomposes a raw protobuf payload into a tree, without a schema. Returns JSON.</summary>
    [JSExport]
    internal static string Decode(byte[] data, bool fullStrings)
    {
        var options = new DecodeOptions { FullStrings = fullStrings };
        var result = WireWalker.Decode(data, options);
        return JsonSerializer.Serialize(result, JsonContext.Default.DecodeResult);
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
