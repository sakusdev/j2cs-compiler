namespace J2cs.Runtime.NodeCompat;

public delegate void NodeTimerCallback(NodeTimeoutHandle handle, IReadOnlyList<JsValue> arguments);

public sealed class NodeTimeoutHandle
{
    private bool referenced = true;

    internal NodeTimeoutHandle(NodeEventLoop owner, NodeTimerCallback callback, IReadOnlyList<JsValue> arguments)
    {
        Owner = owner;
        Callback = callback;
        Arguments = arguments;
        Pending = true;
    }

    internal NodeEventLoop Owner { get; }
    internal NodeTimerCallback Callback { get; }
    internal IReadOnlyList<JsValue> Arguments { get; }
    internal bool Pending { get; set; }
    internal bool Repeating { get; set; }
    internal long DueMilliseconds { get; set; }
    internal int DelayMilliseconds { get; set; }
    internal long Sequence { get; set; }

    public bool HasRef() => referenced;

    public NodeTimeoutHandle Ref()
    {
        referenced = true;
        return this;
    }

    public NodeTimeoutHandle Unref()
    {
        referenced = false;
        return this;
    }
}
