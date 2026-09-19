namespace J2cs.Runtime;

/// <summary>ReferenceError-equivalent boundary for reads of uninitialized ESM lexical cells.</summary>
public sealed class JsModuleReferenceError : Exception
{
    public JsModuleReferenceError(string message) : base(message) { }
}

/// <summary>Static ESM linking failure (missing/ambiguous export, duplicate binding, etc.).</summary>
public sealed class JsModuleLinkException : Exception
{
    public JsModuleLinkException(string message) : base(message) { }
}

/// <summary>
/// One ECMAScript module binding cell. Indirect import cells dereference the exporter on
/// every read; direct cells keep initialization separate from JavaScript undefined/null.
/// </summary>
public sealed class JsModuleBinding
{
    private readonly JsModuleBinding? target;
    private readonly bool mutable;
    private bool initialized;
    private JsValue value;

    private JsModuleBinding(bool mutable) => this.mutable = mutable;
    private JsModuleBinding(JsModuleBinding target)
        => this.target = target ?? throw new ArgumentNullException(nameof(target));

    internal static JsModuleBinding Direct(bool mutable) => new(mutable);
    internal static JsModuleBinding Indirect(JsModuleBinding target) => new(target);

    public bool IsIndirect => target is not null;
    public bool IsInitialized => target?.IsInitialized ?? initialized;
    internal JsModuleBinding Root => target?.Root ?? this;

    public JsValue Read()
    {
        if (target is not null) return target.Read();
        if (!initialized) throw new JsModuleReferenceError("Cannot access an uninitialized ECMAScript module binding.");
        return value;
    }

    public void Initialize(JsValue initialValue)
    {
        if (target is not null) throw new InvalidOperationException("Indirect import bindings are initialized by their target binding.");
        if (initialized) throw new InvalidOperationException("ECMAScript module binding was initialized more than once.");
        value = initialValue;
        initialized = true;
    }

    public void Set(JsValue nextValue)
    {
        if (target is not null) throw new InvalidOperationException("Cannot assign to an imported ECMAScript module binding.");
        if (!initialized) throw new JsModuleReferenceError("Cannot assign to an uninitialized ECMAScript module binding.");
        if (!mutable) throw new InvalidOperationException("Cannot assign to an immutable ECMAScript module binding.");
        value = nextValue;
    }
}
