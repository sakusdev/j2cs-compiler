namespace J2cs.Runtime;

/// <summary>Implementations of canonical j2cs operator helper contracts for the admitted value domain.</summary>
public static class JsOperators
{
    public static JsValue Add(JsValue left, JsValue right)
    {
        // Compiler adapter guards keep Object/Array values out until ToPrimitive exists.
        if (left.Kind == JsKind.String || right.Kind == JsKind.String)
            return JsValue.FromString(JsCoercion.ToStringPrimitive(left) + JsCoercion.ToStringPrimitive(right));
        return JsValue.FromNumber(JsCoercion.ToNumberPrimitive(left) + JsCoercion.ToNumberPrimitive(right));
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

    public static bool LooseEquals(JsValue left, JsValue right)
    {
        if (left.Kind == right.Kind) return StrictEquals(left, right);
        if ((left.Kind == JsKind.Null && right.Kind == JsKind.Undefined)
            || (left.Kind == JsKind.Undefined && right.Kind == JsKind.Null)) return true;
        if (left.Kind == JsKind.Number && right.Kind == JsKind.String)
            return left.Number == JsCoercion.ToNumberPrimitive(right);
        if (left.Kind == JsKind.String && right.Kind == JsKind.Number)
            return JsCoercion.ToNumberPrimitive(left) == right.Number;
        if (left.Kind == JsKind.Boolean)
            return LooseEquals(JsValue.FromNumber(left.Boolean ? 1d : 0d), right);
        if (right.Kind == JsKind.Boolean)
            return LooseEquals(left, JsValue.FromNumber(right.Boolean ? 1d : 0d));
        return false;
    }

    public static bool LessThan(JsValue left, JsValue right) =>
        BothStrings(left, right) ? string.CompareOrdinal(left.String, right.String) < 0
            : JsCoercion.ToNumberPrimitive(left) < JsCoercion.ToNumberPrimitive(right);

    public static bool LessThanOrEqual(JsValue left, JsValue right) =>
        BothStrings(left, right) ? string.CompareOrdinal(left.String, right.String) <= 0
            : JsCoercion.ToNumberPrimitive(left) <= JsCoercion.ToNumberPrimitive(right);

    public static bool GreaterThan(JsValue left, JsValue right) =>
        BothStrings(left, right) ? string.CompareOrdinal(left.String, right.String) > 0
            : JsCoercion.ToNumberPrimitive(left) > JsCoercion.ToNumberPrimitive(right);

    public static bool GreaterThanOrEqual(JsValue left, JsValue right) =>
        BothStrings(left, right) ? string.CompareOrdinal(left.String, right.String) >= 0
            : JsCoercion.ToNumberPrimitive(left) >= JsCoercion.ToNumberPrimitive(right);

    private static bool BothStrings(JsValue left, JsValue right) =>
        left.Kind == JsKind.String && right.Kind == JsKind.String;
}

public static class JsReference
{
    public static JsValue Assign(ref JsValue binding, JsValue value) => binding = value;

    public static JsValue AddAssign(ref JsValue binding, JsValue current, JsValue right)
        => binding = JsOperators.Add(current, right);

    public static JsValue SubtractAssignNumber(ref JsValue binding, JsValue current, JsValue right)
        => AssignNumber(ref binding, current.Number - right.Number);

    public static JsValue MultiplyAssignNumber(ref JsValue binding, JsValue current, JsValue right)
        => AssignNumber(ref binding, current.Number * right.Number);

    public static JsValue DivideAssignNumber(ref JsValue binding, JsValue current, JsValue right)
        => AssignNumber(ref binding, current.Number / right.Number);

    public static JsValue RemainderAssignNumber(ref JsValue binding, JsValue current, JsValue right)
        => AssignNumber(ref binding, current.Number % right.Number);

    public static JsValue PrefixIncrementNumber(ref JsValue binding, JsValue current)
        => AssignNumber(ref binding, current.Number + 1d);

    public static JsValue PostfixIncrementNumber(ref JsValue binding, JsValue current)
    {
        binding = JsValue.FromNumber(current.Number + 1d);
        return current;
    }

    public static JsValue PrefixDecrementNumber(ref JsValue binding, JsValue current)
        => AssignNumber(ref binding, current.Number - 1d);

    public static JsValue PostfixDecrementNumber(ref JsValue binding, JsValue current)
    {
        binding = JsValue.FromNumber(current.Number - 1d);
        return current;
    }

    private static JsValue AssignNumber(ref JsValue binding, double value)
    {
        var result = JsValue.FromNumber(value);
        binding = result;
        return result;
    }
}
