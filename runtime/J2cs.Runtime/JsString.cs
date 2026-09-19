namespace J2cs.Runtime;

/// <summary>
/// JavaScript String builtin helpers. System.String is UTF-16, so indexing and
/// slicing operate on ECMAScript code units rather than Unicode scalar values.
/// </summary>
public static class JsString
{
    public static double Length(JsValue receiver) => RequireString(receiver).Length;

    public static JsValue At(JsValue receiver, JsValue index)
    {
        string value = RequireString(receiver);
        double relative = ToIntegerOrInfinity(index);
        if (!double.IsFinite(relative)) return JsUndefined.Value;
        double actual = relative >= 0 ? relative : value.Length + relative;
        if (actual < 0 || actual >= value.Length) return JsUndefined.Value;
        return JsValue.FromString(new string(value[(int)actual], 1));
    }

    public static JsValue CharAt(JsValue receiver, JsValue position)
    {
        string value = RequireString(receiver);
        double index = ToIntegerOrInfinity(position);
        if (!double.IsFinite(index) || index < 0 || index >= value.Length) return JsValue.FromString(string.Empty);
        return JsValue.FromString(new string(value[(int)index], 1));
    }

    public static JsValue Includes(JsValue receiver, JsValue searchValue, JsValue position)
    {
        string value = RequireString(receiver);
        string search = JsCoercion.ToStringPrimitive(searchValue);
        int start = ClampNonNegative(position, value.Length);
        if (search.Length == 0) return JsValue.FromBoolean(true);
        return JsValue.FromBoolean(value.IndexOf(search, start, StringComparison.Ordinal) >= 0);
    }

    public static JsValue IndexOf(JsValue receiver, JsValue searchValue, JsValue position)
    {
        string value = RequireString(receiver);
        string search = JsCoercion.ToStringPrimitive(searchValue);
        int start = ClampNonNegative(position, value.Length);
        if (search.Length == 0) return JsValue.FromNumber(start);
        return JsValue.FromNumber(value.IndexOf(search, start, StringComparison.Ordinal));
    }

    public static JsValue Slice(JsValue receiver, JsValue startValue, JsValue endValue)
    {
        string value = RequireString(receiver);
        int start = RelativeIndex(startValue, value.Length, undefinedMeansLength: false);
        int end = RelativeIndex(endValue, value.Length, undefinedMeansLength: true);
        if (end <= start) return JsValue.FromString(string.Empty);
        return JsValue.FromString(value.Substring(start, end - start));
    }

    public static JsValue Substring(JsValue receiver, JsValue startValue, JsValue endValue)
    {
        string value = RequireString(receiver);
        int start = ClampSubstringIndex(startValue, value.Length, undefinedMeansLength: false);
        int end = ClampSubstringIndex(endValue, value.Length, undefinedMeansLength: true);
        if (start > end) (start, end) = (end, start);
        return JsValue.FromString(value.Substring(start, end - start));
    }

    private static string RequireString(JsValue value)
        => value.Kind == JsKind.String ? value.String : throw new InvalidOperationException("Compiler String proof violated");

    private static double ToIntegerOrInfinity(JsValue value)
    {
        double number = JsCoercion.ToNumberPrimitive(value);
        if (double.IsNaN(number) || number == 0d) return 0d;
        if (!double.IsFinite(number)) return number;
        return Math.Truncate(number);
    }

    private static int ClampNonNegative(JsValue value, int length)
    {
        double index = value.Kind == JsKind.Undefined ? 0d : ToIntegerOrInfinity(value);
        if (index <= 0 || index == double.NegativeInfinity) return 0;
        if (index >= length || index == double.PositiveInfinity) return length;
        return (int)index;
    }

    private static int RelativeIndex(JsValue value, int length, bool undefinedMeansLength)
    {
        if (value.Kind == JsKind.Undefined && undefinedMeansLength) return length;
        double index = ToIntegerOrInfinity(value);
        if (index == double.NegativeInfinity) return 0;
        if (index == double.PositiveInfinity) return length;
        if (index < 0)
        {
            double relative = length + index;
            return relative <= 0 ? 0 : (int)relative;
        }
        return index >= length ? length : (int)index;
    }

    private static int ClampSubstringIndex(JsValue value, int length, bool undefinedMeansLength)
    {
        if (value.Kind == JsKind.Undefined && undefinedMeansLength) return length;
        double index = ToIntegerOrInfinity(value);
        if (index <= 0 || index == double.NegativeInfinity) return 0;
        if (index >= length || index == double.PositiveInfinity) return length;
        return (int)index;
    }
}
