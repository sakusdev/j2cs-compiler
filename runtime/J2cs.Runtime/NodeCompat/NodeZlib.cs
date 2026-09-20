using System.IO.Compression;
using System.Text;

namespace J2cs.Runtime.NodeCompat;

public static class NodeZlib
{
    public static byte[] SyncGzipSync(string input) =>
        SyncGzipSync(Encoding.UTF8.GetBytes(input ?? throw new ArgumentNullException(nameof(input))));

    public static byte[] SyncGzipSync(byte[] input)
    {
        ArgumentNullException.ThrowIfNull(input);
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
            gzip.Write(input, 0, input.Length);
        return output.ToArray();
    }

    public static byte[] SyncGunzipSync(byte[] input)
    {
        ArgumentNullException.ThrowIfNull(input);
        using var source = new MemoryStream(input, writable: false);
        using var gzip = new GZipStream(source, CompressionMode.Decompress);
        using var output = new MemoryStream();
        gzip.CopyTo(output);
        return output.ToArray();
    }
}
