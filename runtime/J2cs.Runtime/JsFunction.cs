namespace J2cs.Runtime;

public delegate JsValue JsFunctionBody(JsEnvironment environment);

/// <summary>
/// Identity-bearing JavaScript callable. The object owns only its lexical environment and
/// compiler template identity; a statically proven call site supplies the reviewed body
/// specialization, keeping ordinary JS identity separate from C# method identity.
/// </summary>
public sealed class JsFunction : JsObject
{
    internal int TemplateId { get; }
    internal JsEnvironment Closure { get; }

    private JsFunction(int templateId, JsEnvironment closure)
        => (TemplateId, Closure) = (templateId, closure);

    public static JsValue Create(int templateId, JsEnvironment closure)
        => JsValue.FromReference(new JsFunction(templateId, closure ?? throw new ArgumentNullException(nameof(closure))));

    public static JsValue CallKnown(
        JsValue callee,
        int expectedTemplateId,
        JsFunctionBody body,
        int[] parameterIds,
        params JsValue[] arguments)
    {
        var function = JsObject.RequireReference(callee) as JsFunction
            ?? throw new InvalidOperationException("Compiler callable proof violated");
        if (function.TemplateId != expectedTemplateId)
            throw new InvalidOperationException("Compiler function-template proof violated");

        var activation = JsEnvironment.CreateChild(function.Closure);
        for (var i = 0; i < parameterIds.Length; i++)
            activation.Declare(parameterIds[i], i < arguments.Length ? arguments[i] : JsUndefined.Value);
        return body(activation);
    }
}
