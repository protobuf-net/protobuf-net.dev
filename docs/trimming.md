# Trimming and the `IL2104` suppression

`ProtoGen.Wasm.csproj` publishes with `PublishTrimmed` and `TrimMode=full`, and suppresses
`IL2104` ("assembly produced trim warnings"). This note records what was checked, so the
suppression is a decision rather than a shrug.

## What warns, and why it does not matter here

The warnings come from `protobuf-net.Core`, and every one of them is on the *reflection-based
serializer* — the machinery that builds a serializer for an arbitrary `[ProtoContract]` type at
runtime:

| Location | Warning | Path |
| --- | --- | --- |
| `Internal/DynamicStub.cs` | `IL2055`, `IL2067`, `IL2070` | `MakeGenericType` / `Activator.CreateInstance` for runtime-built serializers |
| `Helpers.cs` | `IL2070` | `Type.GetConstructor` |
| `Internal/TypeHelperT.cs` | `IL2070` | `Type.GetInterfaces` for collection discovery |
| `Meta/TypeModel.cs` | `IL2067` | `Activator.CreateInstance` for list and auxiliary types |
| `ProtoWriter.State.WriteMethods.cs` | `IL2098` | a `DynamicallyAccessedMembers` attribute on a non-`Type` parameter |

This site never reaches that code. It uses two things from the package graph:

1. **`protobuf-net.Reflection`'s parser and code generators** — plain object-graph work over the
   descriptor model, no runtime type resolution.
2. **`CustomProtogenSerializer`** — for reading protobuf-net's own custom options out of a
   descriptor. That is a hand-written `TypeModel` with explicit `ISerializer<T>` implementations
   for every descriptor type, so it resolves serializers statically and never consults the
   reflection path above.

The site does not serialize user types, so `RuntimeTypeModel` is never touched.

## The one warning that is on our path

`protobuf-net.Reflection/TokenExtensions.cs` raises `IL2090`: `EnumCache<T>` calls
`Type.GetFields` on `T` without a `[DynamicallyAccessedMembers(PublicFields)]` annotation. This
*is* on the parse path — it backs enum parsing in the `.proto` DSL.

It survives today because the trimmer keeps enum fields in practice, and the enums in question are
referenced directly from code the trimmer can see. It is nonetheless an annotation gap in the
library rather than something this repo can fix locally; the proper fix is a one-line attribute
upstream in protobuf-net.

**If enum-valued options in schemas ever start failing to parse in a published build, look here
first.**

## How to re-check

```sh
dotnet publish src/ProtoGen.Wasm -c Release 2>&1 | grep -E "IL[0-9]{4}"
```

If a warning appears from an assembly or a code path not listed above, do not extend the
suppression — work out whether the new path is actually reachable first.
