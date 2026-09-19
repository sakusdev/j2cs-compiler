namespace J2cs.Runtime;

/// <summary>Node console.log for admitted primitive arguments without format substitution.</summary>
public static class JsConsole
{
    static JsConsole() => Console.OutputEncoding = new System.Text.UTF8Encoding(false);

    public static JsValue Log(params JsValue[] values)
    {
        Console.Write(string.Join(" ", values.Select(value => value.Kind == JsKind.Number
            ? JsNumber.Format(value.Number, inspect: true) : JsCoercion.ToString(value))));
        Console.Write('\n'); // Node uses LF even on Windows.
        return JsUndefined.Value;
    }
}
