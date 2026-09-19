using System.Text;

namespace J2cs.Runtime.NodeCompat;

public enum NodeBufferEncoding { Utf8, Utf16Le, Latin1, Ascii, Hex, Base64, Base64Url }

/// <summary>
/// Identity-bearing Node Buffer storage with explicit copy-vs-view constructors.
/// Slice/View share the same backing bytes; From(byte[]) copies.
/// </summary>
public sealed class NodeBuffer : JsObject
{
    private readonly byte[] backing;
    private readonly int offset;
    public int Length { get; }

    private NodeBuffer(byte[] backing, int offset, int length)
    {
        this.backing = backing;
        this.offset = offset;
        Length = length;
    }

    public byte this[int index]
    {
        get
        {
            CheckIndex(index);
            return backing[offset + index];
        }
        set
        {
            CheckIndex(index);
            backing[offset + index] = value;
        }
    }

    public static NodeBuffer From(string value, string encoding = "utf8")
        => new(Encode(value ?? throw new ArgumentNullException(nameof(value)), ParseEncoding(encoding)), 0,
            Encode(value, ParseEncoding(encoding)).Length);

    public static NodeBuffer From(byte[] value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var copy = value.ToArray();
        return new NodeBuffer(copy, 0, copy.Length);
    }

    public static NodeBuffer FromArrayBuffer(byte[] backingStore, int byteOffset = 0, int? length = null)
    {
        ArgumentNullException.ThrowIfNull(backingStore);
        var actualLength = length ?? backingStore.Length - byteOffset;
        ValidateRange(backingStore.Length, byteOffset, actualLength);
        return new NodeBuffer(backingStore, byteOffset, actualLength);
    }

    public static NodeBuffer Alloc(int size, byte fill = 0)
    {
        if (size < 0) throw new ArgumentOutOfRangeException(nameof(size));
        var bytes = new byte[size];
        if (fill != 0) Array.Fill(bytes, fill);
        return new NodeBuffer(bytes, 0, bytes.Length);
    }

    public static int ByteLength(string value, string encoding = "utf8")
        => Encode(value ?? throw new ArgumentNullException(nameof(value)), ParseEncoding(encoding)).Length;

    public static NodeBuffer View(NodeBuffer buffer, int start = 0, int? end = null)
        => (buffer ?? throw new ArgumentNullException(nameof(buffer))).Slice(start, end);

    public NodeBuffer Slice(int start = 0, int? end = null)
    {
        var from = NormalizeIndex(start, Length);
        var to = NormalizeIndex(end ?? Length, Length);
        if (to < from) to = from;
        return new NodeBuffer(backing, offset + from, to - from);
    }

    public NodeBuffer Subarray(int start = 0, int? end = null) => Slice(start, end);

    public byte[] ToArray()
    {
        var result = new byte[Length];
        Array.Copy(backing, offset, result, 0, Length);
        return result;
    }

    public void CopyTo(byte[] destination, int destinationOffset, int sourceOffset, int count)
    {
        ArgumentNullException.ThrowIfNull(destination);
        ValidateRange(Length, sourceOffset, count);
        ValidateRange(destination.Length, destinationOffset, count);
        Array.Copy(backing, offset + sourceOffset, destination, destinationOffset, count);
    }

    public string ToString(string encoding, int start = 0, int? end = null)
    {
        var view = Slice(start, end);
        return Decode(view.backing, view.offset, view.Length, ParseEncoding(encoding));
    }

    public override string ToString() => ToString("utf8");

    public static NodeBufferEncoding ParseEncoding(string encoding)
    {
        var normalized = (encoding ?? throw new ArgumentNullException(nameof(encoding))).ToLowerInvariant().Replace("-", "");
        return normalized switch
        {
            "utf8" => NodeBufferEncoding.Utf8,
            "utf16le" or "ucs2" => NodeBufferEncoding.Utf16Le,
            "latin1" or "binary" => NodeBufferEncoding.Latin1,
            "ascii" => NodeBufferEncoding.Ascii,
            "hex" => NodeBufferEncoding.Hex,
            "base64" => NodeBufferEncoding.Base64,
            "base64url" => NodeBufferEncoding.Base64Url,
            _ => throw new ArgumentException($"Unknown Buffer encoding: {encoding}", nameof(encoding))
        };
    }

    private static byte[] Encode(string value, NodeBufferEncoding encoding) => encoding switch
    {
        NodeBufferEncoding.Utf8 => Encoding.UTF8.GetBytes(value),
        NodeBufferEncoding.Utf16Le => Encoding.Unicode.GetBytes(value),
        NodeBufferEncoding.Latin1 => Encoding.Latin1.GetBytes(value),
        NodeBufferEncoding.Ascii => value.Select(ch => (byte)(ch & 0x7f)).ToArray(),
        NodeBufferEncoding.Hex => DecodeHex(value),
        NodeBufferEncoding.Base64 => DecodeBase64(value, false),
        NodeBufferEncoding.Base64Url => DecodeBase64(value, true),
        _ => throw new InvalidOperationException("Unknown encoding")
    };

    private static string Decode(byte[] bytes, int start, int length, NodeBufferEncoding encoding) => encoding switch
    {
        NodeBufferEncoding.Utf8 => Encoding.UTF8.GetString(bytes, start, length),
        NodeBufferEncoding.Utf16Le => Encoding.Unicode.GetString(bytes, start, length),
        NodeBufferEncoding.Latin1 => Encoding.Latin1.GetString(bytes, start, length),
        NodeBufferEncoding.Ascii => new string(bytes.Skip(start).Take(length).Select(b => (char)(b & 0x7f)).ToArray()),
        NodeBufferEncoding.Hex => Convert.ToHexString(bytes, start, length).ToLowerInvariant(),
        NodeBufferEncoding.Base64 => Convert.ToBase64String(bytes, start, length),
        NodeBufferEncoding.Base64Url => Convert.ToBase64String(bytes, start, length).TrimEnd('=').Replace('+', '-').Replace('/', '_'),
        _ => throw new InvalidOperationException("Unknown encoding")
    };

    private static byte[] DecodeHex(string value)
    {
        var result = new List<byte>(value.Length / 2);
        for (var i = 0; i + 1 < value.Length; i += 2)
        {
            var high = Hex(value[i]);
            var low = Hex(value[i + 1]);
            if (high < 0 || low < 0) break;
            result.Add((byte)((high << 4) | low));
        }
        return result.ToArray();
    }

    private static int Hex(char c) => c is >= '0' and <= '9' ? c - '0'
        : c is >= 'a' and <= 'f' ? c - 'a' + 10
        : c is >= 'A' and <= 'F' ? c - 'A' + 10 : -1;

    private static byte[] DecodeBase64(string value, bool url)
    {
        var cleaned = new string(value.Where(c => !char.IsWhiteSpace(c)).ToArray());
        if (url) cleaned = cleaned.Replace('-', '+').Replace('_', '/');
        var remainder = cleaned.Length % 4;
        if (remainder != 0) cleaned = cleaned.PadRight(cleaned.Length + 4 - remainder, '=');
        return Convert.FromBase64String(cleaned);
    }

    private static int NormalizeIndex(int index, int length)
    {
        if (index < 0) return Math.Max(length + index, 0);
        return Math.Min(index, length);
    }

    private void CheckIndex(int index)
    {
        if ((uint)index >= (uint)Length) throw new ArgumentOutOfRangeException(nameof(index));
    }

    private static void ValidateRange(int total, int start, int length)
    {
        if (start < 0 || length < 0 || start > total - length) throw new ArgumentOutOfRangeException();
    }
}
