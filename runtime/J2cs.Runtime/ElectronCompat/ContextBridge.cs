namespace J2cs.Runtime.ElectronCompat;

public abstract class BridgeValue
{
    protected BridgeValue() { }
}

public sealed class BridgeUndefinedValue : BridgeValue
{
    public static BridgeUndefinedValue Instance { get; } = new();
    private BridgeUndefinedValue() { }
}

public sealed class BridgeNullValue : BridgeValue
{
    public static BridgeNullValue Instance { get; } = new();
    private BridgeNullValue() { }
}

public sealed class BridgeBooleanValue : BridgeValue
{
    public BridgeBooleanValue(bool value) => Value = value;
    public bool Value { get; }
}

public sealed class BridgeNumberValue : BridgeValue
{
    public BridgeNumberValue(double value) => Value = value;
    public double Value { get; }
}

public sealed class BridgeStringValue : BridgeValue
{
    public BridgeStringValue(string value)
        => Value = value ?? throw new ArgumentNullException(nameof(value));

    public string Value { get; }
}

public sealed class BridgeArrayValue : BridgeValue
{
    private readonly BridgeValue[] items;

    public BridgeArrayValue(IEnumerable<BridgeValue> items)
        => this.items = (items ?? throw new ArgumentNullException(nameof(items)))
            .Select(item => item ?? throw new ArgumentException("Bridge arrays cannot contain null CLR references.", nameof(items)))
            .ToArray();

    public IReadOnlyList<BridgeValue> Items => items;
}

public sealed class BridgeObjectValue : BridgeValue
{
    private readonly Dictionary<string, BridgeValue> properties;

    public BridgeObjectValue(IEnumerable<KeyValuePair<string, BridgeValue>> properties)
    {
        ArgumentNullException.ThrowIfNull(properties);
        this.properties = new Dictionary<string, BridgeValue>(StringComparer.Ordinal);
        foreach (var pair in properties)
        {
            if (pair.Key is null)
                throw new ArgumentException("Bridge keys cannot be null.", nameof(properties));
            if (pair.Value is null)
                throw new ArgumentException("Bridge values cannot be null CLR references.", nameof(properties));
            this.properties.Add(pair.Key, pair.Value);
        }
    }

    public IReadOnlyDictionary<string, BridgeValue> Properties => properties;
}

public sealed class BridgeFrozenArrayValue : BridgeValue
{
    private readonly BridgeValue[] items;

    internal BridgeFrozenArrayValue(IEnumerable<BridgeValue> items)
        => this.items = items.ToArray();

    public IReadOnlyList<BridgeValue> Items => items;
}

public sealed class BridgeFrozenObjectValue : BridgeValue
{
    private readonly IReadOnlyDictionary<string, BridgeValue> properties;

    internal BridgeFrozenObjectValue(IEnumerable<KeyValuePair<string, BridgeValue>> properties)
        => this.properties = new System.Collections.ObjectModel.ReadOnlyDictionary<string, BridgeValue>(
            properties.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal));

    public IReadOnlyDictionary<string, BridgeValue> Properties => properties;
}

public sealed class BridgeFunctionValue : BridgeValue
{
    private readonly Func<IReadOnlyList<BridgeValue>, ValueTask<BridgeValue>> callback;

    public BridgeFunctionValue(Func<IReadOnlyList<BridgeValue>, ValueTask<BridgeValue>> callback)
        => this.callback = callback ?? throw new ArgumentNullException(nameof(callback));

    internal ValueTask<BridgeValue> InvokeSourceAsync(IReadOnlyList<BridgeValue> arguments)
        => callback(arguments);
}

public sealed class BridgeFunctionProxyValue : BridgeValue
{
    private readonly BridgeFunctionValue source;

    internal BridgeFunctionProxyValue(BridgeFunctionValue source)
        => this.source = source;

    public async ValueTask<BridgeValue> InvokeAsync(params BridgeValue[] arguments)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        var copiedArguments = arguments.Select(ContextBridge.CopyForSourceInvocation).ToArray();
        var result = await source.InvokeSourceAsync(copiedArguments).ConfigureAwait(false);
        return ContextBridge.CopyAndFreeze(result);
    }
}

public sealed class BridgeIpcRendererValue : BridgeValue
{
    public static BridgeIpcRendererValue Instance { get; } = new();
    private BridgeIpcRendererValue() { }
}

public sealed class BridgeSymbolValue : BridgeValue
{
    public BridgeSymbolValue(string description) => Description = description;
    public string Description { get; }
}

public sealed class BridgeUnsupportedValue : BridgeValue
{
    public BridgeUnsupportedValue(string kind)
        => Kind = kind ?? throw new ArgumentNullException(nameof(kind));

    public string Kind { get; }
}

public sealed class ContextBridgeTypeException : InvalidOperationException
{
    public ContextBridgeTypeException(string message) : base(message) { }
}

public sealed class ContextBridgeSecurityException : InvalidOperationException
{
    public ContextBridgeSecurityException(string message) : base(message) { }
}

public sealed class ContextBridge
{
    private readonly Dictionary<string, BridgeValue> mainWorld = new(StringComparer.Ordinal);

    public void ExposeInMainWorld(string apiKey, BridgeValue api)
    {
        ArgumentException.ThrowIfNullOrEmpty(apiKey);
        ArgumentNullException.ThrowIfNull(api);

        if (mainWorld.ContainsKey(apiKey))
            throw new InvalidOperationException("The main-world key '" + apiKey + "' is already exposed.");

        mainWorld.Add(apiKey, CopyAndFreeze(api));
    }

    public bool TryGetMainWorldValue(string apiKey, out BridgeValue? value)
    {
        ArgumentNullException.ThrowIfNull(apiKey);
        return mainWorld.TryGetValue(apiKey, out value);
    }

    public static BridgeValue ValidateSafeWrapper(BridgeValue api)
    {
        ArgumentNullException.ThrowIfNull(api);
        ValidateSafeWrapperTree(api);
        return api;
    }

    private static void ValidateSafeWrapperTree(BridgeValue value)
    {
        switch (value)
        {
            case BridgeIpcRendererValue:
                throw new ContextBridgeSecurityException(
                    "Raw ipcRenderer capabilities cannot be exposed through contextBridge.");
            case BridgeSymbolValue:
                throw new ContextBridgeTypeException("Symbols cannot cross an Electron contextBridge.");
            case BridgeUnsupportedValue unsupported:
                throw new ContextBridgeTypeException(
                    "Unsupported contextBridge value: " + unsupported.Kind + ".");
            case BridgeArrayValue array:
                foreach (var item in array.Items)
                    ValidateSafeWrapperTree(item);
                break;
            case BridgeObjectValue record:
                foreach (var item in record.Properties.Values)
                    ValidateSafeWrapperTree(item);
                break;
            case BridgeFrozenArrayValue array:
                foreach (var item in array.Items)
                    ValidateSafeWrapperTree(item);
                break;
            case BridgeFrozenObjectValue record:
                foreach (var item in record.Properties.Values)
                    ValidateSafeWrapperTree(item);
                break;
        }
    }

    public static BridgeValue CopyAndFreeze(BridgeValue value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return value switch
        {
            BridgeUndefinedValue => BridgeUndefinedValue.Instance,
            BridgeNullValue => BridgeNullValue.Instance,
            BridgeBooleanValue boolean => new BridgeBooleanValue(boolean.Value),
            BridgeNumberValue number => new BridgeNumberValue(number.Value),
            BridgeStringValue text => new BridgeStringValue(text.Value),
            BridgeArrayValue array => new BridgeFrozenArrayValue(array.Items.Select(CopyAndFreeze)),
            BridgeObjectValue record => new BridgeFrozenObjectValue(record.Properties.Select(pair =>
                new KeyValuePair<string, BridgeValue>(pair.Key, CopyAndFreeze(pair.Value)))),
            BridgeFrozenArrayValue array => new BridgeFrozenArrayValue(array.Items.Select(CopyAndFreeze)),
            BridgeFrozenObjectValue record => new BridgeFrozenObjectValue(record.Properties.Select(pair =>
                new KeyValuePair<string, BridgeValue>(pair.Key, CopyAndFreeze(pair.Value)))),
            BridgeFunctionValue function => new BridgeFunctionProxyValue(function),
            BridgeFunctionProxyValue proxy => proxy,
            BridgeIpcRendererValue => throw new ContextBridgeSecurityException(
                "Electron >=29 does not permit exposing the ipcRenderer module through contextBridge."),
            BridgeSymbolValue => throw new ContextBridgeTypeException(
                "Symbols cannot cross an Electron contextBridge."),
            BridgeUnsupportedValue unsupported => throw new ContextBridgeTypeException(
                "Unsupported contextBridge value: " + unsupported.Kind + "."),
            _ => throw new ContextBridgeTypeException(
                "Unknown contextBridge value representation: " + value.GetType().Name + "."),
        };
    }

    internal static BridgeValue CopyForSourceInvocation(BridgeValue value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return value switch
        {
            BridgeUndefinedValue => BridgeUndefinedValue.Instance,
            BridgeNullValue => BridgeNullValue.Instance,
            BridgeBooleanValue boolean => new BridgeBooleanValue(boolean.Value),
            BridgeNumberValue number => new BridgeNumberValue(number.Value),
            BridgeStringValue text => new BridgeStringValue(text.Value),
            BridgeArrayValue array => new BridgeArrayValue(array.Items.Select(CopyForSourceInvocation)),
            BridgeObjectValue record => new BridgeObjectValue(record.Properties.Select(pair =>
                new KeyValuePair<string, BridgeValue>(pair.Key, CopyForSourceInvocation(pair.Value)))),
            BridgeFrozenArrayValue array => new BridgeArrayValue(array.Items.Select(CopyForSourceInvocation)),
            BridgeFrozenObjectValue record => new BridgeObjectValue(record.Properties.Select(pair =>
                new KeyValuePair<string, BridgeValue>(pair.Key, CopyForSourceInvocation(pair.Value)))),
            BridgeFunctionValue function => function,
            BridgeFunctionProxyValue => throw new ContextBridgeTypeException(
                "Destination-world function proxies cannot be passed back as source-world functions in this bounded contract."),
            BridgeIpcRendererValue => throw new ContextBridgeSecurityException(
                "Raw ipcRenderer capabilities cannot cross into the destination world."),
            BridgeSymbolValue => throw new ContextBridgeTypeException(
                "Symbols cannot cross an Electron contextBridge."),
            BridgeUnsupportedValue unsupported => throw new ContextBridgeTypeException(
                "Unsupported contextBridge argument: " + unsupported.Kind + "."),
            _ => throw new ContextBridgeTypeException(
                "Unknown contextBridge argument representation: " + value.GetType().Name + "."),
        };
    }
}
