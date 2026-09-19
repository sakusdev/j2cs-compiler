using System.Security.Cryptography;
using System.Text;

namespace J2cs.Runtime.NodeCompat;

public enum NodeCryptoDigestKind
{
    Bytes,
    String
}

/// <summary>
/// Explicit tagged result for Node hash/HMAC digest. This avoids a CLR object/dynamic
/// escape hatch while preserving the Buffer-vs-string result distinction.
/// </summary>
public readonly struct NodeCryptoDigest
{
    private readonly NodeCryptoBytes? bytes;
    private readonly string? text;

    private NodeCryptoDigest(NodeCryptoDigestKind kind, NodeCryptoBytes? bytes, string? text)
        => (Kind, this.bytes, this.text) = (kind, bytes, text);

    public NodeCryptoDigestKind Kind { get; }
    public NodeCryptoBytes Bytes => Kind == NodeCryptoDigestKind.Bytes
        ? bytes!
        : throw new InvalidOperationException("Digest result is a string");
    public string String => Kind == NodeCryptoDigestKind.String
        ? text!
        : throw new InvalidOperationException("Digest result is binary");

    internal static NodeCryptoDigest FromBytes(NodeCryptoBytes value)
        => new(NodeCryptoDigestKind.Bytes, value ?? throw new ArgumentNullException(nameof(value)), null);
    internal static NodeCryptoDigest FromString(string value)
        => new(NodeCryptoDigestKind.String, null, value ?? throw new ArgumentNullException(nameof(value)));
}

/// <summary>
/// Owned binary crypto payload. It is intentionally not presented as a Node Buffer:
/// Buffer identity/view semantics belong to the separate Buffer compatibility lane.
/// </summary>
public sealed class NodeCryptoBytes
{
    private readonly byte[] data;

    public NodeCryptoBytes(ReadOnlySpan<byte> value) => data = value.ToArray();
    public int Length => data.Length;
    public byte GetByte(int index) => data[index];
    public byte[] ToArray() => data.ToArray();
    public string ToHex() => Convert.ToHexString(data).ToLowerInvariant();
    public string ToBase64() => Convert.ToBase64String(data);
    public string ToBase64Url() => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    internal ReadOnlySpan<byte> Span => data;
}

public sealed class NodeCryptoSecretKey : IDisposable
{
    private byte[]? material;

    internal NodeCryptoSecretKey(ReadOnlySpan<byte> value) => material = value.ToArray();

    public string Type => "secret";

    public NodeCryptoBytes Export()
    {
        EnsureAlive();
        return new NodeCryptoBytes(material!);
    }

    internal byte[] CopyMaterial()
    {
        EnsureAlive();
        return material!.ToArray();
    }

    private void EnsureAlive()
    {
        if (material is null) throw new ObjectDisposedException(nameof(NodeCryptoSecretKey));
    }

    public void Dispose()
    {
        if (material is null) return;
        CryptographicOperations.ZeroMemory(material);
        material = null;
    }
}

public sealed class NodeHash : IDisposable
{
    private IncrementalHash? hash;
    private bool finalized;

    internal NodeHash(HashAlgorithmName algorithm) => hash = IncrementalHash.CreateHash(algorithm);

    public NodeHash Update(string data, string? inputEncoding = null)
    {
        EnsureActive();
        hash!.AppendData(NodeCryptoEncoding.Decode(data, inputEncoding));
        return this;
    }

    public NodeHash Update(NodeCryptoBytes data)
    {
        ArgumentNullException.ThrowIfNull(data);
        EnsureActive();
        hash!.AppendData(data.Span);
        return this;
    }

    public NodeCryptoDigest Digest(string? encoding = null)
    {
        EnsureActive();
        var value = hash!.GetHashAndReset();
        hash.Dispose();
        hash = null;
        finalized = true;
        return NodeCryptoEncoding.AsDigest(value, encoding);
    }

    private void EnsureActive()
    {
        if (finalized || hash is null) throw new InvalidOperationException("Digest already called");
    }

    public void Dispose()
    {
        hash?.Dispose();
        hash = null;
        finalized = true;
    }
}

public sealed class NodeHmac : IDisposable
{
    private IncrementalHash? hmac;
    private bool finalized;

    internal NodeHmac(HashAlgorithmName algorithm, ReadOnlySpan<byte> key)
    {
        var copy = key.ToArray();
        try
        {
            hmac = IncrementalHash.CreateHMAC(algorithm, copy);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(copy);
        }
    }

    public NodeHmac Update(string data, string? inputEncoding = null)
    {
        EnsureActive();
        hmac!.AppendData(NodeCryptoEncoding.Decode(data, inputEncoding));
        return this;
    }

    public NodeHmac Update(NodeCryptoBytes data)
    {
        ArgumentNullException.ThrowIfNull(data);
        EnsureActive();
        hmac!.AppendData(data.Span);
        return this;
    }

    public NodeCryptoDigest Digest(string? encoding = null)
    {
        // Node 22 returns an empty Buffer/string on repeated Hmac digest calls,
        // while update-after-digest is finalized-state failure.
        if (finalized) return NodeCryptoEncoding.AsDigest(Array.Empty<byte>(), encoding);
        EnsureActive();
        var value = hmac!.GetHashAndReset();
        hmac.Dispose();
        hmac = null;
        finalized = true;
        return NodeCryptoEncoding.AsDigest(value, encoding);
    }

    private void EnsureActive()
    {
        if (finalized || hmac is null) throw new InvalidOperationException("Digest already called");
    }

    public void Dispose()
    {
        hmac?.Dispose();
        hmac = null;
        finalized = true;
    }
}

public static class NodeCrypto
{
    private const long SafeIntegerMax = 9_007_199_254_740_991L;
    private const ulong RandomIntDomain = 1UL << 48;
    private const ulong RandomIntMaxRange = RandomIntDomain - 1UL;

    public static NodeHash CreateHash(string algorithm)
        => new(ResolveDigest(algorithm));

    public static NodeHash HashUpdate(NodeHash hash, string data, string? inputEncoding = null)
        => (hash ?? throw new ArgumentNullException(nameof(hash))).Update(data, inputEncoding);

    public static NodeHash HashUpdate(NodeHash hash, NodeCryptoBytes data)
        => (hash ?? throw new ArgumentNullException(nameof(hash))).Update(data);

    public static NodeCryptoDigest HashDigest(NodeHash hash, string? encoding = null)
        => (hash ?? throw new ArgumentNullException(nameof(hash))).Digest(encoding);

    public static NodeHmac CreateHmac(string algorithm, string key, string? keyEncoding = null)
    {
        ArgumentNullException.ThrowIfNull(key);
        return new NodeHmac(ResolveDigest(algorithm), NodeCryptoEncoding.Decode(key, keyEncoding));
    }

    public static NodeHmac CreateHmac(string algorithm, NodeCryptoBytes key)
    {
        ArgumentNullException.ThrowIfNull(key);
        return new NodeHmac(ResolveDigest(algorithm), key.Span);
    }

    public static NodeHmac CreateHmac(string algorithm, NodeCryptoSecretKey key)
    {
        ArgumentNullException.ThrowIfNull(key);
        var material = key.CopyMaterial();
        try
        {
            return new NodeHmac(ResolveDigest(algorithm), material);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(material);
        }
    }

    public static NodeHmac HmacUpdate(NodeHmac hmac, string data, string? inputEncoding = null)
        => (hmac ?? throw new ArgumentNullException(nameof(hmac))).Update(data, inputEncoding);

    public static NodeHmac HmacUpdate(NodeHmac hmac, NodeCryptoBytes data)
        => (hmac ?? throw new ArgumentNullException(nameof(hmac))).Update(data);

    public static NodeCryptoDigest HmacDigest(NodeHmac hmac, string? encoding = null)
        => (hmac ?? throw new ArgumentNullException(nameof(hmac))).Digest(encoding);

    public static NodeCryptoBytes RandomBytes(int size)
    {
        if (size < 0) throw new ArgumentOutOfRangeException(nameof(size), "size must be non-negative");
        var bytes = new byte[size];
        RandomNumberGenerator.Fill(bytes);
        return new NodeCryptoBytes(bytes);
    }

    public static long RandomInt(long max) => RandomInt(0, max);

    public static long RandomInt(long min, long max)
    {
        if (min < -SafeIntegerMax || min > SafeIntegerMax)
            throw new ArgumentOutOfRangeException(nameof(min), "min must be a JavaScript safe integer");
        if (max < -SafeIntegerMax || max > SafeIntegerMax)
            throw new ArgumentOutOfRangeException(nameof(max), "max must be a JavaScript safe integer");
        if (max <= min) throw new ArgumentOutOfRangeException(nameof(max), "max must be greater than min");

        var range = (ulong)(max - min);
        if (range > RandomIntMaxRange)
            throw new ArgumentOutOfRangeException(nameof(max), "max - min must be less than 2^48");

        var limit = RandomIntDomain - (RandomIntDomain % range);
        Span<byte> bytes = stackalloc byte[6];
        ulong sample;
        do
        {
            RandomNumberGenerator.Fill(bytes);
            sample =
                ((ulong)bytes[0] << 40) |
                ((ulong)bytes[1] << 32) |
                ((ulong)bytes[2] << 24) |
                ((ulong)bytes[3] << 16) |
                ((ulong)bytes[4] << 8) |
                bytes[5];
        } while (sample >= limit);

        return min + (long)(sample % range);
    }

    public static string RandomUuid()
    {
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        bytes[6] = (byte)((bytes[6] & 0x0f) | 0x40);
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
        var hex = Convert.ToHexString(bytes).ToLowerInvariant();
        return $"{hex[..8]}-{hex[8..12]}-{hex[12..16]}-{hex[16..20]}-{hex[20..]}";
    }

    public static bool TimingSafeEqual(NodeCryptoBytes a, NodeCryptoBytes b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);
        if (a.Length != b.Length)
            throw new ArgumentException("Input buffers must have the same byte length");
        return CryptographicOperations.FixedTimeEquals(a.Span, b.Span);
    }

    public static NodeCryptoSecretKey CreateSecretKey(NodeCryptoBytes key)
    {
        ArgumentNullException.ThrowIfNull(key);
        return new NodeCryptoSecretKey(key.Span);
    }

    public static NodeCryptoSecretKey CreateSecretKey(string key, string? encoding = null)
    {
        ArgumentNullException.ThrowIfNull(key);
        return new NodeCryptoSecretKey(NodeCryptoEncoding.Decode(key, encoding));
    }

    public static NodeCryptoBytes ExportSecretKey(NodeCryptoSecretKey key)
        => (key ?? throw new ArgumentNullException(nameof(key))).Export();

    /// <summary>
    /// Cryptographic core for WebCrypto digest. This does not claim Promise,
    /// BufferSource snapshot, or microtask semantics; compiler planning keeps the
    /// WebCrypto surface fail-closed until those sibling contracts are proven.
    /// </summary>
    public static NodeCryptoBytes WebCryptoDigestCore(string algorithm, NodeCryptoBytes data)
    {
        ArgumentNullException.ThrowIfNull(data);
        var normalized = NormalizeAlgorithm(algorithm);
        if (normalized is not ("sha1" or "sha256" or "sha384" or "sha512"))
            throw new ArgumentException("WebCrypto digest supports SHA-1/SHA-256/SHA-384/SHA-512", nameof(algorithm));
        using var hash = CreateHash(algorithm);
        hash.Update(data);
        return hash.Digest().Bytes;
    }

    private static HashAlgorithmName ResolveDigest(string algorithm)
        => NormalizeAlgorithm(algorithm) switch
        {
            "md5" => HashAlgorithmName.MD5,
            "sha1" => HashAlgorithmName.SHA1,
            "sha256" => HashAlgorithmName.SHA256,
            "sha384" => HashAlgorithmName.SHA384,
            "sha512" => HashAlgorithmName.SHA512,
            _ => throw new ArgumentException("Digest method is not supported by the bounded .NET host contract", nameof(algorithm))
        };

    private static string NormalizeAlgorithm(string algorithm)
    {
        if (string.IsNullOrWhiteSpace(algorithm)) throw new ArgumentException("Algorithm is required", nameof(algorithm));
        return algorithm.Trim().ToLowerInvariant().Replace("-", string.Empty);
    }
}

internal static class NodeCryptoEncoding
{
    public static byte[] Decode(string value, string? encoding)
    {
        ArgumentNullException.ThrowIfNull(value);
        return Normalize(encoding) switch
        {
            "utf8" => Encoding.UTF8.GetBytes(value),
            "latin1" or "binary" => Encoding.Latin1.GetBytes(value),
            "hex" => Convert.FromHexString(value),
            "base64" => Convert.FromBase64String(PadBase64(value)),
            "base64url" => Convert.FromBase64String(PadBase64(value.Replace('-', '+').Replace('_', '/'))),
            _ => throw new ArgumentException("Unsupported Node crypto string encoding", nameof(encoding))
        };
    }

    public static NodeCryptoDigest AsDigest(ReadOnlySpan<byte> bytes, string? encoding)
    {
        if (encoding is null) return NodeCryptoDigest.FromBytes(new NodeCryptoBytes(bytes));
        var copy = bytes.ToArray();
        var text = Normalize(encoding) switch
        {
            "hex" => Convert.ToHexString(copy).ToLowerInvariant(),
            "base64" => Convert.ToBase64String(copy),
            "base64url" => Convert.ToBase64String(copy).TrimEnd('=').Replace('+', '-').Replace('/', '_'),
            "latin1" or "binary" => Encoding.Latin1.GetString(copy),
            _ => throw new ArgumentException("Unsupported Node crypto digest encoding", nameof(encoding))
        };
        return NodeCryptoDigest.FromString(text);
    }

    private static string Normalize(string? encoding)
    {
        if (encoding is null) return "utf8";
        var normalized = encoding.Trim().ToLowerInvariant();
        return normalized switch
        {
            "utf-8" => "utf8",
            "base64url" => "base64url",
            _ => normalized
        };
    }

    private static string PadBase64(string value)
    {
        var remainder = value.Length % 4;
        return remainder == 0 ? value : value + new string('=', 4 - remainder);
    }
}
