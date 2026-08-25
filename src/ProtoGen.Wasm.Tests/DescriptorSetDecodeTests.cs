using Google.Protobuf.Reflection;
using Xunit;

namespace ProtoGen.Wasm.Tests;

/// <summary>
/// Decodes descriptor.proto's own <c>FileDescriptorSet</c> against descriptor.proto.
/// </summary>
/// <remarks>
/// The rest of the decode tests write their bytes by hand, which keeps them legible but keeps them
/// small. This one is 13 KB of descriptor produced by the same parser the site runs, and it
/// exercises depth, repetition, enums, proto2 groups and nested types in the proportions a real
/// payload has them. It is also the payload most likely to be dropped into the decode view by
/// someone with a .bin they cannot identify, since a serialized descriptor set is what
/// <c>protoc -o</c> and protobuf-net's own tooling emit.
/// </remarks>
public class DescriptorSetDecodeTests
{
    /// <summary>
    /// The entire schema. <see cref="SchemaIndex"/> walks every file in the set, imports included,
    /// so an import is enough to name everything descriptor.proto declares — and the copy resolves
    /// from protobuf-net.Reflection's embedded resources, so this tracks the referenced package
    /// rather than a snapshot checked in beside it.
    /// </summary>
    private const string Schema = """
        syntax = "proto2";
        import "google/protobuf/descriptor.proto";
        """;

    private const string RootType = "google.protobuf.FileDescriptorSet";

    /// <summary>descriptor.proto, parsed and re-serialized: a genuine descriptor set.</summary>
    private static readonly byte[] Payload = BuildPayload();

    private static byte[] BuildPayload()
    {
        var set = new FileDescriptorSet();
        Assert.True(set.Add("google/protobuf/descriptor.proto", includeInOutput: true));
        set.Process();
        Assert.DoesNotContain(set.GetErrors(), error => error.IsError);

        using var ms = new MemoryStream();
        set.Serialize(FileDescriptorSet.Serializer, ms, includeImports: true);
        return ms.ToArray();
    }

    private static DecodeResult Decode(string? rootType = RootType)
        => Decoder.Decode(
            Payload,
            new DecodeRequest { Schema = Schema, RootType = rootType, FullStrings = true });

    private static IEnumerable<Node> Flatten(IEnumerable<Node> nodes)
    {
        foreach (var node in nodes)
        {
            yield return node;
            if (node.Children is not null)
            {
                foreach (var child in Flatten(node.Children)) yield return child;
            }
        }
    }

    [Fact]
    public void EveryByteIsAccountedForAndNothingContradictsTheSchema()
    {
        var result = Decode();
        var all = Flatten(result.Nodes).ToList();

        Assert.Equal(RootType, result.RootType);
        Assert.False(result.RootGuessed);
        Assert.Null(result.Error);
        Assert.Null(result.SchemaNote);
        // one warning, and it is right: nothing in the stub uses what it imports
        Assert.DoesNotContain(result.SchemaErrors!, error => error.IsError);
        Assert.False(result.Truncated);
        Assert.Equal(result.TotalBytes, result.ConsumedBytes);

        // a schema that describes the payload exactly leaves nothing to flag and nothing unnamed
        Assert.DoesNotContain(all, node => node.Mismatch is not null);
        Assert.DoesNotContain(all, node => node.Unknown);
        Assert.DoesNotContain(all, node => node.Name is null);
        Assert.Equal(0, result.UnknownFields);
    }

    [Fact]
    public void ADescriptorSetIsRecognisedWithoutBeingNamed()
    {
        var result = Decode(rootType: null);

        Assert.Equal(RootType, result.RootType);
        Assert.True(result.RootGuessed);
        // 34 messages to choose between, and only one of them fits: the tie-break never runs
        Assert.Null(result.RootAlternatives);
        Assert.Contains("guessed", result.SchemaNote);
    }

    [Fact]
    public void TheDecodeDescribesTheFieldItWasItselfReadThrough()
    {
        var result = Decode();

        var file = Assert.Single(result.Nodes);
        Assert.Equal("file", file.Name);
        Assert.Equal("repeated FileDescriptorProto", file.Declared);
        Assert.Equal("message", file.Primary);
        Assert.Equal("google.protobuf.FileDescriptorProto", file.MessageType);

        // ...and inside it, that same field's own declaration
        var firstMessage = Flatten(file.Children!).First(node => node.Name == "message_type");
        Assert.Equal("FileDescriptorSet", Value(firstMessage, "name"));

        var firstField = Flatten(firstMessage.Children!).First(node => node.Name == "field");
        Assert.Equal("file", Value(firstField, "name"));
        Assert.Equal("1", Value(firstField, "number"));
        Assert.Equal(".google.protobuf.FileDescriptorProto", Value(firstField, "type_name"));

        // enums read as names, not just the numbers on the wire
        Assert.Equal("LABEL_REPEATED = 3", Value(firstField, "label"));
        Assert.Equal("TYPE_MESSAGE = 11", Value(firstField, "type"));

        static string? Value(Node parent, string name)
            => parent.Children!.First(child => child.Name == name).Readings[0].Value;
    }
}
