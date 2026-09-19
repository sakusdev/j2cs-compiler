namespace J2cs.Runtime;

/// <summary>
/// Bounded RegExp runtime for a compiler-proven literal UTF-16 substring subset.
/// It intentionally does not use System.Text.RegularExpressions as a semantic substitute
/// for ECMAScript RegExp. Unsupported grammar/flags fail closed.
/// </summary>
public static class JsRegExp
{
    private sealed class RegExpObject(string pattern, bool global) : JsObject
    {
        internal string Pattern { get; } = pattern;
        internal bool Global { get; } = global;
        internal double Index { get; set; }
    }

    private const string Meta = @"^$\.*+?()[]{}|";

    public static JsValue CreateLiteral(string pattern, string flags)
    {
        if (pattern.Length == 0 || pattern.Any(c => Meta.IndexOf(c) >= 0))
            throw new NotSupportedException("RegExp backend admits only non-empty literal UTF-16 substring patterns.");
        if (flags is not "" and not "g")
            throw new NotSupportedException("RegExp backend currently admits only no flags or the global g flag.");
        return JsValue.FromReference(new RegExpObject(pattern, flags == "g"));
    }

    public static JsValue Test(JsValue regexp, JsValue input)
    {
        var target = Require(regexp);
        if (input.Kind == JsKind.Object)
            throw new NotSupportedException("RegExp.test object input requires the unmerged ToPrimitive object contract.");
        var text = JsCoercion.ToStringPrimitive(input);
        var start = target.Global ? ToLength(target.Index, text.Length) : 0;
        var found = start <= text.Length ? text.IndexOf(target.Pattern, start, StringComparison.Ordinal) : -1;
        if (found < 0)
        {
            if (target.Global) target.Index = 0d;
            return JsValue.FromBoolean(false);
        }
        if (target.Global) target.Index = found + target.Pattern.Length;
        return JsValue.FromBoolean(true);
    }

    public static JsValue LastIndex(JsValue regexp) => JsValue.FromNumber(Require(regexp).Index);

    public static JsValue SetLastIndex(JsValue regexp, JsValue value)
    {
        var target = Require(regexp);
        if (value.Kind == JsKind.Object)
            throw new NotSupportedException("RegExp.lastIndex object coercion requires the unmerged ToPrimitive object contract.");
        target.Index = JsCoercion.ToNumberPrimitive(value);
        return value;
    }

    private static int ToLength(double value, int maximum)
    {
        if (double.IsNaN(value) || value <= 0) return 0;
        if (double.IsPositiveInfinity(value)) return maximum + 1;
        var truncated = Math.Floor(value);
        return truncated > maximum ? maximum + 1 : (int)truncated;
    }

    private static RegExpObject Require(JsValue value)
        => value.Kind == JsKind.Object && value.Reference is RegExpObject regexp
            ? regexp : throw new InvalidOperationException("JavaScript RegExp proof violated.");
}
