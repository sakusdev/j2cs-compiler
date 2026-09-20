namespace J2cs.Runtime;

/// <summary>Semantic JavaScript Error value; CLR exceptions below are transport only.</summary>
public static class JsError
{
    private sealed class ErrorObject(string name, bool hasMessage, string message) : JsObject
    {
        internal string ErrorName { get; } = name;
        internal bool HasMessage { get; } = hasMessage;
        internal string ErrorMessage { get; } = message;

        protected override bool TryGetOwn(string key, out JsValue value)
        {
            if (key == "message" && HasMessage)
            {
                value = JsValue.FromString(ErrorMessage);
                return true;
            }
            return base.TryGetOwn(key, out value);
        }

        public override bool HasOwnProperty(string key)
            => (key == "message" && HasMessage) || base.HasOwnProperty(key);
    }

    public static JsValue Create() => CreateNamed("Error", JsUndefined.Value);

    public static JsValue Create(JsValue message) => CreateNamed("Error", message);

    internal static JsValue CreateNamed(string name, JsValue message)
    {
        if (message.Kind == JsKind.Object)
            throw new NotSupportedException("Error message object coercion requires the unmerged ToPrimitive object contract.");
        var hasMessage = message.Kind != JsKind.Undefined;
        var text = hasMessage ? JsCoercion.ToStringPrimitive(message) : "";
        return JsValue.FromReference(new ErrorObject(name, hasMessage, text));
    }

    public static bool IsError(JsValue value) => value.Kind == JsKind.Object && value.Reference is ErrorObject;

    public static JsValue Name(JsValue value) => JsValue.FromString(RequireError(value).ErrorName);

    public static JsValue Message(JsValue value)
    {
        var error = RequireError(value);
        return error.HasMessage ? JsValue.FromString(error.ErrorMessage) : JsUndefined.Value;
    }

    public static JsValue ToString(JsValue value)
    {
        var error = RequireError(value);
        var name = error.ErrorName;
        var message = error.HasMessage ? error.ErrorMessage : "";
        return JsValue.FromString(name.Length == 0 ? message : message.Length == 0 ? name : name + ": " + message);
    }

    private static ErrorObject RequireError(JsValue value)
        => value.Kind == JsKind.Object && value.Reference is ErrorObject error
            ? error : throw new InvalidOperationException("JavaScript Error proof violated.");
}

public sealed class JsSyntaxErrorException : Exception
{
    public JsValue Value { get; }
    internal JsSyntaxErrorException(string message) : base(message)
        => Value = JsError.CreateNamed("SyntaxError", JsValue.FromString(message));
}

public sealed class JsTypeErrorException : Exception
{
    public JsValue Value { get; }
    internal JsTypeErrorException(string message) : base(message)
        => Value = JsError.CreateNamed("TypeError", JsValue.FromString(message));
}
