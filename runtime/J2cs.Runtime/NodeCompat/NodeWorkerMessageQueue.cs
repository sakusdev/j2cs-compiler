namespace J2cs.Runtime.NodeCompat;

public sealed class NodeWorkerMessageQueue
{
    private readonly Queue<JsValue> messages = [];
    private bool completed;
    private bool exitDelivered;
    private int exitCode;

    public int PendingCount => messages.Count;
    public bool IsCompleted => completed;

    public void PostMessage(JsValue value)
    {
        if (completed) throw new InvalidOperationException("Cannot post a Worker message after exit.");
        messages.Enqueue(CloneSupportedValue(value));
    }

    public void Complete(int code)
    {
        if (completed) throw new InvalidOperationException("Worker exit was already recorded.");
        completed = true;
        exitCode = code;
    }

    public void Drain(Action<JsValue> onMessage, Action<int>? onExit = null)
    {
        ArgumentNullException.ThrowIfNull(onMessage);
        while (messages.Count > 0)
            onMessage(messages.Dequeue());

        if (completed && !exitDelivered)
        {
            exitDelivered = true;
            onExit?.Invoke(exitCode);
        }
    }

    private static JsValue CloneSupportedValue(JsValue value) => value.Kind switch
    {
        JsKind.Undefined => JsValue.Undefined,
        JsKind.Null => JsValue.Null,
        JsKind.Number => JsValue.FromNumber(value.Number),
        JsKind.String => JsValue.FromString(value.String),
        JsKind.Boolean => JsValue.FromBoolean(value.Boolean),
        JsKind.Object => throw new NotSupportedException(
            "Worker object/transfer serialization requires WORKERS_MESSAGING/BINARY integration."),
        _ => throw new InvalidOperationException("Unknown JavaScript value tag."),
    };
}
