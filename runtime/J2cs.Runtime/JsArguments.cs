namespace J2cs.Runtime;

public sealed class JsArguments
{
    private readonly JsValue[] values;
    private JsArguments(JsValue[] values) => this.values = values;

    public static JsArguments Empty() => new(Array.Empty<JsValue>());
    public static JsArguments Create(params JsValue[] values) => new((JsValue[])values.Clone());

    public static JsArguments Create(JsArguments prefix, JsValue value)
    {
        var next = new JsValue[prefix.values.Length + 1];
        Array.Copy(prefix.values, next, prefix.values.Length);
        next[^1] = value;
        return new JsArguments(next);
    }

    public static JsValue Get(JsArguments arguments, double requestedIndex)
    {
        if (requestedIndex < 0 || requestedIndex > int.MaxValue || Math.Truncate(requestedIndex) != requestedIndex)
            return JsUndefined.Value;
        var index = (int)requestedIndex;
        return index < arguments.values.Length ? arguments.values[index] : JsUndefined.Value;
    }

    public static double Length(JsArguments arguments) => arguments.values.Length;

    public static JsValue Rest(JsArguments arguments, double start)
        => BuildRest(arguments, (int)start);

    private static JsValue BuildRest(JsArguments arguments, int start)
    {
        start = Math.Clamp(start, 0, arguments.values.Length);
        var result = JsArray.Create(arguments.values.Length - start);
        for (var i = start; i < arguments.values.Length; i++)
            result = JsArray.DefineElement(result, i - start, arguments.values[i]);
        return result;
    }
}
