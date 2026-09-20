using System.Text;

namespace J2cs.Runtime.NodeCompat;

public enum NodeUrlPlatformMode
{
    Posix,
    Windows,
}

public sealed class NodeUrlException : Exception
{
    public string Code { get; }

    public NodeUrlException(string code, string message) : base(message)
    {
        Code = code;
    }
}

public static class NodeUrl
{
    public static string FileUrlToPath(string value, NodeUrlPlatformMode platformMode)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
            throw new NodeUrlException("ERR_INVALID_URL", "Invalid URL.");

        if (!string.Equals(uri.Scheme, "file", StringComparison.OrdinalIgnoreCase))
            throw new NodeUrlException("ERR_INVALID_URL_SCHEME", "The URL must use the file: scheme.");

        string host = uri.Host;
        string rawPath = uri.AbsolutePath;

        if (ContainsEncodedSeparator(rawPath, platformMode))
            throw new NodeUrlException("ERR_INVALID_FILE_URL_PATH", "File URL path contains an encoded path separator.");

        string decodedPath = DecodeUtf8PercentEscapes(rawPath);

        if (platformMode == NodeUrlPlatformMode.Posix)
        {
            if (host.Length != 0 && !string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase))
                throw new NodeUrlException("ERR_INVALID_FILE_URL_HOST", "File URL host must be empty or localhost on POSIX.");
            return decodedPath;
        }

        if (host.Length != 0 && !string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase))
        {
            string uncPath = decodedPath.Replace('/', '\\');
            return "\\\\" + host + uncPath;
        }

        if (decodedPath.Length >= 3 && decodedPath[0] == '/' &&
            IsAsciiLetter(decodedPath[1]) && decodedPath[2] == ':')
            return decodedPath[1..].Replace('/', '\\');

        if (decodedPath.Length >= 2 && IsAsciiLetter(decodedPath[0]) && decodedPath[1] == ':')
            return decodedPath.Replace('/', '\\');

        throw new NodeUrlException("ERR_INVALID_FILE_URL_PATH", "Windows file URLs require an absolute drive path or UNC host.");
    }

    private static bool ContainsEncodedSeparator(string rawPath, NodeUrlPlatformMode platformMode)
    {
        for (int i = 0; i + 2 < rawPath.Length; i++)
        {
            if (rawPath[i] != '%') continue;
            int value = Hex(rawPath[i + 1]) * 16 + Hex(rawPath[i + 2]);
            if (value < 0) continue;
            if (value == 0x2f || (platformMode == NodeUrlPlatformMode.Windows && value == 0x5c))
                return true;
        }
        return false;
    }

    private static string DecodeUtf8PercentEscapes(string raw)
    {
        using var bytes = new MemoryStream();
        for (int i = 0; i < raw.Length;)
        {
            if (raw[i] == '%')
            {
                if (i + 2 >= raw.Length)
                    throw new NodeUrlException("ERR_INVALID_FILE_URL_PATH", "Invalid percent escape in file URL.");
                int high = Hex(raw[i + 1]);
                int low = Hex(raw[i + 2]);
                if (high < 0 || low < 0)
                    throw new NodeUrlException("ERR_INVALID_FILE_URL_PATH", "Invalid percent escape in file URL.");
                bytes.WriteByte((byte)((high << 4) | low));
                i += 3;
                continue;
            }

            int scalarLength = char.IsSurrogatePair(raw, i) ? 2 : 1;
            byte[] encoded;
            try
            {
                encoded = new UTF8Encoding(false, true).GetBytes(raw.Substring(i, scalarLength));
            }
            catch (EncoderFallbackException)
            {
                throw new NodeUrlException("ERR_INVALID_FILE_URL_PATH", "File URL path contains invalid Unicode.");
            }
            bytes.Write(encoded, 0, encoded.Length);
            i += scalarLength;
        }

        try
        {
            return new UTF8Encoding(false, true).GetString(bytes.ToArray());
        }
        catch (DecoderFallbackException)
        {
            throw new NodeUrlException("ERR_INVALID_FILE_URL_PATH", "File URL path contains invalid UTF-8.");
        }
    }

    private static int Hex(char value) =>
        value is >= '0' and <= '9' ? value - '0' :
        value is >= 'a' and <= 'f' ? value - 'a' + 10 :
        value is >= 'A' and <= 'F' ? value - 'A' + 10 : -1;

    private static bool IsAsciiLetter(char value) =>
        value is >= 'a' and <= 'z' or >= 'A' and <= 'Z';
}
