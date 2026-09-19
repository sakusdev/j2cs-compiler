namespace J2cs.Runtime.NodeCompat;

public sealed class NodeEventLoop
{
    private readonly List<NodeTimeoutHandle> timers = [];
    private readonly Queue<NodeImmediateHandle> immediates = [];
    private long nowMilliseconds;
    private long nextSequence;

    public long NowMilliseconds => nowMilliseconds;

    public static int NormalizeDelay(double delay)
        => double.IsNaN(delay) || delay < 1 || delay > int.MaxValue
            ? 1
            : Math.Max(1, checked((int)Math.Truncate(delay)));

    public NodeTimeoutHandle SetTimeout(NodeTimerCallback callback, double delay = 1, params JsValue[] arguments)
        => AddTimer(callback, delay, false, arguments);

    public NodeTimeoutHandle SetInterval(NodeTimerCallback callback, double delay = 1, params JsValue[] arguments)
        => AddTimer(callback, delay, true, arguments);

    public void ClearTimeout(NodeTimeoutHandle? handle)
    {
        if (handle is null || !ReferenceEquals(handle.Owner, this)) return;
        handle.Pending = false;
        timers.Remove(handle);
    }

    public void ClearInterval(NodeTimeoutHandle? handle) => ClearTimeout(handle);

    public NodeImmediateHandle SetImmediate(NodeImmediateCallback callback, params JsValue[] arguments)
    {
        ArgumentNullException.ThrowIfNull(callback);
        var handle = new NodeImmediateHandle(this, callback, arguments.ToArray());
        immediates.Enqueue(handle);
        return handle;
    }

    public void ClearImmediate(NodeImmediateHandle? handle)
    {
        if (handle is null || !ReferenceEquals(handle.Owner, this)) return;
        handle.Pending = false;
    }

    public void AdvanceBy(long milliseconds, int maxCallbacks = 10_000)
    {
        if (milliseconds < 0) throw new ArgumentOutOfRangeException(nameof(milliseconds));
        checked { nowMilliseconds += milliseconds; }
        RunDueTimers(maxCallbacks);
    }

    public int RunDueTimers(int maxCallbacks = 10_000)
    {
        if (maxCallbacks < 1) throw new ArgumentOutOfRangeException(nameof(maxCallbacks));
        var invoked = 0;
        for (;;)
        {
            var next = FindNextDue();
            if (next is null) return invoked;
            if (++invoked > maxCallbacks) throw new InvalidOperationException("Timer callback limit exceeded.");

            if (!next.Repeating)
            {
                next.Pending = false;
                timers.Remove(next);
            }

            next.Callback(next, next.Arguments);
            if (next.Repeating && next.Pending)
            {
                next.DueMilliseconds = checked(nowMilliseconds + next.DelayMilliseconds);
                next.Sequence = ++nextSequence;
            }
        }
    }

    public int RunCheckPhase(int maxCallbacks = 10_000)
    {
        if (maxCallbacks < 1) throw new ArgumentOutOfRangeException(nameof(maxCallbacks));
        var scheduledThisTurn = immediates.Count;
        var invoked = 0;
        for (var i = 0; i < scheduledThisTurn; i++)
        {
            var immediate = immediates.Dequeue();
            if (!immediate.Pending) continue;
            if (++invoked > maxCallbacks) throw new InvalidOperationException("Immediate callback limit exceeded.");
            immediate.Pending = false;
            immediate.Callback(immediate, immediate.Arguments);
        }
        return invoked;
    }

    private NodeTimeoutHandle AddTimer(
        NodeTimerCallback callback,
        double delay,
        bool repeating,
        JsValue[] arguments)
    {
        ArgumentNullException.ThrowIfNull(callback);
        var normalized = NormalizeDelay(delay);
        var handle = new NodeTimeoutHandle(this, callback, arguments.ToArray())
        {
            Repeating = repeating,
            DelayMilliseconds = normalized,
            DueMilliseconds = checked(nowMilliseconds + normalized),
            Sequence = ++nextSequence,
        };
        timers.Add(handle);
        return handle;
    }

    private NodeTimeoutHandle? FindNextDue()
    {
        NodeTimeoutHandle? result = null;
        foreach (var timer in timers)
        {
            if (!timer.Pending || timer.DueMilliseconds > nowMilliseconds) continue;
            if (result is null
                || timer.DueMilliseconds < result.DueMilliseconds
                || timer.DueMilliseconds == result.DueMilliseconds && timer.Sequence < result.Sequence)
                result = timer;
        }
        return result;
    }
}
