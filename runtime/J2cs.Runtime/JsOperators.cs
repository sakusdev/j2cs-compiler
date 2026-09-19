namespace J2cs.Runtime;

/// <summary>Implementations of canonical j2cs operator helper contracts for the admitted value domain.</summary>
public static class JsOperators
{
    public static JsValue Add(JsValue left, JsValue right)
    {
        // Compiler adapter guards keep Object/Array values out until ToPrimitive exists.
        if (left.Kind == JsKind.String || right.Kind == JsKind.String)
            return JsValue.FromString(JsCoercion.ToString(left) + JsCoercion.ToString(right));
        return JsValue.FromNumber(JsCoercion.ToNumberNonString(left) + JsCoercion.ToNumberNonString(right));
    }

    public static bool StrictEquals(JsValue left, JsValue right)
    {
        if (left.Kind != right.Kind) return false;
        return left.Kind switch
        {
            JsKind.Undefined or JsKind.Null => true,
            JsKind.Number => left.Number == right.Number,
            JsKind.String => string.Equals(left.String, right.String, StringComparison.Ordinal),
            JsKind.Boolean => left.Boolean == right.Boolean,
            JsKind.Object => left.Reference == right.Reference,
            _ => throw new InvalidOperationException("Unknown value tag")
        };
    }
}

public static class JsReference
{
    public static JsValue Assign(ref JsValue binding, JsValue value) => binding = value;
}
