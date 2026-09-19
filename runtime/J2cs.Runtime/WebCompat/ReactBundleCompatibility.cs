using System.Collections.Concurrent;
using System.Runtime.ExceptionServices;

namespace J2cs.Runtime.WebCompat;

/// <summary>
/// Host-side identity token for the registered Symbol keys used by production React.
/// This is intentionally not a general JavaScript Symbol implementation.
/// </summary>
public sealed class ReactRegisteredSymbol
{
    internal ReactRegisteredSymbol(string key) => Key = key;
    public string Key { get; }
}

/// <summary>
/// Process-wide registry boundary matching the identity property required by the
/// canonical symbol.for.primitive-key rule for React's registered tag keys.
/// </summary>
public static class ReactSymbolRegistry
{
    private static readonly ConcurrentDictionary<string, ReactRegisteredSymbol> Registry = new(StringComparer.Ordinal);

    public static ReactRegisteredSymbol For(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        return Registry.GetOrAdd(key, static value => new ReactRegisteredSymbol(value));
    }
}

/// <summary>
/// Single-threaded bundle/module evaluation ledger. It supplies the evaluate-once
/// and re-entrant cycle guard needed by bundle hosts without pretending to be a
/// complete ESM linker or JavaScript value runtime.
/// </summary>
public sealed class BundleExecutionLedger
{
    private enum State { Evaluating, Evaluated, Failed }

    private sealed class Entry
    {
        public State State { get; set; }
        public ExceptionDispatchInfo? Failure { get; set; }
    }

    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);

    public bool EvaluateOnce(string moduleId, Action body)
    {
        ArgumentNullException.ThrowIfNull(moduleId);
        ArgumentNullException.ThrowIfNull(body);

        if (entries.TryGetValue(moduleId, out var existing))
        {
            if (existing.State is State.Evaluating or State.Evaluated) return false;
            existing.Failure!.Throw();
            throw new InvalidOperationException("Unreachable after rethrow.");
        }

        var entry = new Entry { State = State.Evaluating };
        entries.Add(moduleId, entry);
        try
        {
            body();
            entry.State = State.Evaluated;
            return true;
        }
        catch (Exception exception)
        {
            entry.State = State.Failed;
            entry.Failure = ExceptionDispatchInfo.Capture(exception);
            throw;
        }
    }

    public bool IsEvaluated(string moduleId) =>
        entries.TryGetValue(moduleId, out var entry) && entry.State == State.Evaluated;
}

/// <summary>
/// Deterministic host metadata for code-split chunk registration. Module execution
/// remains a separate compiler/runtime contract and is deliberately not faked here.
/// </summary>
public sealed class BundleChunkRegistry
{
    private readonly Dictionary<string, string[]> chunks = new(StringComparer.Ordinal);
    private readonly List<string> registrationOrder = [];

    public IReadOnlyList<string> RegistrationOrder => registrationOrder;

    public bool Register(string chunkId, IReadOnlyList<string> moduleIds)
    {
        ArgumentNullException.ThrowIfNull(chunkId);
        ArgumentNullException.ThrowIfNull(moduleIds);
        if (chunks.ContainsKey(chunkId)) return false;

        var copy = new string[moduleIds.Count];
        for (var index = 0; index < moduleIds.Count; index++)
            copy[index] = moduleIds[index] ?? throw new ArgumentException("Module IDs cannot contain null.", nameof(moduleIds));

        chunks.Add(chunkId, copy);
        registrationOrder.Add(chunkId);
        return true;
    }

    public IReadOnlyList<string> Modules(string chunkId) =>
        chunks.TryGetValue(chunkId, out var moduleIds) ? moduleIds : Array.Empty<string>();
}
