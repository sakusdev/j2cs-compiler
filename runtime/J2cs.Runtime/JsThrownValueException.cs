namespace J2cs.Runtime;

/// <summary>
/// Internal/runtime carrier for JavaScript's ability to throw any JsValue. Compiler
/// lowering may use this only at explicit JS throw/reaction boundaries.
/// </summary>
public sealed class JsThrownValueException : Exception
{
    public JsValue Value { get; }

    public JsThrownValueException(JsValue value)
        : base("JavaScript value was thrown.")
        => Value = value;
}
