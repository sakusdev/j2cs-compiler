using System.Text;

namespace J2cs.Runtime.NodeCompat;

public enum NodeFsTextEncoding
{
    Utf8,
    Utf16Le,
    Latin1,
    Ascii,
    Hex,
    Base64,
    Base64Url,
}

internal static class NodeFsEncodingCodec
{
    private static readonly UTF8Encoding Utf8 = new(false, false);

    public static NodeFsTextEncoding Parse(string encoding)
    {
        ArgumentNullException.ThrowIfNull(encoding);
        return encoding.ToLowerInvariant() switch
        {
            "utf8" or "utf-8" => NodeFsTextEncoding.Utf8,
            "utf16le" or "utf-16le" or "ucs2" or "ucs-2" => NodeFsTextEncoding.Utf16Le,
            "latin1" or "binary" => NodeFsTextEncoding.Latin1,
            "ascii" => NodeFsTextEncoding.Ascii,
            "hex" => NodeFsTextEncoding.Hex,
            "base64" => NodeFsTextEncoding.Base64,
            "base64url" => NodeFsTextEncoding.Base64Url,
            _ => throw new NodeFsArgumentException("ERR_UNKNOWN_ENCODING", $"Unknown encoding: {encoding}", nameof(encoding)),
        };
    }

    public static string Decode(ReadOnlySpan<byte> bytes, NodeFsTextEncoding encoding) => encoding switch
    {
        NodeFsTextEncoding.Utf8 => Utf8.GetString(bytes),
        NodeFsTextEncoding.Utf16Le => DecodeUtf16Le(bytes),
        NodeFsTextEncoding.Latin1 => Encoding.Latin1.GetString(bytes),
        NodeFsTextEncoding.Ascii => DecodeAscii(bytes),
        NodeFsTextEncoding.Hex => Convert.ToHexString(bytes).ToLowerInvariant(),
        NodeFsTextEncoding.Base64 => Convert.ToBase64String(bytes),
        NodeFsTextEncoding.Base64Url => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'),
        _ => throw new InvalidOperationException("Unreachable Node fs encoding."),
    };

    public static byte[] Encode(string text, NodeFsTextEncoding encoding)
    {
        ArgumentNullException.ThrowIfNull(text);
        return encoding switch
        {
            NodeFsTextEncoding.Utf8 => Utf8.GetBytes(text),
            NodeFsTextEncoding.Utf16Le => EncodeUtf16Le(text),
            NodeFsTextEncoding.Latin1 => EncodeLatin1(text),
            NodeFsTextEncoding.Ascii => EncodeLatin1(text),
            NodeFsTextEncoding.Hex => DecodeHex(text),
            NodeFsTextEncoding.Base64 => DecodeBase64(text),
            NodeFsTextEncoding.Base64Url => DecodeBase64(text),
            _ => throw new InvalidOperationException("Unreachable Node fs encoding."),
        };
    }

    private static string DecodeUtf16Le(ReadOnlySpan<byte> bytes)
    {
        var chars = new char[bytes.Length / 2];
        for (var i = 0; i < chars.Length; i++)
            chars[i] = (char)(bytes[i * 2] | (bytes[i * 2 + 1] << 8));
        return new string(chars);
    }

    private static byte[] EncodeUtf16Le(string text)
    {
        var bytes = new byte[text.Length * 2];
        for (var i = 0; i < text.Length; i++)
        {
            bytes[i * 2] = (byte)(text[i] & 0xff);
            bytes[i * 2 + 1] = (byte)(text[i] >> 8);
        }
        return bytes;
    }

    private static string DecodeAscii(ReadOnlySpan<byte> bytes)
    {
        var chars = new char[bytes.Length];
        for (var i = 0; i < bytes.Length; i++) chars[i] = (char)(bytes[i] & 0x7f);
        return new string(chars);
    }

    private static byte[] EncodeLatin1(string text)
    {
        var bytes = new byte[text.Length];
        for (var i = 0; i < text.Length; i++) bytes[i] = (byte)(text[i] & 0xff);
        return bytes;
    }

    private static int HexNibble(char c)
        => c is >= '0' and <= '9' ? c - '0'
         : c is >= 'a' and <= 'f' ? c - 'a' + 10
         : c is >= 'A' and <= 'F' ? c - 'A' + 10
         : -1;

    private static byte[] DecodeHex(string text)
    {
        var output = new List<byte>(text.Length / 2);
        for (var i = 0; i + 1 < text.Length; i += 2)
        {
            var high = HexNibble(text[i]);
            var low = HexNibble(text[i + 1]);
            if (high < 0 || low < 0) break;
            output.Add((byte)((high << 4) | low));
        }
        return output.ToArray();
    }

    private static byte[] DecodeBase64(string text)
    {
        static int Digit(char c)
            => c is >= 'A' and <= 'Z' ? c - 'A'
             : c is >= 'a' and <= 'z' ? c - 'a' + 26
             : c is >= '0' and <= '9' ? c - '0' + 52
             : c is '+' or '-' ? 62
             : c is '/' or '_' ? 63
             : -1;

        var digits = new List<int>(text.Length);
        foreach (var c in text)
        {
            if (c == '=') break;
            var digit = Digit(c);
            if (digit >= 0) digits.Add(digit);
        }

        var output = new List<byte>(digits.Count * 3 / 4);
        for (var i = 0; i + 1 < digits.Count; i += 4)
        {
            var a = digits[i];
            var b = digits[i + 1];
            output.Add((byte)((a << 2) | (b >> 4)));
            if (i + 2 >= digits.Count) break;
            var d2 = digits[i + 2];
            output.Add((byte)((b << 4) | (d2 >> 2)));
            if (i + 3 >= digits.Count) break;
            var d3 = digits[i + 3];
            output.Add((byte)((d2 << 6) | d3));
        }
        return output.ToArray();
    }
}
