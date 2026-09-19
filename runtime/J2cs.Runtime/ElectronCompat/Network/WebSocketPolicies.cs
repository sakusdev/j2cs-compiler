namespace J2cs.Runtime.ElectronCompat.Network;

/// <summary>
/// Application/host retry policy. It is intentionally separate from browser WebSocket:
/// connectivity changes never mutate an existing WebSocket into a fresh connection.
/// </summary>
public sealed class WebSocketReconnectPolicy
{
    public WebSocketReconnectPolicy(TimeSpan initialDelay, TimeSpan maximumDelay, int maximumAttempts)
    {
        if (initialDelay < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(initialDelay));
        if (maximumDelay < initialDelay) throw new ArgumentOutOfRangeException(nameof(maximumDelay));
        if (maximumAttempts < 0) throw new ArgumentOutOfRangeException(nameof(maximumAttempts));
        InitialDelay = initialDelay;
        MaximumDelay = maximumDelay;
        MaximumAttempts = maximumAttempts;
    }

    public TimeSpan InitialDelay { get; }
    public TimeSpan MaximumDelay { get; }
    public int MaximumAttempts { get; }

    public TimeSpan? DelayForAttempt(int zeroBasedAttempt)
    {
        if (zeroBasedAttempt < 0) throw new ArgumentOutOfRangeException(nameof(zeroBasedAttempt));
        if (zeroBasedAttempt >= MaximumAttempts) return null;
        double scale = Math.Pow(2d, Math.Min(zeroBasedAttempt, 52));
        double ticks = Math.Min(MaximumDelay.Ticks, InitialDelay.Ticks * scale);
        return TimeSpan.FromTicks(checked((long)ticks));
    }
}

/// <summary>
/// Browser WebSocket exposes no protocol-level ping API. This models only an
/// application text heartbeat; transport Ping/Pong remains inside the host.
/// </summary>
public sealed record WebSocketHeartbeatPolicy(TimeSpan Interval, string TextPayload)
{
    public WebSocketHeartbeatPolicy Validate()
    {
        if (Interval <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(Interval));
        ArgumentNullException.ThrowIfNull(TextPayload);
        return this;
    }
}
