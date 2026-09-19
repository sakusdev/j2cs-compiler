using System.Runtime.CompilerServices;

namespace J2cs.Runtime;

/// <summary>
/// Identity-bearing insertion-ordered JavaScript Set storage. Tombstones retain iterator position,
/// while delete-and-readd appends a new live value at the end of the sequence.
/// </summary>
public sealed class JsSet : JsObject
{
    private sealed class Entry
    {
        public Entry(JsValue value) => Value = value;
        public JsValue Value { get; }
        public bool Active { get; set; } = true;
    }

    private enum IterationKind { Value, EntryPair }

    private sealed class Iterator : JsObject, IJsCollectionIterator
    {
        private JsSet? owner;
        private readonly IterationKind kind;
        private int cursor;

        public Iterator(JsSet owner, IterationKind kind) => (this.owner, this.kind) = (owner, kind);

        public JsValue Next()
        {
            if (owner is null) return JsCollectionIterator.Done();
            while (cursor < owner.entries.Count)
            {
                var entry = owner.entries[cursor++];
                if (!entry.Active) continue;
                var value = kind == IterationKind.Value
                    ? entry.Value
                    : JsCollectionIterator.Pair(entry.Value, entry.Value);
                return JsCollectionIterator.Yield(value);
            }

            owner = null;
            return JsCollectionIterator.Done();
        }
    }

    private readonly List<Entry> entries = [];
    private readonly Dictionary<JsValue, int> index = new(JsSameValueZeroComparer.Instance);

    private JsSet() { }

    private static JsSet RequireSet(JsValue receiver)
        => JsObject.RequireReference(receiver) as JsSet
            ?? throw new InvalidOperationException("Compiler builtin Set proof violated");

    private static JsValue CanonicalizeValue(JsValue value)
        => value.Kind == JsKind.Number && value.Number == 0d ? JsValue.FromNumber(0d) : value;

    public static JsValue Create() => JsValue.FromReference(new JsSet());

    public static JsValue Add(JsValue receiver, JsValue value)
    {
        var set = RequireSet(receiver);
        value = CanonicalizeValue(value);
        if (set.index.ContainsKey(value)) return receiver;

        set.entries.Add(new Entry(value));
        set.index.Add(value, set.entries.Count - 1);
        return receiver;
    }

    public static bool Has(JsValue receiver, JsValue value)
    {
        var set = RequireSet(receiver);
        return set.index.ContainsKey(CanonicalizeValue(value));
    }

    public static bool Delete(JsValue receiver, JsValue value)
    {
        var set = RequireSet(receiver);
        value = CanonicalizeValue(value);
        if (!set.index.Remove(value, out int found)) return false;
        set.entries[found].Active = false;
        return true;
    }

    public static JsValue Clear(JsValue receiver)
    {
        var set = RequireSet(receiver);
        foreach (var entry in set.entries) entry.Active = false;
        set.index.Clear();
        return JsUndefined.Value;
    }

    public static double Size(JsValue receiver) => RequireSet(receiver).index.Count;

    /// <summary>Set.prototype.values, Set.prototype.keys and @@iterator share this value iterator.</summary>
    public static JsValue Values(JsValue receiver)
        => JsValue.FromReference(new Iterator(RequireSet(receiver), IterationKind.Value));

    public static JsValue Entries(JsValue receiver)
        => JsValue.FromReference(new Iterator(RequireSet(receiver), IterationKind.EntryPair));
}

internal sealed class JsWeakSet : JsObject
{
    private sealed class Marker { }
    private static readonly Marker Present = new();
    private readonly ConditionalWeakTable<JsObject, Marker> entries = new();

    internal static JsWeakSet Require(JsValue receiver)
        => JsObject.RequireReference(receiver) as JsWeakSet
            ?? throw new InvalidOperationException("Compiler builtin WeakSet proof violated");

    internal void Add(JsValue value)
    {
        var reference = JsWeakMap.WeakKeyOrNull(value)
            ?? throw new JsWeakCollectionKeyException("Invalid value used in weak set");
        if (!entries.TryGetValue(reference, out _)) entries.Add(reference, Present);
    }

    internal bool Has(JsValue value)
    {
        var reference = JsWeakMap.WeakKeyOrNull(value);
        return reference is not null && entries.TryGetValue(reference, out _);
    }

    internal bool Delete(JsValue value)
    {
        var reference = JsWeakMap.WeakKeyOrNull(value);
        return reference is not null && entries.Remove(reference);
    }
}

/// <summary>Canonical runtime targets used by the pinned j2cs WeakSet rules.</summary>
public static partial class JsRuntime
{
    public static JsValue CreateWeakSet() => JsValue.FromReference(new JsWeakSet());

    public static JsValue WeakSetAdd(JsValue receiver, JsValue value)
    {
        JsWeakSet.Require(receiver).Add(value);
        return receiver;
    }

    public static bool WeakSetHas(JsValue receiver, JsValue value) => JsWeakSet.Require(receiver).Has(value);
    public static bool WeakSetDelete(JsValue receiver, JsValue value) => JsWeakSet.Require(receiver).Delete(value);
}
