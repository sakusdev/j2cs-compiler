namespace J2cs.Runtime;

public delegate void JsCommonJsModuleBody(JsCommonJsContext context);

/// <summary>
/// One CommonJS module instance. The record enters the runtime cache before body
/// execution so cycles can observe partially initialized exports.
/// </summary>
public sealed class JsCommonJsModuleRecord
{
    internal JsCommonJsModuleRecord(string filename)
    {
        Filename = filename;
        Exports = JsObject.Create();
    }

    public string Filename { get; }
    public JsValue Exports { get; internal set; }
    public bool Loaded { get; internal set; }
}

/// <summary>
/// Wrapper-local CommonJS bindings. Exports intentionally captures the initial
/// module.exports identity and is not rebound when module.exports is replaced.
/// </summary>
public sealed class JsCommonJsContext
{
    private readonly JsCommonJsRuntime runtime;

    internal JsCommonJsContext(JsCommonJsRuntime runtime, JsCommonJsModuleRecord module)
    {
        this.runtime = runtime;
        Module = module;
        Exports = module.Exports;
        Dirname = Path.GetDirectoryName(module.Filename) ?? string.Empty;
    }

    public JsCommonJsModuleRecord Module { get; }
    public JsValue Exports { get; }
    public string Filename => Module.Filename;
    public string Dirname { get; }

    public JsValue Require(string specifier) => runtime.Require(this, specifier);
}

/// <summary>
/// Canonical CommonJS execution contract for generated modules. Resolution is
/// supplied by the compiler/host as a canonical filename resolver; this runtime
/// owns wrapper bindings, cache timing, cycles, and module.exports identity.
/// </summary>
public sealed class JsCommonJsRuntime
{
    private readonly Func<string, string, string> resolver;
    private readonly Dictionary<string, JsCommonJsModuleBody> definitions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, JsCommonJsModuleRecord> cache = new(StringComparer.Ordinal);

    public JsCommonJsRuntime(Func<string, string, string> resolver)
        => this.resolver = resolver ?? throw new ArgumentNullException(nameof(resolver));

    public void RegisterModule(string canonicalFilename, JsCommonJsModuleBody body)
    {
        ArgumentException.ThrowIfNullOrEmpty(canonicalFilename);
        ArgumentNullException.ThrowIfNull(body);
        if (!definitions.TryAdd(canonicalFilename, body))
            throw new InvalidOperationException($"CommonJS module already registered: {canonicalFilename}");
    }

    public JsValue RequireFrom(string parentFilename, string specifier)
    {
        ArgumentNullException.ThrowIfNull(parentFilename);
        ArgumentNullException.ThrowIfNull(specifier);
        var resolved = resolver(parentFilename, specifier);
        if (string.IsNullOrEmpty(resolved))
            throw new InvalidOperationException("CommonJS resolver returned an empty canonical filename.");
        return Load(resolved);
    }

    internal JsValue Require(JsCommonJsContext context, string specifier)
        => RequireFrom(context.Filename, specifier);

    public static JsValue SetModuleExports(JsCommonJsContext context, JsValue value)
    {
        ArgumentNullException.ThrowIfNull(context);
        context.Module.Exports = value;
        return value;
    }

    public bool IsCached(string canonicalFilename) => cache.ContainsKey(canonicalFilename);

    private JsValue Load(string canonicalFilename)
    {
        if (cache.TryGetValue(canonicalFilename, out var cached))
            return cached.Exports;

        if (!definitions.TryGetValue(canonicalFilename, out var body))
            throw new FileNotFoundException($"MODULE_NOT_FOUND: {canonicalFilename}", canonicalFilename);

        var module = new JsCommonJsModuleRecord(canonicalFilename);
        cache.Add(canonicalFilename, module);
        var context = new JsCommonJsContext(this, module);
        try
        {
            body(context);
            module.Loaded = true;
            return module.Exports;
        }
        catch
        {
            // Node does not keep a failed module evaluation as a successfully cached module.
            cache.Remove(canonicalFilename);
            throw;
        }
    }
}

public sealed class JsModuleInteropException : Exception
{
    public JsModuleInteropException(string code, string message) : base(message) => Code = code;
    public string Code { get; }
}

/// <summary>Node-specific ESM/CommonJS interop boundaries used only after compiler proof.</summary>
public static class JsNodeModuleInterop
{
    public static JsValue ImportCommonJsDefault(JsCommonJsRuntime runtime, string parentFilename, string specifier)
        => runtime.RequireFrom(parentFilename, specifier);

    public static JsValue ImportCommonJsNamed()
        => throw new NotSupportedException(
            "Named ESM imports from CommonJS require Node host export-name detection and remain fail-closed without that proof.");

    public static JsValue RequireEsm(Func<JsValue> evaluateSynchronousGraph, bool graphContainsTopLevelAwait)
    {
        ArgumentNullException.ThrowIfNull(evaluateSynchronousGraph);
        if (graphContainsTopLevelAwait)
            throw new JsModuleInteropException(
                "ERR_REQUIRE_ASYNC_MODULE",
                "CommonJS require cannot synchronously evaluate an ESM graph containing top-level await.");
        return evaluateSynchronousGraph();
    }
}
