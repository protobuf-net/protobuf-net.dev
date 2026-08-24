using Google.Protobuf.Reflection;
using Type = Google.Protobuf.Reflection.FieldDescriptorProto.Type;

namespace ProtoGen.Wasm;

/// <summary>
/// The parts of a parsed schema the wire walker needs: field numbers to names and declared types,
/// enum numbers to names, addressable by fully-qualified type name.
/// </summary>
/// <remarks>
/// This is a flattened view of the descriptor rather than a wrapper over it. The walker asks the
/// same two questions of every byte it reads - "what is field 3 of this message" and "what is
/// value 2 of this enum" - and both want a dictionary, not a tree walk.
/// </remarks>
internal sealed class SchemaIndex
{
    private readonly Dictionary<string, SchemaMessage> _messages = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SchemaEnum> _enums = new(StringComparer.Ordinal);

    public static readonly SchemaIndex Empty = new();

    /// <summary>Every message in the schema, map entries excluded: the root picker's contents.</summary>
    public IEnumerable<SchemaMessage> RootCandidates
        => _messages.Values.Where(m => !m.IsMapEntry).OrderBy(m => m.DisplayName, StringComparer.Ordinal);

    public SchemaMessage? Message(string? fullName)
        => fullName is not null && _messages.TryGetValue(fullName, out var found) ? found : null;

    public SchemaEnum? Enum(string? fullName)
        => fullName is not null && _enums.TryGetValue(fullName, out var found) ? found : null;

    /// <summary>Resolves a name the user picked, which may or may not carry the leading dot.</summary>
    public SchemaMessage? ResolveRoot(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        name = name.Trim();
        return Message(name.StartsWith('.') ? name : "." + name);
    }

    public static SchemaIndex Build(FileDescriptorSet set)
    {
        var index = new SchemaIndex();

        // In passes, because each needs the one before it finished: nothing can point at a type
        // until every type is declared, nothing can be described until the pointers resolve, and a
        // map cannot be described until its entry's own fields are.
        var fields = new List<(SchemaField Field, FieldDescriptorProto Descriptor)>();
        var extensions = new List<(string Extendee, SchemaField Field)>();

        foreach (var file in set.Files)
        {
            string package = string.IsNullOrEmpty(file.Package) ? "" : "." + file.Package;
            foreach (var message in file.MessageTypes) index.AddMessage(package, package, message, fields, extensions);
            foreach (var value in file.EnumTypes) index.AddEnum(package, value);
            AddExtensions(package, file.Extensions, fields, extensions);
        }

        // an extension is declared on one message and belongs to another, so it is attached to the
        // message it extends - which is where the walker comes looking for the field number
        foreach (var (extendee, field) in extensions)
        {
            if (index.Message(extendee) is { } target) target.Fields.TryAdd(field.Number, field);
        }

        foreach (var (field, descriptor) in fields)
        {
            field.Message = index.Message(descriptor.TypeName);
            field.Enum = index.Enum(descriptor.TypeName);
        }
        // a map is described in terms of its entry type's own fields, so every field needs a
        // description before any map can have one
        foreach (var (field, _) in fields) field.Declared = Describe(field);
        foreach (var (field, _) in fields)
        {
            if (field.Message is { IsMapEntry: true } entry)
            {
                field.Declared = $"map<{entry.Field(1)?.Declared ?? "?"}, {entry.Field(2)?.Declared ?? "?"}>";
            }
        }

        return index;
    }

    private void AddMessage(
        string package, string prefix, DescriptorProto message,
        List<(SchemaField, FieldDescriptorProto)> fields,
        List<(string, SchemaField)> extensions)
    {
        string fullName = $"{prefix}.{message.Name}";
        var entry = new SchemaMessage(fullName, message.Options?.MapEntry == true);
        _messages[fullName] = entry;

        foreach (var field in message.Fields)
        {
            var schemaField = ToField(package, field, message);
            entry.Fields[field.Number] = schemaField;
            fields.Add((schemaField, field));
        }

        foreach (var nested in message.NestedTypes) AddMessage(package, fullName, nested, fields, extensions);
        foreach (var value in message.EnumTypes) AddEnum(fullName, value);
        AddExtensions(package, message.Extensions, fields, extensions);
    }

    private static void AddExtensions(
        string package, List<FieldDescriptorProto> declared,
        List<(SchemaField, FieldDescriptorProto)> fields,
        List<(string, SchemaField)> extensions)
    {
        foreach (var field in declared)
        {
            var schemaField = ToField(package, field, owner: null);
            fields.Add((schemaField, field));
            extensions.Add((field.Extendee, schemaField));
        }
    }

    private static SchemaField ToField(string package, FieldDescriptorProto field, DescriptorProto? owner) => new()
    {
        Name = field.Name,
        Package = package,
        Number = field.Number,
        Kind = field.type,
        RawTypeName = field.ShouldSerializeTypeName() ? field.TypeName : null,
        Repeated = field.label == FieldDescriptorProto.Label.LabelRepeated,
        IsExtension = owner is null,
        // proto3's `optional` is a synthetic one-field oneof; naming it would misdescribe the schema
        OneOf = !field.Proto3Optional && field.ShouldSerializeOneofIndex()
                && owner is not null && field.OneofIndex >= 0 && field.OneofIndex < owner.OneofDecls.Count
            ? owner.OneofDecls[field.OneofIndex].Name
            : null,
    };

    private void AddEnum(string prefix, EnumDescriptorProto value)
    {
        string fullName = $"{prefix}.{value.Name}";
        var entry = new SchemaEnum(fullName);
        // aliases are legal; the first name declared for a number is the canonical one
        foreach (var member in value.Values) entry.Values.TryAdd(member.Number, member.Name);
        _enums[fullName] = entry;
    }

    /// <summary>How the schema declares a field, as it would read in a .proto.</summary>
    private static string Describe(SchemaField field)
    {
        string core = Relative(field.Message?.FullName ?? field.Enum?.FullName, field.Package)
                      // a schema with errors leaves type names unresolved; show what was written
                      ?? (field.Kind is Type.TypeMessage or Type.TypeGroup or Type.TypeEnum
                          ? Relative(field.RawTypeName, field.Package) ?? ScalarName(field.Kind)
                          : ScalarName(field.Kind));

        if (field.Kind == Type.TypeGroup) core = "group " + core;
        return field.Repeated ? "repeated " + core : core;
    }

    /// <summary>
    /// A type name as it would be written next to the field: qualified only as far as it needs to
    /// be. A name from the same package reads the way the .proto does, and one from elsewhere keeps
    /// the package that says where it came from.
    /// </summary>
    private static string? Relative(string? fullName, string package)
    {
        if (fullName is null) return null;
        string prefix = package + ".";
        return fullName.StartsWith(prefix, StringComparison.Ordinal)
            ? fullName[prefix.Length..]
            : fullName.TrimStart('.');
    }

    public static string ScalarName(Type kind) => kind switch
    {
        Type.TypeDouble => "double",
        Type.TypeFloat => "float",
        Type.TypeInt64 => "int64",
        Type.TypeUint64 => "uint64",
        Type.TypeInt32 => "int32",
        Type.TypeFixed64 => "fixed64",
        Type.TypeFixed32 => "fixed32",
        Type.TypeBool => "bool",
        Type.TypeString => "string",
        Type.TypeGroup => "group",
        Type.TypeMessage => "message",
        Type.TypeBytes => "bytes",
        Type.TypeUint32 => "uint32",
        Type.TypeEnum => "enum",
        Type.TypeSfixed32 => "sfixed32",
        Type.TypeSfixed64 => "sfixed64",
        Type.TypeSint32 => "sint32",
        Type.TypeSint64 => "sint64",
        _ => "?",
    };

    /// <summary>The wire type a field of this kind is written as, ignoring packing.</summary>
    public static int ExpectedWireType(Type kind) => kind switch
    {
        Type.TypeDouble or Type.TypeFixed64 or Type.TypeSfixed64 => 1,
        Type.TypeFloat or Type.TypeFixed32 or Type.TypeSfixed32 => 5,
        Type.TypeString or Type.TypeBytes or Type.TypeMessage => 2,
        Type.TypeGroup => 3,
        _ => 0,
    };

    /// <summary>True for the kinds a repeated field may pack into a single length-delimited field.</summary>
    public static bool IsPackable(Type kind)
        => kind is not (Type.TypeString or Type.TypeBytes or Type.TypeMessage or Type.TypeGroup);
}

/// <summary>A message type, by field number.</summary>
internal sealed class SchemaMessage(string fullName, bool isMapEntry)
{
    public string FullName { get; } = fullName;
    public string DisplayName { get; } = fullName.TrimStart('.');
    public bool IsMapEntry { get; } = isMapEntry;
    public Dictionary<int, SchemaField> Fields { get; } = [];

    public SchemaField? Field(int number) => Fields.TryGetValue(number, out var found) ? found : null;
}

/// <summary>An enum type, by value.</summary>
internal sealed class SchemaEnum(string fullName)
{
    public string FullName { get; } = fullName;
    public string DisplayName { get; } = fullName.TrimStart('.');
    public Dictionary<int, string> Values { get; } = [];

    public string? Name(long number)
        => number is >= int.MinValue and <= int.MaxValue && Values.TryGetValue((int)number, out var name)
            ? name
            : null;
}

/// <summary>One field of a message, as the schema declares it.</summary>
internal sealed class SchemaField
{
    public required string Name { get; init; }
    public required int Number { get; init; }
    public required Type Kind { get; init; }
    public required bool Repeated { get; init; }
    public required bool IsExtension { get; init; }

    /// <summary>The package this field was declared in, so type names can be written relative to it.</summary>
    public required string Package { get; init; }

    public string? RawTypeName { get; init; }
    public string? OneOf { get; init; }

    public SchemaMessage? Message { get; set; }
    public SchemaEnum? Enum { get; set; }

    /// <summary>How this reads in a .proto: "string", "repeated Person", "map&lt;string, int32&gt;".</summary>
    public string Declared { get; set; } = "";
}
