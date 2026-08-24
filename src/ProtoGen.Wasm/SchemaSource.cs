using Google.Protobuf.Reflection;

namespace ProtoGen.Wasm;

/// <summary>
/// Parses .proto source into a descriptor set, and remembers the last one.
/// </summary>
/// <remarks>
/// The decode view sends its schema with every payload, and both change as the user types, so the
/// same text is parsed over and over. One remembered result is enough to make that free: a
/// keystroke in the payload box does not reparse the schema, and a keystroke in the schema box was
/// going to need a parse anyway. There is a single thread here, so no locking.
/// </remarks>
internal static class SchemaSource
{
    private static string? _lastSchema;
    private static string? _lastFileName;
    private static ParsedSchema? _last;

    /// <summary>Parses afresh, appending any diagnostics to <paramref name="errors"/>.</summary>
    public static FileDescriptorSet Parse(string? schema, string fileName, List<SchemaError> errors)
    {
        var set = new FileDescriptorSet();
        set.Add(fileName, includeInOutput: true, new StringReader(schema ?? ""));
        set.Process();

        foreach (var error in set.GetErrors())
        {
            errors.Add(new SchemaError
            {
                IsError = error.IsError,
                LineNumber = error.LineNumber,
                ColumnNumber = error.ColumnNumber,
                Length = error.Text?.Length ?? 0,
                Message = error.Message,
                ErrorNumber = error.ErrorNumber,
                File = error.File ?? "",
            });
        }
        return set;
    }

    /// <summary>Parses, or returns the previous result when the same text is asked for again.</summary>
    public static ParsedSchema Load(string schema, string fileName)
    {
        if (_last is not null && _lastSchema == schema && _lastFileName == fileName) return _last;

        var parsed = ParseIndexed(schema, fileName);
        (_lastSchema, _lastFileName, _last) = (schema, fileName, parsed);
        return parsed;
    }

    private static ParsedSchema ParseIndexed(string schema, string fileName)
    {
        var errors = new List<SchemaError>();
        try
        {
            var set = Parse(schema, fileName, errors);
            // Indexing a schema that failed to parse is still worth doing: protobuf-net populates
            // what it understood, so the fields above a syntax error are named correctly. The
            // errors travel with the result, so the user can see why the rest is unlabelled.
            return new ParsedSchema(SchemaIndex.Build(set), errors, null);
        }
        catch (Exception ex)
        {
            return new ParsedSchema(SchemaIndex.Empty, errors, $"{ex.GetType().Name}: {ex.Message}");
        }
    }
}

/// <summary>A parsed schema, its diagnostics, and the failure that stopped it being either.</summary>
internal sealed record ParsedSchema(SchemaIndex Index, List<SchemaError> Errors, string? Exception)
{
    public bool HasErrors => Errors.Any(e => e.IsError);
}
