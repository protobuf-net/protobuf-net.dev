using System.Text;

namespace ProtoGen.Wasm.Tests;

/// <summary>
/// Writes protobuf wire format by hand, so a test says which bytes it means.
/// </summary>
/// <remarks>
/// Deliberately not a serializer: the point of most of these tests is what happens when the bytes
/// and the schema disagree, which a serializer would refuse to produce.
/// </remarks>
internal sealed class Payload
{
    private readonly List<byte> _bytes = [];

    public static Payload New() => new();

    public Payload Varint(int field, ulong value) => Tag(field, 0).Varint(value);

    public Payload Varint(int field, long value) => Tag(field, 0).Varint(unchecked((ulong)value));

    public Payload Bool(int field, bool value) => Varint(field, value ? 1UL : 0UL);

    public Payload ZigZag(int field, long value) => Varint(field, unchecked((ulong)((value << 1) ^ (value >> 63))));

    public Payload Fixed32(int field, uint value)
    {
        Tag(field, 5);
        _bytes.AddRange(BitConverter.GetBytes(value));
        return this;
    }

    public Payload Float(int field, float value)
    {
        Tag(field, 5);
        _bytes.AddRange(BitConverter.GetBytes(value));
        return this;
    }

    public Payload Fixed64(int field, ulong value)
    {
        Tag(field, 1);
        _bytes.AddRange(BitConverter.GetBytes(value));
        return this;
    }

    public Payload Double(int field, double value)
    {
        Tag(field, 1);
        _bytes.AddRange(BitConverter.GetBytes(value));
        return this;
    }

    public Payload String(int field, string value) => Len(field, Encoding.UTF8.GetBytes(value));

    public Payload Message(int field, Payload body) => Len(field, body.ToArray());

    public Payload Len(int field, params byte[] payload)
    {
        Tag(field, 2).Varint((ulong)payload.Length);
        _bytes.AddRange(payload);
        return this;
    }

    /// <summary>A group: the body between a start tag and the matching end tag.</summary>
    public Payload Group(int field, Payload body)
    {
        Tag(field, 3);
        _bytes.AddRange(body.ToArray());
        return Tag(field, 4);
    }

    public Payload Raw(params byte[] bytes)
    {
        _bytes.AddRange(bytes);
        return this;
    }

    public byte[] ToArray() => [.. _bytes];

    private Payload Tag(int field, int wireType) => Varint((ulong)((field << 3) | wireType));

    private Payload Varint(ulong value)
    {
        while (value > 0x7F)
        {
            _bytes.Add((byte)((value & 0x7F) | 0x80));
            value >>= 7;
        }
        _bytes.Add((byte)value);
        return this;
    }
}
