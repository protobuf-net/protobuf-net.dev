using Google.Protobuf.Reflection;
using ProtoBuf.Reflection;

namespace ProtoGen.Wasm;

/// <summary>
/// Wraps protobuf-net.Reflection's parser and code generators.
/// </summary>
/// <remarks>
/// Imports of <c>google/**</c> and <c>protobuf-net/**</c> resolve from resources embedded in
/// protobuf-net.Reflection, so the common cases need no network access and no server. Any other
/// import fails with protobuf-net's own "unable to find" diagnostic, which is the honest answer:
/// there is no filesystem here to find it on.
/// </remarks>
internal static class Codegen
{
    public static GenerateResponse Generate(GenerateRequest request)
    {
        var response = new GenerateResponse();
        try
        {
            var set = new FileDescriptorSet();
            string fileName = string.IsNullOrWhiteSpace(request.FileName) ? "my.proto" : request.FileName.Trim();
            set.Add(fileName, includeInOutput: true, new StringReader(request.Schema ?? ""));
            set.Process();

            bool fatal = false;
            foreach (var error in set.GetErrors())
            {
                response.Errors.Add(new SchemaError
                {
                    IsError = error.IsError,
                    LineNumber = error.LineNumber,
                    ColumnNumber = error.ColumnNumber,
                    Length = error.Text?.Length ?? 0,
                    Message = error.Message,
                    ErrorNumber = error.ErrorNumber,
                    File = error.File ?? "",
                });
                if (error.IsError) fatal = true;
            }

            // warnings are worth showing alongside output; errors mean there is no output to show
            if (fatal) return response;

            var generator = ResolveGenerator(request.Language);
            var normalizer = ResolveNormalizer(request.NamingConvention);
            foreach (var file in generator.Generate(set, normalizer, BuildOptions(request)))
            {
                response.Files.Add(new GeneratedFile { Name = file.Name, Text = file.Text });
            }
        }
        catch (Exception ex)
        {
            response.Exception = $"{ex.GetType().Name}: {ex.Message}";
        }
        return response;
    }

    private static CodeGenerator ResolveGenerator(string? language) => language?.ToLowerInvariant() switch
    {
        "csharp" or "c#" or null or "" => CSharpCodeGenerator.Default,
        "vb" or "vbnet" or "vb.net" => VBCodeGenerator.Default,
        _ => throw new ArgumentException(
            $"'{language}' is not supported. This tool generates C# and VB.NET via protobuf-net's own " +
            "generators; the other languages protoc supports need protoc itself, which cannot run in a browser."),
    };

    private static NameNormalizer ResolveNormalizer(string? convention) => convention?.ToLowerInvariant() switch
    {
        "original" or "none" => NameNormalizer.Null,
        "noplural" => NameNormalizer.NoPlural,
        _ => NameNormalizer.Default,
    };

    private static Dictionary<string, string> BuildOptions(GenerateRequest request)
    {
        var options = new Dictionary<string, string>();
        if (!string.IsNullOrWhiteSpace(request.LanguageVersion)) options["langver"] = request.LanguageVersion!;
        if (request.Services) options["services"] = "yes";
        if (request.OneOfEnum) options["oneof"] = "enum";
        if (request.ListSet) options["listset"] = "yes";
        if (request.DisableNullWrappers) options["nullwrappers"] = "false";
        if (request.DisableCompatLevel) options["compatlevel"] = "false";
        if (request.NullableValueType) options["nullablevaluetype"] = "yes";
        if (request.RepeatedAsList) options["repeatedaslist"] = "yes";
        return options;
    }
}
