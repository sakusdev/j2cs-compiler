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
}
