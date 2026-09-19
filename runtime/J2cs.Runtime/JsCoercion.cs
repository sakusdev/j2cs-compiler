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
        _ => throw new InvalidOperationException("Unknown value tag")
    };

    // The Add helper reaches this only after ruling out String. This is deliberately not
    // a general ToNumber implementation: string grammar, objects, Symbol and BigInt are deferred.
    internal static double ToNumberNonString(JsValue value) => value.Kind switch
    {
        JsKind.Number => value.Number,
        JsKind.Boolean => value.Boolean ? 1d : 0d,
        JsKind.Null => 0d,
        JsKind.Undefined => double.NaN,
        _ => throw new InvalidOperationException("Non-string primitive required")
    };
}
