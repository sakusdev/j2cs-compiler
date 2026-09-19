namespace J2cs.Runtime;

public static class JsGlobals
{
    public static bool IsFinitePrimitive(JsValue value) =>
        double.IsFinite(JsCoercion.ToNumberPrimitive(value));

    public static bool IsNaNPrimitive(JsValue value) =>
        double.IsNaN(JsCoercion.ToNumberPrimitive(value));

    public static double ParseFloatPrimitive(JsValue value) =>
        JsNumber.ParseFloatPrimitive(JsCoercion.ToStringPrimitive(value));

    public static double ParseIntPrimitive(JsValue value, JsValue radix) =>
        JsNumber.ParseIntPrimitive(JsCoercion.ToStringPrimitive(value), JsCoercion.ToInt32Primitive(radix));
}
