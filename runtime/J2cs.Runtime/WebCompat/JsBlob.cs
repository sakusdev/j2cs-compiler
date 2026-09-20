using System.Text;

namespace J2cs.Runtime.WebCompat;

public enum JsBlobEndings
{
    Transparent,
    Native
}

public readonly record struct JsBlobOptions(
    string? Type = null,
    JsBlobEndings Endings = JsBlobEndings.Transparent);

public readonly record struct JsFileOptions(
    string? Type = null,
    JsBlobEndings Endings = JsBlobEndings.Transparent,
    long? LastModified = null);

public enum JsBlobPartKind
{
    String,
    Bytes,
    Blob
}

public readonly struct JsBlobPart
{
    private readonly string? text;
    private readonly byte[]? bytes;
    private readonly JsBlob? blob;

    private JsBlobPart(JsBlobPartKind kind, string? text = null, byte[]? bytes = null, JsBlob? blob = null)
        => (Kind, this.text, this.bytes, this.blob) = (kind, text, bytes, blob);

    public JsBlobPartKind Kind { get; }

    public static JsBlobPart FromString(string value)
        => new(JsBlobPartKind.String, text: value ?? throw new ArgumentNullException(nameof(value)));

    public static JsBlobPart FromBytes(ReadOnlySpan<byte> value)
        => new(JsBlobPartKind.Bytes, bytes: value.ToArray());

    public static JsBlobPart FromBlob(JsBlob value)
        => new(JsBlobPartKind.Blob, blob: value ?? throw new ArgumentNullException(nameof(value)));

    internal void AppendTo(List<byte> output, JsBlobEndings endings)
    {
        switch (Kind)
        {
            case JsBlobPartKind.String:
                output.AddRange(JsBlob.EncodeStringPart(text!, endings));
                break;
            case JsBlobPartKind.Bytes:
                output.AddRange(bytes!);
                break;
            case JsBlobPartKind.Blob:
                output.AddRange(blob!.SnapshotBytes());
                break;
            default:
                throw new InvalidOperationException("Unknown BlobPart tag.");
        }
    }
}

public class JsBlob
{
    private static readonly Encoding Utf8 = new UTF8Encoding(
        encoderShouldEmitUTF8Identifier: false,
        throwOnInvalidBytes: false);

    private readonly byte[] bytes;

    protected JsBlob(byte[] bytes, string type)
    {
        this.bytes = bytes.ToArray();
        Type = NormalizeType(type);
    }

    public long Size => bytes.LongLength;
    public string Type { get; }

    public static JsBlob Create(IEnumerable<JsBlobPart>? parts = null, JsBlobOptions options = default)
    {
        var output = new List<byte>();
        if (parts is not null)
        {
            foreach (var part in parts)
                part.AppendTo(output, options.Endings);
        }

        return new JsBlob(output.ToArray(), NormalizeType(options.Type));
    }

    public JsBlob Slice(long? requestedStart = null, long? requestedEnd = null, string? contentType = null)
    {
        var size = Size;
        var start = NormalizeIndex(requestedStart ?? 0, size);
        var end = requestedEnd.HasValue ? NormalizeIndex(requestedEnd.Value, size) : size;
        var length = Math.Max(end - start, 0);
        if (length > int.MaxValue)
            throw new InvalidOperationException("Blob slice exceeds the runtime byte-array boundary.");

        var result = new byte[(int)length];
        if (length != 0)
            Buffer.BlockCopy(bytes, checked((int)start), result, 0, checked((int)length));

        return new JsBlob(result, NormalizeType(contentType));
    }

    public byte[] ReadBytes() => bytes.ToArray();

    // Host-only synchronous decoder. This does not claim Blob.text() Promise scheduling.
    public string ReadTextUtf8() => Utf8.GetString(bytes);

    internal byte[] SnapshotBytes() => bytes.ToArray();

    internal static byte[] EncodeStringPart(string value, JsBlobEndings endings)
    {
        var usv = ToUsvString(value);
        if (endings == JsBlobEndings.Native)
            usv = NormalizeNativeLineEndings(usv);
        return Utf8.GetBytes(usv);
    }

    internal static string ToUsvString(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var result = new StringBuilder(value.Length);
        for (var index = 0; index < value.Length; index++)
        {
            var current = value[index];
            if (char.IsHighSurrogate(current))
            {
                if (index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
                {
                    result.Append(current);
                    result.Append(value[++index]);
                }
                else
                {
                    result.Append('\uFFFD');
                }
            }
            else if (char.IsLowSurrogate(current))
            {
                result.Append('\uFFFD');
            }
            else
            {
                result.Append(current);
            }
        }

        return result.ToString();
    }

    internal static string NormalizeType(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;

        var chars = value.ToCharArray();
        for (var index = 0; index < chars.Length; index++)
        {
            var current = chars[index];
            if (current < '\u0020' || current > '\u007E')
                return string.Empty;
            if (current is >= 'A' and <= 'Z')
                chars[index] = (char)(current + ('a' - 'A'));
        }

        return new string(chars);
    }

    private static long NormalizeIndex(long value, long size)
        => value < 0 ? Math.Max(size + value, 0) : Math.Min(value, size);

    private static string NormalizeNativeLineEndings(string value)
    {
        var normalized = value.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace("\r", "\n", StringComparison.Ordinal);
        return Environment.NewLine == "\n"
            ? normalized
            : normalized.Replace("\n", Environment.NewLine, StringComparison.Ordinal);
    }
}

public sealed class JsFile : JsBlob
{
    private JsFile(byte[] bytes, string type, string name, long lastModified)
        : base(bytes, type)
        => (Name, LastModified) = (name, lastModified);

    public string Name { get; }
    public long LastModified { get; }

    public static JsFile Create(IEnumerable<JsBlobPart>? parts, string name, JsFileOptions options = default)
    {
        ArgumentNullException.ThrowIfNull(name);
        var blob = JsBlob.Create(parts, new JsBlobOptions(options.Type, options.Endings));
        return new JsFile(
            blob.ReadBytes(),
            blob.Type,
            ToUsvString(name),
            options.LastModified ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }
}
