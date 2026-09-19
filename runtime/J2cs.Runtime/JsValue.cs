namespace J2cs.Runtime;

public enum JsKind { Undefined, Null, Number, String, Boolean }

/// <summary>A tagged primitive value, never CLR object/dynamic. Number payloads are binary64.</summary>
public readonly struct JsValue
{
    public JsKind Kind { get; }
    private readonly double number;
    private readonly string? text;
    private readonly bool boolean;
    private JsValue(JsKind kind, double number = 0, string? text = null, bool boolean = false)
        => (Kind, this.number, this.text, this.boolean) = (kind, number, text, boolean);

    public static JsValue FromNumber(double value) => new(JsKind.Number, number: value);
    public static JsValue FromString(string value) => new(JsKind.String, text: value ?? throw new ArgumentNullException(nameof(value)));
    public static JsValue FromBoolean(bool value) => new(JsKind.Boolean, boolean: value);
    public static JsValue Null => new(JsKind.Null);
    public static JsValue Undefined => default;
    public double Number => Kind == JsKind.Number ? number : throw new InvalidOperationException("Compiler Number proof violated");
    public string String => Kind == JsKind.String ? text! : throw new InvalidOperationException("Compiler String proof violated");
    public bool Boolean => Kind == JsKind.Boolean ? boolean : throw new InvalidOperationException("Compiler Boolean proof violated");

    public static bool IsTruthy(JsValue value) => value.Kind switch
    {
        JsKind.Undefined or JsKind.Null => false,
        JsKind.Boolean => value.boolean,
        JsKind.Number => value.number != 0 && !double.IsNaN(value.number),
        JsKind.String => value.text!.Length != 0,
        _ => throw new InvalidOperationException("Unknown value tag")
    };
}

// Canonical rule-DB sentinel names. Neither is represented by CLR null.
public static class JsNull { public static JsValue Value => JsValue.Null; }
public static class JsUndefined { public static JsValue Value => JsValue.Undefined; }
