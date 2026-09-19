namespace J2cs.Runtime;

/// <summary>
/// Ordinary-function this modes owned by the call/reference boundary.
/// Arrow lexical this and bound-function behavior are separate contracts.
/// </summary>
public enum JsThisMode
{
    Strict,
    Sloppy,
}

/// <summary>
/// Captures the ECMAScript distinction between evaluating a callee as a property Reference
/// and evaluating it as a standalone value. The callable implementation is intentionally not
/// duplicated here: the FUNCTIONS_CLOSURES lane will consume this record when its JsFunction
/// runtime is merged.
/// </summary>
public readonly struct JsCallReference
{
    private JsCallReference(JsValue callee, JsValue thisArgument, bool hasPropertyBase)
        => (Callee, ThisArgument, HasPropertyBase) = (callee, thisArgument, hasPropertyBase);

    public JsValue Callee { get; }
    public JsValue ThisArgument { get; }
    public bool HasPropertyBase { get; }

    /// <summary>A plain value call supplies undefined as the ordinary thisArgument.</summary>
    public static JsCallReference FromValue(JsValue callee)
        => new(callee, JsUndefined.Value, false);

    /// <summary>
    /// Evaluate an own-data property exactly once, then retain the base object independently
    /// from the resulting value. This prevents accidental C# delegate receiver capture.
    /// </summary>
    public static JsCallReference FromProperty(JsValue receiver, string property)
    {
        ArgumentNullException.ThrowIfNull(property);
        var callee = JsObject.GetProperty(receiver, property);
        return new(callee, receiver, true);
    }

    public JsValue BindOrdinaryThis(JsThisMode mode, JsValue globalThis)
        => BindOrdinaryThis(ThisArgument, mode, globalThis);

    /// <summary>
    /// OrdinaryCallBindThis subset that is safe in the current runtime profile.
    /// Strict calls preserve every supplied JsValue exactly. Sloppy calls substitute a proven
    /// global object for undefined/null and preserve object receivers. Primitive sloppy this
    /// requires ToObject/prototype semantics owned by the object-model lanes and therefore
    /// fails closed instead of silently changing behavior.
    /// </summary>
    public static JsValue BindOrdinaryThis(JsValue suppliedThis, JsThisMode mode, JsValue globalThis)
    {
        if (mode == JsThisMode.Strict) return suppliedThis;
        if (mode != JsThisMode.Sloppy) throw new ArgumentOutOfRangeException(nameof(mode));

        if (suppliedThis.Kind is JsKind.Undefined or JsKind.Null)
        {
            if (globalThis.Kind != JsKind.Object)
                throw new InvalidOperationException("Sloppy this substitution requires a proven host global object");
            return globalThis;
        }

        if (suppliedThis.Kind == JsKind.Object) return suppliedThis;

        throw new InvalidOperationException(
            "Sloppy primitive this boxing requires ToObject/prototype semantics that are not available in this runtime profile");
    }
}
