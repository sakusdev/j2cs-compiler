using System.Globalization;

namespace J2cs.Runtime;

public delegate JsValue JsGetter(JsValue receiver);
public delegate void JsSetter(JsValue receiver, JsValue value);

/// <summary>
/// Canonical identity-bearing ordinary-object runtime for the compiler-owned object profile.
/// String-keyed own properties carry JavaScript descriptor metadata and each object has a
/// mutable per-instance prototype slot. Symbol keys and Proxy exotic methods remain outside
/// this lane and are rejected by compiler proof gates.
/// </summary>
public class JsObject
{
    protected sealed class PropertyDescriptor
    {
        public bool IsAccessor { get; init; }
        public JsValue Value { get; set; }
        public bool Writable { get; set; }
        public bool Enumerable { get; set; }
        public bool Configurable { get; set; }
        public JsGetter? Getter { get; init; }
        public JsSetter? Setter { get; init; }

        public static PropertyDescriptor Data(JsValue value, bool writable, bool enumerable, bool configurable)
            => new() { Value = value, Writable = writable, Enumerable = enumerable, Configurable = configurable };

        public static PropertyDescriptor Accessor(JsGetter? getter, JsSetter? setter, bool enumerable, bool configurable)
            => new() { IsAccessor = true, Getter = getter, Setter = setter, Enumerable = enumerable, Configurable = configurable };

        public PropertyDescriptor Copy() => IsAccessor
            ? Accessor(Getter, Setter, Enumerable, Configurable)
            : Data(Value, Writable, Enumerable, Configurable);
    }

    private readonly Dictionary<string, PropertyDescriptor> ownProperties = new(StringComparer.Ordinal);
    private JsObject? prototype;

    protected JsObject(JsObject? prototype = null) => this.prototype = prototype;

    protected virtual bool TryGetOwnDescriptor(string key, out PropertyDescriptor descriptor)
    {
        if (ownProperties.TryGetValue(key, out var found))
        {
            descriptor = found;
            return true;
        }
        descriptor = null!;
        return false;
    }

    protected virtual void StoreOwnDescriptor(string key, PropertyDescriptor descriptor)
        => ownProperties[key] = descriptor;

    public virtual bool HasOwnProperty(string key) => ownProperties.ContainsKey(key);

    internal static JsObject RequireReference(JsValue value)
        => value.Kind == JsKind.Object ? value.Reference : throw new InvalidOperationException("Compiler Object/Array proof violated");

    private bool TryGetPropertyDescriptor(string key, out PropertyDescriptor descriptor)
    {
        if (TryGetOwnDescriptor(key, out descriptor)) return true;
        if (prototype is not null) return prototype.TryGetPropertyDescriptor(key, out descriptor);
        descriptor = null!;
        return false;
    }

    private JsValue OrdinaryGet(string key, JsValue receiver)
    {
        if (TryGetOwnDescriptor(key, out var descriptor))
        {
            if (!descriptor.IsAccessor) return descriptor.Value;
            return descriptor.Getter is null ? JsUndefined.Value : descriptor.Getter(receiver);
        }
        return prototype is null ? JsUndefined.Value : prototype.OrdinaryGet(key, receiver);
    }

    private bool WriteReceiverData(string key, JsValue value)
    {
        if (TryGetOwnDescriptor(key, out var descriptor))
        {
            if (descriptor.IsAccessor)
            {
                if (descriptor.Setter is null) return false;
                descriptor.Setter(JsValue.FromReference(this), value);
                return true;
            }
            if (!descriptor.Writable) return false;
            var next = descriptor.Copy();
            next.Value = value;
            StoreOwnDescriptor(key, next);
            return true;
        }
        StoreOwnDescriptor(key, PropertyDescriptor.Data(value, writable: true, enumerable: true, configurable: true));
        return true;
    }

    private bool OrdinarySet(string key, JsValue value, JsObject receiverObject, JsValue receiver)
    {
        if (TryGetOwnDescriptor(key, out var descriptor))
        {
            if (descriptor.IsAccessor)
            {
                if (descriptor.Setter is null) return false;
                descriptor.Setter(receiver, value);
                return true;
            }
            if (!descriptor.Writable) return false;
            return receiverObject.WriteReceiverData(key, value);
        }
        return prototype is not null
            ? prototype.OrdinarySet(key, value, receiverObject, receiver)
            : receiverObject.WriteReceiverData(key, value);
    }

    private static bool SameValue(JsValue left, JsValue right)
    {
        if (left.Kind != right.Kind) return false;
        return left.Kind switch
        {
            JsKind.Undefined or JsKind.Null => true,
            JsKind.Boolean => left.Boolean == right.Boolean,
            JsKind.String => string.Equals(left.String, right.String, StringComparison.Ordinal),
            JsKind.Object => ReferenceEquals(left.Reference, right.Reference),
            JsKind.Number => double.IsNaN(left.Number) && double.IsNaN(right.Number)
                || left.Number == right.Number && (left.Number != 0
                    || BitConverter.DoubleToInt64Bits(left.Number) == BitConverter.DoubleToInt64Bits(right.Number)),
            _ => throw new InvalidOperationException("Unknown value tag")
        };
    }

    private bool ApplyGenericDescriptor(string key, bool? enumerable, bool? configurable)
    {
        if (!TryGetOwnDescriptor(key, out var current))
        {
            StoreOwnDescriptor(key, PropertyDescriptor.Data(
                JsUndefined.Value, writable: false, enumerable ?? false, configurable ?? false));
            return true;
        }
        if (!current.Configurable)
        {
            if (configurable == true) return false;
            if (enumerable.HasValue && enumerable.Value != current.Enumerable) return false;
        }
        var next = current.Copy();
        if (enumerable.HasValue) next.Enumerable = enumerable.Value;
        if (configurable.HasValue) next.Configurable = configurable.Value;
        StoreOwnDescriptor(key, next);
        return true;
    }

    private bool ApplyDataDescriptor(
        string key,
        bool hasValue,
        JsValue value,
        bool? writable,
        bool? enumerable,
        bool? configurable)
    {
        if (!TryGetOwnDescriptor(key, out var current))
        {
            StoreOwnDescriptor(key, PropertyDescriptor.Data(
                hasValue ? value : JsUndefined.Value,
                writable ?? false,
                enumerable ?? false,
                configurable ?? false));
            return true;
        }

        if (current.IsAccessor)
        {
            if (!current.Configurable) return false;
            current = PropertyDescriptor.Data(JsUndefined.Value, writable: false, current.Enumerable, current.Configurable);
        }

        if (!current.Configurable)
        {
            if (configurable == true) return false;
            if (enumerable.HasValue && enumerable.Value != current.Enumerable) return false;
            if (!current.Writable)
            {
                if (writable == true) return false;
                if (hasValue && !SameValue(value, current.Value)) return false;
            }
        }

        var next = current.Copy();
        if (hasValue) next.Value = value;
        if (writable.HasValue) next.Writable = writable.Value;
        if (enumerable.HasValue) next.Enumerable = enumerable.Value;
        if (configurable.HasValue) next.Configurable = configurable.Value;
        StoreOwnDescriptor(key, next);
        return true;
    }

    private bool ApplyAccessorDescriptor(
        string key,
        JsGetter? getter,
        JsSetter? setter,
        bool? enumerable,
        bool? configurable)
    {
        if (!TryGetOwnDescriptor(key, out var current))
        {
            StoreOwnDescriptor(key, PropertyDescriptor.Accessor(
                getter, setter, enumerable ?? false, configurable ?? false));
            return true;
        }

        if (!current.IsAccessor)
        {
            if (!current.Configurable) return false;
            current = PropertyDescriptor.Accessor(null, null, current.Enumerable, current.Configurable);
        }

        if (!current.Configurable)
        {
            if (configurable == true) return false;
            if (enumerable.HasValue && enumerable.Value != current.Enumerable) return false;
            if (!ReferenceEquals(getter, current.Getter) || !ReferenceEquals(setter, current.Setter)) return false;
        }

        var next = PropertyDescriptor.Accessor(
            getter, setter,
            enumerable ?? current.Enumerable,
            configurable ?? current.Configurable);
        StoreOwnDescriptor(key, next);
        return true;
    }

    private static bool? DescriptorBoolean(JsObject descriptor, string key)
        => descriptor.TryGetPropertyDescriptor(key, out _)
            ? JsValue.IsTruthy(descriptor.OrdinaryGet(key, JsValue.FromReference(descriptor)))
            : null;

    public static JsValue Create() => JsValue.FromReference(new JsObject());

    public static JsValue CreateWithPrototype(JsValue prototype)
    {
        if (prototype.Kind == JsKind.Null) return JsValue.FromReference(new JsObject(null));
        return JsValue.FromReference(new JsObject(RequireReference(prototype)));
    }

    public static JsValue DefineDataProperty(JsValue receiver, string key, JsValue value)
    {
        RequireReference(receiver).StoreOwnDescriptor(
            key, PropertyDescriptor.Data(value, writable: true, enumerable: true, configurable: true));
        return receiver;
    }

    public static JsValue DefineAccessorProperty(
        JsValue receiver,
        string key,
        JsGetter? getter,
        JsSetter? setter,
        bool enumerable,
        bool configurable)
    {
        var target = RequireReference(receiver);
        if (!target.ApplyAccessorDescriptor(key, getter, setter, enumerable, configurable))
            throw new InvalidOperationException("Compiler accessor descriptor compatibility proof violated");
        return receiver;
    }

    public static JsValue DefineProperty(JsValue receiver, string key, JsValue descriptorValue)
    {
        var target = RequireReference(receiver);
        var descriptor = RequireReference(descriptorValue);

        var hasValue = descriptor.TryGetPropertyDescriptor("value", out _);
        var hasWritable = descriptor.TryGetPropertyDescriptor("writable", out _);
        var hasGet = descriptor.TryGetPropertyDescriptor("get", out _);
        var hasSet = descriptor.TryGetPropertyDescriptor("set", out _);
        var enumerable = DescriptorBoolean(descriptor, "enumerable");
        var configurable = DescriptorBoolean(descriptor, "configurable");

        if ((hasGet || hasSet) && (hasValue || hasWritable))
            throw new InvalidOperationException("Invalid mixed JavaScript data/accessor descriptor");

        bool accepted;
        if (hasGet || hasSet)
        {
            var getterValue = hasGet ? descriptor.OrdinaryGet("get", descriptorValue) : JsUndefined.Value;
            var setterValue = hasSet ? descriptor.OrdinaryGet("set", descriptorValue) : JsUndefined.Value;
            if (getterValue.Kind != JsKind.Undefined || setterValue.Kind != JsKind.Undefined)
                throw new InvalidOperationException("Callable accessor values require the function runtime integration lane");
            accepted = target.ApplyAccessorDescriptor(key, null, null, enumerable, configurable);
        }
        else if (hasValue || hasWritable)
        {
            var value = hasValue ? descriptor.OrdinaryGet("value", descriptorValue) : JsUndefined.Value;
            bool? writable = hasWritable ? JsValue.IsTruthy(descriptor.OrdinaryGet("writable", descriptorValue)) : null;
            accepted = target.ApplyDataDescriptor(key, hasValue, value, writable, enumerable, configurable);
        }
        else
        {
            accepted = target.ApplyGenericDescriptor(key, enumerable, configurable);
        }

        if (!accepted) throw new InvalidOperationException("Compiler property descriptor compatibility proof violated");
        return receiver;
    }

    public static JsValue GetOwnPropertyDescriptor(JsValue receiver, string key)
    {
        var target = RequireReference(receiver);
        if (!target.TryGetOwnDescriptor(key, out var descriptor)) return JsUndefined.Value;

        var result = Create();
        if (descriptor.IsAccessor)
        {
            if (descriptor.Getter is not null || descriptor.Setter is not null)
                throw new InvalidOperationException("Callable accessor descriptor exposure requires function values");
            DefineDataProperty(result, "get", JsUndefined.Value);
            DefineDataProperty(result, "set", JsUndefined.Value);
        }
        else
        {
            DefineDataProperty(result, "value", descriptor.Value);
            DefineDataProperty(result, "writable", JsValue.FromBoolean(descriptor.Writable));
        }
        DefineDataProperty(result, "enumerable", JsValue.FromBoolean(descriptor.Enumerable));
        DefineDataProperty(result, "configurable", JsValue.FromBoolean(descriptor.Configurable));
        return result;
    }

    public static JsValue GetProperty(JsValue receiver, string key)
    {
        var target = RequireReference(receiver);
        return target.OrdinaryGet(key, receiver);
    }

    public static JsValue SetProperty(JsValue receiver, string key, JsValue value)
    {
        var target = RequireReference(receiver);
        _ = target.OrdinarySet(key, value, target, receiver);
        return value;
    }

    public static bool HasOwn(JsValue receiver, string key) => RequireReference(receiver).HasOwnProperty(key);

    public static JsValue GetPrototypeOf(JsValue receiver)
    {
        var prototype = RequireReference(receiver).prototype;
        return prototype is null ? JsNull.Value : JsValue.FromReference(prototype);
    }

    public static JsValue SetPrototypeOf(JsValue receiver, JsValue prototype)
    {
        var target = RequireReference(receiver);
        JsObject? next = prototype.Kind == JsKind.Null ? null : RequireReference(prototype);
        for (var current = next; current is not null; current = current.prototype)
            if (ReferenceEquals(current, target))
                throw new InvalidOperationException("Compiler prototype-cycle proof violated");
        target.prototype = next;
        return receiver;
    }
}

/// <summary>
/// Canonical sparse Array representation. Length is independent from materialized
/// indexed elements, so a hole and an own element whose value is undefined remain distinct.
/// </summary>
public sealed class JsArray : JsObject
{
    private uint length;
    private JsArray(uint length) => this.length = length;

    protected override bool TryGetOwnDescriptor(string key, out PropertyDescriptor descriptor)
    {
        if (key == "length")
        {
            descriptor = PropertyDescriptor.Data(
                JsValue.FromNumber(length), writable: true, enumerable: false, configurable: false);
            return true;
        }
        return base.TryGetOwnDescriptor(key, out descriptor);
    }

    protected override void StoreOwnDescriptor(string key, PropertyDescriptor descriptor)
    {
        if (key == "length")
            throw new InvalidOperationException("ArraySetLength is not implemented by this compiler profile");
        base.StoreOwnDescriptor(key, descriptor);
        if (TryArrayIndex(key, out var index) && index >= length) length = index + 1;
    }

    public override bool HasOwnProperty(string key) => key == "length" || base.HasOwnProperty(key);

    private static JsArray RequireArray(JsValue value)
        => RequireReference(value) as JsArray ?? throw new InvalidOperationException("Compiler builtin Array proof violated");

    private static bool TryArrayIndex(string key, out uint index)
    {
        index = 0;
        if (!uint.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed == uint.MaxValue) return false;
        if (parsed.ToString(CultureInfo.InvariantCulture) != key) return false;
        index = parsed; return true;
    }

    public static JsValue Create(double requestedLength)
    {
        if (requestedLength < 0 || requestedLength > uint.MaxValue || Math.Truncate(requestedLength) != requestedLength)
            throw new InvalidOperationException("Compiler Array literal length proof violated");
        return JsValue.FromReference(new JsArray((uint)requestedLength));
    }

    public static JsValue DefineElement(JsValue receiver, double requestedIndex, JsValue value)
    {
        var array = RequireArray(receiver);
        if (requestedIndex < 0 || requestedIndex >= array.length || Math.Truncate(requestedIndex) != requestedIndex)
            throw new InvalidOperationException("Compiler Array literal index proof violated");
        array.StoreOwnDescriptor(((uint)requestedIndex).ToString(CultureInfo.InvariantCulture),
            PropertyDescriptor.Data(value, writable: true, enumerable: true, configurable: true));
        return receiver;
    }

    public static double Length(JsValue receiver) => RequireArray(receiver).length;

    public static JsValue Push(JsValue receiver, params JsValue[] items)
    {
        var array = RequireArray(receiver);
        foreach (var item in items)
        {
            if (array.length == uint.MaxValue)
            {
                array.StoreOwnDescriptor(uint.MaxValue.ToString(CultureInfo.InvariantCulture),
                    PropertyDescriptor.Data(item, writable: true, enumerable: true, configurable: true));
                throw new InvalidOperationException("JavaScript Array length overflow");
            }
            array.StoreOwnDescriptor(array.length.ToString(CultureInfo.InvariantCulture),
                PropertyDescriptor.Data(item, writable: true, enumerable: true, configurable: true));
        }
        return JsValue.FromNumber(array.length);
    }
}
