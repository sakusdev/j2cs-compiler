namespace J2cs.Runtime;

/// <summary>
/// JavaScript class constructor-object compatibility boundary used by the independent
/// class lane. It models only reviewed static own-data properties and constructor-object
/// prototype linkage. Instance prototypes, descriptors, accessors, private names and
/// construction are intentionally not claimed here.
/// </summary>
public sealed class JsClass
{
    private readonly Dictionary<string, JsValue> staticData = new(StringComparer.Ordinal);

    public string Name { get; }
    public JsClass? BaseClass { get; }

    private JsClass(string name, JsClass? baseClass)
    {
        Name = name ?? throw new ArgumentNullException(nameof(name));
        BaseClass = baseClass;
    }

    public static JsClass Create(string name) => new(name, null);

    public static JsClass CreateDerived(string name, JsClass baseClass)
        => new(name, baseClass ?? throw new ArgumentNullException(nameof(baseClass)));

    /// <summary>
    /// Runs JavaScript static initialization eagerly at the generated class-evaluation
    /// point. This must not be replaced with CLR lazy static initialization.
    /// </summary>
    public static JsClass Initialize(JsClass target, Action initializer)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(initializer);
        initializer();
        return target;
    }

    /// <summary>
    /// Ordinary constructor-object static data lookup. Reads walk the class constructor
    /// prototype chain, preserving inherited static-field lookup for the admitted data-only surface.
    /// </summary>
    public static JsValue GetStatic(JsClass receiver, string key)
    {
        ArgumentNullException.ThrowIfNull(receiver);
        ArgumentNullException.ThrowIfNull(key);
        for (JsClass? current = receiver; current is not null; current = current.BaseClass)
            if (current.staticData.TryGetValue(key, out var value)) return value;
        return JsUndefined.Value;
    }

    /// <summary>
    /// Ordinary Set on the admitted data-only constructor-object surface creates or
    /// updates an own property on the receiver. In particular, assigning B.x does not
    /// mutate inherited A.x.
    /// </summary>
    public static JsValue SetStatic(JsClass receiver, string key, JsValue value)
    {
        ArgumentNullException.ThrowIfNull(receiver);
        ArgumentNullException.ThrowIfNull(key);
        receiver.staticData[key] = value;
        return value;
    }

    public static bool HasOwnStatic(JsClass receiver, string key)
    {
        ArgumentNullException.ThrowIfNull(receiver);
        ArgumentNullException.ThrowIfNull(key);
        return receiver.staticData.ContainsKey(key);
    }
}
