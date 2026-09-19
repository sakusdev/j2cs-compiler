namespace J2cs.Runtime;

public static class JsAsync
{
    public static void AwaitValue(JsValue value, Action<JsValue> continuation)
    {
        ArgumentNullException.ThrowIfNull(continuation);
        JsMicrotaskQueue.EnqueueContinuation(() => continuation(value));
    }
}
