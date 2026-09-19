using System.Globalization;
using System.Text;

namespace J2cs.Runtime;

/// <summary>
/// ECMAScript JSON helper over JsValue/JsObject. This is a semantic implementation,
/// not a typed CLR serializer. Hooks/accessors/Proxy/replacer/space are proof-gated out.
/// </summary>
public static class JsJson
{
    public static JsValue Parse(JsValue input)
    {
        if (input.Kind == JsKind.Object)
            throw new NotSupportedException("JSON.parse object input requires the unmerged ToPrimitive object contract.");
        var parser = new Parser(JsCoercion.ToStringPrimitive(input));
        return parser.Parse();
    }

    public static JsValue Stringify(JsValue value)
    {
        var active = new HashSet<JsObject>(ReferenceEqualityComparer.Instance);
        var text = Serialize(value, active, arrayElement: false);
        return text is null ? JsUndefined.Value : JsValue.FromString(text);
    }

    private static string? Serialize(JsValue value, HashSet<JsObject> active, bool arrayElement)
    {
        switch (value.Kind)
        {
            case JsKind.Undefined:
                return arrayElement ? "null" : null;
            case JsKind.Null:
                return "null";
            case JsKind.Boolean:
                return value.Boolean ? "true" : "false";
            case JsKind.String:
                return Quote(value.String);
            case JsKind.Number:
                return !double.IsFinite(value.Number) ? "null" : value.Number == 0 ? "0" : JsNumber.Format(value.Number);
            case JsKind.Object:
                break;
            default:
                throw new InvalidOperationException("Unknown JavaScript value tag.");
        }

        var reference = value.Reference;
        if (!active.Add(reference)) throw new JsTypeErrorException("Converting circular structure to JSON");
        try
        {
            if (reference is JsArray)
            {
                var length = checked((uint)JsArray.Length(value));
                var parts = new string[length];
                for (uint i = 0; i < length; i++)
                {
                    var key = i.ToString(CultureInfo.InvariantCulture);
                    var element = JsObject.HasOwn(value, key) ? JsObject.GetProperty(value, key) : JsUndefined.Value;
                    parts[i] = Serialize(element, active, arrayElement: true) ?? "null";
                }
                return "[" + string.Join(",", parts) + "]";
            }

            var properties = OrderedOwnData(reference);
            var members = new List<string>();
            foreach (var pair in properties)
            {
                var serialized = Serialize(pair.Value, active, arrayElement: false);
                if (serialized is not null) members.Add(Quote(pair.Key) + ":" + serialized);
            }
            return "{" + string.Join(",", members) + "}";
        }
        finally
        {
            active.Remove(reference);
        }
    }

    private static IEnumerable<KeyValuePair<string, JsValue>> OrderedOwnData(JsObject value)
    {
        var entries = value.EnumerateOwnData().ToList();
        var numeric = entries
            .Select((pair, order) => (pair, order, index: ArrayIndex(pair.Key)))
            .Where(x => x.index.HasValue)
            .OrderBy(x => x.index!.Value);
        var other = entries
            .Select((pair, order) => (pair, order, index: ArrayIndex(pair.Key)))
            .Where(x => !x.index.HasValue)
            .OrderBy(x => x.order);
        foreach (var item in numeric) yield return item.pair;
        foreach (var item in other) yield return item.pair;
    }

    private static uint? ArrayIndex(string key)
    {
        if (!uint.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out var index)
            || index == uint.MaxValue || index.ToString(CultureInfo.InvariantCulture) != key) return null;
        return index;
    }

    private static string Quote(string text)
    {
        var result = new StringBuilder(text.Length + 2).Append('"');
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            switch (c)
            {
                case '"': result.Append("\\""); continue;
                case '\\': result.Append("\\\\"); continue;
                case '\b': result.Append("\\b"); continue;
                case '\f': result.Append("\\f"); continue;
                case '\n': result.Append("\\n"); continue;
                case '\r': result.Append("\\r"); continue;
                case '\t': result.Append("\\t"); continue;
            }
            if (c < 0x20)
            {
                result.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                continue;
            }
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
                {
                    result.Append(c).Append(text[++i]);
                    continue;
                }
                result.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                continue;
            }
            if (char.IsLowSurrogate(c))
            {
                result.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                continue;
            }
            result.Append(c);
        }
        return result.Append('"').ToString();
    }

    private sealed class Parser(string text)
    {
        private int cursor;

        internal JsValue Parse()
        {
            SkipWhitespace();
            var value = ReadValue();
            SkipWhitespace();
            if (cursor != text.Length) Syntax("Unexpected trailing JSON text.");
            return value;
        }

        private JsValue ReadValue()
        {
            if (cursor >= text.Length) Syntax("Unexpected end of JSON input.");
            return text[cursor] switch
            {
                '"' => JsValue.FromString(ReadString()),
                '{' => ReadObject(),
                '[' => ReadArray(),
                't' => Keyword("true", JsValue.FromBoolean(true)),
                'f' => Keyword("false", JsValue.FromBoolean(false)),
                'n' => Keyword("null", JsNull.Value),
                '-' or >= '0' and <= '9' => ReadNumber(),
                _ => SyntaxValue("Unexpected token in JSON input."),
            };
        }

        private JsValue ReadObject()
        {
            cursor++;
            var result = JsObject.Create();
            SkipWhitespace();
            if (Consume('}')) return result;
            while (true)
            {
                if (cursor >= text.Length || text[cursor] != '"') Syntax("Expected JSON object property name.");
                var key = ReadString();
                SkipWhitespace();
                if (!Consume(':')) Syntax("Expected ':' after JSON object property name.");
                SkipWhitespace();
                JsObject.DefineDataProperty(result, key, ReadValue());
                SkipWhitespace();
                if (Consume('}')) return result;
                if (!Consume(',')) Syntax("Expected ',' or '}' in JSON object.");
                SkipWhitespace();
            }
        }

        private JsValue ReadArray()
        {
            cursor++;
            var result = JsArray.Create(0d);
            SkipWhitespace();
            if (Consume(']')) return result;
            while (true)
            {
                JsArray.Push(result, ReadValue());
                SkipWhitespace();
                if (Consume(']')) return result;
                if (!Consume(',')) Syntax("Expected ',' or ']' in JSON array.");
                SkipWhitespace();
            }
        }

        private JsValue ReadNumber()
        {
            var start = cursor;
            if (Consume('-') && cursor >= text.Length) Syntax("Invalid JSON number.");
            if (Consume('0'))
            {
                if (cursor < text.Length && char.IsAsciiDigit(text[cursor])) Syntax("Invalid leading zero in JSON number.");
            }
            else
            {
                if (cursor >= text.Length || text[cursor] is < '1' or > '9') Syntax("Invalid JSON number.");
                while (cursor < text.Length && char.IsAsciiDigit(text[cursor])) cursor++;
            }
            if (Consume('.'))
            {
                var fraction = cursor;
                while (cursor < text.Length && char.IsAsciiDigit(text[cursor])) cursor++;
                if (cursor == fraction) Syntax("Invalid JSON fraction.");
            }
            if (cursor < text.Length && text[cursor] is 'e' or 'E')
            {
                cursor++;
                if (cursor < text.Length && text[cursor] is '+' or '-') cursor++;
                var exponent = cursor;
                while (cursor < text.Length && char.IsAsciiDigit(text[cursor])) cursor++;
                if (cursor == exponent) Syntax("Invalid JSON exponent.");
            }

            var token = text.AsSpan(start, cursor - start);
            if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
                Syntax("Invalid JSON number.");
            if (number == 0 && token.Length > 0 && token[0] == '-') number = -0.0d;
            return JsValue.FromNumber(number);
        }

        private string ReadString()
        {
            cursor++;
            var result = new StringBuilder();
            while (cursor < text.Length)
            {
                var c = text[cursor++];
                if (c == '"') return result.ToString();
                if (c < 0x20) Syntax("Unescaped control character in JSON string.");
                if (c != '\\')
                {
                    result.Append(c);
                    continue;
                }
                if (cursor >= text.Length) Syntax("Unterminated JSON escape.");
                var escaped = text[cursor++];
                switch (escaped)
                {
                    case '"': result.Append('"'); break;
                    case '\\': result.Append('\\'); break;
                    case '/': result.Append('/'); break;
                    case 'b': result.Append('\b'); break;
                    case 'f': result.Append('\f'); break;
                    case 'n': result.Append('\n'); break;
                    case 'r': result.Append('\r'); break;
                    case 't': result.Append('\t'); break;
                    case 'u':
                        if (cursor + 4 > text.Length
                            || !ushort.TryParse(text.AsSpan(cursor, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var unit))
                            Syntax("Invalid Unicode escape in JSON string.");
                        result.Append((char)unit);
                        cursor += 4;
                        break;
                    default:
                        Syntax("Invalid JSON escape.");
                        break;
                }
            }
            return SyntaxString("Unterminated JSON string.");
        }

        private JsValue Keyword(string expected, JsValue value)
        {
            if (cursor + expected.Length > text.Length
                || !text.AsSpan(cursor, expected.Length).SequenceEqual(expected.AsSpan()))
                Syntax($"Unexpected token; expected {expected}.");
            cursor += expected.Length;
            return value;
        }

        private bool Consume(char value)
        {
            if (cursor >= text.Length || text[cursor] != value) return false;
            cursor++;
            return true;
        }

        private void SkipWhitespace()
        {
            while (cursor < text.Length && text[cursor] is ' ' or '\t' or '\r' or '\n') cursor++;
        }

        private void Syntax(string message) => throw new JsSyntaxErrorException($"{message} at offset {cursor}");
        private JsValue SyntaxValue(string message) { Syntax(message); return JsUndefined.Value; }
        private string SyntaxString(string message) { Syntax(message); return ""; }
    }
}
