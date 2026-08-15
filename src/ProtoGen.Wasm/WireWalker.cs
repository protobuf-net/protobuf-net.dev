using System.Text;

namespace ProtoGen.Wasm;

/// <summary>
/// Walks raw protobuf wire format and decomposes it into a tree, without a schema.
/// </summary>
/// <remarks>
/// This deliberately does not use <c>ProtoReader</c>. An analysis tool needs two things that
/// the serializer's reader does not offer: exact byte offsets for every component (so the UI can
/// highlight the corresponding bytes), and partial results on malformed input rather than an
/// exception that discards everything decoded so far. Both fall out naturally from walking the
/// span directly, and the wire format is small enough that there is little to get wrong.
/// </remarks>
internal static class WireWalker
{
    /// <summary>Recursion limit for speculative sub-message parsing.</summary>
    private const int MaxDepth = 24;

    /// <summary>Total node budget, so a hostile or unlucky payload cannot hang the browser.</summary>
    private const int MaxNodes = 20_000;

    public static DecodeResult Decode(ReadOnlySpan<byte> data, DecodeOptions options)
    {
        var result = new DecodeResult { TotalBytes = data.Length };
        var budget = new Budget(MaxNodes);
        result.Nodes = Walk(data, baseOffset: 0, depth: 0, options, budget, out var error, out var consumed);
        result.Error = error;
        result.ConsumedBytes = consumed;
        result.Truncated = budget.Exhausted;
        return result;
    }

    private sealed class Budget(int max)
    {
        private int _remaining = max;
        public bool Exhausted { get; private set; }
        public bool Take()
        {
            if (_remaining <= 0) { Exhausted = true; return false; }
            _remaining--;
            return true;
        }
    }

    private static List<Node> Walk(
        ReadOnlySpan<byte> data, int baseOffset, int depth,
        DecodeOptions options, Budget budget, out string? error, out int consumed)
    {
        var nodes = new List<Node>();
        error = null;
        int pos = 0;

        while (pos < data.Length)
        {
            int tagStart = pos;
            if (!TryReadVarint(data, ref pos, out ulong tag))
            {
                // rewind, so `consumed` reports the bytes we actually made sense of
                pos = tagStart;
                error = $"truncated field tag at offset {baseOffset + tagStart}";
                break;
            }

            int fieldNumber = (int)(tag >> 3);
            int wireType = (int)(tag & 7);

            if (fieldNumber <= 0)
            {
                error = $"invalid field number {fieldNumber} at offset {baseOffset + tagStart}";
                pos = tagStart;
                break;
            }

            // an end-group tag terminates the current tier; the caller matches the field number
            if (wireType == 4)
            {
                pos = tagStart;
                break;
            }

            if (!budget.Take())
            {
                error = "output truncated: node budget exhausted";
                break;
            }

            var node = new Node
            {
                Field = fieldNumber,
                WireType = WireTypeName(wireType),
                Start = baseOffset + tagStart,
                TagHex = Hex(data[tagStart..pos]),
            };

            switch (wireType)
            {
                case 0: // VARINT
                {
                    int valueStart = pos;
                    if (!TryReadVarint(data, ref pos, out ulong value))
                    {
                        error = $"truncated varint for field {fieldNumber} at offset {baseOffset + valueStart}";
                        pos = tagStart;
                        goto done;
                    }
                    node.ValueHex = Hex(data[valueStart..pos]);
                    AddVarintReadings(node, value);
                    break;
                }
                case 5: // I32
                {
                    if (pos + 4 > data.Length)
                    {
                        error = $"truncated fixed32 for field {fieldNumber} at offset {baseOffset + pos}";
                        pos = tagStart;
                        goto done;
                    }
                    var slice = data.Slice(pos, 4);
                    node.ValueHex = Hex(slice);
                    AddFixed32Readings(node, slice);
                    pos += 4;
                    break;
                }
                case 1: // I64
                {
                    if (pos + 8 > data.Length)
                    {
                        error = $"truncated fixed64 for field {fieldNumber} at offset {baseOffset + pos}";
                        pos = tagStart;
                        goto done;
                    }
                    var slice = data.Slice(pos, 8);
                    node.ValueHex = Hex(slice);
                    AddFixed64Readings(node, slice);
                    pos += 8;
                    break;
                }
                case 2: // LEN
                {
                    int lenStart = pos;
                    if (!TryReadVarint(data, ref pos, out ulong rawLen))
                    {
                        error = $"truncated length prefix for field {fieldNumber} at offset {baseOffset + lenStart}";
                        pos = tagStart;
                        goto done;
                    }
                    if (rawLen > (ulong)(data.Length - pos))
                    {
                        error = $"length-prefixed field {fieldNumber} at offset {baseOffset + tagStart} claims " +
                                $"{rawLen} bytes but only {data.Length - pos} remain";
                        pos = tagStart;
                        goto done;
                    }
                    int len = (int)rawLen;
                    node.LenPrefixHex = Hex(data[lenStart..pos]);
                    node.Length = len;

                    var payload = data.Slice(pos, len);
                    node.ValueHex = Hex(payload, options.MaxHexBytes);
                    AddLenReadings(node, payload, baseOffset + pos, depth, options, budget);
                    pos += len;
                    break;
                }
                case 3: // SGROUP
                {
                    var rest = data[pos..];
                    var children = Walk(rest, baseOffset + pos, depth + 1, options, budget, out var innerError, out int used);
                    node.Children = children;
                    node.ChildrenKind = "group";
                    node.Primary = "group";
                    pos += used;

                    // consume the matching end-group tag, if it is there
                    int endStart = pos;
                    if (innerError is null && TryReadVarint(data, ref pos, out ulong endTag)
                        && (int)(endTag & 7) == 4 && (int)(endTag >> 3) == fieldNumber)
                    {
                        node.EndGroupHex = Hex(data[endStart..pos]);
                    }
                    else
                    {
                        pos = endStart;
                        node.Note = innerError ?? $"unterminated group (no end tag for field {fieldNumber})";
                    }
                    break;
                }
                default:
                    error = $"unsupported wire type {wireType} for field {fieldNumber} at offset {baseOffset + tagStart}";
                    pos = tagStart;
                    goto done;
            }

            node.End = baseOffset + pos;
            nodes.Add(node);
        }

    done:
        consumed = pos;
        return nodes;
    }

    private static void AddVarintReadings(Node node, ulong value)
    {
        node.Readings.Add(new Reading("uint64", value.ToString()));

        long signed = unchecked((long)value);
        if (signed != (long)value || signed < 0)
        {
            node.Readings.Add(new Reading("int64", signed.ToString()));
        }

        // int32 is the common case for small schemas; only show it when it round-trips
        if (value <= int.MaxValue)
        {
            node.Readings.Add(new Reading("int32", ((int)value).ToString()));
        }
        else if (signed >= int.MinValue && signed < 0)
        {
            node.Readings.Add(new Reading("int32", ((int)signed).ToString()));
        }

        long zigzag = (long)(value >> 1) ^ -(long)(value & 1);
        if (zigzag != (long)value)
        {
            node.Readings.Add(new Reading("sint (zigzag)", zigzag.ToString()));
        }

        if (value <= 1)
        {
            node.Readings.Add(new Reading("bool", value == 1 ? "true" : "false"));
        }
    }

    private static void AddFixed32Readings(Node node, ReadOnlySpan<byte> slice)
    {
        uint u = BitConverter.ToUInt32(slice);
        node.Readings.Add(new Reading("fixed32", u.ToString()));
        if (u > int.MaxValue) node.Readings.Add(new Reading("sfixed32", unchecked((int)u).ToString()));
        float f = BitConverter.ToSingle(slice);
        if (!float.IsNaN(f) && !float.IsInfinity(f)) node.Readings.Add(new Reading("float", f.ToString("R")));
    }

    private static void AddFixed64Readings(Node node, ReadOnlySpan<byte> slice)
    {
        ulong u = BitConverter.ToUInt64(slice);
        node.Readings.Add(new Reading("fixed64", u.ToString()));
        if (u > long.MaxValue) node.Readings.Add(new Reading("sfixed64", unchecked((long)u).ToString()));
        double d = BitConverter.ToDouble(slice);
        if (!double.IsNaN(d) && !double.IsInfinity(d)) node.Readings.Add(new Reading("double", d.ToString("R")));
    }

    private static void AddLenReadings(
        Node node, ReadOnlySpan<byte> payload, int payloadOffset, int depth,
        DecodeOptions options, Budget budget)
    {
        if (payload.Length == 0)
        {
            node.Readings.Add(new Reading("empty", "(zero bytes)"));
            node.Primary = "bytes";
            return;
        }

        // A length-delimited field is ambiguous by design: string, bytes, sub-message and packed
        // repeated scalars are indistinguishable on the wire. Offer the readings that fit, but rank
        // them - almost any short byte sequence "parses" as something, and listing every technically
        // valid reading with equal weight buries the one the user actually wants.

        // valid UTF-8 that is nothing but control characters is not a string anyone meant to write;
        // offering it as one renders as a blank value and hides the reading that matters
        bool readsAsText = TryDecodeUtf8(payload, out string? text, out bool printable) && printable;
        if (readsAsText)
        {
            string shown = options.FullStrings || text!.Length <= options.StringPreviewLength
                ? text!
                : text!.Substring(0, options.StringPreviewLength);
            node.Readings.Add(new Reading("string", shown)
            {
                Truncated = shown.Length != text!.Length,
                FullLength = text.Length,
            });
            node.LooksPrintable = true;
        }

        List<Node>? children = null;
        if (depth < MaxDepth && TryParseAsMessage(payload, payloadOffset, depth, options, budget, out var parsed)
            && IsPlausibleMessage(parsed!, readsAsText))
        {
            children = parsed;
            node.Children = parsed;
            node.ChildrenKind = "message";
        }

        // packed readings are a long shot on anything that is convincingly text, and offering
        // "packed fixed32" for every payload whose length happens to divide by four is pure noise
        if (!readsAsText)
        {
            if (TryPackedVarints(payload, out string? packed))
            {
                node.Readings.Add(new Reading("packed varints", packed!));
            }
            if (payload.Length is > 0 and <= 64 && payload.Length % 4 == 0)
            {
                node.Readings.Add(new Reading("packed fixed32", FormatFixed32s(payload)));
            }
            if (payload.Length is > 0 and <= 64 && payload.Length % 8 == 0)
            {
                node.Readings.Add(new Reading("packed fixed64", FormatFixed64s(payload)));
            }
        }

        node.Primary = (children, readsAsText) switch
        {
            (not null, false) => "message",
            (not null, true) => "message",
            (null, true) => "string",
            _ => "bytes",
        };
        // when it reads as both, say so rather than silently picking one
        node.Speculative = children is not null && readsAsText;
        if (node.Speculative) node.Primary = "string";
    }

    /// <summary>
    /// Filters speculative sub-message parses that are technically valid but almost certainly wrong.
    /// </summary>
    private static bool IsPlausibleMessage(List<Node> children, bool readsAsText)
    {
        if (children.Count == 0) return false;

        foreach (var child in children)
        {
            // real schemas essentially never reach here; a high field number from a speculative
            // parse means we are reading random bytes as a tag
            if (child.Field > 512) return false;

            // groups were deprecated in proto2 and are vanishingly rare; as a *speculative* reading
            // they are almost always a false positive on arbitrary bytes
            if (child.WireType is "SGROUP" or "EGROUP") return false;
        }

        // a single flat field inside something that already reads as clean text is the classic
        // false positive - every two-byte ASCII string "parses" as one varint field
        if (readsAsText && children.Count == 1 && children[0].Children is null) return false;

        return true;
    }

    /// <summary>
    /// Speculatively parses a length-delimited payload as a nested message. Only reports success
    /// if the whole payload is consumed cleanly, which is a decent (not infallible) heuristic.
    /// </summary>
    private static bool TryParseAsMessage(
        ReadOnlySpan<byte> payload, int payloadOffset, int depth,
        DecodeOptions options, Budget budget, out List<Node>? children)
    {
        children = null;
        var nodes = Walk(payload, payloadOffset, depth + 1, options, budget, out var error, out int consumed);
        if (error is not null || consumed != payload.Length || nodes.Count == 0) return false;
        children = nodes;
        return true;
    }

    private static bool TryPackedVarints(ReadOnlySpan<byte> payload, out string? formatted)
    {
        formatted = null;
        var values = new List<ulong>();
        int pos = 0;
        while (pos < payload.Length)
        {
            if (!TryReadVarint(payload, ref pos, out ulong v)) return false;
            values.Add(v);
            if (values.Count > 64) return false; // too many to display usefully
        }
        if (values.Count is 0 or 1) return false; // a single varint is not usefully "packed"
        formatted = "[" + string.Join(", ", values) + "]";
        return true;
    }

    private static string FormatFixed32s(ReadOnlySpan<byte> payload)
    {
        var parts = new List<string>();
        for (int i = 0; i < payload.Length; i += 4) parts.Add(BitConverter.ToUInt32(payload.Slice(i, 4)).ToString());
        return "[" + string.Join(", ", parts) + "]";
    }

    private static string FormatFixed64s(ReadOnlySpan<byte> payload)
    {
        var parts = new List<string>();
        for (int i = 0; i < payload.Length; i += 8) parts.Add(BitConverter.ToUInt64(payload.Slice(i, 8)).ToString());
        return "[" + string.Join(", ", parts) + "]";
    }

    private static bool TryDecodeUtf8(ReadOnlySpan<byte> payload, out string? text, out bool printable)
    {
        text = null;
        printable = false;
        try
        {
            text = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true)
                .GetString(payload);
        }
        catch (ArgumentException)
        {
            return false; // not valid UTF-8
        }

        printable = true;
        foreach (char c in text)
        {
            if (char.IsControl(c) && c is not ('\n' or '\r' or '\t')) { printable = false; break; }
        }
        return true;
    }

    private static bool TryReadVarint(ReadOnlySpan<byte> data, ref int pos, out ulong value)
    {
        value = 0;
        int shift = 0;
        while (pos < data.Length)
        {
            byte b = data[pos++];
            if (shift == 63 && (b & 0x7F) > 1) { return false; } // would overflow 64 bits
            value |= (ulong)(b & 0x7F) << shift;
            if ((b & 0x80) == 0) return true;
            shift += 7;
            if (shift > 63) return false; // more than 10 bytes
        }
        return false; // ran out of data mid-varint
    }

    private static string WireTypeName(int wireType) => wireType switch
    {
        0 => "VARINT",
        1 => "I64",
        2 => "LEN",
        3 => "SGROUP",
        4 => "EGROUP",
        5 => "I32",
        _ => $"?{wireType}",
    };

    private static string Hex(ReadOnlySpan<byte> bytes, int limit = int.MaxValue)
    {
        bool truncated = bytes.Length > limit;
        if (truncated) bytes = bytes[..limit];

        var sb = new StringBuilder(bytes.Length * 3);
        for (int i = 0; i < bytes.Length; i++)
        {
            if (i > 0) sb.Append('-');
            sb.Append(bytes[i].ToString("X2"));
        }
        if (truncated) sb.Append("…");
        return sb.ToString();
    }
}
