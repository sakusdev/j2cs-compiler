using System.Text;

namespace J2cs.Runtime.WebCompat;

/// <summary>
/// Deterministic browser-WebSocket lifecycle contract. Transport, DNS, proxy, TLS,
/// and scheduling remain explicit host responsibilities; this is not a raw socket.
/// </summary>
public sealed class BrowserWebSocketState
{
    private readonly List<WebSocketTraceEntry> trace = new();
    private readonly Queue<WebSocketQueuedFrame> outbound = new();
    private long sequence;

    public BrowserWebSocketState(string url, IEnumerable<string>? protocols = null, WebSocketHostProfile? hostProfile = null)
    {
        HostProfile = hostProfile ?? WebSocketHostProfile.Browser;
        HostProfile.RequireBrowserSemantics();
        Url = NormalizeUrl(url);
        Protocols = ValidateProtocols(protocols ?? Array.Empty<string>());
        ReadyState = BrowserWebSocketReadyState.Connecting;
        AddTrace(WebSocketTraceKind.Constructed, Url.AbsoluteUri);
    }

    public Uri Url { get; }
    public IReadOnlyList<string> Protocols { get; }
    public BrowserWebSocketReadyState ReadyState { get; private set; }
    public ulong BufferedAmount { get; private set; }
    public string Protocol { get; private set; } = string.Empty;
    public string Extensions { get; private set; } = string.Empty;
    public WebSocketHostProfile HostProfile { get; }
    public IReadOnlyList<WebSocketTraceEntry> Trace => trace;
    public int PendingApplicationMessages => outbound.Count;

    public void HostOpened(string selectedProtocol = "", string extensions = "")
    {
        if (ReadyState != BrowserWebSocketReadyState.Connecting)
            throw new InvalidOperationException("Host open transition requires CONNECTING.");
        if (selectedProtocol.Length != 0 && !Protocols.Contains(selectedProtocol, StringComparer.Ordinal))
            throw new InvalidOperationException("Host selected a protocol that was not offered.");
        Protocol = selectedProtocol;
        Extensions = extensions;
        ReadyState = BrowserWebSocketReadyState.Open;
        AddTrace(WebSocketTraceKind.Open, selectedProtocol);
    }

    public void HostMessageText(string data)
    {
        ArgumentNullException.ThrowIfNull(data);
        if (ReadyState != BrowserWebSocketReadyState.Open)
            throw new InvalidOperationException("Message dispatch requires OPEN.");
        AddTrace(WebSocketTraceKind.Message, data);
    }

    public void HostNetworkError(string opaqueReason = "network-error")
    {
        if (ReadyState == BrowserWebSocketReadyState.Closed) return;
        AddTrace(WebSocketTraceKind.Error, opaqueReason);
        HostClosed(new WebSocketCloseInfo(1006, string.Empty, false));
    }

    public void HostClosed(WebSocketCloseInfo close)
    {
        if (ReadyState == BrowserWebSocketReadyState.Closed) return;
        ReadyState = BrowserWebSocketReadyState.Closed;
        AddTrace(WebSocketTraceKind.Close, $"{close.Code}|{close.Reason}|{(close.WasClean ? "true" : "false")}");
    }

    public void SendText(string data)
    {
        ArgumentNullException.ThrowIfNull(data);
        QueueApplicationData(WebSocketMessageKind.Text, Encoding.UTF8.GetBytes(data));
    }

    public void SendBinary(ReadOnlySpan<byte> data)
        => QueueApplicationData(WebSocketMessageKind.Binary, data.ToArray());

    public WebSocketQueuedFrame HostTransmitNext()
    {
        if (ReadyState == BrowserWebSocketReadyState.Closed)
            throw new InvalidOperationException("Closed sockets cannot transmit queued frames.");
        if (!outbound.TryDequeue(out var frame))
            throw new InvalidOperationException("No queued application frame.");
        BufferedAmount -= checked((ulong)frame.Payload.Length);
        AddTrace(WebSocketTraceKind.Transmitted, frame.Payload.Length.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return frame;
    }

    public void Close(int? code = null, string reason = "")
    {
        ArgumentNullException.ThrowIfNull(reason);
        ValidateClose(code, reason);
        if (ReadyState is BrowserWebSocketReadyState.Closing or BrowserWebSocketReadyState.Closed) return;
        ReadyState = BrowserWebSocketReadyState.Closing;
        AddTrace(WebSocketTraceKind.CloseRequested, $"{(code?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "")}|{reason}|pending={outbound.Count}");
    }

    /// <summary>
    /// Connectivity changes never turn a browser WebSocket into a fresh connection.
    /// Reconnect policy belongs to the application/host layer.
    /// </summary>
    public void NetworkChanged(WebSocketNetworkChange change)
        => AddTrace(WebSocketTraceKind.NetworkChanged, change.ToString());

    private void QueueApplicationData(WebSocketMessageKind kind, byte[] payload)
    {
        if (ReadyState == BrowserWebSocketReadyState.Connecting)
            throw new WebSocketContractException("InvalidStateError", "send() while CONNECTING is not allowed.");

        BufferedAmount = checked(BufferedAmount + (ulong)payload.Length);
        if (ReadyState == BrowserWebSocketReadyState.Open)
        {
            outbound.Enqueue(new WebSocketQueuedFrame(kind, payload));
            AddTrace(WebSocketTraceKind.SendQueued, $"{kind}:{payload.Length}");
        }
        else
        {
            AddTrace(WebSocketTraceKind.SendDiscarded, $"{kind}:{payload.Length}");
        }
    }

    private static Uri NormalizeUrl(string raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri))
            throw new WebSocketContractException("SyntaxError", "WebSocket URL must be absolute.");
        if (!string.IsNullOrEmpty(uri.Fragment))
            throw new WebSocketContractException("SyntaxError", "WebSocket URL fragments are forbidden.");

        string scheme = uri.Scheme.ToLowerInvariant() switch
        {
            "ws" => "ws",
            "wss" => "wss",
            "http" => "ws",
            "https" => "wss",
            _ => throw new WebSocketContractException("SyntaxError", "Unsupported WebSocket URL scheme.")
        };
        if (scheme == uri.Scheme.ToLowerInvariant()) return uri;
        var builder = new UriBuilder(uri) { Scheme = scheme };
        return builder.Uri;
    }

    private static string[] ValidateProtocols(IEnumerable<string> protocols)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();
        foreach (string protocol in protocols)
        {
            ArgumentNullException.ThrowIfNull(protocol);
            if (!IsProtocolToken(protocol) || !seen.Add(protocol))
                throw new WebSocketContractException("SyntaxError", "Invalid or duplicate WebSocket subprotocol.");
            result.Add(protocol);
        }
        return result.ToArray();
    }

    private static bool IsProtocolToken(string value)
    {
        if (value.Length == 0) return false;
        const string separators = "()<>@,;:\"/[]?={} \t";
        foreach (char c in value)
            if (c < 0x21 || c > 0x7e || separators.IndexOf(c) >= 0)
                return false;
        return true;
    }

    private static void ValidateClose(int? code, string reason)
    {
        if (code.HasValue && code.Value != 1000 && (code.Value < 3000 || code.Value > 4999))
            throw new WebSocketContractException("InvalidAccessError", "Script close code must be 1000 or 3000..4999.");
        if (Encoding.UTF8.GetByteCount(reason) > 123)
            throw new WebSocketContractException("SyntaxError", "WebSocket close reason exceeds 123 UTF-8 bytes.");
    }

    private void AddTrace(WebSocketTraceKind kind, string detail)
        => trace.Add(new WebSocketTraceEntry(++sequence, kind, ReadyState, detail, BufferedAmount));
}
