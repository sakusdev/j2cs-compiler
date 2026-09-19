using System.Globalization;

namespace J2cs.Runtime;

public static class JsCoercion
{
    public static string ToString(JsValue value) => ToStringPrimitive(value);

    public static string ToStringPrimitive(JsValue value) => value.Kind switch
    {
        JsKind.Undefined => "undefined",
        JsKind.Null => "null",
        JsKind.Boolean => value.Boolean ? "true" : "false",
        JsKind.String => value.String,
        JsKind.Number => JsNumber.Format(value.Number),
        _ => throw new InvalidOperationException("Unknown value tag")
    };

    public static double ToNumberPrimitive(JsValue value) => value.Kind switch
    {
        JsKind.Number => value.Number,
        JsKind.String => StringToNumber(value.String),
        JsKind.Boolean => value.Boolean ? 1d : 0d,
        JsKind.Null => 0d,
        JsKind.Undefined => double.NaN,
        _ => throw new InvalidOperationException("Primitive value required")
    };

    public static double StringToNumber(string value)
    {
        string text = TrimWhitespace(value);
        if (text.Length == 0) return 0d;
        if (text == "Infinity" || text == "+Infinity") return double.PositiveInfinity;
        if (text == "-Infinity") return double.NegativeInfinity;
        if (text.Contains("Infinity", StringComparison.OrdinalIgnoreCase)) return double.NaN;

        if (text.Length > 2 && text[0] == '0')
        {
            int radix = text[1] switch { 'x' or 'X' => 16, 'o' or 'O' => 8, 'b' or 'B' => 2, _ => 0 };
            if (radix != 0) return ParseRadixLiteral(text[2..], radix);
        }

        if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double number))
            return double.NaN;
        return number == 0 && text.StartsWith("-", StringComparison.Ordinal) ? -0.0d : number;
    }

    public static double ToInt32Primitive(JsValue value)
    {
        double number = ToNumberPrimitive(value);
        if (number == 0 || !double.IsFinite(number)) return 0d;
        double integer = Math.Truncate(number);
        double modulo = integer % 4294967296d;
        if (modulo < 0) modulo += 4294967296d;
        return modulo >= 2147483648d ? modulo - 4294967296d : modulo;
    }

    internal static string TrimWhitespace(string value)
    {
        int start = 0, end = value.Length;
        while (start < end && IsEcmaWhitespace(value[start])) start++;
        while (end > start && IsEcmaWhitespace(value[end - 1])) end--;
        return value[start..end];
    }

    internal static string TrimLeadingWhitespace(string value)
    {
        int start = 0;
        while (start < value.Length && IsEcmaWhitespace(value[start])) start++;
        return value[start..];
    }

    private static bool IsEcmaWhitespace(char value) => value is
        '\u0009' or '\u000A' or '\u000B' or '\u000C' or '\u000D' or '\u0020' or '\u00A0' or '\u1680' or
        '\u2028' or '\u2029' or '\u202F' or '\u205F' or '\u3000' or '\uFEFF'
        || value is >= '\u2000' and <= '\u200A';

    private static double ParseRadixLiteral(string digits, int radix)
    {
        if (digits.Length == 0) return double.NaN;
        double value = 0d;
        foreach (char c in digits)
        {
            int digit = DigitValue(c);
            if (digit < 0 || digit >= radix) return double.NaN;
            value = value * radix + digit;
        }
        return value;
    }

    internal static int DigitValue(char value) =>
        value is >= '0' and <= '9' ? value - '0' :
        value is >= 'a' and <= 'z' ? value - 'a' + 10 :
        value is >= 'A' and <= 'Z' ? value - 'A' + 10 : -1;
}
