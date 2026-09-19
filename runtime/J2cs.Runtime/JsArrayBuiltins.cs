using System.Globalization;

namespace J2cs.Runtime;

/// <summary>
/// Canonical non-callback Array builtins for compiler-owned sparse arrays.
/// These helpers intentionally rely on the compiler proof that indexed prototype
/// properties/accessors and Proxy behavior are unavailable.
/// </summary>
public sealed partial class JsArray
{
    public static JsValue At(JsValue receiver, JsValue index)
    {
        var array = RequireArray(receiver);
        double relative = ToIntegerOrInfinity(index);
        if (!double.IsFinite(relative)) return JsUndefined.Value;
        double actual = relative >= 0 ? relative : array.length + relative;
        if (actual < 0 || actual >= array.length) return JsUndefined.Value;
        string key = ((uint)actual).ToString(CultureInfo.InvariantCulture);
        return array.TryGetOwn(key, out var value) ? value : JsUndefined.Value;
    }

    public static JsValue Includes(JsValue receiver, JsValue searchElement, JsValue fromIndex)
    {
        var array = RequireArray(receiver);
        uint start = NormalizeFromIndex(fromIndex, array.length);
        for (uint index = start; index < array.length; index++)
        {
            string key = index.ToString(CultureInfo.InvariantCulture);
            JsValue current = array.TryGetOwn(key, out var value) ? value : JsUndefined.Value;
            if (SameValueZero(current, searchElement)) return JsValue.FromBoolean(true);
        }
        return JsValue.FromBoolean(false);
    }

    public static JsValue IndexOf(JsValue receiver, JsValue searchElement, JsValue fromIndex)
    {
        var array = RequireArray(receiver);
        uint start = NormalizeFromIndex(fromIndex, array.length);
        for (uint index = start; index < array.length; index++)
        {
            string key = index.ToString(CultureInfo.InvariantCulture);
            if (array.TryGetOwn(key, out var value) && JsOperators.StrictEquals(value, searchElement))
                return JsValue.FromNumber(index);
        }
        return JsValue.FromNumber(-1d);
    }

    public static JsValue Pop(JsValue receiver)
    {
        var array = RequireArray(receiver);
        if (array.length == 0) return JsUndefined.Value;

        uint index = array.length - 1;
        string key = index.ToString(CultureInfo.InvariantCulture);
        JsValue result = array.TryGetOwn(key, out var value) ? value : JsUndefined.Value;
        array.DeleteOwn(key);
        array.length = index;
        return result;
    }

    private static double ToIntegerOrInfinity(JsValue value)
    {
        double number = JsCoercion.ToNumberPrimitive(value);
        if (double.IsNaN(number) || number == 0d) return 0d;
        if (!double.IsFinite(number)) return number;
        return Math.Truncate(number);
    }

    private static uint NormalizeFromIndex(JsValue value, uint length)
    {
        double relative = value.Kind == JsKind.Undefined ? 0d : ToIntegerOrInfinity(value);
        if (relative == double.PositiveInfinity) return length;
        if (relative == double.NegativeInfinity) return 0;
        if (relative >= 0) return relative >= length ? length : (uint)relative;

        double candidate = length + relative;
        return candidate <= 0 ? 0 : (uint)candidate;
    }

    private static bool SameValueZero(JsValue left, JsValue right)
    {
        if (left.Kind == JsKind.Number && right.Kind == JsKind.Number
            && double.IsNaN(left.Number) && double.IsNaN(right.Number)) return true;
        return JsOperators.StrictEquals(left, right);
    }
}
