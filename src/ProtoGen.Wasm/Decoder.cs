namespace ProtoGen.Wasm;

/// <summary>
/// Joins the two halves of the tool: parses the schema, if there is one, works out which of its
/// messages the payload is if the user has not said, and hands that to the wire walker.
/// </summary>
/// <remarks>
/// The walker knows about message types; it knows nothing about .proto text, and the parser knows
/// nothing about payloads. This is the only place that knows about both.
/// </remarks>
internal static class Decoder
{
    public static DecodeResult Decode(byte[] data, DecodeRequest request)
    {
        var options = new DecodeOptions { FullStrings = request.FullStrings };
        if (string.IsNullOrWhiteSpace(request.Schema)) return WireWalker.Decode(data, options);

        var parsed = SchemaSource.Load(request.Schema, FileName(request));
        var root = parsed.Index.ResolveRoot(request.RootType);

        DecodeResult result;
        RootChoice? guess = null;

        if (root is not null)
        {
            result = WireWalker.Decode(data, options, root);
        }
        else if (ShouldGuess(request, parsed) && RootChooser.Choose(data, options, parsed.Index) is { } chosen)
        {
            // the chooser already read the payload as this message to decide; that read is the answer
            (guess, root, result) = (chosen, chosen.Type, chosen.Result);
        }
        else
        {
            result = WireWalker.Decode(data, options);
        }

        result.RootGuessed = guess is not null;
        result.RootAlternatives = guess is { EquallyGood.Count: > 0 } ? guess.EquallyGood : null;
        result.SchemaErrors = parsed.Errors.Count > 0 ? parsed.Errors : null;
        result.SchemaNote = Explain(parsed, request, root, guess);
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

    /// <summary>
    /// A name the user chose is never second-guessed, even when it is wrong: they are telling us
    /// something, and the useful answer to a name that does not resolve is to say so.
    /// </summary>
    private static bool ShouldGuess(DecodeRequest request, ParsedSchema parsed)
        => string.IsNullOrWhiteSpace(request.RootType) && parsed.Exception is null;

    /// <summary>How much the reading above should be trusted, in the words the UI shows.</summary>
    private static string? Explain(
        ParsedSchema parsed, DecodeRequest request, SchemaMessage? root, RootChoice? guess)
    {
        if (parsed.Exception is not null) return $"the schema could not be read: {parsed.Exception}";

        if (root is null)
        {
            return string.IsNullOrWhiteSpace(request.RootType)
                ? "no message in this schema recognises a single field of this payload; pick one " +
                  "above, or check that the schema is the right one for these bytes"
                : $"'{request.RootType}' is not a message in this schema, so the payload was decoded without it";
        }

        if (guess is null) return null;

        if (guess.Capped)
        {
            return $"read as {root.DisplayName}, the first message this schema declares — there is too " +
                   "much here to try them all against the payload, so nothing was measured";
        }

        // the louder signal first: that nothing quite fits matters more than which near-miss won
        if (guess.Contradicted)
        {
            return $"guessed {root.DisplayName}, which fits these bytes better than anything else in " +
                   "the schema but still contradicts some of them — the payload may not be from this " +
                   "schema at all";
        }

        if (guess.EquallyGood.Count > 0)
        {
            return $"guessed {root.DisplayName} from the payload, but {And(guess.EquallyGood)} " +
                   $"{(guess.EquallyGood.Count == 1 ? "fits" : "fit")} it exactly as well — this one won " +
                   "only by being declared first, so check it is the one you meant";
        }

        return $"guessed {root.DisplayName} from the payload: no other message in this schema " +
               "recognises as many of its fields";
    }

    private static string And(List<string> names)
        => names.Count == 1
            ? names[0]
            : $"{string.Join(", ", names.Take(names.Count - 1))} and {names[^1]}";

    private static string FileName(DecodeRequest request)
        => string.IsNullOrWhiteSpace(request.FileName) ? "payload.proto" : request.FileName.Trim();
}
