using System.Globalization;
using System.Numerics;

namespace J2cs.Runtime;

public enum JsBinaryBigIntErrorKind
{
    TypeError,
    RangeError,
    SyntaxError
}

/// <summary>
/// Error boundary owned by the binary/BigInt runtime. General JavaScript Error
/// identity/stack semantics are intentionally left to the dedicated Error workstream.
/// </summary>
public sealed class JsBinaryBigIntException : Exception
{
    public JsBinaryBigIntErrorKind Kind { get; }
    public string Name => Kind.ToString();

    public JsBinaryBigIntException(JsBinaryBigIntErrorKind kind, string message) : base(message)
        => Kind = kind;
}

/// <summary>
/// Exact JavaScript BigInt payload. It never passes through binary64 storage.
/// </summary>
public readonly struct JsBigInt : IEquatable<JsBigInt>
{
    private static readonly BigInteger Two64 = BigInteger.One << 64;
    private static readonly BigInteger Two63 = BigInteger.One << 63;

    public BigInteger Value { get; }

    public JsBigInt(BigInteger value) => Value = value;

    public static JsBigInt ParseLiteral(string canonicalDecimal)
    {
        if (!BigInteger.TryParse(canonicalDecimal, NumberStyles.AllowLeadingSign,
            CultureInfo.InvariantCulture, out var value))
            throw JsBinary.SyntaxError("Invalid canonical BigInt literal.");
        return new JsBigInt(value);
    }

    public static JsBigInt NumberToBigInt(double number)
    {
        if (!double.IsFinite(number) || Math.Truncate(number) != number)
            throw JsBinary.RangeError("NumberToBigInt requires a finite integral Number.");
        return new JsBigInt(new BigInteger(number));
    }

    public static bool TryStringToBigInt(string source, out JsBigInt value)
    {
        string text = JsCoercion.TrimWhitespace(source);
        if (text.Length == 0)
        {
            value = new JsBigInt(BigInteger.Zero);
            return true;
        }

        bool negative = false;
        int cursor = 0;
        if (text[0] is '+' or '-')
        {
            negative = text[0] == '-';
            cursor = 1;
            if (cursor == text.Length)
            {
                value = default;
                return false;
            }
        }

        int radix = 10;
        if (cursor == 0 && text.Length > 2 && text[0] == '0')
        {
            radix = text[1] switch { 'x' or 'X' => 16, 'o' or 'O' => 8, 'b' or 'B' => 2, _ => 10 };
            if (radix != 10) cursor = 2;
        }

        if (cursor >= text.Length)
        {
            value = default;
            return false;
        }

        BigInteger result = BigInteger.Zero;
        for (; cursor < text.Length; cursor++)
        {
            int digit = JsCoercion.DigitValue(text[cursor]);
            if (digit < 0 || digit >= radix)
            {
                value = default;
                return false;
            }
            result = result * radix + digit;
        }

        value = new JsBigInt(negative ? -result : result);
        return true;
    }

    public static JsBigInt StringToBigInt(string source)
    {
        if (!TryStringToBigInt(source, out var value))
            throw JsBinary.SyntaxError("String is not an ECMAScript StringIntegerLiteral.");
        return value;
    }

    public static JsBigInt ToBigIntPrimitive(JsBinaryValue value) => value.Kind switch
    {
        JsBinaryValueKind.BigInt => value.BigInt,
        JsBinaryValueKind.Boolean => new JsBigInt(value.Boolean ? BigInteger.One : BigInteger.Zero),
        JsBinaryValueKind.String => StringToBigInt(value.String),
        _ => throw JsBinary.TypeError("ToBigInt rejects Number, null, undefined, and unsupported object values.")
    };

    public static JsBigInt BigIntFunctionPrimitive(JsBinaryValue value)
        => value.Kind == JsBinaryValueKind.Number ? NumberToBigInt(value.Number) : ToBigIntPrimitive(value);

    public static JsBigInt ToBigUint64(JsBigInt value)
    {
        var wrapped = value.Value % Two64;
        if (wrapped.Sign < 0) wrapped += Two64;
        return new JsBigInt(wrapped);
    }

    public static JsBigInt ToBigInt64(JsBigInt value)
    {
        var wrapped = ToBigUint64(value).Value;
        if (wrapped >= Two63) wrapped -= Two64;
        return new JsBigInt(wrapped);
    }

    public static JsBigInt Add(JsBigInt left, JsBigInt right) => new(left.Value + right.Value);
    public static JsBigInt Subtract(JsBigInt left, JsBigInt right) => new(left.Value - right.Value);
    public static JsBigInt Multiply(JsBigInt left, JsBigInt right) => new(left.Value * right.Value);
    public static JsBigInt Negate(JsBigInt value) => new(-value.Value);

    public static JsBigInt Divide(JsBigInt left, JsBigInt right)
    {
        if (right.Value.IsZero) throw JsBinary.RangeError("BigInt division by zero.");
        return new JsBigInt(left.Value / right.Value);
    }

    public static JsBigInt Remainder(JsBigInt left, JsBigInt right)
    {
        if (right.Value.IsZero) throw JsBinary.RangeError("BigInt remainder by zero.");
        return new JsBigInt(left.Value % right.Value);
    }

    public static JsBigInt Exponentiate(JsBigInt @base, JsBigInt exponent)
    {
        if (exponent.Value.Sign < 0) throw JsBinary.RangeError("BigInt exponent must be non-negative.");
        BigInteger power = exponent.Value;
        BigInteger factor = @base.Value;
        BigInteger result = BigInteger.One;
        while (power > BigInteger.Zero)
        {
            if (!power.IsEven) result *= factor;
            power >>= 1;
            if (power > BigInteger.Zero) factor *= factor;
        }
        return new JsBigInt(result);
    }

    public bool Equals(JsBigInt other) => Value.Equals(other.Value);
    public override bool Equals(object? obj) => obj is JsBigInt other && Equals(other);
    public override int GetHashCode() => Value.GetHashCode();
    public override string ToString() => Value.ToString(CultureInfo.InvariantCulture);
}
