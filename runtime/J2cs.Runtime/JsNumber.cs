using System.Globalization;

namespace J2cs.Runtime;

public static class JsNumber
{
    // .NET 8 supplies shortest round-trippable binary64 digits. Apply ECMAScript's
    // decimal/scientific thresholds and exponent spelling, independently of locale.
    public static string Format(double value, bool inspect = false)
    {
        if (double.IsNaN(value)) return "NaN";
        if (double.IsPositiveInfinity(value)) return "Infinity";
        if (double.IsNegativeInfinity(value)) return "-Infinity";
        if (value == 0) return inspect && double.IsNegative(value) ? "-0" : "0";
        string sign = value < 0 ? "-" : "";
        string raw = Math.Abs(value).ToString("R", CultureInfo.InvariantCulture);
        int e = raw.IndexOf('E');
        int exponent = e < 0 ? 0 : int.Parse(raw[(e + 1)..], CultureInfo.InvariantCulture);
        string mantissa = e < 0 ? raw : raw[..e];
        int dot = mantissa.IndexOf('.');
        int point = (dot < 0 ? mantissa.Length : dot) + exponent;
        string digits = mantissa.Replace(".", "");
        int leading = 0;
        while (leading < digits.Length - 1 && digits[leading] == '0') leading++;
        digits = digits[leading..]; point -= leading;
        digits = digits.TrimEnd('0');
        int power = point - 1;
        if (power >= 21 || power < -6)
            return sign + digits[0] + (digits.Length > 1 ? "." + digits[1..] : "")
                + "e" + (power >= 0 ? "+" : "") + power.ToString(CultureInfo.InvariantCulture);
        if (point <= 0) return sign + "0." + new string('0', -point) + digits;
        if (point >= digits.Length) return sign + digits + new string('0', point - digits.Length);
        return sign + digits[..point] + "." + digits[point..];
    }
    public static double ParseFloatPrimitive(string value)
    {
        string text = JsCoercion.TrimLeadingWhitespace(value);
        if (text.Length == 0) return double.NaN;
        int cursor = 0;
        if (text[cursor] is '+' or '-') cursor++;
        bool negative = text[0] == '-';
        if (cursor < text.Length && text[cursor..].StartsWith("Infinity", StringComparison.Ordinal))
            return negative ? double.NegativeInfinity : double.PositiveInfinity;

        bool hasDigit = false;
        while (cursor < text.Length && text[cursor] is >= '0' and <= '9') { cursor++; hasDigit = true; }
        if (cursor < text.Length && text[cursor] == '.')
        {
            cursor++;
            while (cursor < text.Length && text[cursor] is >= '0' and <= '9') { cursor++; hasDigit = true; }
        }
        if (!hasDigit) return double.NaN;
        int end = cursor;
        if (cursor < text.Length && (text[cursor] is 'e' or 'E'))
        {
            int exponent = cursor++;
            if (cursor < text.Length && (text[cursor] is '+' or '-')) cursor++;
            int digits = cursor;
            while (cursor < text.Length && text[cursor] is >= '0' and <= '9') cursor++;
            if (cursor > digits) end = cursor;
            else cursor = exponent;
        }

        string token = text[..end];
        if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double number))
            return double.NaN;
        return number == 0 && negative ? -0.0d : number;
    }

    public static double ParseIntPrimitive(string value, double radixNumber)
    {
        string text = JsCoercion.TrimLeadingWhitespace(value);
        if (text.Length == 0) return double.NaN;
        int cursor = 0, sign = 1;
        if (text[cursor] is '+' or '-')
        {
            if (text[cursor] == '-') sign = -1;
            cursor++;
        }
        int radix = (int)radixNumber;
        bool hexPrefix = cursor + 1 < text.Length && text[cursor] == '0' && (text[cursor + 1] is 'x' or 'X');
        if (radix == 0)
        {
            radix = hexPrefix ? 16 : 10;
            if (hexPrefix) cursor += 2;
        }
        else
        {
            if (radix < 2 || radix > 36) return double.NaN;
            if (radix == 16 && hexPrefix) cursor += 2;
        }

        int start = cursor;
        double number = 0d;
        while (cursor < text.Length)
        {
            int digit = JsCoercion.DigitValue(text[cursor]);
            if (digit < 0 || digit >= radix) break;
            number = number * radix + digit;
            cursor++;
        }
        if (cursor == start) return double.NaN;
        if (number == 0 && sign < 0) return -0.0d;
        return sign < 0 ? -number : number;
    }

}
