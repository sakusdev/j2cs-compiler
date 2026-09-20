namespace J2cs.Runtime.ElectronCompat;

public delegate void IpcMainListener(IpcMainEvent @event, IReadOnlyList<IpcValue> arguments);
public delegate ValueTask<IpcValue> IpcInvokeHandler(IpcMainEvent @event, IReadOnlyList<IpcValue> arguments);
public delegate void IpcRendererListener(IReadOnlyList<IpcValue> arguments);

public sealed class IpcRendererDestroyedException : InvalidOperationException
{
    public IpcRendererDestroyedException(int rendererId)
        : base("Electron renderer " + rendererId + " has been destroyed.") { }
}

public sealed class IpcRemoteException : Exception
{
    public IpcRemoteException(string remoteName, string remoteMessage)
        : base(remoteName + ": " + remoteMessage)
    {
        RemoteName = remoteName;
        RemoteMessage = remoteMessage;
    }

    public string RemoteName { get; }
    public string RemoteMessage { get; }
}

public sealed class IpcMainEvent
{
    private readonly Action<string, IReadOnlyList<IpcValue>> reply;
    private IpcValue? returnValue;

    internal IpcMainEvent(int rendererId, Action<string, IReadOnlyList<IpcValue>> reply)
    {
        RendererId = rendererId;
        this.reply = reply;
    }

    public int RendererId { get; }
    public bool HasReturnValue => returnValue is not null;

    public void Reply(string channel, params IpcValue[] arguments)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        ArgumentNullException.ThrowIfNull(arguments);
        reply(channel, arguments);
    }

    public void SetReturnValue(IpcValue value)
        => returnValue = IpcStructuredClone.Clone(value ?? throw new ArgumentNullException(nameof(value)));

    internal IpcValue GetReturnValueOrUndefined()
        => returnValue ?? IpcUndefinedValue.Instance;
}

internal sealed class IpcTaskQueue
{
    private readonly Queue<Func<ValueTask>> queue = new();
    private readonly object gate = new();
    private readonly SemaphoreSlim drainGate = new(1, 1);

    public void Enqueue(Func<ValueTask> action)
    {
        ArgumentNullException.ThrowIfNull(action);
        lock (gate)
            queue.Enqueue(action);
    }

    public async ValueTask DrainAsync()
    {
        await drainGate.WaitAsync().ConfigureAwait(false);
        try
        {
            while (true)
            {
                Func<ValueTask>? action;
                lock (gate)
                    action = queue.Count == 0 ? null : queue.Dequeue();
                if (action is null)
                    return;
                await action().ConfigureAwait(false);
            }
        }
        finally
        {
            drainGate.Release();
        }
    }
}

public sealed class IpcMain
{
    private sealed class InvokeRegistration
    {
        public required IpcInvokeHandler Handler { get; init; }
        public required bool Once { get; init; }
    }

    private readonly Dictionary<string, List<IpcMainListener>> listeners = new(StringComparer.Ordinal);
    private readonly Dictionary<string, InvokeRegistration> handlers = new(StringComparer.Ordinal);
    private readonly object gate = new();

    public IpcMain On(string channel, IpcMainListener listener)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        ArgumentNullException.ThrowIfNull(listener);
        lock (gate)
        {
            if (!listeners.TryGetValue(channel, out var channelListeners))
            {
                channelListeners = new List<IpcMainListener>();
                listeners[channel] = channelListeners;
            }
            channelListeners.Add(listener);
        }
        return this;
    }

    public void Handle(string channel, IpcInvokeHandler handler)
        => AddHandler(channel, handler, once: false);

    public void HandleOnce(string channel, IpcInvokeHandler handler)
        => AddHandler(channel, handler, once: true);

    private void AddHandler(string channel, IpcInvokeHandler handler, bool once)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        ArgumentNullException.ThrowIfNull(handler);
        lock (gate)
        {
            if (handlers.ContainsKey(channel))
                throw new InvalidOperationException("An invoke handler is already registered for channel '" + channel + "'.");
            handlers.Add(channel, new InvokeRegistration { Handler = handler, Once = once });
        }
    }

    public void RemoveHandler(string channel)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        lock (gate)
            handlers.Remove(channel);
    }

    internal void DispatchSend(IpcRenderer renderer, string channel, IReadOnlyList<IpcValue> arguments)
    {
        IpcMainListener[] snapshot;
        lock (gate)
            snapshot = listeners.TryGetValue(channel, out var channelListeners)
                ? channelListeners.ToArray()
                : Array.Empty<IpcMainListener>();

        var @event = renderer.CreateMainEvent();
        foreach (var listener in snapshot)
            listener(@event, arguments);
    }

    internal IpcValue DispatchSync(IpcRenderer renderer, string channel, IReadOnlyList<IpcValue> arguments)
    {
        IpcMainListener[] snapshot;
        lock (gate)
            snapshot = listeners.TryGetValue(channel, out var channelListeners)
                ? channelListeners.ToArray()
                : Array.Empty<IpcMainListener>();

        var @event = renderer.CreateMainEvent();
        foreach (var listener in snapshot)
            listener(@event, arguments);
        return IpcStructuredClone.Clone(@event.GetReturnValueOrUndefined());
    }

    internal async ValueTask<IpcValue> DispatchInvokeAsync(
        IpcRenderer renderer,
        string channel,
        IReadOnlyList<IpcValue> arguments)
    {
        InvokeRegistration registration;
        lock (gate)
        {
            if (!handlers.TryGetValue(channel, out registration!))
                throw new InvalidOperationException("No invoke handler is registered for channel '" + channel + "'.");
            if (registration.Once)
                handlers.Remove(channel);
        }

        return await registration.Handler(renderer.CreateMainEvent(), arguments).ConfigureAwait(false);
    }
}

public sealed class IpcRenderer
{
    private readonly ElectronIpcRuntime runtime;
    private readonly Dictionary<string, List<IpcRendererListener>> listeners = new(StringComparer.Ordinal);
    private readonly object gate = new();
    private int destroyed;

    internal IpcRenderer(ElectronIpcRuntime runtime, int id)
    {
        this.runtime = runtime;
        Id = id;
    }

    public int Id { get; }
    public bool IsDestroyed => Volatile.Read(ref destroyed) != 0;

    public IpcRenderer On(string channel, IpcRendererListener listener)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        ArgumentNullException.ThrowIfNull(listener);
        EnsureAlive();
        lock (gate)
        {
            if (!listeners.TryGetValue(channel, out var channelListeners))
            {
                channelListeners = new List<IpcRendererListener>();
                listeners[channel] = channelListeners;
            }
            channelListeners.Add(listener);
        }
        return this;
    }

    public void Send(string channel, params IpcValue[] arguments)
    {
        EnsureAlive();
        runtime.EnqueueSend(this, channel, arguments);
    }

    public Task<IpcValue> InvokeAsync(string channel, params IpcValue[] arguments)
    {
        EnsureAlive();
        return runtime.EnqueueInvoke(this, channel, arguments);
    }

    public IpcValue SendSync(string channel, params IpcValue[] arguments)
    {
        EnsureAlive();
        return runtime.SendSync(this, channel, arguments);
    }

    public void Destroy()
        => Interlocked.Exchange(ref destroyed, 1);

    internal void EnsureAlive()
    {
        if (IsDestroyed)
            throw new IpcRendererDestroyedException(Id);
    }

    internal IpcMainEvent CreateMainEvent()
        => new(Id, (channel, arguments) => runtime.EnqueueMainToRenderer(this, channel, arguments));

    internal ValueTask DeliverAsync(string channel, IReadOnlyList<IpcValue> arguments)
    {
        if (IsDestroyed)
            return ValueTask.CompletedTask;

        IpcRendererListener[] snapshot;
        lock (gate)
            snapshot = listeners.TryGetValue(channel, out var channelListeners)
                ? channelListeners.ToArray()
                : Array.Empty<IpcRendererListener>();

        foreach (var listener in snapshot)
            listener(arguments);
        return ValueTask.CompletedTask;
    }
}

public sealed class ElectronIpcRuntime
{
    private readonly IpcTaskQueue queue = new();
    private int nextRendererId;

    public ElectronIpcRuntime()
        => IpcMain = new IpcMain();

    public IpcMain IpcMain { get; }

    public IpcRenderer CreateRenderer()
        => new(this, Interlocked.Increment(ref nextRendererId));

    public ValueTask DrainAsync()
        => queue.DrainAsync();

    internal void EnqueueSend(IpcRenderer renderer, string channel, IReadOnlyList<IpcValue> arguments)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        var snapshot = IpcStructuredClone.CloneArguments(arguments);
        queue.Enqueue(() =>
        {
            renderer.EnsureAlive();
            IpcMain.DispatchSend(renderer, channel, snapshot);
            return ValueTask.CompletedTask;
        });
    }

    internal Task<IpcValue> EnqueueInvoke(
        IpcRenderer renderer,
        string channel,
        IReadOnlyList<IpcValue> arguments)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        var snapshot = IpcStructuredClone.CloneArguments(arguments);
        var completion = new TaskCompletionSource<IpcValue>(TaskCreationOptions.RunContinuationsAsynchronously);
        queue.Enqueue(async () =>
        {
            try
            {
                renderer.EnsureAlive();
                var result = await IpcMain.DispatchInvokeAsync(renderer, channel, snapshot).ConfigureAwait(false);
                renderer.EnsureAlive();
                completion.TrySetResult(IpcStructuredClone.Clone(result));
            }
            catch (IpcRendererDestroyedException exception)
            {
                completion.TrySetException(exception);
            }
            catch (IpcDataCloneException exception)
            {
                completion.TrySetException(exception);
            }
            catch (Exception exception)
            {
                completion.TrySetException(new IpcRemoteException(exception.GetType().Name, exception.Message));
            }
        });
        return completion.Task;
    }

    internal IpcValue SendSync(
        IpcRenderer renderer,
        string channel,
        IReadOnlyList<IpcValue> arguments)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        renderer.EnsureAlive();
        var snapshot = IpcStructuredClone.CloneArguments(arguments);
        return IpcMain.DispatchSync(renderer, channel, snapshot);
    }

    internal void EnqueueMainToRenderer(
        IpcRenderer renderer,
        string channel,
        IReadOnlyList<IpcValue> arguments)
    {
        ArgumentException.ThrowIfNullOrEmpty(channel);
        var snapshot = IpcStructuredClone.CloneArguments(arguments);
        queue.Enqueue(() => renderer.DeliverAsync(channel, snapshot));
    }
}
