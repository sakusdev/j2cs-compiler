namespace J2cs.Runtime;

public static class JsMicrotaskQueue
{
    private static readonly Queue<Action> Jobs = new();
    private static bool _draining;

    public static JsValue Enqueue(Func<JsValue> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        Jobs.Enqueue(() => { _ = callback(); });
        return JsUndefined.Value;
    }

    internal static void EnqueueContinuation(Action callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        Jobs.Enqueue(callback);
    }

    public static JsValue Drain()
    {
        if (_draining)
            return JsUndefined.Value;

        _draining = true;
        try
        {
            while (Jobs.Count != 0)
                Jobs.Dequeue()();
        }
        finally
        {
            _draining = false;
        }

        return JsUndefined.Value;
    }
}
