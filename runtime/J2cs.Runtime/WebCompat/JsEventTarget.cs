namespace J2cs.Runtime.WebCompat;

public sealed class JsEventListenerHandle
{
    private readonly Action<JsDomEvent> callback;

    public JsEventListenerHandle(Action<JsDomEvent> callback)
        => this.callback = callback ?? throw new ArgumentNullException(nameof(callback));

    internal void Invoke(JsDomEvent @event) => callback(@event);
}

public readonly record struct JsEventListenerOptions(
    bool Capture = false,
    bool Passive = false,
    bool Once = false);

public sealed class JsEventTarget
{
    private sealed class Registration
    {
        public required string Type { get; init; }
        public required JsEventListenerHandle Listener { get; init; }
        public required JsEventListenerOptions Options { get; init; }
        public bool Removed { get; set; }
    }

    private readonly List<Registration> listeners = new();
    private readonly List<Exception> reportedExceptions = new();

    public IReadOnlyList<Exception> ReportedExceptions => reportedExceptions;

    public void AddEventListener(string type, JsEventListenerHandle? listener, JsEventListenerOptions options = default)
    {
        ArgumentNullException.ThrowIfNull(type);
        if (listener is null)
            return;

        if (listeners.Any(item =>
            !item.Removed &&
            StringComparer.Ordinal.Equals(item.Type, type) &&
            ReferenceEquals(item.Listener, listener) &&
            item.Options.Capture == options.Capture))
            return;

        listeners.Add(new Registration { Type = type, Listener = listener, Options = options });
    }

    public void RemoveEventListener(string type, JsEventListenerHandle? listener, JsEventListenerOptions options = default)
    {
        ArgumentNullException.ThrowIfNull(type);
        if (listener is null)
            return;

        var item = listeners.FirstOrDefault(candidate =>
            !candidate.Removed &&
            StringComparer.Ordinal.Equals(candidate.Type, type) &&
            ReferenceEquals(candidate.Listener, listener) &&
            candidate.Options.Capture == options.Capture);

        if (item is null)
            return;

        item.Removed = true;
        listeners.Remove(item);
    }

    public bool DispatchEvent(JsDomEvent @event)
    {
        ArgumentNullException.ThrowIfNull(@event);
        @event.BeginDispatch(this);
        try
        {
            var snapshot = listeners
                .Where(item => !item.Removed && StringComparer.Ordinal.Equals(item.Type, @event.Type))
                .ToArray();

            foreach (var item in snapshot)
            {
                if (item.Removed)
                    continue;

                if (item.Options.Once)
                {
                    item.Removed = true;
                    listeners.Remove(item);
                }

                @event.CurrentListenerPassive = item.Options.Passive;
                try
                {
                    item.Listener.Invoke(@event);
                }
                catch (Exception exception)
                {
                    reportedExceptions.Add(exception);
                }
                finally
                {
                    @event.CurrentListenerPassive = false;
                }

                if (@event.ImmediatePropagationStopped)
                    break;
            }

            return !@event.DefaultPrevented;
        }
        finally
        {
            @event.EndDispatch();
        }
    }
}
