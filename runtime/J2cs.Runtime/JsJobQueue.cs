namespace J2cs.Runtime;

/// <summary>
/// Explicit FIFO queue for ECMAScript Promise jobs. It is intentionally independent
/// from CLR Task scheduling so settled promises never run reactions inline.
/// </summary>
public sealed class JsJobQueue
{
    private readonly Queue<Action> jobs = new();
    private bool draining;

    public int Count => jobs.Count;

    public void Enqueue(Action job)
        => jobs.Enqueue(job ?? throw new ArgumentNullException(nameof(job)));

    /// <summary>
    /// Drain one JavaScript microtask checkpoint. Jobs enqueued by jobs in this
    /// checkpoint are appended and run before Drain returns.
    /// </summary>
    public void Drain()
    {
        if (draining) return;
        draining = true;
        try
        {
            while (jobs.Count != 0)
                jobs.Dequeue()();
        }
        finally
        {
            draining = false;
        }
    }
}
