using System.Security.Cryptography;
using System.Text;

namespace J2cs.Runtime.Observability;

public sealed record TraceField(string Key, string Value);

public sealed record RuntimeTraceEvent(
    int Sequence,
    string Domain,
    string Operation,
    string? Resource,
    IReadOnlyList<TraceField> Fields);

/// <summary>
/// Deterministic, bounded event recording for host-level differential probes.
/// This class records already-observed events; it does not claim to intercept or
/// emulate Electron/browser/Node behavior on its own.
/// </summary>
public sealed class DeterministicTrace
{
    private readonly List<RuntimeTraceEvent> events = new();
    private readonly int maxEvents;
    private int sequence;

    public DeterministicTrace(int maxEvents = 100_000)
    {
        if (maxEvents <= 0) throw new ArgumentOutOfRangeException(nameof(maxEvents));
        this.maxEvents = maxEvents;
    }

    public IReadOnlyList<RuntimeTraceEvent> Events => events;

    public RuntimeTraceEvent Append(string domain, string operation, string? resource = null, params TraceField[] fields)
    {
        if (events.Count >= maxEvents) throw new InvalidOperationException($"Trace event limit {maxEvents} exceeded.");
        if (string.IsNullOrEmpty(domain)) throw new ArgumentException("Trace domain must be non-empty.", nameof(domain));
        if (string.IsNullOrEmpty(operation)) throw new ArgumentException("Trace operation must be non-empty.", nameof(operation));
        ArgumentNullException.ThrowIfNull(fields);

        var sorted = fields.OrderBy(field => field.Key, StringComparer.Ordinal).ToArray();
        for (var index = 1; index < sorted.Length; index++)
        {
            if (StringComparer.Ordinal.Equals(sorted[index - 1].Key, sorted[index].Key))
                throw new ArgumentException($"Duplicate trace field: {sorted[index].Key}", nameof(fields));
        }

        var entry = new RuntimeTraceEvent(++sequence, domain, operation, resource, sorted);
        events.Add(entry);
        return entry;
    }

    public IReadOnlyList<string> CanonicalLines()
        => events.Select(Encode).ToArray();

    public string ComputeSha256()
    {
        var bytes = Encoding.UTF8.GetBytes(string.Join("\n", CanonicalLines()));
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    public static string Encode(RuntimeTraceEvent entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (entry.Sequence <= 0) throw new ArgumentOutOfRangeException(nameof(entry), "Trace sequence must be positive.");
        var fields = entry.Fields.OrderBy(field => field.Key, StringComparer.Ordinal).ToArray();
        for (var index = 1; index < fields.Length; index++)
        {
            if (StringComparer.Ordinal.Equals(fields[index - 1].Key, fields[index].Key))
                throw new ArgumentException($"Duplicate trace field: {fields[index].Key}", nameof(entry));
        }
        var encodedFields = string.Join(";", fields.Select(field => $"{Escape(field.Key)}={Escape(field.Value)}"));
        return string.Join("|", entry.Sequence.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Escape(entry.Domain), Escape(entry.Operation), Escape(entry.Resource ?? string.Empty), encodedFields);
    }

    private static string Escape(string value)
        => value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("\n", "\\n", StringComparison.Ordinal)
            .Replace("\r", "\\r", StringComparison.Ordinal)
            .Replace("|", "\\p", StringComparison.Ordinal)
            .Replace(";", "\\s", StringComparison.Ordinal)
            .Replace("=", "\\e", StringComparison.Ordinal);
}
