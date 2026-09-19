namespace J2cs.Runtime;

/// <summary>
/// CLR wrapper for an ECMAScript Throw completion. The payload is the exact tagged
/// JavaScript value, including object identity; no CLR exception coercion is performed.
/// </summary>
public sealed class JsException : JsCompletionSignal
{
    private JsException(JsValue value)
        : base(JsCompletionKind.Throw, value)
    {
    }

    public static JsException Wrap(JsValue value) => new(value);

    public static JsValue Unwrap(JsException exception)
        => exception?.Value ?? throw new ArgumentNullException(nameof(exception));
}
