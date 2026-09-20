using System.Globalization;

namespace J2cs.Runtime;

/// <summary>
/// Date helpers for proof-gated canonical j2cs Date rules. Local-time/DST semantics are
/// intentionally absent: callers may only use the explicitly portable contracts here.
/// </summary>
public static class JsDate
{
    private const double MsPerDay = 86_400_000d;
    private const double MaxTime = 8_640_000_000_000_000d;

    public static double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public static double TimeClip(double time)
    {
        if (!double.IsFinite(time) || Math.Abs(time) > MaxTime) return double.NaN;
        var clipped = Math.Truncate(time);
        return clipped == 0d ? 0d : clipped;
    }

    public static double Utc(params JsValue[] arguments)
    {
        if (arguments.Length == 0) return double.NaN;

        Span<double> parts = stackalloc double[7] { double.NaN, 0d, 1d, 0d, 0d, 0d, 0d };
        for (var i = 0; i < Math.Min(arguments.Length, parts.Length); i++)
        {
            var number = JsCoercion.ToNumberPrimitive(arguments[i]);
            if (!double.IsFinite(number)) return double.NaN;
            parts[i] = Math.Truncate(number);
        }

        var year = parts[0];
        if (year is >= 0 and <= 99) year += 1900;
        return MakeUtc(year, parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]);
    }

    /// <summary>
    /// Parse the deterministic portable subset of the ECMAScript Date Time String Format:
    /// YYYY-MM-DD, or YYYY-MM-DDTHH:mm:ss[.sss] followed by Z or an explicit ±HH:mm offset.
    /// Standard local-time strings without an offset require host timezone/DST semantics and
    /// are deliberately rejected by the backend proof guard rather than approximated.
    /// </summary>
    public static double ParseStandard(JsValue input)
    {
        if (input.Kind != JsKind.String)
            throw new InvalidOperationException("Date.parse standard-string proof requires String input.");
        var text = input.String;
        if (text.Length == 10)
        {
            if (!TryDate(text.AsSpan(), out var y, out var m, out var d)) return double.NaN;
            return MakeUtc(y, m - 1, d, 0, 0, 0, 0);
        }

        if (text.Length < 20 || text[10] != 'T') return double.NaN;
        if (!TryDate(text.AsSpan(0, 10), out var year, out var month, out var day)) return double.NaN;
        if (!Try2(text, 11, out var hour) || text[13] != ':' || !Try2(text, 14, out var minute)
            || text[16] != ':' || !Try2(text, 17, out var second)) return double.NaN;

        var cursor = 19;
        var millisecond = 0;
        if (cursor < text.Length && text[cursor] == '.')
        {
            if (cursor + 4 > text.Length || !Try3(text, cursor + 1, out millisecond)) return double.NaN;
            cursor += 4;
        }

        var offsetMinutes = 0;
        if (cursor == text.Length - 1 && text[cursor] == 'Z')
        {
            cursor++;
        }
        else if (cursor + 6 == text.Length && (text[cursor] == '+' || text[cursor] == '-')
            && Try2(text, cursor + 1, out var offsetHour) && text[cursor + 3] == ':'
            && Try2(text, cursor + 4, out var offsetMinute) && offsetHour <= 23 && offsetMinute <= 59)
        {
            offsetMinutes = (offsetHour * 60 + offsetMinute) * (text[cursor] == '+' ? 1 : -1);
            cursor += 6;
        }
        else
        {
            throw new NotSupportedException("Date.parse local-time or non-portable standard form requires host timezone semantics.");
        }

        if (cursor != text.Length || minute > 59 || second > 59 || hour > 24
            || (hour == 24 && (minute != 0 || second != 0 || millisecond != 0))) return double.NaN;

        var value = MakeUtc(year, month - 1, day, hour, minute, second, millisecond);
        return double.IsNaN(value) ? value : TimeClip(value - offsetMinutes * 60_000d);
    }

    private static double MakeUtc(double year, double month, double date, double hour, double minute, double second, double millisecond)
    {
        if (!AllFinite(year, month, date, hour, minute, second, millisecond)) return double.NaN;
        if (year < long.MinValue || year > long.MaxValue || month < long.MinValue || month > long.MaxValue
            || date < long.MinValue || date > long.MaxValue) return double.NaN;

        var y = (long)Math.Truncate(year);
        var m = (long)Math.Truncate(month);
        var dt = (long)Math.Truncate(date);
        var monthYears = FloorDiv(m, 12);
        if ((monthYears > 0 && y > long.MaxValue - monthYears) || (monthYears < 0 && y < long.MinValue - monthYears))
            return double.NaN;
        var normalizedYear = y + monthYears;
        var normalizedMonth = (int)(m - monthYears * 12);
        if (normalizedYear < int.MinValue || normalizedYear > int.MaxValue) return double.NaN;

        var day = DayFromYear((int)normalizedYear) + DayBeforeMonth((int)normalizedYear, normalizedMonth) + dt - 1d;
        var value = day * MsPerDay
            + Math.Truncate(hour) * 3_600_000d
            + Math.Truncate(minute) * 60_000d
            + Math.Truncate(second) * 1_000d
            + Math.Truncate(millisecond);
        return TimeClip(value);
    }

    private static bool AllFinite(params double[] values) => values.All(double.IsFinite);

    private static long FloorDiv(long value, long divisor)
    {
        var quotient = value / divisor;
        var remainder = value % divisor;
        return remainder < 0 ? quotient - 1 : quotient;
    }

    private static long DayFromYear(int year)
    {
        static long DaysBeforeYear(long y)
            => 365L * y + FloorDiv(y - 1, 4) - FloorDiv(y - 1, 100) + FloorDiv(y - 1, 400);
        return DaysBeforeYear(year) - DaysBeforeYear(1970);
    }

    private static int DayBeforeMonth(int year, int month)
    {
        ReadOnlySpan<int> normal = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        var day = normal[month];
        if (month >= 2 && IsLeapYear(year)) day++;
        return day;
    }

    private static bool IsLeapYear(int year) => year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);

    private static bool TryDate(ReadOnlySpan<char> text, out int year, out int month, out int day)
    {
        year = month = day = 0;
        if (text.Length != 10 || text[4] != '-' || text[7] != '-'
            || !int.TryParse(text[..4], NumberStyles.None, CultureInfo.InvariantCulture, out year)
            || !int.TryParse(text.Slice(5, 2), NumberStyles.None, CultureInfo.InvariantCulture, out month)
            || !int.TryParse(text.Slice(8, 2), NumberStyles.None, CultureInfo.InvariantCulture, out day)
            || month is < 1 or > 12) return false;
        var days = month switch
        {
            2 => IsLeapYear(year) ? 29 : 28,
            4 or 6 or 9 or 11 => 30,
            _ => 31,
        };
        return day >= 1 && day <= days;
    }

    private static bool Try2(string text, int start, out int value)
        => int.TryParse(text.AsSpan(start, 2), NumberStyles.None, CultureInfo.InvariantCulture, out value);

    private static bool Try3(string text, int start, out int value)
        => int.TryParse(text.AsSpan(start, 3), NumberStyles.None, CultureInfo.InvariantCulture, out value);
}
