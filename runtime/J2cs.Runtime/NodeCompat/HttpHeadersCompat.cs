using System.Globalization;

namespace J2cs.Runtime.NodeCompat;

public enum NodeHeaderValueKind
{
    String,
    Number,
    StringList
}

public readonly struct NodeHeaderValue
{
    private readonly string? text;
    private readonly double number;
    private readonly IReadOnlyList<string>? list;

    private NodeHeaderValue(NodeHeaderValueKind kind, string? text = null, double number = 0, IReadOnlyList<string>? list = null)
        => (Kind, this.text, this.number, this.list) = (kind, text, number, list);

    public NodeHeaderValueKind Kind { get; }

    public static NodeHeaderValue FromString(string value)
        => new(NodeHeaderValueKind.String, text: value ?? throw new ArgumentNullException(nameof(value)));

    public static NodeHeaderValue FromNumber(double value)
        => new(NodeHeaderValueKind.Number, number: value);

    public static NodeHeaderValue FromStrings(IEnumerable<string> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return new NodeHeaderValue(NodeHeaderValueKind.StringList, list: values.ToArray());
    }

    public string String => Kind == NodeHeaderValueKind.String
        ? text!
        : throw new InvalidOperationException("Header value is not a string");

    public double Number => Kind == NodeHeaderValueKind.Number
        ? number
        : throw new InvalidOperationException("Header value is not a number");

    public IReadOnlyList<string> Strings => Kind == NodeHeaderValueKind.StringList
        ? list!
        : throw new InvalidOperationException("Header value is not a string list");

    public string ToWireString() => Kind switch
    {
        NodeHeaderValueKind.String => text!,
        NodeHeaderValueKind.Number => number.ToString("R", CultureInfo.InvariantCulture),
        NodeHeaderValueKind.StringList => string.Join(", ", list!),
        _ => throw new InvalidOperationException("Unknown header value kind")
    };
}

public sealed class NodeHttpOutgoingHeaders
{
    private sealed record HeaderEntry(string OriginalName, NodeHeaderValue Value);
    private readonly Dictionary<string, HeaderEntry> entries = new(StringComparer.OrdinalIgnoreCase);

    public void SetHeader(string name, NodeHeaderValue value)
    {
        ValidateHeaderName(name);
        ValidateHeaderValue(value);
        entries[name] = new HeaderEntry(name, value);
    }

    public bool HasHeader(string name)
    {
        ValidateHeaderName(name);
        return entries.ContainsKey(name);
    }

    public bool TryGetHeader(string name, out NodeHeaderValue value)
    {
        ValidateHeaderName(name);
        if (entries.TryGetValue(name, out var entry))
        {
            value = entry.Value;
            return true;
        }
        value = default;
        return false;
    }

    public bool RemoveHeader(string name)
    {
        ValidateHeaderName(name);
        return entries.Remove(name);
    }

    public IReadOnlyList<string> HeaderNames
        => entries.Keys.Select(name => name.ToLowerInvariant()).ToArray();

    public IReadOnlyList<KeyValuePair<string, NodeHeaderValue>> RawEntries
        => entries.Values.Select(entry => new KeyValuePair<string, NodeHeaderValue>(entry.OriginalName, entry.Value)).ToArray();

    internal static void ValidateHeaderName(string name)
    {
        if (string.IsNullOrEmpty(name) || name.Any(character => !IsTokenCharacter(character)))
            throw new NodeNetworkException("ERR_INVALID_HTTP_TOKEN", $"Header name must be a valid HTTP token: {name}");
    }

    private static bool IsTokenCharacter(char character)
        => char.IsAsciiLetterOrDigit(character) || "!#$%&'*+-.^_`|~".IndexOf(character) >= 0;

    private static void ValidateHeaderValue(NodeHeaderValue value)
    {
        if (value.Kind == NodeHeaderValueKind.String)
            ValidateHeaderString(value.String);
        else if (value.Kind == NodeHeaderValueKind.StringList)
            foreach (var item in value.Strings) ValidateHeaderString(item);
    }

    private static void ValidateHeaderString(string value)
    {
        if (value.Any(character => character == '\r' || character == '\n'
            || (character < 0x20 && character != '\t') || character == 0x7f || character > 0xff))
            throw new NodeNetworkException("ERR_INVALID_CHAR", "Invalid character in header content");
    }
}

public readonly struct NodeIncomingHeaderValue
{
    private readonly string? single;
    private readonly IReadOnlyList<string>? multiple;

    private NodeIncomingHeaderValue(string? single, IReadOnlyList<string>? multiple)
        => (this.single, this.multiple) = (single, multiple);

    public bool IsMultiple => multiple is not null;

    public string Single => !IsMultiple
        ? single!
        : throw new InvalidOperationException("Incoming header value is an array");

    public IReadOnlyList<string> Multiple => IsMultiple
        ? multiple!
        : throw new InvalidOperationException("Incoming header value is a string");

    public static NodeIncomingHeaderValue FromString(string value) => new(value, null);
    public static NodeIncomingHeaderValue FromStrings(IReadOnlyList<string> values) => new(null, values);
}

public sealed class NodeHttpIncomingHeaders
{
    private static readonly HashSet<string> SingletonHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "age", "authorization", "content-length", "content-type", "etag", "expires", "from", "host",
        "if-modified-since", "if-unmodified-since", "last-modified", "location", "max-forwards",
        "proxy-authorization", "referer", "retry-after", "server", "user-agent"
    };

    private readonly IReadOnlyDictionary<string, string[]> distinct;
    private readonly IReadOnlyDictionary<string, NodeIncomingHeaderValue> combined;

    private NodeHttpIncomingHeaders(
        IReadOnlyDictionary<string, string[]> distinct,
        IReadOnlyDictionary<string, NodeIncomingHeaderValue> combined)
        => (this.distinct, this.combined) = (distinct, combined);

    public static NodeHttpIncomingHeaders FromRaw(
        IEnumerable<KeyValuePair<string, string>> rawHeaders,
        bool joinDuplicateHeaders = false)
    {
        ArgumentNullException.ThrowIfNull(rawHeaders);
        var grouped = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var pair in rawHeaders)
        {
            NodeHttpOutgoingHeaders.ValidateHeaderName(pair.Key);
            var key = pair.Key.ToLowerInvariant();
            if (!grouped.TryGetValue(key, out var values))
            {
                values = new List<string>();
                grouped[key] = values;
            }
            values.Add(pair.Value);
        }

        var distinct = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        var combined = new Dictionary<string, NodeIncomingHeaderValue>(StringComparer.OrdinalIgnoreCase);

        foreach (var (name, values) in grouped)
        {
            var snapshot = values.ToArray();
            distinct[name] = snapshot;

            if (name.Equals("set-cookie", StringComparison.OrdinalIgnoreCase))
                combined[name] = NodeIncomingHeaderValue.FromStrings(snapshot);
            else if (name.Equals("cookie", StringComparison.OrdinalIgnoreCase))
                combined[name] = NodeIncomingHeaderValue.FromString(string.Join("; ", snapshot));
            else if (!joinDuplicateHeaders && SingletonHeaders.Contains(name))
                combined[name] = NodeIncomingHeaderValue.FromString(snapshot[0]);
            else
                combined[name] = NodeIncomingHeaderValue.FromString(string.Join(", ", snapshot));
        }

        return new NodeHttpIncomingHeaders(distinct, combined);
    }

    public bool TryGet(string name, out NodeIncomingHeaderValue value)
        => combined.TryGetValue(name, out value);

    public IReadOnlyList<string> GetDistinct(string name)
        => distinct.TryGetValue(name, out var values) ? values : Array.Empty<string>();

    public IReadOnlyCollection<string> Names => combined.Keys.ToArray();
}
