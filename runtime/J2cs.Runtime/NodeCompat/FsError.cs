namespace J2cs.Runtime.NodeCompat;

public sealed class NodeFsException : IOException
{
    public string Code { get; }
    public string Syscall { get; }
    public string PathValue { get; }

    public NodeFsException(string code, string syscall, string path, string detail, Exception? inner = null)
        : base($"{code}: {detail}, {syscall} '{path}'", inner)
    {
        Code = code;
        Syscall = syscall;
        PathValue = path;
    }
}

public sealed class NodeFsArgumentException : ArgumentException
{
    public string Code { get; }

    public NodeFsArgumentException(string code, string message, string? paramName = null)
        : base(message, paramName)
    {
        Code = code;
    }
}

public sealed class NodeFsAbortException : OperationCanceledException
{
    public string Name => "AbortError";
    public string Code => "ABORT_ERR";

    public NodeFsAbortException(CancellationToken token, Exception? inner = null)
        : base("The operation was aborted.", inner, token)
    {
    }
}
