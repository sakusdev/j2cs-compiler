using System.Runtime.CompilerServices;

namespace J2cs.Runtime;

/// <summary>
/// SameValueZero for the currently representable JavaScript value domain.
/// Numbers canonicalize signed zero and all NaNs compare equal; Object values use reference identity.
/// </summary>
internal sealed class JsSameValueZeroComparer : IEqualityComparer<JsValue>
{
    public static JsSameValueZeroComparer Instance { get; } = new();

    private JsSameValueZeroComparer() { }

    public bool Equals(JsValue left, JsValue right)
    {
        if (left.Kind != right.Kind) return false;
        return left.Kind switch
        {
            JsKind.Undefined or JsKind.Null => true,
            JsKind.Number => left.Number == right.Number || (double.IsNaN(left.Number) && double.IsNaN(right.Number)),
            JsKind.String => string.Equals(left.String, right.String, StringComparison.Ordinal),
            JsKind.Boolean => left.Boolean == right.Boolean,
            JsKind.Object => ReferenceEquals(left.Reference, right.Reference),
            _ => throw new InvalidOperationException("Unknown value tag")
        };
    }

    public int GetHashCode(JsValue value)
    {
        int payload = value.Kind switch
        {
            JsKind.Undefined => 0x10,
            JsKind.Null => 0x20,
            JsKind.Number => NumberHash(value.Number),
            JsKind.String => StringComparer.Ordinal.GetHashCode(value.String),
            JsKind.Boolean => value.Boolean ? 1 : 0,
            JsKind.Object => RuntimeHelpers.GetHashCode(value.Reference),
            _ => throw new InvalidOperationException("Unknown value tag")
        };
        return HashCode.Combine((int)value.Kind, payload);
    }

    private static int NumberHash(double value)
        => double.IsNaN(value) ? unchecked((int)0x7ff80000) : value == 0d ? 0 : value.GetHashCode();
}

internal interface IJsCollectionIterator
{
    JsValue Next();
}

/// <summary>Shared iterator-result construction and the explicit collection-iterator next boundary.</summary>
public static class JsCollectionIterator
{
    public static JsValue Next(JsValue iterator)
    {
        var reference = JsObject.RequireReference(iterator);
        return reference is IJsCollectionIterator collection
            ? collection.Next()
            : throw new InvalidOperationException("Compiler collection iterator proof violated");
    }

    internal static JsValue Yield(JsValue value) => Result(value, false);
    internal static JsValue Done() => Result(JsUndefined.Value, true);

    private static JsValue Result(JsValue value, bool done)
    {
        var result = JsObject.Create();
        JsObject.DefineDataProperty(result, "value", value);
        JsObject.DefineDataProperty(result, "done", JsValue.FromBoolean(done));
        return result;
    }

    internal static JsValue Pair(JsValue first, JsValue second)
    {
        var pair = JsArray.Create(2);
        JsArray.DefineElement(pair, 0, first);
        JsArray.DefineElement(pair, 1, second);
        return pair;
    }
}

/// <summary>
/// Identity-bearing insertion-ordered JavaScript Map storage. Entries are tombstoned rather than
/// compacted so suspended iterators preserve ECMAScript live-iteration behavior across mutation.
/// </summary>
public sealed class JsMap : JsObject
{
    private sealed class Entry
    {
        public Entry(JsValue key, JsValue value) => (Key, Value) = (key, value);
        public JsValue Key { get; }
        public JsValue Value { get; set; }
        public bool Active { get; set; } = true;
    }

    private enum IterationKind { Key, Value, EntryPair }

    private sealed class Iterator : JsObject, IJsCollectionIterator
    {
        private JsMap? owner;
        private readonly IterationKind kind;
        private int cursor;

        public Iterator(JsMap owner, IterationKind kind) => (this.owner, this.kind) = (owner, kind);

        public JsValue Next()
        {
            if (owner is null) return JsCollectionIterator.Done();
            while (cursor < owner.entries.Count)
            {
                var entry = owner.entries[cursor++];
                if (!entry.Active) continue;
                var value = kind switch
                {
                    IterationKind.Key => entry.Key,
                    IterationKind.Value => entry.Value,
                    IterationKind.EntryPair => JsCollectionIterator.Pair(entry.Key, entry.Value),
                    _ => throw new InvalidOperationException("Unknown Map iterator kind")
                };
                return JsCollectionIterator.Yield(value);
            }

            owner = null;
            return JsCollectionIterator.Done();
        }
    }

    private readonly List<Entry> entries = [];
    private readonly Dictionary<JsValue, int> index = new(JsSameValueZeroComparer.Instance);

    private JsMap() { }

    private static JsMap RequireMap(JsValue receiver)
        => JsObject.RequireReference(receiver) as JsMap
            ?? throw new InvalidOperationException("Compiler builtin Map proof violated");

    private static JsValue CanonicalizeKey(JsValue key)
        => key.Kind == JsKind.Number && key.Number == 0d ? JsValue.FromNumber(0d) : key;

    public static JsValue Create() => JsValue.FromReference(new JsMap());

    public static JsValue Set(JsValue receiver, JsValue key, JsValue value)
    {
        var map = RequireMap(receiver);
        key = CanonicalizeKey(key);
        if (map.index.TryGetValue(key, out int existing))
        {
            map.entries[existing].Value = value;
            return receiver;
        }

        map.entries.Add(new Entry(key, value));
        map.index.Add(key, map.entries.Count - 1);
        return receiver;
    }

    public static JsValue Get(JsValue receiver, JsValue key)
    {
        var map = RequireMap(receiver);
        key = CanonicalizeKey(key);
        return map.index.TryGetValue(key, out int found) ? map.entries[found].Value : JsUndefined.Value;
    }

    public static bool Has(JsValue receiver, JsValue key)
    {
        var map = RequireMap(receiver);
        return map.index.ContainsKey(CanonicalizeKey(key));
    }

    public static bool Delete(JsValue receiver, JsValue key)
    {
        var map = RequireMap(receiver);
        key = CanonicalizeKey(key);
        if (!map.index.Remove(key, out int found)) return false;
        map.entries[found].Active = false;
        return true;
    }

    public static JsValue Clear(JsValue receiver)
    {
        var map = RequireMap(receiver);
        foreach (var entry in map.entries) entry.Active = false;
        map.index.Clear();
        return JsUndefined.Value;
    }

    public static double Size(JsValue receiver) => RequireMap(receiver).index.Count;

    public static JsValue Keys(JsValue receiver)
        => JsValue.FromReference(new Iterator(RequireMap(receiver), IterationKind.Key));

    public static JsValue Values(JsValue receiver)
        => JsValue.FromReference(new Iterator(RequireMap(receiver), IterationKind.Value));

    public static JsValue Entries(JsValue receiver)
        => JsValue.FromReference(new Iterator(RequireMap(receiver), IterationKind.EntryPair));
}

/// <summary>
/// Host-level signal for the WeakMap/WeakSet CanBeHeldWeakly TypeError boundary.
/// The Error-object lane can later map this to the canonical JavaScript TypeError object.
/// </summary>
public sealed class JsWeakCollectionKeyException : Exception
{
    public const string JavaScriptName = "TypeError";
    public JsWeakCollectionKeyException(string message) : base(message) { }
}

internal sealed class JsWeakMap : JsObject
{
    internal sealed class Box
    {
        public Box(JsValue value) => Value = value;
        public JsValue Value { get; set; }
    }

    private readonly ConditionalWeakTable<JsObject, Box> entries = new();

    internal static JsWeakMap Require(JsValue receiver)
        => JsObject.RequireReference(receiver) as JsWeakMap
            ?? throw new InvalidOperationException("Compiler builtin WeakMap proof violated");

    internal static JsObject? WeakKeyOrNull(JsValue key)
        // JsKind.Symbol is intentionally absent today. Once the Symbol lane adds it, only
        // non-registered Symbols may be admitted here; primitives remain non-weak keys.
        => key.Kind == JsKind.Object ? key.Reference : null;

    internal JsValue Set(JsValue key, JsValue value)
    {
        var reference = WeakKeyOrNull(key)
            ?? throw new JsWeakCollectionKeyException("Invalid value used as weak map key");
        if (entries.TryGetValue(reference, out var box)) box.Value = value;
        else entries.Add(reference, new Box(value));
        return key;
    }

    internal JsValue Get(JsValue key)
    {
        var reference = WeakKeyOrNull(key);
        return reference is not null && entries.TryGetValue(reference, out var box) ? box.Value : JsUndefined.Value;
    }

    internal bool Has(JsValue key)
    {
        var reference = WeakKeyOrNull(key);
        return reference is not null && entries.TryGetValue(reference, out _);
    }

    internal bool Delete(JsValue key)
    {
        var reference = WeakKeyOrNull(key);
        return reference is not null && entries.Remove(reference);
    }
}

/// <summary>Canonical runtime targets used by the pinned j2cs WeakMap rules.</summary>
public static partial class JsRuntime
{
    public static JsValue CreateWeakMap() => JsValue.FromReference(new JsWeakMap());

    public static JsValue WeakMapSet(JsValue receiver, JsValue key, JsValue value)
    {
        JsWeakMap.Require(receiver).Set(key, value);
        return receiver;
    }

    public static JsValue WeakMapGet(JsValue receiver, JsValue key) => JsWeakMap.Require(receiver).Get(key);
    public static bool WeakMapHas(JsValue receiver, JsValue key) => JsWeakMap.Require(receiver).Has(key);
    public static bool WeakMapDelete(JsValue receiver, JsValue key) => JsWeakMap.Require(receiver).Delete(key);
}
