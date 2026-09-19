namespace J2cs.Runtime;

/// <summary>Primitive-only implementations of the canonical j2cs helper contracts.</summary>
public static class JsOperators
{
    public static JsValue Add(JsValue left, JsValue right)
    {
        // ToPrimitive is identity over this profile. Evaluate both source operands before calling.
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
            _ => throw new InvalidOperationException("Unknown value tag")
        };
    }
}

public static class JsReference
{
    public static JsValue Assign(ref JsValue binding, JsValue value) => binding = value;
}
