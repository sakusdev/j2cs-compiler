namespace J2cs.Runtime.NodeCompat;

public sealed record NodeFsReadFileOptions(NodeFsTextEncoding? Encoding, string Flag)
{
    public static NodeFsReadFileOptions BufferDefault { get; } = new(null, "r");

    public static NodeFsReadFileOptions FromEncoding(string encoding)
        => new(NodeFsEncodingCodec.Parse(encoding), "r");

    public static NodeFsReadFileOptions FromFlag(string flag, string? encoding = null)
        => new(encoding is null ? null : NodeFsEncodingCodec.Parse(encoding), flag);
}

public sealed record NodeFsWriteFileOptions(NodeFsTextEncoding Encoding, string Flag, bool Flush)
{
    public static NodeFsWriteFileOptions Default { get; } = new(NodeFsTextEncoding.Utf8, "w", false);

    public static NodeFsWriteFileOptions FromEncoding(string encoding)
        => new(NodeFsEncodingCodec.Parse(encoding), "w", false);

    public static NodeFsWriteFileOptions FromFlag(string flag, string encoding = "utf8", bool flush = false)
        => new(NodeFsEncodingCodec.Parse(encoding), flag, flush);
}
