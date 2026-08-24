namespace ProtoGen.Wasm;

/// <summary>
/// Joins the two halves of the tool: parses the schema, if there is one, and hands the resulting
/// type to the wire walker.
/// </summary>
/// <remarks>
/// The walker knows about message types; it knows nothing about .proto text, and the parser knows
/// nothing about payloads. This is the only place that knows about both.
/// </remarks>
internal static class Decoder
{
    public static DecodeResult Decode(ReadOnlySpan<byte> data, DecodeRequest request)
    {
        var options = new DecodeOptions { FullStrings = request.FullStrings };
        if (string.IsNullOrWhiteSpace(request.Schema)) return WireWalker.Decode(data, options);

        var parsed = SchemaSource.Load(request.Schema, FileName(request));
        var root = parsed.Index.ResolveRoot(request.RootType);

        var result = WireWalker.Decode(data, options, root);
        result.SchemaErrors = parsed.Errors.Count > 0 ? parsed.Errors : null;
        result.SchemaNote = Explain(parsed, request, root);
        return result;
    }

    /// <summary>The message types the schema declares, for the root-type picker.</summary>
    public static SchemaTypesResult Types(DecodeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Schema)) return new SchemaTypesResult();

        var parsed = SchemaSource.Load(request.Schema, FileName(request));
        return new SchemaTypesResult
        {
            Types = parsed.Index.RootCandidates.Select(message => message.DisplayName).ToList(),
            Errors = parsed.Errors,
            Exception = parsed.Exception,
        };
    }

    /// <summary>Why the schema did not label anything, when it did not.</summary>
    private static string? Explain(ParsedSchema parsed, DecodeRequest request, SchemaMessage? root)
    {
        if (parsed.Exception is not null) return $"the schema could not be read: {parsed.Exception}";
        if (root is not null) return null;

        return string.IsNullOrWhiteSpace(request.RootType)
            ? "choose the message this payload is an instance of; nothing in the bytes says which it is"
            : $"'{request.RootType}' is not a message in this schema, so the payload was decoded without it";
    }

    private static string FileName(DecodeRequest request)
        => string.IsNullOrWhiteSpace(request.FileName) ? "payload.proto" : request.FileName.Trim();
}
