namespace J2cs.Runtime;

/// <summary>
/// Runtime contract for ArrowFunction lexical meta-bindings. This file deliberately
/// does not depend on the pending general JsFunction runtime so it remains independently mergeable.
/// </summary>
public static class JsArrowFunction
{
    public static JsValue CaptureLexicalThis(JsValue enclosingThis) => enclosingThis;

    public static JsValue CaptureLexicalArguments(JsValue enclosingArguments) => enclosingArguments;

    public static JsValue CaptureLexicalNewTarget(JsValue enclosingNewTarget) => enclosingNewTarget;

    public static void ThrowNotConstructable() => throw new JsArrowNotConstructableException();
}

/// <summary>
/// Dedicated fail-closed runtime signal until the general JavaScript exception model is merged.
/// It must not be mistaken for a complete ECMAScript TypeError representation.
/// </summary>
public sealed class JsArrowNotConstructableException : InvalidOperationException
{
    public JsArrowNotConstructableException()
        : base("TypeError: Arrow function is not a constructor")
    {
    }
}
