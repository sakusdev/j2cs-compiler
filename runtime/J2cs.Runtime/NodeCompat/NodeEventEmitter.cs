namespace J2cs.Runtime.NodeCompat;

public readonly struct NodeEventKey : IEquatable<NodeEventKey>
{
    private readonly string? name;
    private readonly long symbolId;
    public bool IsSymbol { get; }

    private NodeEventKey(string name) => (this.name, symbolId, IsSymbol) = (name, 0, false);
    private NodeEventKey(long symbolId) => (name, this.symbolId, IsSymbol) = (null, symbolId, true);

    public static NodeEventKey String(string name) => new(name ?? throw new ArgumentNullException(nameof(name)));
    public static NodeEventKey Symbol(long identity) => new(identity);

    public bool Equals(NodeEventKey other) => IsSymbol == other.IsSymbol
        && (IsSymbol ? symbolId == other.symbolId : StringComparer.Ordinal.Equals(name, other.name));
    public override bool Equals(object? obj) => obj is NodeEventKey other && Equals(other);
    public override int GetHashCode() => IsSymbol ? HashCode.Combine(true, symbolId) : HashCode.Combine(false, StringComparer.Ordinal.GetHashCode(name ?? ""));
    public override string ToString() => IsSymbol ? $"Symbol({symbolId})" : name ?? "";
}

public sealed class NodeEventListener
{
    private readonly Action<IReadOnlyList<JsValue>> callback;
    public NodeEventListener(Action<IReadOnlyList<JsValue>> callback)
        => this.callback = callback ?? throw new ArgumentNullException(nameof(callback));
    internal void Invoke(IReadOnlyList<JsValue> args) => callback(args);
}

public sealed class NodeUnhandledErrorException : Exception
{
    public JsValue Context { get; }
    public NodeUnhandledErrorException(JsValue context)
        : base("Unhandled 'error' event") => Context = context;
}

/// <summary>
/// Node-compatible listener registry core. It intentionally does not use C# events:
/// listener ordering, duplicate registrations, once wrappers, removal, and emit snapshots
/// are observable Node semantics.
/// </summary>
public class NodeEventEmitter
{
    private sealed class Registration
    {
        public NodeEventListener Listener { get; }
        public bool Once { get; }
        public Registration(NodeEventListener listener, bool once) => (Listener, Once) = (listener, once);
    }

    private static readonly NodeEventKey ErrorEvent = NodeEventKey.String("error");
    private readonly Dictionary<NodeEventKey, List<Registration>> listeners = new();

    public NodeEventEmitter On(NodeEventKey eventName, NodeEventListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        if (!listeners.TryGetValue(eventName, out var list)) listeners[eventName] = list = new List<Registration>();
        list.Add(new Registration(listener, false));
        return this;
    }

    public NodeEventEmitter Once(NodeEventKey eventName, NodeEventListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        if (!listeners.TryGetValue(eventName, out var list)) listeners[eventName] = list = new List<Registration>();
        list.Add(new Registration(listener, true));
        return this;
    }

    public NodeEventEmitter RemoveListener(NodeEventKey eventName, NodeEventListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        if (!listeners.TryGetValue(eventName, out var list)) return this;
        for (var i = list.Count - 1; i >= 0; i--)
        {
            if (!ReferenceEquals(list[i].Listener, listener)) continue;
            list.RemoveAt(i);
            if (list.Count == 0) listeners.Remove(eventName);
            break;
        }
        return this;
    }

    public int ListenerCount(NodeEventKey eventName) => listeners.TryGetValue(eventName, out var list) ? list.Count : 0;

    public bool Emit(NodeEventKey eventName, params JsValue[] args)
    {
        if (!listeners.TryGetValue(eventName, out var current) || current.Count == 0)
        {
            if (eventName.Equals(ErrorEvent))
                throw new NodeUnhandledErrorException(args.Length == 0 ? JsUndefined.Value : args[0]);
            return false;
        }

        // Node emit() snapshots the current listener sequence. Mutations performed by a
        // listener affect later emits, not the already-started emission.
        var snapshot = current.ToArray();
        foreach (var registration in snapshot)
        {
            if (registration.Once) RemoveExact(eventName, registration);
            registration.Listener.Invoke(args);
        }
        return true;
    }

    private void RemoveExact(NodeEventKey eventName, Registration registration)
    {
        if (!listeners.TryGetValue(eventName, out var list)) return;
        var index = list.FindIndex(item => ReferenceEquals(item, registration));
        if (index < 0) return;
        list.RemoveAt(index);
        if (list.Count == 0) listeners.Remove(eventName);
    }
}

public static class NodeEvents
{
    public static NodeEventEmitter Create() => new();
    public static NodeEventEmitter On(NodeEventEmitter emitter, NodeEventKey eventName, NodeEventListener listener)
        => emitter.On(eventName, listener);
    public static NodeEventEmitter Once(NodeEventEmitter emitter, NodeEventKey eventName, NodeEventListener listener)
        => emitter.Once(eventName, listener);
    public static NodeEventEmitter RemoveListener(NodeEventEmitter emitter, NodeEventKey eventName, NodeEventListener listener)
        => emitter.RemoveListener(eventName, listener);
    public static bool Emit(NodeEventEmitter emitter, NodeEventKey eventName, params JsValue[] args)
        => emitter.Emit(eventName, args);
}
