namespace J2cs.Runtime;

public enum JsCompletionKind
{
    Throw,
    Return,
    Break,
    Continue
}

/// <summary>
/// Internal control-transfer carrier used when JavaScript abrupt completion must cross a CLR
/// finally clause. It is never exposed as a JavaScript value.
/// </summary>
public class JsCompletionSignal : Exception
{
    public JsCompletionKind Kind { get; }
    public JsValue Value { get; }
    public string? Target { get; }

    protected internal JsCompletionSignal(JsCompletionKind kind, JsValue value, string? target = null)
        : base("JavaScript abrupt completion")
        => (Kind, Value, Target) = (kind, value, target);
}

public static class JsCompletion
{
    public static JsCompletionSignal Return(JsValue value)
        => new(JsCompletionKind.Return, value);

    public static JsCompletionSignal Break()
        => new(JsCompletionKind.Break, JsValue.Undefined);

    public static JsCompletionSignal Continue()
        => new(JsCompletionKind.Continue, JsValue.Undefined);
}
