namespace J2cs.Runtime;

/// <summary>
/// Runtime boundary for statically proven ordinary-function construction. Function identity
/// is represented explicitly rather than by a CLR delegate, and each identity owns the
/// default JavaScript prototype object used by fresh constructor receivers.
/// </summary>
public static class JsConstructor
{
    private sealed class ConstructorIdentity : JsObject
    {
        internal JsValue Prototype { get; } = JsObject.Create();
    }

    private sealed class ConstructedObject : JsObject
    {
        internal JsValue Prototype { get; }
        internal ConstructedObject(JsValue prototype) => Prototype = prototype;
    }

    private static readonly Dictionary<int, ConstructorIdentity> identities = new();
    private static readonly object gate = new();

    private static int RequireTemplateId(double templateId)
    {
        if (!double.IsFinite(templateId) || templateId < 0 || templateId > int.MaxValue || Math.Truncate(templateId) != templateId)
            throw new InvalidOperationException("Compiler constructor-template proof violated");
        return (int)templateId;
    }

    private static ConstructorIdentity Resolve(double templateId)
    {
        var id = RequireTemplateId(templateId);
        lock (gate)
        {
            if (identities.TryGetValue(id, out var existing)) return existing;
            var identity = new ConstructorIdentity();
            var identityValue = JsValue.FromReference(identity);
            JsObject.DefineDataProperty(identityValue, "prototype", identity.Prototype);
            JsObject.DefineDataProperty(identity.Prototype, "constructor", identityValue);
            identities.Add(id, identity);
            return identity;
        }
    }

    /// <summary>Stable identity used for the effective new.target of the direct-known lane.</summary>
    public static JsValue Identity(double templateId) => JsValue.FromReference(Resolve(templateId));

    /// <summary>Create a fresh receiver linked to the constructor's default prototype boundary.</summary>
    public static JsValue CreateReceiver(double templateId)
        => JsValue.FromReference(new ConstructedObject(Resolve(templateId).Prototype));

    /// <summary>Ordinary constructor completion: an Object result wins; every primitive result is ignored.</summary>
    public static JsValue SelectResult(JsValue receiver, JsValue result)
    {
        _ = JsObject.RequireReference(receiver);
        return result.Kind == JsKind.Object ? result : receiver;
    }
}
