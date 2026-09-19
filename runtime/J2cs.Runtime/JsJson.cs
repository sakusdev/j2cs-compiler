using System.Globalization;
using System.Text;

namespace J2cs.Runtime;

/// <summary>
/// ECMAScript JSON semantics over JsValue/JsObject for the proof-gated no-hook subset.
/// This intentionally does not delegate to a CLR serializer.
/// </summary>
public static class JsJson
{
    public static JsValue Parse(JsValue input)
    {
        if (input.Kind == JsKind.Object)
            throw new NotSupportedException("JSON.parse object input requires ToPrimitive object semantics.");
        return new Parser(JsCoercion.ToStringPrimitive(input)).Parse();
    }

    public static JsValue Stringify(JsValue value)
    {
        var active = new HashSet<JsObject>(ReferenceEqualityComparer.Instance);
        var text = Serialize(value, active, false);
        return text is null ? JsUndefined.Value : JsValue.FromString(text);
    }

    private static string? Serialize(JsValue value, HashSet<JsObject> active, bool arrayElement)
    {
        if (value.Kind == JsKind.Undefined) return arrayElement ? "null" : null;
        if (value.Kind == JsKind.Null) return "null";
        if (value.Kind == JsKind.Boolean) return value.Boolean ? "true" : "false";
        if (value.Kind == JsKind.String) return Quote(value.String);
        if (value.Kind == JsKind.Number)
            return !double.IsFinite(value.Number) ? "null" : value.Number == 0d ? "0" : JsNumber.Format(value.Number);
        if (value.Kind != JsKind.Object) throw new InvalidOperationException("Unknown JavaScript value tag.");

        var reference = value.Reference;
        if (!active.Add(reference)) throw new JsTypeErrorException("Converting circular structure to JSON");
        try
        {
            if (reference is JsArray)
            {
                var length = checked((int)JsArray.Length(value));
                var items = new string[length];
                for (var i = 0; i < length; i++)
                {
                    var key = i.ToString(CultureInfo.InvariantCulture);
                    var element = JsObject.HasOwn(value, key) ? JsObject.GetProperty(value, key) : JsUndefined.Value;
                    items[i] = Serialize(element, active, true) ?? "null";
                }
                return "[" + string.Join(",", items) + "]";
            }

            var members = new List<string>();
            foreach (var pair in OrderedOwnData(reference))
            {
                var serialized = Serialize(pair.Value, active, false);
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
        var entries = value.EnumerateOwnData().Select((pair, order) => (pair, order, index: ArrayIndex(pair.Key))).ToList();
        foreach (var item in entries.Where(x => x.index.HasValue).OrderBy(x => x.index!.Value))
            yield return item.pair;
        foreach (var item in entries.Where(x => !x.index.HasValue).OrderBy(x => x.order))
            yield return item.pair;
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
                case '"': result.Append('\\').Append('"'); continue;
                case '\\': result.Append("\\\\"); continue;
                case '\b': result.Append("\\b"); continue;
                case '\f': result.Append("\\f"); continue;
                case '\n': result.Append("\\n"); continue;
                case '\r': result.Append("\\r"); continue;
                case '\t': result.Append("\\t"); continue;
            }
            if (c < 0x20 || char.IsLowSurrogate(c))
            {
                UnicodeEscape(result, c);
                continue;
            }
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
                    result.Append(c).Append(text[++i]);
                else
                    UnicodeEscape(result, c);
                continue;
            }
            result.Append(c);
        }
        return result.Append('"').ToString();
    }

    private static void UnicodeEscape(StringBuilder result, char value)
        => result.Append("\\u").Append(((int)value).ToString("x4", CultureInfo.InvariantCulture));

    private sealed class Parser(string text)
    {
        private int cursor;

        internal JsValue Parse()
        {
            Skip();
            var value = Value();
            Skip();
            if (cursor != text.Length) Syntax("Unexpected trailing JSON text");
            return value;
        }

        private JsValue Value()
        {
            if (cursor >= text.Length) return SyntaxValue("Unexpected end of JSON input");
            return text[cursor] switch
            {
                '"' => JsValue.FromString(String()),
                '{' => Object(),
                '[' => Array(),
                't' => Keyword("true", JsValue.FromBoolean(true)),
                'f' => Keyword("false", JsValue.FromBoolean(false)),
                'n' => Keyword("null", JsNull.Value),
                '-' or >= '0' and <= '9' => Number(),
                _ => SyntaxValue("Unexpected JSON token"),
            };
        }

        private JsValue Object()
        {
            cursor++;
            var result = JsObject.Create();
            Skip();
            if (Take('}')) return result;
            while (true)
            {
                if (cursor >= text.Length || text[cursor] != '"') Syntax("Expected object property name");
                var key = String();
                Skip();
                if (!Take(':')) Syntax("Expected ':' after property name");
                Skip();
                JsObject.DefineDataProperty(result, key, Value());
                Skip();
                if (Take('}')) return result;
                if (!Take(',')) Syntax("Expected ',' or '}'");
                Skip();
            }
        }

        private JsValue Array()
        {
            cursor++;
            var result = JsArray.Create(0d);
            Skip();
            if (Take(']')) return result;
            while (true)
            {
                JsArray.Push(result, Value());
                Skip();
                if (Take(']')) return result;
                if (!Take(',')) Syntax("Expected ',' or ']'");
                Skip();
            }
        }

        private JsValue Number()
        {
            var start = cursor;
            if (Take('-') && cursor >= text.Length) Syntax("Invalid JSON number");
            if (Take('0'))
            {
                if (cursor < text.Length && char.IsAsciiDigit(text[cursor])) Syntax("Invalid leading zero");
            }
            else
            {
                if (cursor >= text.Length || text[cursor] is < '1' or > '9') Syntax("Invalid JSON number");
                Digits();
            }
            if (Take('.'))
            {
                var before = cursor;
                Digits();
                if (before == cursor) Syntax("Invalid JSON fraction");
            }
            if (cursor < text.Length && text[cursor] is 'e' or 'E')
            {
                cursor++;
                if (cursor < text.Length && text[cursor] is '+' or '-') cursor++;
                var before = cursor;
                Digits();
                if (before == cursor) Syntax("Invalid JSON exponent");
            }
            var token = text.AsSpan(start, cursor - start);
            if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
                Syntax("Invalid JSON number");
            if (number == 0d && token[0] == '-') number = -0.0d;
            return JsValue.FromNumber(number);
        }

        private string String()
        {
            cursor++;
            var result = new StringBuilder();
            while (cursor < text.Length)
            {
                var c = text[cursor++];
                if (c == '"') return result.ToString();
                if (c < 0x20) Syntax("Unescaped control character");
                if (c != '\\')
                {
                    result.Append(c);
                    continue;
                }
                if (cursor >= text.Length) Syntax("Unterminated escape");
                switch (text[cursor++])
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
                            Syntax("Invalid Unicode escape");
                        result.Append((char)unit);
                        cursor += 4;
                        break;
                    default: Syntax("Invalid JSON escape"); break;
                }
            }
            return SyntaxString("Unterminated JSON string");
        }

        private JsValue Keyword(string expected, JsValue value)
        {
            if (cursor + expected.Length > text.Length
                || !text.AsSpan(cursor, expected.Length).SequenceEqual(expected.AsSpan()))
                Syntax("Unexpected JSON keyword");
            cursor += expected.Length;
            return value;
        }

        private void Digits()
        {
            while (cursor < text.Length && char.IsAsciiDigit(text[cursor])) cursor++;
        }

        private bool Take(char value)
        {
            if (cursor >= text.Length || text[cursor] != value) return false;
            cursor++;
            return true;
        }

        private void Skip()
        {
            while (cursor < text.Length && text[cursor] is ' ' or '\t' or '\r' or '\n') cursor++;
        }

        private void Syntax(string message) => throw new JsSyntaxErrorException(message + " at offset " + cursor);
        private JsValue SyntaxValue(string message) { Syntax(message); return JsUndefined.Value; }
        private string SyntaxString(string message) { Syntax(message); return ""; }
    }
}
