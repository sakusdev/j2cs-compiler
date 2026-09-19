namespace J2cs.Runtime;

public enum JsModuleState { Unlinked, Linking, Linked, Evaluating, Evaluated, Errored }

/// <summary>
/// Runtime Module Record for the synchronous ESM subset. Host/package resolution and
/// source parsing stay in the compiler; this record owns live cells, reexports, graph
/// ordering, namespace identity, and exactly-once evaluation.
/// </summary>
public sealed class JsModuleRecord
{
    private readonly Dictionary<string, JsModuleBinding> locals = new(StringComparer.Ordinal);
    private readonly Dictionary<string, JsModuleBinding> explicitExports = new(StringComparer.Ordinal);
    private readonly List<JsModuleRecord> starExports = [];
    private readonly List<JsModuleRecord> dependencies = [];
    private JsModuleNamespace? moduleNamespace;
    private Action<JsModuleRecord>? body;
    private Exception? failure;

    public JsModuleRecord(string identifier)
        => Identifier = string.IsNullOrWhiteSpace(identifier)
            ? throw new ArgumentException("Module identifier is required.", nameof(identifier))
            : identifier;

    public string Identifier { get; }
    public JsModuleState State { get; internal set; } = JsModuleState.Unlinked;
    internal IReadOnlyList<JsModuleRecord> Dependencies => dependencies;
    internal Exception? Failure => failure;

    public JsModuleBinding DeclareLocal(string name, bool mutable)
    {
        if (locals.ContainsKey(name)) throw new JsModuleLinkException($"Duplicate module binding '{name}' in {Identifier}.");
        var binding = JsModuleBinding.Direct(mutable);
        locals.Add(name, binding);
        return binding;
    }

    internal JsModuleBinding DeclareImport(string name, JsModuleBinding target)
    {
        if (locals.ContainsKey(name)) throw new JsModuleLinkException($"Duplicate module binding '{name}' in {Identifier}.");
        var binding = JsModuleBinding.Indirect(target);
        locals.Add(name, binding);
        return binding;
    }

    internal JsModuleBinding DeclareInitializedLocal(string name, JsValue value)
    {
        var binding = DeclareLocal(name, mutable: false);
        binding.Initialize(value);
        return binding;
    }

    public JsModuleBinding Local(string name)
        => locals.TryGetValue(name, out var binding)
            ? binding
            : throw new JsModuleLinkException($"Unknown module binding '{name}' in {Identifier}.");

    internal void AddExport(string name, JsModuleBinding binding)
    {
        if (!explicitExports.TryAdd(name, binding))
            throw new JsModuleLinkException($"Duplicate explicit export '{name}' in {Identifier}.");
    }

    internal void AddStarExport(JsModuleRecord target)
        => starExports.Add(target ?? throw new ArgumentNullException(nameof(target)));

    internal void AddDependency(JsModuleRecord target)
        => dependencies.Add(target ?? throw new ArgumentNullException(nameof(target)));

    public void SetBody(Action<JsModuleRecord> evaluator)
        => body = evaluator ?? throw new ArgumentNullException(nameof(evaluator));

    internal void ExecuteBody() => body?.Invoke(this);
    internal void RememberFailure(Exception error) => failure = error;

    private readonly record struct ResolveKey(JsModuleRecord Module, string Name);
    internal readonly record struct Resolution(JsModuleBinding? Binding, bool Ambiguous)
    {
        internal static Resolution Missing => new(null, false);
        internal static Resolution Conflict => new(null, true);
    }

    internal Resolution ResolveExport(string name, HashSet<ResolveKey>? resolveSet = null)
    {
        resolveSet ??= [];
        var key = new ResolveKey(this, name);
        if (!resolveSet.Add(key)) return Resolution.Missing;

        if (explicitExports.TryGetValue(name, out var direct)) return new Resolution(direct, false);
        if (name == "default") return Resolution.Missing;

        JsModuleBinding? found = null;
        foreach (var star in starExports)
        {
            var candidate = star.ResolveExport(name, resolveSet);
            if (candidate.Ambiguous) return Resolution.Conflict;
            if (candidate.Binding is null) continue;
            if (found is null) found = candidate.Binding;
            else if (!ReferenceEquals(found.Root, candidate.Binding.Root)) return Resolution.Conflict;
        }
        return new Resolution(found, false);
    }

    internal string[] ExportedNames(HashSet<JsModuleRecord>? visited = null)
    {
        visited ??= [];
        if (!visited.Add(this)) return [];
        var candidates = new HashSet<string>(explicitExports.Keys, StringComparer.Ordinal);
        foreach (var star in starExports)
            foreach (var name in star.ExportedNames(visited))
                if (name != "default") candidates.Add(name);

        return candidates.Where(name =>
        {
            var resolution = ResolveExport(name);
            return resolution.Binding is not null && !resolution.Ambiguous;
        }).OrderBy(name => name, StringComparer.Ordinal).ToArray();
    }

    internal JsModuleNamespace NamespaceObject()
        => moduleNamespace ??= new JsModuleNamespace(this);
}

/// <summary>
/// Canonical module namespace identity. It exposes live export reads, rejects writes,
/// is non-extensible by construction, and reports sorted string export keys. Prototype /
/// descriptor APIs in sibling object-model lanes must recognize this marker instead of
/// flattening it into an ordinary dictionary.
/// </summary>
public sealed class JsModuleNamespace : JsObject
{
    private readonly JsModuleRecord module;
    internal JsModuleNamespace(JsModuleRecord module) => this.module = module;

    public bool HasNullPrototype => true;
    public bool IsExtensible => false;
    public string[] OwnKeys() => module.ExportedNames();

    protected override bool TryGetOwn(string key, out JsValue value)
    {
        var resolution = module.ResolveExport(key);
        if (resolution.Binding is null || resolution.Ambiguous)
        {
            value = JsUndefined.Value;
            return false;
        }
        value = resolution.Binding.Read();
        return true;
    }

    protected override void SetOwn(string key, JsValue value)
        => throw new InvalidOperationException($"Cannot mutate ECMAScript module namespace export '{key}'.");

    public override bool HasOwnProperty(string key)
    {
        var resolution = module.ResolveExport(key);
        return resolution.Binding is not null && !resolution.Ambiguous;
    }
}

public static class JsModuleRuntime
{
    private static JsModuleBinding ResolveRequiredExport(JsModuleRecord module, string exportName)
    {
        var resolution = module.ResolveExport(exportName);
        if (resolution.Ambiguous)
            throw new JsModuleLinkException($"Export '{exportName}' is ambiguous in {module.Identifier}.");
        return resolution.Binding
            ?? throw new JsModuleLinkException($"Export '{exportName}' is missing in {module.Identifier}.");
    }

    public static JsModuleBinding BindImport(
        JsModuleRecord module, string localName, JsModuleRecord targetModule, string exportName)
        => module.DeclareImport(localName, ResolveRequiredExport(targetModule, exportName));

    public static JsModuleBinding BindNamespaceImport(
        JsModuleRecord module, string localName, JsModuleRecord targetModule)
        => module.DeclareInitializedLocal(localName, NamespaceObject(targetModule));

    public static JsModuleBinding ExportLocal(
        JsModuleRecord module, string exportName, JsModuleBinding localBinding)
    {
        module.AddExport(exportName, localBinding);
        return localBinding;
    }

    public static JsModuleBinding ExportAlias(
        JsModuleRecord module, string exportName, JsModuleBinding localBinding)
        => ExportLocal(module, exportName, localBinding);

    public static JsModuleBinding ReExport(
        JsModuleRecord module, string exportName, JsModuleRecord targetModule, string importedName)
    {
        var binding = ResolveRequiredExport(targetModule, importedName);
        module.AddExport(exportName, binding);
        return binding;
    }

    public static void ReExportStar(JsModuleRecord module, JsModuleRecord targetModule)
        => module.AddStarExport(targetModule);

    public static JsModuleBinding ReExportNamespace(
        JsModuleRecord module, string exportName, JsModuleRecord targetModule)
    {
        var binding = JsModuleBinding.Direct(mutable: false);
        binding.Initialize(NamespaceObject(targetModule));
        module.AddExport(exportName, binding);
        return binding;
    }

    public static JsModuleBinding InitializeDefaultExport(JsModuleRecord module, JsValue value)
    {
        var binding = JsModuleBinding.Direct(mutable: false);
        binding.Initialize(value);
        module.AddExport("default", binding);
        return binding;
    }

    public static JsModuleBinding ExportDefaultDeclaration(JsModuleRecord module, JsModuleBinding binding)
    {
        module.AddExport("default", binding);
        return binding;
    }

    public static void RequireDependency(JsModuleRecord module, JsModuleRecord targetModule)
        => module.AddDependency(targetModule);

    public static JsValue ReadBinding(JsModuleBinding binding) => binding.Read();

    public static JsValue NamespaceObject(JsModuleRecord module)
        => JsValue.FromReference(module.NamespaceObject());

    public static string[] NamespaceOwnKeys(JsValue namespaceValue)
        => JsObject.RequireReference(namespaceValue) is JsModuleNamespace ns
            ? ns.OwnKeys()
            : throw new InvalidOperationException("Compiler module-namespace proof violated.");

    public static JsValue TopLevelThis => JsUndefined.Value;

    public static void Link(params JsModuleRecord[] modules)
    {
        foreach (var module in modules) LinkOne(module);
    }

    private static void LinkOne(JsModuleRecord module)
    {
        if (module.State is JsModuleState.Linked or JsModuleState.Evaluating or JsModuleState.Evaluated) return;
        if (module.State == JsModuleState.Linking) return;
        if (module.State == JsModuleState.Errored)
            throw module.Failure ?? new JsModuleLinkException($"Module {module.Identifier} previously failed.");

        module.State = JsModuleState.Linking;
        try
        {
            foreach (var dependency in module.Dependencies) LinkOne(dependency);
            module.State = JsModuleState.Linked;
        }
        catch (Exception error)
        {
            module.RememberFailure(error);
            module.State = JsModuleState.Errored;
            throw;
        }
    }

    public static void Evaluate(JsModuleRecord module)
    {
        if (module.State == JsModuleState.Evaluated) return;
        if (module.State == JsModuleState.Evaluating) return;
        if (module.State == JsModuleState.Errored)
            throw module.Failure ?? new InvalidOperationException($"Module {module.Identifier} previously failed.");
        if (module.State == JsModuleState.Unlinked) LinkOne(module);

        module.State = JsModuleState.Evaluating;
        try
        {
            foreach (var dependency in module.Dependencies) Evaluate(dependency);
            module.ExecuteBody();
            module.State = JsModuleState.Evaluated;
        }
        catch (Exception error)
        {
            module.RememberFailure(error);
            module.State = JsModuleState.Errored;
            throw;
        }
    }

    public static void LinkAndEvaluate(JsModuleRecord entry)
    {
        Link(entry);
        Evaluate(entry);
    }
}
