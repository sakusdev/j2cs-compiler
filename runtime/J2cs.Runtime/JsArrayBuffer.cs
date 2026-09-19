namespace J2cs.Runtime;

/// <summary>
/// Fixed-length ArrayBuffer backing store for the independently testable BINARY lane.
/// Resizable/SharedArrayBuffer behavior remains fail-closed.
/// </summary>
public sealed class JsArrayBuffer
{
    private byte[]? bytes;

    internal JsArrayBuffer(int byteLength) => bytes = new byte[byteLength];

    public bool IsDetached => bytes is null;
    public int ByteLength => bytes?.Length ?? 0;

    public void Detach() => bytes = null;

    internal Span<byte> MutableBytes()
        => bytes is null ? throw JsBinary.TypeError("ArrayBuffer is detached.") : bytes.AsSpan();

    internal ReadOnlySpan<byte> ReadBytes()
        => bytes is null ? throw JsBinary.TypeError("ArrayBuffer is detached.") : bytes.AsSpan();
}
