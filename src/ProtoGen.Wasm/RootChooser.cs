namespace ProtoGen.Wasm;

/// <summary>
/// Works out which message a payload is, when the user has not said.
/// </summary>
/// <remarks>
/// <para>
/// Nothing in a payload names its type, so this is inference, and everything it produces is
/// labelled as a guess by the time it reaches the screen. The evidence is what a schema-driven
/// read of the same bytes actually produces: how many fields the message accounts for, and whether
/// any of them contradict it.
/// </para>
/// <para>
/// Only agreement counts. A payload carrying fields the schema has never heard of is the normal
/// condition of protobuf, not a symptom of the wrong message — it is what a service that has moved
/// on from the schema you have to hand sends, and unknown fields are meant to survive a round trip
/// untouched. Scoring on the *share* of fields recognised would punish the right message for
/// exactly that, and worse: a message that decomposes a sub-message which is itself newer than the
/// schema would score below one that writes the same bytes off as opaque, which is backwards. So
/// unknown fields are ignored, and the message that recognises the most wins.
/// </para>
/// <para>
/// A contradiction is different, and eliminating. If the schema declares field 3 a string and the
/// payload wrote a varint there, this is not the message that wrote it: reusing a field number
/// with a different type is the one thing protobuf's compatibility rules forbid outright, which is
/// what <c>reserved</c> exists to prevent.
/// </para>
/// <para>
/// Ties fall to the order the schema declares its messages in — the closest thing a .proto has to
/// saying which message is the point of the file — and a tie is then reported rather than hidden,
/// because at that point it is a coin toss and the user is the only one who can settle it.
/// </para>
/// </remarks>
internal static class RootChooser
{
    /// <summary>Reading a payload once per message stops being worth the wait somewhere.</summary>
    private const int MaxCandidates = 48;
    private const int MaxPayloadBytes = 128 * 1024;

    /// <summary>How many equally good alternatives are worth naming before it becomes a list.</summary>
    private const int MaxAlternatives = 3;

    /// <summary>
    /// Reads the payload as every message the schema declares and returns the best fit, or null if
    /// no message recognises any of it — in which case guessing would be noise, not help.
    /// </summary>
    public static RootChoice? Choose(byte[] data, DecodeOptions options, SchemaIndex index)
    {
        var candidates = index.RootCandidates.ToList();
        if (candidates.Count == 0) return null;

        if (candidates.Count > MaxCandidates || data.Length > MaxPayloadBytes)
        {
            // too much work to test them all; fall back to the schema's own idea of which message
            // matters most, and say that is what happened rather than implying it was measured
            var first = candidates[0];
            return new RootChoice(
                first, WireWalker.Decode(data, options, first), [], Contradicted: false, Capped: true);
        }

        var fits = new List<RootFit>(candidates.Count);
        foreach (var candidate in candidates)
        {
            fits.Add(Measure(candidate, WireWalker.Decode(data, options, candidate)));
        }

        fits.Sort(Compare);
        var best = fits[0];

        // a schema that recognises nothing in this payload has nothing to say about it
        if (best.Matched == 0) return null;

        var equallyGood = fits
            .Skip(1)
            .TakeWhile(fit => SameEvidence(fit, best))
            .Take(MaxAlternatives)
            .Select(fit => fit.Type.DisplayName)
            .ToList();

        return new RootChoice(best.Type, best.Result, equallyGood, best.Contradictions > 0, Capped: false);
    }

    /// <summary>
    /// Best first: a consistent explanation beats a contradicted one, then the most fields
    /// recognised, then the fewest contradictions, then the one the schema declared first.
    /// </summary>
    private static int Compare(RootFit left, RootFit right)
    {
        int result = Tier(left).CompareTo(Tier(right));
        if (result != 0) return result;

        result = right.Matched.CompareTo(left.Matched);
        if (result != 0) return result;

        result = left.Contradictions.CompareTo(right.Contradictions);
        return result != 0 ? result : left.Type.Order.CompareTo(right.Type.Order);
    }

    /// <summary>
    /// Explains some of the payload without contradicting any of it (0), explains some and
    /// contradicts some (1), or explains none of it (2).
    /// </summary>
    /// <remarks>
    /// Contradictions cannot be the first thing compared. A message that declares nothing this
    /// payload contains contradicts nothing either, and ranking on that alone would let a message
    /// with no bearing on the bytes beat one that accounts for most of them and disagrees about a
    /// corner. Recognising nothing is the worst outcome here, not the cleanest.
    /// </remarks>
    private static int Tier(RootFit fit)
        => fit.Matched == 0 ? 2 : fit.Contradictions == 0 ? 0 : 1;

    /// <summary>
    /// Whether the payload says the same about both. Declaration order separates these two for
    /// ranking, but it is not evidence, so it does not get to make the winner look decided.
    /// </summary>
    private static bool SameEvidence(RootFit left, RootFit right)
        => left.Contradictions == right.Contradictions && left.Matched == right.Matched;

    private static RootFit Measure(SchemaMessage type, DecodeResult result)
    {
        int matched = 0, contradictions = 0;
        Count(result.Nodes, ref matched, ref contradictions);
        return new RootFit(type, result, matched, contradictions);
    }

    private static void Count(List<Node> nodes, ref int matched, ref int contradictions)
    {
        foreach (var node in nodes)
        {
            // a contradicted field was declared and is still wrong, so it is not a match; a field
            // the schema does not declare is neither, and is deliberately not held against it
            if (node.Mismatch is not null) contradictions++;
            else if (node.Name is not null) matched++;

            if (node.Children is { } children) Count(children, ref matched, ref contradictions);
        }
    }
}

/// <summary>How well one message accounts for a payload.</summary>
/// <param name="Matched">Fields the message declares and the payload agrees with, at any depth.</param>
/// <param name="Contradictions">Fields the payload cannot hold, if this is the message.</param>
internal sealed record RootFit(SchemaMessage Type, DecodeResult Result, int Matched, int Contradictions);

/// <summary>The message a payload was read as, and how much confidence that deserves.</summary>
/// <param name="EquallyGood">Messages that fit exactly as well; empty when the choice was clear.</param>
/// <param name="Contradicted">True when even the best message disagrees with some of the bytes.</param>
/// <param name="Capped">True when the schema or payload was too big to test, so order decided it.</param>
internal sealed record RootChoice(
    SchemaMessage Type, DecodeResult Result, List<string> EquallyGood, bool Contradicted, bool Capped);
