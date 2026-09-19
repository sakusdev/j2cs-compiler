using System.Buffers.Binary;
using System.Numerics;

namespace J2cs.Runtime;

public enum JsBinaryValueKind { Undefined, Null, Boolean, Number, String, BigInt }

/// <summary>
/// Primitive value boundary used by binary helpers while BigInt syntax is still
/// intentionally disconnected from the shared compiler value lattice.
/// </summary>
public readonly struct JsBinaryValue
{
    private readonly double number;
    private readonly bool boolean;
    private readonly string? text;
    private readonly JsBigInt bigint;

    public JsBinaryValueKind Kind { get; }

    private JsBinaryValue(JsBinaryValueKind kind, double number = 0, bool boolean = false,
        string? text = null, JsBigInt bigint = default)
        => (Kind, this.number, this.boolean, this.text, this.bigint) = (kind, number, boolean, text, bigint);

    public static JsBinaryValue Undefined => default;
    public static JsBinaryValue Null => new(JsBinaryValueKind.Null);
    public static JsBinaryValue FromBoolean(bool value) => new(JsBinaryValueKind.Boolean, boolean: value);
    public static JsBinaryValue FromNumber(double value) => new(JsBinaryValueKind.Number, number: value);
    public static JsBinaryValue FromString(string value) => new(JsBinaryValueKind.String, text: value ?? throw new ArgumentNullException(nameof(value)));
    public static JsBinaryValue FromBigInt(JsBigInt value) => new(JsBinaryValueKind.BigInt, bigint: value);

    public double Number => Kind == JsBinaryValueKind.Number ? number : throw new InvalidOperationException("Number proof violated.");
    public bool Boolean => Kind == JsBinaryValueKind.Boolean ? boolean : throw new InvalidOperationException("Boolean proof violated.");
    public string String => Kind == JsBinaryValueKind.String ? text! : throw new InvalidOperationException("String proof violated.");
    public JsBigInt BigInt => Kind == JsBinaryValueKind.BigInt ? bigint : throw new InvalidOperationException("BigInt proof violated.");

    public double ToNumberPrimitive() => Kind switch
    {
        JsBinaryValueKind.Number => number,
        JsBinaryValueKind.String => JsCoercion.StringToNumber(text!),
        JsBinaryValueKind.Boolean => boolean ? 1d : 0d,
        JsBinaryValueKind.Null => 0d,
        JsBinaryValueKind.Undefined => double.NaN,
        JsBinaryValueKind.BigInt => throw JsBinary.TypeError("ToNumber rejects BigInt."),
        _ => throw new InvalidOperationException("Unknown binary value tag.")
    };

    public string ToDisplayString() => Kind switch
    {
        JsBinaryValueKind.Undefined => "undefined",
        JsBinaryValueKind.Null => "null",
        JsBinaryValueKind.Boolean => boolean ? "true" : "false",
        JsBinaryValueKind.Number => JsNumber.Format(number),
        JsBinaryValueKind.String => text!,
        JsBinaryValueKind.BigInt => bigint.ToString() + "n",
        _ => throw new InvalidOperationException("Unknown binary value tag.")
    };
}

public enum JsTypedArrayKind
{
    Int8, Uint8, Uint8Clamped, Int16, Uint16, Int32, Uint32, Float32, Float64, BigInt64, BigUint64
}

public enum JsDataViewKind
{
    Int8, Uint8, Int16, Uint16, Int32, Uint32, Float32, Float64, BigInt64, BigUint64
}

public sealed class JsTypedArray
{
    internal JsTypedArray(JsTypedArrayKind kind, JsArrayBuffer buffer, int byteOffset, int length)
        => (Kind, Buffer, ByteOffsetInternal, LengthInternal) = (kind, buffer, byteOffset, length);

    public JsTypedArrayKind Kind { get; }
    public JsArrayBuffer Buffer { get; }
    internal int ByteOffsetInternal { get; }
    internal int LengthInternal { get; }

    public int Length => Buffer.IsDetached ? 0 : LengthInternal;
    public int ByteOffset => Buffer.IsDetached ? 0 : ByteOffsetInternal;
    public int ByteLength => Buffer.IsDetached ? 0 : checked(LengthInternal * JsBinary.BytesPerElement(Kind));
}

public sealed class JsDataView
{
    internal JsDataView(JsArrayBuffer buffer, int byteOffset, int byteLength)
        => (Buffer, ByteOffsetInternal, ByteLengthInternal) = (buffer, byteOffset, byteLength);

    public JsArrayBuffer Buffer { get; }
    internal int ByteOffsetInternal { get; }
    internal int ByteLengthInternal { get; }

    public int ByteOffset => Buffer.IsDetached ? throw JsBinary.TypeError("DataView buffer is detached.") : ByteOffsetInternal;
    public int ByteLength => Buffer.IsDetached ? throw JsBinary.TypeError("DataView buffer is detached.") : ByteLengthInternal;
}

/// <summary>
/// Canonical helper surface for reviewed j2cs BINARY rules. It implements only
/// fixed ArrayBuffer storage and fixed views; resizable/shared/proxy/property
/// integration is deliberately not approximated.
/// </summary>
public static class JsBinary
{
    private const double MaxSafeInteger = 9007199254740991d;

    internal static JsBinaryBigIntException TypeError(string message)
        => new(JsBinaryBigIntErrorKind.TypeError, message);
    internal static JsBinaryBigIntException RangeError(string message)
        => new(JsBinaryBigIntErrorKind.RangeError, message);
    internal static JsBinaryBigIntException SyntaxError(string message)
        => new(JsBinaryBigIntErrorKind.SyntaxError, message);

    public static JsArrayBuffer NewArrayBuffer(JsBinaryValue length)
    {
        long index = ToIndex(length);
        if (index > int.MaxValue) throw RangeError("ArrayBuffer allocation exceeds this runtime's supported backing-store size.");
        try { return new JsArrayBuffer((int)index); }
        catch (OutOfMemoryException) { throw RangeError("ArrayBuffer allocation failed."); }
    }

    public static JsTypedArray NewTypedArrayView(JsTypedArrayKind kind, JsArrayBuffer buffer,
        JsBinaryValue byteOffset, JsBinaryValue? length = null)
    {
        if (buffer.IsDetached) throw TypeError("Cannot construct a TypedArray over a detached ArrayBuffer.");
        int elementSize = BytesPerElement(kind);
        long offsetLong = ToIndex(byteOffset);
        if (offsetLong > int.MaxValue || offsetLong % elementSize != 0)
            throw RangeError("TypedArray byteOffset is misaligned or outside the supported range.");
        int offset = (int)offsetLong;
        if (offset > buffer.ByteLength) throw RangeError("TypedArray byteOffset is outside the buffer.");

        long count;
        if (length is null)
        {
            int remaining = buffer.ByteLength - offset;
            if (remaining % elementSize != 0) throw RangeError("Buffer remainder is not aligned to the element size.");
            count = remaining / elementSize;
        }
        else count = ToIndex(length.Value);

        long bytes = checked(count * elementSize);
        if (count > int.MaxValue || bytes > buffer.ByteLength - offset)
            throw RangeError("TypedArray view exceeds the backing buffer.");
        return new JsTypedArray(kind, buffer, offset, (int)count);
    }

    public static JsBinaryValue TypedArrayGet(JsTypedArray array, JsBinaryValue index)
    {
        if (!TryIntegerIndex(index, out int elementIndex) || array.Buffer.IsDetached || elementIndex >= array.LengthInternal)
            return JsBinaryValue.Undefined;
        int byteIndex = checked(array.ByteOffsetInternal + elementIndex * BytesPerElement(array.Kind));
        return ReadTyped(array.Kind, array.Buffer.ReadBytes().Slice(byteIndex, BytesPerElement(array.Kind)));
    }

    public static JsBinaryValue TypedArraySetNumber(JsTypedArray array, JsBinaryValue index, JsBinaryValue value)
    {
        if (IsBigIntKind(array.Kind)) throw TypeError("Number-content TypedArray helper cannot target a BigInt TypedArray.");
        // Integer-indexed [[Set]] coerces the RHS before the invalid/OOB index becomes a no-op.
        // This matters for BigInt -> Number TypeError even when the element will not be stored.
        double number = value.ToNumberPrimitive();
        if (!TryIntegerIndex(index, out int elementIndex) || array.Buffer.IsDetached || elementIndex >= array.LengthInternal)
            return value;
        int byteIndex = checked(array.ByteOffsetInternal + elementIndex * BytesPerElement(array.Kind));
        WriteNumber(array.Kind, array.Buffer.MutableBytes().Slice(byteIndex, BytesPerElement(array.Kind)), number);
        return value;
    }

    public static JsBinaryValue TypedArraySetBigInt(JsTypedArray array, JsBinaryValue index, JsBinaryValue value)
    {
        if (!IsBigIntKind(array.Kind)) throw TypeError("BigInt-content TypedArray helper requires BigInt64Array/BigUint64Array.");
        // ToBigInt is observable before an invalid/OOB/detached integer index is discarded.
        JsBigInt bigint = JsBigInt.ToBigIntPrimitive(value);
        if (!TryIntegerIndex(index, out int elementIndex) || array.Buffer.IsDetached || elementIndex >= array.LengthInternal)
            return value;
        int byteIndex = checked(array.ByteOffsetInternal + elementIndex * 8);
        var bytes = array.Buffer.MutableBytes().Slice(byteIndex, 8);
        if (array.Kind == JsTypedArrayKind.BigInt64)
            BinaryPrimitives.WriteInt64LittleEndian(bytes, (long)JsBigInt.ToBigInt64(bigint).Value);
        else
            BinaryPrimitives.WriteUInt64LittleEndian(bytes, (ulong)JsBigInt.ToBigUint64(bigint).Value);
        return value;
    }

    public static JsDataView NewDataView(JsArrayBuffer buffer, JsBinaryValue byteOffset, JsBinaryValue? byteLength = null)
    {
        if (buffer.IsDetached) throw TypeError("Cannot construct DataView over a detached ArrayBuffer.");
        long offsetLong = ToIndex(byteOffset);
        if (offsetLong > int.MaxValue || offsetLong > buffer.ByteLength) throw RangeError("DataView byteOffset is outside the buffer.");
        int offset = (int)offsetLong;
        long length = byteLength is null ? buffer.ByteLength - offset : ToIndex(byteLength.Value);
        if (length > int.MaxValue || length > buffer.ByteLength - offset) throw RangeError("DataView byteLength exceeds the buffer.");
        return new JsDataView(buffer, offset, (int)length);
    }

    public static JsBinaryValue DataViewGet(JsDataView view, JsDataViewKind kind, JsBinaryValue byteOffset, bool littleEndian = false)
    {
        int width = BytesPerElement(kind);
        int absolute = ResolveDataViewRange(view, byteOffset, width);
        var bytes = view.Buffer.ReadBytes().Slice(absolute, width);
        return ReadDataView(kind, bytes, littleEndian);
    }

    public static void DataViewSet(JsDataView view, JsDataViewKind kind, JsBinaryValue byteOffset,
        JsBinaryValue value, bool littleEndian = false)
    {
        int width = BytesPerElement(kind);
        long relativeLong = ToIndex(byteOffset);
        if (relativeLong > int.MaxValue) throw RangeError("DataView byteOffset is outside the supported range.");

        double number = 0;
        JsBigInt bigint = default;
        if (kind is JsDataViewKind.BigInt64 or JsDataViewKind.BigUint64)
            bigint = JsBigInt.ToBigIntPrimitive(value);
        else
            number = value.ToNumberPrimitive();

        int relative = (int)relativeLong;
        if (view.Buffer.IsDetached) throw TypeError("DataView buffer is detached.");
        if (relative > view.ByteLengthInternal - width) throw RangeError("DataView write is out of bounds.");
        int absolute = checked(view.ByteOffsetInternal + relative);
        var bytes = view.Buffer.MutableBytes().Slice(absolute, width);
        WriteDataView(kind, bytes, number, bigint, littleEndian);
    }

    internal static int BytesPerElement(JsTypedArrayKind kind) => kind switch
    {
        JsTypedArrayKind.Int8 or JsTypedArrayKind.Uint8 or JsTypedArrayKind.Uint8Clamped => 1,
        JsTypedArrayKind.Int16 or JsTypedArrayKind.Uint16 => 2,
        JsTypedArrayKind.Int32 or JsTypedArrayKind.Uint32 or JsTypedArrayKind.Float32 => 4,
        JsTypedArrayKind.Float64 or JsTypedArrayKind.BigInt64 or JsTypedArrayKind.BigUint64 => 8,
        _ => throw new InvalidOperationException("Unknown TypedArray kind.")
    };

    private static int BytesPerElement(JsDataViewKind kind) => kind switch
    {
        JsDataViewKind.Int8 or JsDataViewKind.Uint8 => 1,
        JsDataViewKind.Int16 or JsDataViewKind.Uint16 => 2,
        JsDataViewKind.Int32 or JsDataViewKind.Uint32 or JsDataViewKind.Float32 => 4,
        JsDataViewKind.Float64 or JsDataViewKind.BigInt64 or JsDataViewKind.BigUint64 => 8,
        _ => throw new InvalidOperationException("Unknown DataView kind.")
    };

    private static bool IsBigIntKind(JsTypedArrayKind kind)
        => kind is JsTypedArrayKind.BigInt64 or JsTypedArrayKind.BigUint64;

    private static long ToIndex(JsBinaryValue value)
    {
        double number = value.ToNumberPrimitive();
        if (double.IsNaN(number) || number == 0) return 0;
        if (!double.IsFinite(number)) throw RangeError("ToIndex cannot accept Infinity.");
        double integer = Math.Truncate(number);
        if (integer < 0 || integer > MaxSafeInteger) throw RangeError("ToIndex is outside 0..2^53-1.");
        return (long)integer;
    }

    private static bool TryIntegerIndex(JsBinaryValue value, out int index)
    {
        index = 0;
        if (value.Kind != JsBinaryValueKind.Number) throw new InvalidOperationException("Canonical numeric index proof required.");
        double number = value.Number;
        if (number == 0 && BitConverter.DoubleToInt64Bits(number) < 0) return false;
        if (!double.IsFinite(number) || number < 0 || Math.Truncate(number) != number || number > int.MaxValue) return false;
        index = (int)number;
        return true;
    }

    private static JsBinaryValue ReadTyped(JsTypedArrayKind kind, ReadOnlySpan<byte> bytes) => kind switch
    {
        JsTypedArrayKind.Int8 => JsBinaryValue.FromNumber((sbyte)bytes[0]),
        JsTypedArrayKind.Uint8 or JsTypedArrayKind.Uint8Clamped => JsBinaryValue.FromNumber(bytes[0]),
        JsTypedArrayKind.Int16 => JsBinaryValue.FromNumber(BinaryPrimitives.ReadInt16LittleEndian(bytes)),
        JsTypedArrayKind.Uint16 => JsBinaryValue.FromNumber(BinaryPrimitives.ReadUInt16LittleEndian(bytes)),
        JsTypedArrayKind.Int32 => JsBinaryValue.FromNumber(BinaryPrimitives.ReadInt32LittleEndian(bytes)),
        JsTypedArrayKind.Uint32 => JsBinaryValue.FromNumber(BinaryPrimitives.ReadUInt32LittleEndian(bytes)),
        JsTypedArrayKind.Float32 => JsBinaryValue.FromNumber(BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(bytes))),
        JsTypedArrayKind.Float64 => JsBinaryValue.FromNumber(BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64LittleEndian(bytes))),
        JsTypedArrayKind.BigInt64 => JsBinaryValue.FromBigInt(new JsBigInt(BinaryPrimitives.ReadInt64LittleEndian(bytes))),
        JsTypedArrayKind.BigUint64 => JsBinaryValue.FromBigInt(new JsBigInt(BinaryPrimitives.ReadUInt64LittleEndian(bytes))),
        _ => throw new InvalidOperationException("Unknown TypedArray kind.")
    };

    private static void WriteNumber(JsTypedArrayKind kind, Span<byte> bytes, double number)
    {
        switch (kind)
        {
            case JsTypedArrayKind.Int8: bytes[0] = unchecked((byte)(sbyte)SignedModulo(number, 8)); break;
            case JsTypedArrayKind.Uint8: bytes[0] = (byte)UnsignedModulo(number, 8); break;
            case JsTypedArrayKind.Uint8Clamped: bytes[0] = ToUint8Clamp(number); break;
            case JsTypedArrayKind.Int16: BinaryPrimitives.WriteInt16LittleEndian(bytes, (short)SignedModulo(number, 16)); break;
            case JsTypedArrayKind.Uint16: BinaryPrimitives.WriteUInt16LittleEndian(bytes, (ushort)UnsignedModulo(number, 16)); break;
            case JsTypedArrayKind.Int32: BinaryPrimitives.WriteInt32LittleEndian(bytes, (int)SignedModulo(number, 32)); break;
            case JsTypedArrayKind.Uint32: BinaryPrimitives.WriteUInt32LittleEndian(bytes, (uint)UnsignedModulo(number, 32)); break;
            case JsTypedArrayKind.Float32: BinaryPrimitives.WriteInt32LittleEndian(bytes, BitConverter.SingleToInt32Bits((float)number)); break;
            case JsTypedArrayKind.Float64: BinaryPrimitives.WriteInt64LittleEndian(bytes, BitConverter.DoubleToInt64Bits(number)); break;
            default: throw TypeError("Number write requested for BigInt TypedArray.");
        }
    }

    private static JsBinaryValue ReadDataView(JsDataViewKind kind, ReadOnlySpan<byte> bytes, bool little) => kind switch
    {
        JsDataViewKind.Int8 => JsBinaryValue.FromNumber((sbyte)bytes[0]),
        JsDataViewKind.Uint8 => JsBinaryValue.FromNumber(bytes[0]),
        JsDataViewKind.Int16 => JsBinaryValue.FromNumber(little ? BinaryPrimitives.ReadInt16LittleEndian(bytes) : BinaryPrimitives.ReadInt16BigEndian(bytes)),
        JsDataViewKind.Uint16 => JsBinaryValue.FromNumber(little ? BinaryPrimitives.ReadUInt16LittleEndian(bytes) : BinaryPrimitives.ReadUInt16BigEndian(bytes)),
        JsDataViewKind.Int32 => JsBinaryValue.FromNumber(little ? BinaryPrimitives.ReadInt32LittleEndian(bytes) : BinaryPrimitives.ReadInt32BigEndian(bytes)),
        JsDataViewKind.Uint32 => JsBinaryValue.FromNumber(little ? BinaryPrimitives.ReadUInt32LittleEndian(bytes) : BinaryPrimitives.ReadUInt32BigEndian(bytes)),
        JsDataViewKind.Float32 => JsBinaryValue.FromNumber(BitConverter.Int32BitsToSingle(little ? BinaryPrimitives.ReadInt32LittleEndian(bytes) : BinaryPrimitives.ReadInt32BigEndian(bytes))),
        JsDataViewKind.Float64 => JsBinaryValue.FromNumber(BitConverter.Int64BitsToDouble(little ? BinaryPrimitives.ReadInt64LittleEndian(bytes) : BinaryPrimitives.ReadInt64BigEndian(bytes))),
        JsDataViewKind.BigInt64 => JsBinaryValue.FromBigInt(new JsBigInt(little ? BinaryPrimitives.ReadInt64LittleEndian(bytes) : BinaryPrimitives.ReadInt64BigEndian(bytes))),
        JsDataViewKind.BigUint64 => JsBinaryValue.FromBigInt(new JsBigInt(little ? BinaryPrimitives.ReadUInt64LittleEndian(bytes) : BinaryPrimitives.ReadUInt64BigEndian(bytes))),
        _ => throw new InvalidOperationException("Unknown DataView kind.")
    };

    private static void WriteDataView(JsDataViewKind kind, Span<byte> bytes, double number, JsBigInt bigint, bool little)
    {
        switch (kind)
        {
            case JsDataViewKind.Int8: bytes[0] = unchecked((byte)(sbyte)SignedModulo(number, 8)); break;
            case JsDataViewKind.Uint8: bytes[0] = (byte)UnsignedModulo(number, 8); break;
            case JsDataViewKind.Int16: WriteInt16(bytes, (short)SignedModulo(number, 16), little); break;
            case JsDataViewKind.Uint16: WriteUInt16(bytes, (ushort)UnsignedModulo(number, 16), little); break;
            case JsDataViewKind.Int32: WriteInt32(bytes, (int)SignedModulo(number, 32), little); break;
            case JsDataViewKind.Uint32: WriteUInt32(bytes, (uint)UnsignedModulo(number, 32), little); break;
            case JsDataViewKind.Float32: WriteInt32(bytes, BitConverter.SingleToInt32Bits((float)number), little); break;
            case JsDataViewKind.Float64: WriteInt64(bytes, BitConverter.DoubleToInt64Bits(number), little); break;
            case JsDataViewKind.BigInt64: WriteInt64(bytes, (long)JsBigInt.ToBigInt64(bigint).Value, little); break;
            case JsDataViewKind.BigUint64: WriteUInt64(bytes, (ulong)JsBigInt.ToBigUint64(bigint).Value, little); break;
            default: throw new InvalidOperationException("Unknown DataView kind.");
        }
    }

    private static int ResolveDataViewRange(JsDataView view, JsBinaryValue byteOffset, int width)
    {
        long relativeLong = ToIndex(byteOffset);
        if (relativeLong > int.MaxValue) throw RangeError("DataView byteOffset is outside the supported range.");
        if (view.Buffer.IsDetached) throw TypeError("DataView buffer is detached.");
        int relative = (int)relativeLong;
        if (relative > view.ByteLengthInternal - width) throw RangeError("DataView read is out of bounds.");
        return checked(view.ByteOffsetInternal + relative);
    }

    private static ulong UnsignedModulo(double number, int bits)
    {
        if (!double.IsFinite(number) || number == 0) return 0;
        BigInteger modulus = BigInteger.One << bits;
        BigInteger integer = new(Math.Truncate(number));
        BigInteger result = integer % modulus;
        if (result.Sign < 0) result += modulus;
        return (ulong)result;
    }

    private static long SignedModulo(double number, int bits)
    {
        ulong unsigned = UnsignedModulo(number, bits);
        ulong sign = 1UL << (bits - 1);
        ulong modulus = 1UL << bits;
        return unsigned >= sign ? (long)(unsigned - modulus) : (long)unsigned;
    }

    private static byte ToUint8Clamp(double number)
    {
        if (double.IsNaN(number) || number <= 0) return 0;
        if (number >= 255) return 255;
        return (byte)Math.Round(number, MidpointRounding.ToEven);
    }

    private static void WriteInt16(Span<byte> b, short v, bool little) { if (little) BinaryPrimitives.WriteInt16LittleEndian(b, v); else BinaryPrimitives.WriteInt16BigEndian(b, v); }
    private static void WriteUInt16(Span<byte> b, ushort v, bool little) { if (little) BinaryPrimitives.WriteUInt16LittleEndian(b, v); else BinaryPrimitives.WriteUInt16BigEndian(b, v); }
    private static void WriteInt32(Span<byte> b, int v, bool little) { if (little) BinaryPrimitives.WriteInt32LittleEndian(b, v); else BinaryPrimitives.WriteInt32BigEndian(b, v); }
    private static void WriteUInt32(Span<byte> b, uint v, bool little) { if (little) BinaryPrimitives.WriteUInt32LittleEndian(b, v); else BinaryPrimitives.WriteUInt32BigEndian(b, v); }
    private static void WriteInt64(Span<byte> b, long v, bool little) { if (little) BinaryPrimitives.WriteInt64LittleEndian(b, v); else BinaryPrimitives.WriteInt64BigEndian(b, v); }
    private static void WriteUInt64(Span<byte> b, ulong v, bool little) { if (little) BinaryPrimitives.WriteUInt64LittleEndian(b, v); else BinaryPrimitives.WriteUInt64BigEndian(b, v); }
}
