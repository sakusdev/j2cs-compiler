namespace J2cs.Runtime.NodeCompat;

public delegate void NodeImmediateCallback(NodeImmediateHandle handle, IReadOnlyList<JsValue> arguments);

public sealed class NodeImmediateHandle
{
    private bool referenced = true;

    internal NodeImmediateHandle(NodeEventLoop owner, NodeImmediateCallback callback, IReadOnlyList<JsValue> arguments)
    {
        Owner = owner;
        Callback = callback;
        Arguments = arguments;
        Pending = true;
    }

    internal NodeEventLoop Owner { get; }
    internal NodeImmediateCallback Callback { get; }
    internal IReadOnlyList<JsValue> Arguments { get; }
    internal bool Pending { get; set; }

    public bool HasRef() => referenced;

    public NodeImmediateHandle Ref()
    {
        referenced = true;
        return this;
    }

    public NodeImmediateHandle Unref()
    {
        referenced = false;
        return this;
    }
}
