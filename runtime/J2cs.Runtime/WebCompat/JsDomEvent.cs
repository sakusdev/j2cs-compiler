namespace J2cs.Runtime.WebCompat;

public sealed class JsDomEvent
{
    public JsDomEvent(string type, bool bubbles = false, bool cancelable = false, bool composed = false)
    {
        Type = type ?? throw new ArgumentNullException(nameof(type));
        Bubbles = bubbles;
        Cancelable = cancelable;
        Composed = composed;
    }

    public string Type { get; }
    public bool Bubbles { get; }
    public bool Cancelable { get; }
    public bool Composed { get; }
    public bool IsTrusted => false;
    public bool DefaultPrevented { get; private set; }
    public JsEventTarget? Target { get; private set; }
    public JsEventTarget? CurrentTarget { get; private set; }
    internal bool Dispatching { get; private set; }
    internal bool PropagationStopped { get; private set; }
    internal bool ImmediatePropagationStopped { get; private set; }
    internal bool CurrentListenerPassive { get; set; }

    public void PreventDefault()
    {
        if (Cancelable && !CurrentListenerPassive) DefaultPrevented = true;
    }

    public void StopPropagation() => PropagationStopped = true;

    public void StopImmediatePropagation()
    {
        ImmediatePropagationStopped = true;
        PropagationStopped = true;
    }

    internal void BeginDispatch(JsEventTarget target)
    {
        if (Dispatching) throw new InvalidOperationException("An Event cannot be dispatched while it is already being dispatched.");
        Dispatching = true;
        Target = target;
        CurrentTarget = target;
        PropagationStopped = false;
        ImmediatePropagationStopped = false;
        CurrentListenerPassive = false;
    }

    internal void EndDispatch()
    {
        CurrentTarget = null;
        CurrentListenerPassive = false;
        Dispatching = false;
    }
}
