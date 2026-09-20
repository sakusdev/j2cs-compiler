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

public sealed class IpcArrayValue : IpcValue
{
    private readonly IpcValue[] items;

    public IpcArrayValue(IEnumerable<IpcValue> items)
        => this.items = (items ?? throw new ArgumentNullException(nameof(items)))
            .Select(item => item ?? throw new ArgumentException("IPC arrays cannot contain null CLR references.", nameof(items)))
            .ToArray();

    public IReadOnlyList<IpcValue> Items => items;
}

public sealed class IpcObjectValue : IpcValue
{
    private readonly Dictionary<string, IpcValue> properties;

    public IpcObjectValue(IEnumerable<KeyValuePair<string, IpcValue>> properties)
    {
        ArgumentNullException.ThrowIfNull(properties);
        this.properties = new Dictionary<string, IpcValue>(StringComparer.Ordinal);
        foreach (var pair in properties)
        {
            if (pair.Key is null)
                throw new ArgumentException("IPC object keys cannot be null.", nameof(properties));
            if (pair.Value is null)
                throw new ArgumentException("IPC object values cannot be null CLR references.", nameof(properties));
            this.properties.Add(pair.Key, pair.Value);
        }
    }

    public IReadOnlyDictionary<string, IpcValue> Properties => properties;
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

public static class IpcStructuredClone
{
    public static IpcValue Clone(IpcValue value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return value switch
        {
            IpcUndefinedValue => IpcUndefinedValue.Instance,
            IpcNullValue => IpcNullValue.Instance,
            IpcBooleanValue boolean => new IpcBooleanValue(boolean.Value),
            IpcNumberValue number => new IpcNumberValue(number.Value),
            IpcStringValue text => new IpcStringValue(text.Value),
            IpcArrayValue array => new IpcArrayValue(array.Items.Select(Clone)),
            IpcObjectValue record => new IpcObjectValue(record.Properties.Select(pair =>
                new KeyValuePair<string, IpcValue>(pair.Key, Clone(pair.Value)))),
            IpcUnsupportedValue unsupported => throw new IpcDataCloneException(
                "Electron IPC structured clone does not support " + unsupported.Kind + "."),
            _ => throw new IpcDataCloneException(
                "Unknown Electron IPC value representation: " + value.GetType().Name + "."),
        };
    }

    public static IReadOnlyList<IpcValue> CloneArguments(IReadOnlyList<IpcValue> arguments)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        var result = new IpcValue[arguments.Count];
        for (var i = 0; i < arguments.Count; i++)
            result[i] = Clone(arguments[i]);
        return result;
    }
}
