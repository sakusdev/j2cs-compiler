namespace J2cs.Runtime.WebCompat;

public enum BrowserWebSocketReadyState
{
    Connecting = 0,
    Open = 1,
    Closing = 2,
    Closed = 3
}

public enum WebSocketMessageKind
{
    Text,
    Binary
}

public enum WebSocketTraceKind
{
    Constructed,
    Open,
    Message,
    SendQueued,
    SendDiscarded,
    Transmitted,
    CloseRequested,
    Error,
    Close,
    NetworkChanged
}

public enum WebSocketNetworkChange
{
    Online,
    Offline,
    InterfaceChanged
}

public sealed record WebSocketHostProfile(
    bool BrowserNetworkPolicy,
    bool ProxyPolicyDelegated,
    bool TlsPolicyDelegated,
    bool NetworkChangeDelegated)
{
    public static WebSocketHostProfile Browser { get; } = new(true, true, true, true);

    public void RequireBrowserSemantics()
    {
        if (!BrowserNetworkPolicy || !ProxyPolicyDelegated || !TlsPolicyDelegated || !NetworkChangeDelegated)
            throw new InvalidOperationException("Browser WebSocket host policy is incomplete; raw socket substitution is forbidden.");
    }
}

public sealed class WebSocketContractException : Exception
{
    public WebSocketContractException(string name, string message) : base(message) => Name = name;
    public string Name { get; }
}

public readonly record struct WebSocketTraceEntry(
    long Sequence,
    WebSocketTraceKind Kind,
    BrowserWebSocketReadyState State,
    string Detail,
    ulong BufferedAmount);

public readonly record struct WebSocketQueuedFrame(WebSocketMessageKind Kind, byte[] Payload);

public readonly record struct WebSocketCloseInfo(int Code, string Reason, bool WasClean);
