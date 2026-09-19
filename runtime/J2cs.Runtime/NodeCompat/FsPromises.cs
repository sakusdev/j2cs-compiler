namespace J2cs.Runtime.NodeCompat;

public interface INodePromiseScheduler
{
    bool PreservesJavaScriptMicrotaskOrdering { get; }

    Task<T> BridgeHostTask<T>(Task<T> hostTask, CancellationToken cancellationToken);
}

public static class NodeFsPromises
{
    public static Task<NodeFsReadResult> ReadFileAsync(
        string path,
        NodeFsReadFileOptions? options,
        INodePromiseScheduler scheduler,
        CancellationToken cancellationToken = default)
    {
        RequireCompatibleScheduler(scheduler);
        var hostTask = ReadFileCoreAsync(path, options ?? NodeFsReadFileOptions.BufferDefault, cancellationToken);
        return scheduler.BridgeHostTask(hostTask, cancellationToken);
    }

    public static Task<JsValue> WriteFileAsync(
        string path,
        string data,
        NodeFsWriteFileOptions? options,
        INodePromiseScheduler scheduler,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(data);
        RequireCompatibleScheduler(scheduler);
        var actual = options ?? NodeFsWriteFileOptions.Default;
        var bytes = NodeFsEncodingCodec.Encode(data, actual.Encoding);
        var hostTask = WriteFileCoreAsync(path, bytes, actual, cancellationToken);
        return scheduler.BridgeHostTask(hostTask, cancellationToken);
    }

    public static Task<JsValue> WriteFileAsync(
        string path,
        NodeFsBuffer data,
        NodeFsWriteFileOptions? options,
        INodePromiseScheduler scheduler,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(data);
        RequireCompatibleScheduler(scheduler);
        var actual = options ?? NodeFsWriteFileOptions.Default;
        var hostTask = WriteFileCoreAsync(path, data.Memory, actual, cancellationToken);
        return scheduler.BridgeHostTask(hostTask, cancellationToken);
    }

    private static void RequireCompatibleScheduler(INodePromiseScheduler scheduler)
    {
        ArgumentNullException.ThrowIfNull(scheduler);
        if (!scheduler.PreservesJavaScriptMicrotaskOrdering)
            throw new InvalidOperationException("fs.promises lowering requires a JS-compatible Promise/microtask scheduler.");
    }

    private static async Task<NodeFsReadResult> ReadFileCoreAsync(string path, NodeFsReadFileOptions options, CancellationToken token)
    {
        ArgumentNullException.ThrowIfNull(path);
        try
        {
            token.ThrowIfCancellationRequested();
            if (Directory.Exists(path))
                throw new NodeFsException("EISDIR", "read", path, "illegal operation on a directory");
            await using var stream = NodeFs.OpenReadStream(path, options.Flag, asynchronous: true);
            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory, token).ConfigureAwait(false);
            return NodeFs.DecodeReadResult(memory.ToArray(), options.Encoding);
        }
        catch (OperationCanceledException ex) when (token.IsCancellationRequested)
        {
            throw new NodeFsAbortException(token, ex);
        }
        catch (NodeFsException)
        {
            throw;
        }
        catch (NodeFsArgumentException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            throw NodeFs.Wrap(ex, "open", path);
        }
    }

    private static async Task<JsValue> WriteFileCoreAsync(
        string path,
        ReadOnlyMemory<byte> bytes,
        NodeFsWriteFileOptions options,
        CancellationToken token)
    {
        ArgumentNullException.ThrowIfNull(path);
        var exclusive = NodeFs.IsExclusiveWriteFlag(options.Flag);
        try
        {
            token.ThrowIfCancellationRequested();
            await using var stream = NodeFs.OpenWriteStream(path, options.Flag, asynchronous: true);
            await stream.WriteAsync(bytes, token).ConfigureAwait(false);
            if (options.Flush)
            {
                await stream.FlushAsync(token).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }
            return JsUndefined.Value;
        }
        catch (OperationCanceledException ex) when (token.IsCancellationRequested)
        {
            throw new NodeFsAbortException(token, ex);
        }
        catch (NodeFsArgumentException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            throw NodeFs.Wrap(ex, "open", path, exclusive);
        }
    }
}
