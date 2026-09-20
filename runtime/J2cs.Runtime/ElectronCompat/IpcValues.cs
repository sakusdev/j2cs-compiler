using System.Runtime.CompilerServices;

namespace J2cs.Runtime.ElectronCompat;

public abstract class IpcValue
{
    protected IpcValue() { }
}

public sealed class IpcUndefinedValue : IpcValue
{
    public static IpcUndefinedValue Instance { get; } = new();
    private IpcUndefinedValue() { }
}

public sealed class IpcNullValue : IpcValue
{
    public static IpcNullValue Instance { get; } = new();
    private IpcNullValue() { }
}

public sealed class IpcBooleanValue : IpcValue
{
    public IpcBooleanValue(bool value) => Value = value;
    public bool Value { get; }
}

public sealed class IpcNumberValue : IpcValue
{
    public IpcNumberValue(double value) => Value = value;
    public double Value { get; }
}

public sealed class IpcStringValue : IpcValue
{
    public IpcStringValue(string value)
        => Value = value ?? throw new ArgumentNullException(nameof(value));

    public string Value { get; }
}

public sealed class IpcBytesValue : IpcValue
{
    private readonly byte[] bytes;

    public IpcBytesValue(ReadOnlySpan<byte> bytes)
        => this.bytes = bytes.ToArray();

    public ReadOnlyMemory<byte> Bytes => bytes;
}

public sealed class IpcArrayValue : IpcValue
{
    private readonly List<IpcValue> items = new();

    public IpcArrayValue() { }

    public IpcArrayValue(IEnumerable<IpcValue> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        foreach (var item in items)
            Add(item);
    }

    public IReadOnlyList<IpcValue> Items => items;

    public void Add(IpcValue value)
        => items.Add(value ?? throw new ArgumentNullException(nameof(value)));
}

public sealed class IpcObjectValue : IpcValue
{
    private readonly Dictionary<string, IpcValue> properties = new(StringComparer.Ordinal);

    public IpcObjectValue() { }

    public IpcObjectValue(IEnumerable<KeyValuePair<string, IpcValue>> properties)
    {
        ArgumentNullException.ThrowIfNull(properties);
        foreach (var pair in properties)
            Set(pair.Key, pair.Value);
    }

    public IReadOnlyDictionary<string, IpcValue> Properties => properties;

    public void Set(string key, IpcValue value)
    {
        ArgumentNullException.ThrowIfNull(key);
        ArgumentNullException.ThrowIfNull(value);
        properties[key] = value;
    }
}

public sealed class IpcUnsupportedValue : IpcValue
{
    public IpcUnsupportedValue(string kind)
        => Kind = kind ?? throw new ArgumentNullException(nameof(kind));

    public string Kind { get; }
}

public sealed class IpcDataCloneException : InvalidOperationException
{
    public IpcDataCloneException(string message) : base(message) { }
}

internal sealed class IpcReferenceComparer : IEqualityComparer<IpcValue>
{
    public static IpcReferenceComparer Instance { get; } = new();

    public bool Equals(IpcValue? x, IpcValue? y) => ReferenceEquals(x, y);

    public int GetHashCode(IpcValue value) => RuntimeHelpers.GetHashCode(value);
}

public static class IpcStructuredClone
{
    public static IpcValue Clone(IpcValue value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return Clone(value, new Dictionary<IpcValue, IpcValue>(IpcReferenceComparer.Instance));
    }

    public static IReadOnlyList<IpcValue> CloneArguments(IReadOnlyList<IpcValue> arguments)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        var seen = new Dictionary<IpcValue, IpcValue>(IpcReferenceComparer.Instance);
        var result = new IpcValue[arguments.Count];
        for (var i = 0; i < arguments.Count; i++)
            result[i] = Clone(arguments[i], seen);
        return result;
    }

    private static IpcValue Clone(IpcValue value, Dictionary<IpcValue, IpcValue> seen)
    {
        if (value is IpcUndefinedValue)
            return IpcUndefinedValue.Instance;
        if (value is IpcNullValue)
            return IpcNullValue.Instance;
        if (value is IpcBooleanValue boolean)
            return new IpcBooleanValue(boolean.Value);
        if (value is IpcNumberValue number)
            return new IpcNumberValue(number.Value);
        if (value is IpcStringValue text)
            return new IpcStringValue(text.Value);
        if (value is IpcBytesValue bytes)
            return new IpcBytesValue(bytes.Bytes.Span);
        if (value is IpcUnsupportedValue unsupported)
            throw new IpcDataCloneException(
                "Electron IPC structured clone does not support " + unsupported.Kind + ".");

        if (seen.TryGetValue(value, out var existing))
            return existing;

        if (value is IpcArrayValue array)
        {
            var copy = new IpcArrayValue();
            seen.Add(value, copy);
            foreach (var item in array.Items)
                copy.Add(Clone(item, seen));
            return copy;
        }

        if (value is IpcObjectValue record)
        {
            var copy = new IpcObjectValue();
            seen.Add(value, copy);
            foreach (var pair in record.Properties)
                copy.Set(pair.Key, Clone(pair.Value, seen));
            return copy;
        }

        throw new IpcDataCloneException(
            "Unknown Electron IPC value representation: " + value.GetType().Name + ".");
    }
}
