namespace J2cs.Runtime;

public enum JsKind { Undefined, Null, Number, String, Boolean, Object }

/// <summary>A tagged JavaScript value. Number payloads are binary64; objects carry canonical identity-bearing references.</summary>
public readonly struct JsValue
{
    public JsKind Kind { get; }
    private readonly double number;
    private readonly string? text;
    private readonly bool boolean;
    private readonly JsObject? reference;
    private JsValue(JsKind kind, double number = 0, string? text = null, bool boolean = false, JsObject? reference = null)
        => (Kind, this.number, this.text, this.boolean, this.reference) = (kind, number, text, boolean, reference);

    public static JsValue FromNumber(double value) => new(JsKind.Number, number: value);
    public static JsValue FromString(string value) => new(JsKind.String, text: value ?? throw new ArgumentNullException(nameof(value)));
    public static JsValue FromBoolean(bool value) => new(JsKind.Boolean, boolean: value);
    internal static JsValue FromReference(JsObject value) => new(JsKind.Object, reference: value ?? throw new ArgumentNullException(nameof(value)));
    public static JsValue Null => new(JsKind.Null);
    public static JsValue Undefined => default;
    public double Number => Kind == JsKind.Number ? number : throw new InvalidOperationException("Compiler Number proof violated");
    public string String => Kind == JsKind.String ? text! : throw new InvalidOperationException("Compiler String proof violated");
    public bool Boolean => Kind == JsKind.Boolean ? boolean : throw new InvalidOperationException("Compiler Boolean proof violated");
    internal JsObject Reference => Kind == JsKind.Object ? reference! : throw new InvalidOperationException("Compiler Object proof violated");

    public static bool IsTruthy(JsValue value) => value.Kind switch
    {
        JsKind.Undefined or JsKind.Null => false,
        JsKind.Boolean => value.boolean,
        JsKind.Number => value.number != 0 && !double.IsNaN(value.number),
        JsKind.String => value.text!.Length != 0,
        JsKind.Object => true,
        _ => throw new InvalidOperationException("Unknown value tag")
    };
}

public static class JsNull { public static JsValue Value => JsValue.Null; }
public static class JsUndefined { public static JsValue Value => JsValue.Undefined; }
