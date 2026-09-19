namespace J2cs.Runtime.NodeCompat;

public sealed class NodeFsBuffer
{
    private readonly byte[] bytes;

    public NodeFsBuffer(ReadOnlySpan<byte> value) => bytes = value.ToArray();

    public int Length => bytes.Length;
    public ReadOnlySpan<byte> Span => bytes;
    internal ReadOnlyMemory<byte> Memory => bytes;

    public byte[] ToArray() => bytes.ToArray();

    public string Decode(NodeFsTextEncoding encoding) => NodeFsEncodingCodec.Decode(bytes, encoding);
}

public sealed class NodeFsReadResult
{
    private readonly NodeFsBuffer? buffer;
    private readonly string? text;

    private NodeFsReadResult(NodeFsBuffer buffer)
    {
        this.buffer = buffer;
        IsBuffer = true;
    }

    private NodeFsReadResult(string text)
    {
        this.text = text;
        IsBuffer = false;
    }

    public bool IsBuffer { get; }

    public NodeFsBuffer Buffer => IsBuffer
        ? buffer!
        : throw new InvalidOperationException("Node fs read result is a string.");

    public string Text => !IsBuffer
        ? text!
        : throw new InvalidOperationException("Node fs read result is a Buffer.");

    internal static NodeFsReadResult FromBuffer(byte[] bytes) => new(new NodeFsBuffer(bytes));
    internal static NodeFsReadResult FromString(string text) => new(text);
}
