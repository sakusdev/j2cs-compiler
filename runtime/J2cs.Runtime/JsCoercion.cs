namespace J2cs.Runtime;

public static class JsCoercion
{
    public static string ToString(JsValue value) => value.Kind switch
    {
        JsKind.Undefined => "undefined",
        JsKind.Null => "null",
        JsKind.Boolean => value.Boolean ? "true" : "false",
        JsKind.String => value.String,
        JsKind.Number => JsNumber.Format(value.Number),
        JsKind.Object => throw new InvalidOperationException("Object ToPrimitive/ToString is intentionally not implemented"),
        _ => throw new InvalidOperationException("Unknown value tag")
    };

    internal static double ToNumberNonString(JsValue value) => value.Kind switch
    {
        JsKind.Number => value.Number,
        JsKind.Boolean => value.Boolean ? 1d : 0d,
        JsKind.Null => 0d,
        JsKind.Undefined => double.NaN,
        JsKind.Object => throw new InvalidOperationException("Object ToPrimitive/ToNumber is intentionally not implemented"),
        _ => throw new InvalidOperationException("Non-string primitive required")
    };
}
