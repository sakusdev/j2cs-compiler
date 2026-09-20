namespace J2cs.Runtime.ElectronCompat;

public sealed class PreloadContext
{
    private readonly Dictionary<string, BridgeValue> isolatedWindow = new(StringComparer.Ordinal);

    public PreloadContext(ContextBridge? contextBridge = null)
        => ContextBridge = contextBridge ?? new ContextBridge();

    public ContextBridge ContextBridge { get; }

    public static PreloadContext CreateIsolated() => new();

    public void SetIsolatedWindowValue(string key, BridgeValue value)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentNullException.ThrowIfNull(value);
        isolatedWindow[key] = value;
    }

    public bool TryGetIsolatedWindowValue(string key, out BridgeValue? value)
    {
        ArgumentNullException.ThrowIfNull(key);
        return isolatedWindow.TryGetValue(key, out value);
    }

    public bool TryGetMainWorldValue(string key, out BridgeValue? value)
        => ContextBridge.TryGetMainWorldValue(key, out value);

    public void ExposeInMainWorld(string key, BridgeValue api)
        => ContextBridge.ExposeInMainWorld(key, api);
}

public static class Preload
{
    /// <summary>
    /// Modern Electron profiles (12+) default contextIsolation to true. Compiler
    /// proof is required before using this helper for a concrete target profile.
    /// </summary>
    public static bool DefaultContextIsolation() => true;
}
