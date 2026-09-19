using System.Diagnostics;

namespace J2cs.Runtime.NodeCompat;

public sealed class NodeChildProcessHandle : IDisposable
{
    private readonly Process process;

    internal NodeChildProcessHandle(Process process) => this.process = process;

    public StreamWriter Stdin => process.StandardInput;
    public StreamReader Stdout => process.StandardOutput;
    public StreamReader Stderr => process.StandardError;
    public int ProcessId => process.Id;
    public int? ExitCode => process.HasExited ? process.ExitCode : null;

    public async Task<int> WaitForExitAsync(CancellationToken cancellationToken = default)
    {
        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        return process.ExitCode;
    }

    public bool Kill(bool entireProcessTree = false)
    {
        if (process.HasExited) return false;
        try
        {
            process.Kill(entireProcessTree);
            return true;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    public void Dispose() => process.Dispose();
}

public sealed record NodeSpawnAttempt(NodeChildProcessHandle? Handle, NodeProcessError? Error)
{
    public bool IsSuccess => Handle is not null;
}
