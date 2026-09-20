using System.Globalization;

namespace J2cs.Runtime;

/// <summary>
/// Identity-bearing boundary for the admitted ordinary own-data-property object model.
/// The dictionary is private storage, not a claim that Dictionary implements JavaScript
/// prototypes, descriptors, Symbols, accessors, Proxy traps, or enumeration semantics.
/// </summary>
public class JsObject
{
    private readonly Dictionary<string, JsValue> ownData = new(StringComparer.Ordinal);

    protected virtual bool TryGetOwn(string key, out JsValue value) => ownData.TryGetValue(key, out value);
    protected virtual void SetOwn(string key, JsValue value) => ownData[key] = value;
    protected virtual bool DeleteOwn(string key) => ownData.Remove(key);
    public virtual bool HasOwnProperty(string key) => ownData.ContainsKey(key);

    internal static JsObject RequireReference(JsValue value)
        => value.Kind == JsKind.Object ? value.Reference : throw new InvalidOperationException("Compiler Object/Array proof violated");

    public static JsValue Create() => JsValue.FromReference(new JsObject());

    public static JsValue DefineDataProperty(JsValue receiver, string key, JsValue value)
    {
        RequireReference(receiver).SetOwn(key, value);
        return receiver;
    }

    /// <summary>
    /// Own-data lookup used only after compiler proof that the static key cannot observe
    /// an inherited builtin property. Missing own data is distinct from present undefined.
    /// </summary>
    public static JsValue GetProperty(JsValue receiver, string key)
    {
        var target = RequireReference(receiver);
        return target.TryGetOwn(key, out var value) ? value : JsUndefined.Value;
    }

    public static JsValue SetProperty(JsValue receiver, string key, JsValue value)
    {
        RequireReference(receiver).SetOwn(key, value);
        return value;
    }

    public static bool HasOwn(JsValue receiver, string key) => RequireReference(receiver).HasOwnProperty(key);
}

/// <summary>
/// Canonical sparse Array representation. Length is independent from materialized
/// indexed elements, so a hole and an own element whose value is undefined remain distinct.
/// </summary>
public sealed partial class JsArray : JsObject
{
    private uint length;
    private JsArray(uint length) => this.length = length;

    protected override bool TryGetOwn(string key, out JsValue value)
    {
        if (key == "length") { value = JsValue.FromNumber(length); return true; }
        return base.TryGetOwn(key, out value);
    }

    protected override void SetOwn(string key, JsValue value)
    {
        if (key == "length") throw new InvalidOperationException("ArraySetLength is not implemented by this compiler profile");
        base.SetOwn(key, value);
        if (TryArrayIndex(key, out var index) && index >= length) length = index + 1;
    }

    public override bool HasOwnProperty(string key) => key == "length" || base.HasOwnProperty(key);

    private static JsArray RequireArray(JsValue value)
        => RequireReference(value) as JsArray ?? throw new InvalidOperationException("Compiler builtin Array proof violated");

    private static bool TryArrayIndex(string key, out uint index)
    {
        index = 0;
        if (!uint.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed == uint.MaxValue) return false;
        if (parsed.ToString(CultureInfo.InvariantCulture) != key) return false;
        index = parsed; return true;
    }

    public static JsValue Create(double requestedLength)
    {
        if (requestedLength < 0 || requestedLength > uint.MaxValue || Math.Truncate(requestedLength) != requestedLength)
            throw new InvalidOperationException("Compiler Array literal length proof violated");
        return JsValue.FromReference(new JsArray((uint)requestedLength));
    }

    public static JsValue DefineElement(JsValue receiver, double requestedIndex, JsValue value)
    {
        var array = RequireArray(receiver);
        if (requestedIndex < 0 || requestedIndex >= array.length || Math.Truncate(requestedIndex) != requestedIndex)
            throw new InvalidOperationException("Compiler Array literal index proof violated");
        array.SetOwn(((uint)requestedIndex).ToString(CultureInfo.InvariantCulture), value);
        return receiver;
    }

    public static double Length(JsValue receiver) => RequireArray(receiver).length;

    public static JsValue Push(JsValue receiver, params JsValue[] items)
    {
        var array = RequireArray(receiver);
        foreach (var item in items)
        {
            if (array.length == uint.MaxValue)
            {
                array.SetOwn(uint.MaxValue.ToString(CultureInfo.InvariantCulture), item);
                throw new InvalidOperationException("JavaScript Array length overflow");
            }
            array.SetOwn(array.length.ToString(CultureInfo.InvariantCulture), item);
        }
        return JsValue.FromNumber(array.length);
    }
}
