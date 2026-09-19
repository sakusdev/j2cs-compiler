namespace J2cs.Runtime.NodeCompat;

public enum NodeStreamChunkKind { Buffer, Value }

/// <summary>
/// A deliberately closed stream chunk union. Byte-mode streams admit NodeBuffer only;
/// objectMode admits JsValue without falling back to CLR object/dynamic.
/// </summary>
public readonly struct NodeStreamChunk
{
    private readonly NodeBuffer? buffer;
    private readonly JsValue value;
    public NodeStreamChunkKind Kind { get; }

    private NodeStreamChunk(NodeBuffer buffer)
        => (this.buffer, value, Kind) = (buffer ?? throw new ArgumentNullException(nameof(buffer)), default, NodeStreamChunkKind.Buffer);

    private NodeStreamChunk(JsValue value)
        => (buffer, this.value, Kind) = (null, value, NodeStreamChunkKind.Value);

    public static NodeStreamChunk FromBuffer(NodeBuffer buffer) => new(buffer);
    public static NodeStreamChunk FromValue(JsValue value) => new(value);

    public NodeBuffer Buffer => Kind == NodeStreamChunkKind.Buffer
        ? buffer!
        : throw new InvalidOperationException("Byte-mode stream chunk proof violated");

    public JsValue Value => Kind == NodeStreamChunkKind.Value
        ? value
        : throw new InvalidOperationException("Object-mode stream chunk proof violated");

    public int Measure(bool objectMode)
        => objectMode ? 1 : Kind == NodeStreamChunkKind.Buffer
            ? Buffer.Length
            : throw new InvalidOperationException("Non-Buffer chunk in byte-mode Node stream");
}

public interface INodeCompatScheduler
{
    void Defer(Action action);
}

/// <summary>
/// Deterministic host scheduler used by compatibility tests and embedders. A production
/// Node host must drive this queue at the Node-compatible task boundary; the runtime
/// never silently substitutes CLR thread-pool ordering.
/// </summary>
public sealed class NodeManualScheduler : INodeCompatScheduler
{
    private readonly Queue<Action> pending = new();

    public int PendingCount => pending.Count;

    public void Defer(Action action)
    {
        ArgumentNullException.ThrowIfNull(action);
        pending.Enqueue(action);
    }

    public void Drain()
    {
        while (pending.TryDequeue(out var action)) action();
    }
}

public sealed class NodeReadable
{
    private sealed class Entry
    {
        public NodeStreamChunk Chunk { get; set; }
        public int Size { get; }
        public Entry(NodeStreamChunk chunk, int size) => (Chunk, Size) = (chunk, size);
    }

    private readonly LinkedList<Entry> queue = new();
    private readonly NodeEventEmitter events;
    private readonly INodeCompatScheduler scheduler;
    private bool eof;
    private bool endScheduled;
    private bool endEmitted;

    internal NodeReadable(INodeCompatScheduler scheduler, int highWaterMark, bool objectMode, NodeEventEmitter? events = null)
    {
        this.scheduler = scheduler ?? throw new ArgumentNullException(nameof(scheduler));
        this.events = events ?? new NodeEventEmitter();
        HighWaterMark = NodeStreams.ConfigureHighWaterMark(highWaterMark);
        ObjectMode = objectMode;
    }

    public int HighWaterMark { get; }
    public bool ObjectMode { get; }
    public int BufferedLength { get; private set; }
    public bool ReadableEnded => endEmitted;

    public NodeReadable On(string eventName, NodeEventListener listener) { events.On(eventName, listener); return this; }
    public NodeReadable Once(string eventName, NodeEventListener listener) { events.Once(eventName, listener); return this; }
    public NodeReadable RemoveListener(string eventName, NodeEventListener listener) { events.RemoveListener(eventName, listener); return this; }

    public bool Push(NodeStreamChunk chunk)
    {
        if (eof) throw new InvalidOperationException("ERR_STREAM_PUSH_AFTER_EOF");
        var size = chunk.Measure(ObjectMode);
        queue.AddLast(new Entry(chunk, size));
        BufferedLength = checked(BufferedLength + size);
        return BufferedLength < HighWaterMark;
    }

    public bool PushEof()
    {
        if (eof) return false;
        eof = true;
        MaybeScheduleEnd();
        return false;
    }

    public NodeStreamChunk? Read(int? requestedSize = null)
    {
        if (queue.Count == 0)
        {
            MaybeScheduleEnd();
            return null;
        }

        if (ObjectMode)
        {
            if (requestedSize is < 0) throw new ArgumentOutOfRangeException(nameof(requestedSize));
            var entry = queue.First!.Value;
            queue.RemoveFirst();
            BufferedLength--;
            MaybeScheduleEnd();
            return entry.Chunk;
        }

        if (requestedSize is < 0) throw new ArgumentOutOfRangeException(nameof(requestedSize));
        if (requestedSize == 0) return null;
        if (requestedSize.HasValue && requestedSize.Value > BufferedLength && !eof) return null;

        var count = Math.Min(requestedSize ?? BufferedLength, BufferedLength);
        var result = NodeBuffer.Alloc(count);
        var destinationOffset = 0;

        while (destinationOffset < count)
        {
            var node = queue.First ?? throw new InvalidOperationException("Readable buffer accounting invariant violated");
            var source = node.Value.Chunk.Buffer;
            var take = Math.Min(source.Length, count - destinationOffset);
            for (var i = 0; i < take; i++) result[destinationOffset + i] = source[i];
            destinationOffset += take;
            BufferedLength -= take;

            if (take == source.Length)
            {
                queue.RemoveFirst();
            }
            else
            {
                node.Value.Chunk = NodeStreamChunk.FromBuffer(source.Slice(take));
            }
        }

        MaybeScheduleEnd();
        return NodeStreamChunk.FromBuffer(result);
    }

    private void MaybeScheduleEnd()
    {
        if (!eof || BufferedLength != 0 || endEmitted || endScheduled) return;
        endScheduled = true;
        scheduler.Defer(() =>
        {
            endScheduled = false;
            if (!eof || BufferedLength != 0 || endEmitted) return;
            endEmitted = true;
            events.Emit("end");
        });
    }
}

public delegate void NodeWriteHandler(NodeStreamChunk chunk, Action<Exception?> complete);

public sealed class NodeWritable
{
    private sealed class Request
    {
        public NodeStreamChunk Chunk { get; }
        public int Size { get; }
        public Action<Exception?>? Callback { get; }
        public Request(NodeStreamChunk chunk, int size, Action<Exception?>? callback)
            => (Chunk, Size, Callback) = (chunk, size, callback);
    }

    private readonly Queue<Request> queue = new();
    private readonly NodeEventEmitter events;
    private readonly INodeCompatScheduler scheduler;
    private readonly NodeWriteHandler handler;
    private readonly List<Action<Exception?>> endCallbacks = new();
    private bool processing;
    private bool ending;
    private bool finishScheduled;
    private bool finished;
    private bool failed;
    private bool needDrain;

    internal NodeWritable(
        INodeCompatScheduler scheduler,
        int highWaterMark,
        bool objectMode,
        NodeWriteHandler? handler = null,
        NodeEventEmitter? events = null)
    {
        this.scheduler = scheduler ?? throw new ArgumentNullException(nameof(scheduler));
        this.events = events ?? new NodeEventEmitter();
        this.handler = handler ?? ((_, complete) => complete(null));
        HighWaterMark = NodeStreams.ConfigureHighWaterMark(highWaterMark);
        ObjectMode = objectMode;
    }

    public int HighWaterMark { get; }
    public bool ObjectMode { get; }
    public int BufferedLength { get; private set; }
    public bool WritableEnded => ending;
    public bool WritableFinished => finished;

    public NodeWritable On(string eventName, NodeEventListener listener) { events.On(eventName, listener); return this; }
    public NodeWritable Once(string eventName, NodeEventListener listener) { events.Once(eventName, listener); return this; }
    public NodeWritable RemoveListener(string eventName, NodeEventListener listener) { events.RemoveListener(eventName, listener); return this; }

    public bool Write(NodeStreamChunk chunk, Action<Exception?>? callback = null)
    {
        if (ending) throw new InvalidOperationException("ERR_STREAM_WRITE_AFTER_END");
        if (failed) throw new InvalidOperationException("Cannot write to a failed Node stream");

        var size = chunk.Measure(ObjectMode);
        queue.Enqueue(new Request(chunk, size, callback));
        BufferedLength = checked(BufferedLength + size);
        var accepted = BufferedLength < HighWaterMark;
        if (!accepted) needDrain = true;
        StartNext();
        return accepted;
    }

    public NodeWritable End(NodeStreamChunk? finalChunk = null, Action<Exception?>? callback = null)
    {
        if (ending) return this;
        if (callback is not null) endCallbacks.Add(callback);
        if (finalChunk.HasValue) Write(finalChunk.Value);
        ending = true;
        MaybeScheduleFinish();
        return this;
    }

    private void StartNext()
    {
        if (processing || failed || queue.Count == 0)
        {
            MaybeScheduleFinish();
            return;
        }

        processing = true;
        var request = queue.Peek();
        var completed = false;
        void Complete(Exception? error)
        {
            if (completed) throw new InvalidOperationException("Node writable host callback invoked more than once");
            completed = true;
            scheduler.Defer(() => CompleteDeferred(request, error));
        }

        try { handler(request.Chunk, Complete); }
        catch (Exception error) { Complete(error); }
    }

    private void CompleteDeferred(Request request, Exception? error)
    {
        if (queue.Count == 0 || !ReferenceEquals(queue.Peek(), request))
            throw new InvalidOperationException("Node writable completion order invariant violated");

        queue.Dequeue();
        BufferedLength -= request.Size;
        processing = false;
        request.Callback?.Invoke(error);

        if (error is not null)
        {
            failed = true;
            foreach (var callback in endCallbacks) callback(error);
            endCallbacks.Clear();
            events.Emit("error", JsValue.FromString(error.Message));
            return;
        }

        if (needDrain && (BufferedLength < HighWaterMark || (HighWaterMark == 0 && BufferedLength == 0)))
        {
            needDrain = false;
            events.Emit("drain");
        }

        StartNext();
        MaybeScheduleFinish();
    }

    private void MaybeScheduleFinish()
    {
        if (!ending || processing || queue.Count != 0 || finished || finishScheduled || failed) return;
        finishScheduled = true;
        scheduler.Defer(() =>
        {
            finishScheduled = false;
            if (!ending || processing || queue.Count != 0 || finished || failed) return;
            foreach (var callback in endCallbacks) callback(null);
            endCallbacks.Clear();
            finished = true;
            events.Emit("finish");
        });
    }
}

public sealed class NodeDuplex
{
    internal NodeDuplex(
        INodeCompatScheduler scheduler,
        int readableHighWaterMark,
        int writableHighWaterMark,
        bool readableObjectMode,
        bool writableObjectMode,
        bool allowHalfOpen,
        NodeWriteHandler? writeHandler)
    {
        var events = new NodeEventEmitter();
        Readable = new NodeReadable(scheduler, readableHighWaterMark, readableObjectMode, events);
        Writable = new NodeWritable(scheduler, writableHighWaterMark, writableObjectMode, writeHandler, events);
        AllowHalfOpen = allowHalfOpen;
        if (!allowHalfOpen)
            Readable.Once("end", new NodeEventListener(_ => Writable.End()));
    }

    public NodeReadable Readable { get; }
    public NodeWritable Writable { get; }
    public bool AllowHalfOpen { get; }
    public int ReadableHighWaterMark => Readable.HighWaterMark;
    public int WritableHighWaterMark => Writable.HighWaterMark;
}

public static class NodeStreams
{
    public static int ConfigureHighWaterMark(int highWaterMark)
    {
        if (highWaterMark < 0) throw new ArgumentOutOfRangeException(nameof(highWaterMark));
        return highWaterMark;
    }

    public static NodeReadable CreateReadable(INodeCompatScheduler scheduler, int highWaterMark = 16 * 1024, bool objectMode = false)
        => new(scheduler, highWaterMark, objectMode);

    public static NodeWritable CreateWritable(
        INodeCompatScheduler scheduler,
        int highWaterMark = 16 * 1024,
        bool objectMode = false,
        NodeWriteHandler? handler = null)
        => new(scheduler, highWaterMark, objectMode, handler);

    public static NodeDuplex CreateDuplex(
        INodeCompatScheduler scheduler,
        int readableHighWaterMark = 16 * 1024,
        int writableHighWaterMark = 16 * 1024,
        bool readableObjectMode = false,
        bool writableObjectMode = false,
        bool allowHalfOpen = true,
        NodeWriteHandler? writeHandler = null)
        => new(scheduler, readableHighWaterMark, writableHighWaterMark, readableObjectMode, writableObjectMode, allowHalfOpen, writeHandler);

    public static bool Push(NodeReadable readable, NodeStreamChunk chunk) => readable.Push(chunk);
    public static bool PushEof(NodeReadable readable) => readable.PushEof();
    public static NodeStreamChunk? Read(NodeReadable readable, int? size = null) => readable.Read(size);
    public static bool Write(NodeWritable writable, NodeStreamChunk chunk, Action<Exception?>? callback = null) => writable.Write(chunk, callback);
    public static NodeWritable End(NodeWritable writable, NodeStreamChunk? finalChunk = null, Action<Exception?>? callback = null)
        => writable.End(finalChunk, callback);
    public static NodeWritable OnDrain(NodeWritable writable, NodeEventListener listener) => writable.On("drain", listener);
    public static NodeWritable OnFinish(NodeWritable writable, NodeEventListener listener) => writable.On("finish", listener);
}
