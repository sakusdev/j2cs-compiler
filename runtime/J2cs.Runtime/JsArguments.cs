namespace J2cs.Runtime;

public sealed class JsArguments
{
    private readonly JsValue[] values;
    private JsArguments(JsValue[] values) => this.values = values;
}
