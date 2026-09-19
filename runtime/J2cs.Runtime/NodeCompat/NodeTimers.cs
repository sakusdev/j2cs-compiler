namespace J2cs.Runtime.NodeCompat;

public sealed class NodeEventLoop
{
    public static int NormalizeDelay(double delay)
        => double.IsNaN(delay) || delay < 1 || delay > int.MaxValue
            ? 1
            : Math.Max(1, checked((int)Math.Truncate(delay)));
}
