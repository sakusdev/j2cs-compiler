using System.Text;

namespace J2cs.Runtime.NodeCompat;

public static class NodeUtil
{
    public static string Format(JsValue format, params JsValue[] args)
    {
        if (format.Kind != JsKind.String)
            return JoinValues(new[] { format }.Concat(args));

        string formatString = format.String;
        if (args.Length == 0) return formatString;

        var builder = new StringBuilder();
        int argumentIndex = 0;
        for (int i = 0; i < formatString.Length; i++)
        {
            if (formatString[i] != '%' || i + 1 >= formatString.Length)
            {
                builder.Append(formatString[i]);
                continue;
            }

            char specifier = formatString[i + 1];
            if (specifier == '%')
            {
                builder.Append('%');
                i++;
                continue;
            }

            if (!IsSupportedSpecifier(specifier) || argumentIndex >= args.Length)
            {
                builder.Append('%');
                continue;
            }

            JsValue value = args[argumentIndex++];
            builder.Append(FormatSpecifier(specifier, value));
            i++;
        }

        if (argumentIndex < args.Length)
        {
            if (builder.Length != 0) builder.Append(' ');
            builder.Append(JoinValues(args.Skip(argumentIndex)));
        }

        return builder.ToString();
    }

    private static bool IsSupportedSpecifier(char value) =>
        value is 's' or 'd' or 'i' or 'f' or 'j' or 'o' or 'O' or 'c';

    private static string FormatSpecifier(char specifier, JsValue value) => specifier switch
    {
        's' => JsCoercion.ToStringPrimitive(RequirePrimitive(value)),
        'd' => JsNumber.Format(JsCoercion.ToNumberPrimitive(RequirePrimitive(value))),
        'i' => JsNumber.Format(ParseInteger(value)),
        'f' => JsNumber.Format(ParseFloat(value)),
        'j' => JsonPrimitive(value),
        'o' or 'O' => InspectPrimitive(value),
        'c' => string.Empty,
        _ => throw new InvalidOperationException("Unsupported util.format specifier."),
    };

    private static string JoinValues(IEnumerable<JsValue> values) =>
        string.Join(" ", values.Select(FormatExtraValue));

    private static string FormatExtraValue(JsValue value) =>
        value.Kind == JsKind.String ? value.String : InspectPrimitive(value);

    private static string InspectPrimitive(JsValue value) => value.Kind switch
    {
        JsKind.Undefined => "undefined",
        JsKind.Null => "null",
        JsKind.Boolean => value.Boolean ? "true" : "false",
        JsKind.Number => JsNumber.Format(value.Number, inspect: true),
        JsKind.String => "'" + value.String.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("'", "\\'", StringComparison.Ordinal)
            .Replace("\n", "\\n", StringComparison.Ordinal)
            .Replace("\r", "\\r", StringComparison.Ordinal) + "'",
        _ => throw new InvalidOperationException("NODE_URL_UTIL_ZLIB_MISC util.format only admits primitive values."),
    };

    private static JsValue RequirePrimitive(JsValue value) =>
        value.Kind == JsKind.Object
            ? throw new InvalidOperationException("NODE_URL_UTIL_ZLIB_MISC util.format object formatting is not enabled.")
            : value;

    private static double ParseInteger(JsValue value) => value.Kind switch
    {
        JsKind.String => JsNumber.ParseIntPrimitive(value.String, 0),
        JsKind.Number => Math.Truncate(value.Number),
        _ => double.NaN,
    };

    private static double ParseFloat(JsValue value) => value.Kind switch
    {
        JsKind.String => JsNumber.ParseFloatPrimitive(value.String),
        JsKind.Number => value.Number,
        _ => double.NaN,
    };

    private static string JsonPrimitive(JsValue value) => value.Kind switch
    {
        JsKind.Undefined => "undefined",
        JsKind.Null => "null",
        JsKind.Boolean => value.Boolean ? "true" : "false",
        JsKind.Number => double.IsFinite(value.Number) ? JsNumber.Format(value.Number) : "null",
        JsKind.String => "\\\"" + JsonEscape(value.String) + "\\\"",
        _ => throw new InvalidOperationException("NODE_URL_UTIL_ZLIB_MISC util.format %j object formatting is not enabled."),
    };

    private static string JsonEscape(string value)
    {
        var builder = new StringBuilder(value.Length + 2);
        foreach (char c in value)
        {
            switch (c)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (c < 0x20) builder.Append("\\u").Append(((int)c).ToString("x4", System.Globalization.CultureInfo.InvariantCulture));
                    else builder.Append(c);
                    break;
            }
        }
        return builder.ToString();
    }
}
