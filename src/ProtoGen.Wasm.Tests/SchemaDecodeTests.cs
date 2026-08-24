using Xunit;

namespace ProtoGen.Wasm.Tests;

/// <summary>
/// Covers what a schema adds to a payload decode: names, declared types, and a straight answer
/// where the wire format alone could only guess.
/// </summary>
public class SchemaDecodeTests
{
    private const string Schema = """
        syntax = "proto3";
        package demo;

        message Person {
          string name = 1;
          int32 id = 2;
          repeated string tags = 3;
          Address address = 4;
          Kind kind = 5;
          repeated int32 scores = 6;
          map<string, int32> counts = 7;
          bytes blob = 8;
          bool active = 9;
          double ratio = 10;
          sint32 delta = 11;
          float share = 12;
          fixed32 token = 13;
          oneof choice {
            string alias = 20;
            int32 code = 21;
          }
        }

        message Address {
          string city = 1;
          string country = 2;
        }

        enum Kind {
          KIND_UNSPECIFIED = 0;
          KIND_PRIMARY = 1;
        }
        """;

    private const string Proto2Schema = """
        syntax = "proto2";
        package legacy;

        message Outer {
          optional group Inner = 1 {
            optional string label = 1;
          }
          extensions 100 to 200;
        }

        extend Outer {
          optional int32 extra = 100;
        }
        """;

    /// <summary>
    /// Printable text that also parses as a message: two repeats of field 7, varint 49. Without a
    /// schema this is genuinely ambiguous, which is what makes it worth pinning down.
    /// </summary>
    private const string AmbiguousText = "8181";

    private static DecodeResult Decode(string? schema, string? rootType, Payload payload)
        => Decoder.Decode(
            payload.ToArray(),
            new DecodeRequest { Schema = schema, RootType = rootType, FullStrings = true });

    private static DecodeResult DecodePerson(Payload payload) => Decode(Schema, "demo.Person", payload);

    [Fact]
    public void FieldsAreNamedAndTypedFromTheSchema()
    {
        var result = DecodePerson(Payload.New().String(1, "hi").Varint(2, 150));

        Assert.Equal("demo.Person", result.RootType);
        Assert.Null(result.SchemaNote);
        Assert.Equal(0, result.UnknownFields);

        var name = result.Nodes[0];
        Assert.Equal("name", name.Name);
        Assert.Equal("string", name.Declared);
        Assert.Equal("string", name.Primary);
        Assert.Equal("hi", name.Readings[0].Value);

        var id = result.Nodes[1];
        Assert.Equal("id", id.Name);
        Assert.Equal("int32", id.Declared);
        Assert.Equal("int32", id.Readings[0].Kind);
        Assert.Equal("150", id.Readings[0].Value);
    }

    [Fact]
    public void AnUnstatedRootTypeIsInferredAndSaidToBeInferred()
    {
        var result = Decode(Schema, rootType: null, Payload.New().String(1, "hi").Varint(2, 150));

        Assert.Equal("demo.Person", result.RootType);
        Assert.True(result.RootGuessed);
        Assert.Equal("name", result.Nodes[0].Name);
        Assert.Contains("guessed", result.SchemaNote);
    }

    [Fact]
    public void AnUnknownRootTypeIsExplainedRatherThanIgnored()
    {
        var result = Decode(Schema, "demo.Nope", Payload.New().String(1, "hi"));

        Assert.Null(result.RootType);
        Assert.Contains("demo.Nope", result.SchemaNote);
        // the payload is still worth decomposing without it
        Assert.Single(result.Nodes);
    }

    // ---- the guessing the schema is here to remove ----

    [Fact]
    public void TextThatAlsoParsesAsAMessageIsAmbiguousWithoutASchema()
    {
        var result = Decode(null, null, Payload.New().String(1, AmbiguousText));

        var node = result.Nodes[0];
        Assert.True(node.Speculative);
        Assert.NotNull(node.Children);
        Assert.Equal(2, node.Children!.Count);
    }

    [Fact]
    public void ADeclaredStringIsAStringEvenWhenItParsesAsAMessage()
    {
        var result = DecodePerson(Payload.New().String(1, AmbiguousText));

        var node = result.Nodes[0];
        Assert.Equal("name", node.Name);
        Assert.Equal("string", node.Primary);
        Assert.False(node.Speculative);
        Assert.Null(node.Children);
        Assert.Equal(AmbiguousText, node.Readings[0].Value);
    }

    [Fact]
    public void ADeclaredMessageIsDecomposedWithItsOwnFieldNames()
    {
        var result = DecodePerson(
            Payload.New().Message(4, Payload.New().String(1, "Ipswich").String(2, "UK")));

        var node = result.Nodes[0];
        Assert.Equal("address", node.Name);
        Assert.Equal("Address", node.Declared);
        Assert.Equal("message", node.Primary);
        Assert.Equal("demo.Address", node.MessageType);
        Assert.False(node.Speculative);

        Assert.Collection(
            node.Children!,
            city =>
            {
                Assert.Equal("city", city.Name);
                Assert.Equal("Ipswich", city.Readings[0].Value);
            },
            country =>
            {
                Assert.Equal("country", country.Name);
                Assert.Equal("UK", country.Readings[0].Value);
            });
    }

    [Fact]
    public void ADeclaredBytesFieldOffersTextWithoutClaimingIt()
    {
        var result = DecodePerson(Payload.New().String(8, "hello"));

        var node = result.Nodes[0];
        Assert.Equal("blob", node.Name);
        Assert.Equal("bytes", node.Primary);
        Assert.Equal("bytes", node.Readings[0].Kind);
        Assert.Equal("utf-8", node.Readings[1].Kind);
        Assert.Equal("hello", node.Readings[1].Value);
    }

    // ---- scalars ----

    [Theory]
    [InlineData(1, "KIND_PRIMARY = 1")]
    [InlineData(7, "7 (not named in demo.Kind)")]
    public void EnumValuesAreNamedWhereTheSchemaNamesThem(int value, string expected)
    {
        var result = DecodePerson(Payload.New().Varint(5, (ulong)value));

        var node = result.Nodes[0];
        Assert.Equal("kind", node.Name);
        Assert.Equal("Kind", node.Declared);
        Assert.Equal("enum", node.Readings[0].Kind);
        Assert.Equal(expected, node.Readings[0].Value);
    }

    [Fact]
    public void ANegativeInt32IsReadBackAsNegative()
    {
        // -1 is written sign-extended across ten bytes; blind, it reads as 18446744073709551615
        var result = DecodePerson(Payload.New().Varint(2, -1L));

        Assert.Equal("-1", result.Nodes[0].Readings[0].Value);
        Assert.Equal("raw varint", result.Nodes[0].Readings[1].Kind);
        Assert.Equal("18446744073709551615", result.Nodes[0].Readings[1].Value);
    }

    [Fact]
    public void DeclaredScalarsUseTheirOwnEncoding()
    {
        var result = DecodePerson(
            Payload.New()
                .Bool(9, true)
                .Double(10, 1.5)
                .ZigZag(11, -3)
                .Float(12, 0.5f)
                .Fixed32(13, 4294967295));

        Assert.Equal(["true", "1.5", "-3", "0.5", "4294967295"], result.Nodes.Select(n => n.Readings[0].Value));
        Assert.Equal(["bool", "double", "sint32", "float", "fixed32"], result.Nodes.Select(n => n.Readings[0].Kind));
    }

    // ---- repeated, packed and maps ----

    [Fact]
    public void PackedRepeatedScalarsAreReadAsTheirElementType()
    {
        var result = DecodePerson(
            Payload.New().Len(6, Payload.New().Raw(0x01).Raw(0xAC, 0x02).Raw(0x07).ToArray()));

        var node = result.Nodes[0];
        Assert.Equal("scores", node.Name);
        Assert.Equal("repeated int32", node.Declared);
        Assert.Equal("packed int32", node.Readings[0].Kind);
        Assert.Equal("[1, 300, 7]", node.Readings[0].Value);
        Assert.Null(node.Mismatch);
    }

    [Fact]
    public void AnUnpackedRepeatedScalarIsAlsoAccepted()
    {
        // both encodings are legal for the same field, and readers must accept either
        var result = DecodePerson(Payload.New().Varint(6, 5UL).Varint(6, 6UL));

        Assert.Equal(["5", "6"], result.Nodes.Select(n => n.Readings[0].Value));
        Assert.All(result.Nodes, node => Assert.Null(node.Mismatch));
    }

    [Fact]
    public void MapEntriesAreNamedKeyAndValue()
    {
        var result = DecodePerson(
            Payload.New().Message(7, Payload.New().String(1, "a").Varint(2, 2)));

        var node = result.Nodes[0];
        Assert.Equal("counts", node.Name);
        Assert.Equal("map<string, int32>", node.Declared);
        Assert.Collection(
            node.Children!,
            key => Assert.Equal("key", key.Name),
            value => Assert.Equal("value", value.Name));
    }

    [Fact]
    public void OneofMembershipIsCarriedThrough()
    {
        var result = DecodePerson(Payload.New().String(20, "mg"));

        Assert.Equal("alias", result.Nodes[0].Name);
        Assert.Equal("choice", result.Nodes[0].OneOf);
    }

    // ---- where the bytes and the schema disagree ----

    [Fact]
    public void AFieldTheSchemaDoesNotDeclareFallsBackToGuessing()
    {
        var result = DecodePerson(Payload.New().String(1, "hi").Varint(99, 42));

        var node = result.Nodes[1];
        Assert.True(node.Unknown);
        Assert.Null(node.Name);
        Assert.Equal(1, result.UnknownFields);
        // the readings are the schema-free ones, so the field is still analysable
        Assert.Equal("uint64", node.Readings[0].Kind);
        Assert.Equal("42", node.Readings[0].Value);
    }

    [Fact]
    public void AWireTypeThatContradictsTheSchemaIsReported()
    {
        var result = DecodePerson(Payload.New().Varint(1, 42));

        var node = result.Nodes[0];
        Assert.Equal("name", node.Name);
        Assert.Contains("LEN", node.Mismatch);
        Assert.Contains("VARINT", node.Mismatch);
        // and the bytes are still read for what they are
        Assert.Equal("uint64", node.Readings[0].Kind);
    }

    [Fact]
    public void AStringFieldHoldingInvalidUtf8IsReported()
    {
        var result = DecodePerson(Payload.New().Len(1, 0xFF, 0xFE));

        var node = result.Nodes[0];
        Assert.Equal("name", node.Name);
        Assert.Contains("UTF-8", node.Mismatch);
        Assert.Equal("bytes", node.Primary);
    }

    [Fact]
    public void AMessageFieldThatDoesNotParseIsReported()
    {
        var result = DecodePerson(Payload.New().Len(4, 0xFF, 0xFF));

        var node = result.Nodes[0];
        Assert.Equal("address", node.Name);
        Assert.Contains("demo.Address", node.Mismatch);
        Assert.Null(node.Children);
    }

    [Fact]
    public void PackedBytesThatDoNotReadAsTheElementTypeAreReported()
    {
        // a trailing continuation bit with nothing after it cannot be a varint
        var result = DecodePerson(Payload.New().Len(6, 0x01, 0xFF));

        Assert.Contains("packed int32", result.Nodes[0].Mismatch);
    }

    // ---- proto2: groups and extensions ----

    [Fact]
    public void GroupFieldsResolveTheirContents()
    {
        var result = Decode(
            Proto2Schema, "legacy.Outer",
            Payload.New().Group(1, Payload.New().String(1, "tagged")));

        var node = result.Nodes[0];
        Assert.Equal("group", node.Primary);
        Assert.Equal("legacy.Outer.Inner", node.MessageType);
        Assert.Equal("label", node.Children![0].Name);
        Assert.Equal("tagged", node.Children[0].Readings[0].Value);
    }

    [Fact]
    public void ExtensionsAreResolvedAgainstTheMessageTheyExtend()
    {
        var result = Decode(Proto2Schema, "legacy.Outer", Payload.New().Varint(100, 7));

        var node = result.Nodes[0];
        Assert.Equal("extra", node.Name);
        Assert.True(node.Extension);
        Assert.False(node.Unknown);
        Assert.Equal("7", node.Readings[0].Value);
    }

    // ---- schema problems ----

    [Fact]
    public void SchemaErrorsTravelWithTheDecodeRatherThanStoppingIt()
    {
        var result = Decode("syntax = \"proto3\"; message Broken { string ", "Broken", Payload.New().String(1, "hi"));

        Assert.NotNull(result.SchemaErrors);
        Assert.Contains(result.SchemaErrors!, error => error.IsError);
        Assert.Single(result.Nodes);
    }

    [Fact]
    public void TheSameSchemaIsOnlyParsedOnce()
    {
        var first = SchemaSource.Load(Schema, "payload.proto");
        var second = SchemaSource.Load(Schema, "payload.proto");

        Assert.Same(first, second);
    }

    [Fact]
    public void TheTypeListOffersEveryMessageButNotMapEntries()
    {
        var types = Decoder.Types(new DecodeRequest { Schema = Schema }).Types;

        // declaration order, not alphabetical: a .proto's first message is usually its point
        Assert.Equal(["demo.Person", "demo.Address"], types);
    }
}

/// <summary>
/// Covers working out which message a payload is when nobody has said, which is inference rather
/// than decoding, and wrong often enough to be worth pinning down.
/// </summary>
public class RootChoiceTests
{
    private const string Schema = """
        syntax = "proto3";
        package demo;

        message Envelope {
          string id = 1;
          Body body = 2;
        }

        message Body {
          string text = 1;
          int32 count = 2;
        }

        message Unrelated {
          bool flag = 7;
        }

        message Contradicting {
          int32 id = 1;
        }
        """;

    private static DecodeResult Decode(string schema, Payload payload)
        => Decoder.Decode(payload.ToArray(), new DecodeRequest { Schema = schema, FullStrings = true });

    [Fact]
    public void TheMessageThatRecognisesMostOfThePayloadWins()
    {
        // Body would account for field 1 alone; Envelope accounts for it and everything inside
        // field 2, which is what makes it the better answer
        var result = Decode(
            Schema,
            Payload.New().String(1, "e-1").Message(2, Payload.New().String(1, "hi").Varint(2, 3)));

        Assert.Equal("demo.Envelope", result.RootType);
        Assert.True(result.RootGuessed);
        Assert.Null(result.RootAlternatives);
    }

    [Fact]
    public void AMessageThePayloadContradictsIsNotChosen()
    {
        // Contradicting declares field 1 an int32 and the payload wrote a string there; that is
        // the one change protobuf's compatibility rules forbid, so it cannot be this message
        var result = Decode(Schema, Payload.New().String(1, "hi"));

        Assert.Equal("demo.Envelope", result.RootType);
    }

    [Fact]
    public void FieldsTheSchemaDoesNotDeclareDoNotCountAgainstIt()
    {
        // the payload is a Body from a service that has moved on; the extra fields are exactly what
        // an older schema is expected to see, and must not push the ranking towards a message that
        // recognises less of it
        var result = Decode(
            Schema,
            Payload.New().String(1, "hi").Varint(2, 3).String(30, "added").Varint(31, 9).Varint(32, 9));

        Assert.Equal("demo.Body", result.RootType);
        Assert.Equal(3, result.UnknownFields);
        Assert.Equal(["text", "count"], result.Nodes.Take(2).Select(node => node.Name));
    }

    [Fact]
    public void AnEqualFitIsReportedRatherThanPresentedAsAnAnswer()
    {
        // field 1 as a string is all Envelope and Body have in common with this payload, and with
        // each other; declaration order picks one, and the other is named as just as likely
        var result = Decode(Schema, Payload.New().String(1, "hi").Varint(99, 1));

        Assert.Equal("demo.Envelope", result.RootType);
        Assert.Equal(["demo.Body"], result.RootAlternatives);
        Assert.Contains("exactly as well", result.SchemaNote);
    }

    [Fact]
    public void AStatedRootTypeIsNeverSecondGuessed()
    {
        var result = Decoder.Decode(
            Payload.New().String(1, "e-1").Message(2, Payload.New().String(1, "hi")).ToArray(),
            new DecodeRequest { Schema = Schema, RootType = "demo.Body" });

        Assert.Equal("demo.Body", result.RootType);
        Assert.False(result.RootGuessed);
        Assert.Null(result.SchemaNote);
    }

    [Fact]
    public void APayloadNoMessageRecognisesIsLeftAlone()
    {
        // field 9 appears in none of these messages, so there is nothing to choose between them
        var result = Decode(Schema, Payload.New().Varint(9, 1));

        Assert.Null(result.RootType);
        Assert.False(result.RootGuessed);
        Assert.Contains("recognises a single field", result.SchemaNote);
    }

    [Fact]
    public void AMessageIsStillChosenWhenTheBestOneContradictsSomething()
    {
        // field 1 holds a fixed32, which Envelope declares a string; everything else agrees with
        // Envelope and nothing else comes close, so it is still the answer - as long as the
        // disagreement is said out loud rather than rendered as though it were fine
        var result = Decode(
            Schema,
            Payload.New().Fixed32(1, 7).Message(2, Payload.New().String(1, "hi").Varint(2, 3)));

        Assert.Equal("demo.Envelope", result.RootType);
        Assert.True(result.RootGuessed);
        Assert.Contains("contradicts", result.SchemaNote);
    }

    [Fact]
    public void RecognisingNothingLosesToRecognisingSomethingAndDisagreeing()
    {
        // Unrelated declares only field 7, which this payload does not have, so it contradicts
        // nothing - but only by having nothing to say about any of it. That is the worst answer
        // available, not the safest one, and it must not outrank a message that explains a field
        // and disagrees about another.
        var result = Decode(Schema, Payload.New().Fixed32(1, 7).String(2, "hi"));

        Assert.Equal("demo.Envelope", result.RootType);
        Assert.Contains("contradicts", result.SchemaNote);
    }
}
