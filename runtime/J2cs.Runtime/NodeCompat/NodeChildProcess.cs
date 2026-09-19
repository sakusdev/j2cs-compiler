using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace J2cs.Runtime.NodeCompat;

public sealed record NodeProcessError(string Code, string Message);

public sealed record NodeSpawnSyncResult(
    int? Status,
    string? Signal,
    string Stdout,
    string Stderr,
    NodeProcessError? Error);

public sealed class NodeSpawnOptions
{
    public string? WorkingDirectory { get; init; }
    public IReadOnlyDictionary<string, string>? Environment { get; init; }
}

public static class NodeChildProcess
{
    public static NodeSpawnAttempt StartPiped(
        string command,
        IReadOnlyList<string>? arguments = null,
        NodeSpawnOptions? options = null)
    {
        if (string.IsNullOrEmpty(command))
            return new NodeSpawnAttempt(null, new NodeProcessError("ENOENT", "Command must not be empty."));

        var process = new Process { StartInfo = BuildStartInfo(command, arguments, options) };
        try
        {
            if (!process.Start())
            {
                process.Dispose();
                return new NodeSpawnAttempt(null, new NodeProcessError("E_START", "Host process API did not start the child."));
            }
            return new NodeSpawnAttempt(new NodeChildProcessHandle(process), null);
        }
        catch (Exception error) when (IsExpectedStartFailure(error))
        {
            process.Dispose();
            return new NodeSpawnAttempt(null, MapStartError(error));
        }
    }

    public static NodeSpawnSyncResult SpawnSync(
        string command,
        IReadOnlyList<string>? arguments = null,
        NodeSpawnOptions? options = null)
    {
        var attempt = StartPiped(command, arguments, options);
        if (!attempt.IsSuccess)
            return new NodeSpawnSyncResult(null, null, string.Empty, string.Empty, attempt.Error);

        using var child = attempt.Handle!;
        child.Stdin.Close();
        var stdout = child.Stdout.ReadToEndAsync();
        var stderr = child.Stderr.ReadToEndAsync();
        var status = child.WaitForExitAsync().GetAwaiter().GetResult();
        Task.WhenAll(stdout, stderr).GetAwaiter().GetResult();
        return new NodeSpawnSyncResult(status, null, stdout.Result, stderr.Result, null);
    }

    private static ProcessStartInfo BuildStartInfo(
        string command,
        IReadOnlyList<string>? arguments,
        NodeSpawnOptions? options)
    {
        var start = new ProcessStartInfo
        {
            FileName = command,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
        };

        if (arguments is not null)
            foreach (var argument in arguments)
                start.ArgumentList.Add(argument);

        if (options?.WorkingDirectory is not null)
            start.WorkingDirectory = options.WorkingDirectory;

        if (options?.Environment is not null)
        {
            start.Environment.Clear();
            foreach (var pair in options.Environment)
                start.Environment[pair.Key] = pair.Value;
        }

        return start;
    }

    private static bool IsExpectedStartFailure(Exception error)
        => error is Win32Exception or DirectoryNotFoundException or FileNotFoundException or UnauthorizedAccessException;

    private static NodeProcessError MapStartError(Exception error) => error switch
    {
        DirectoryNotFoundException or FileNotFoundException => new("ENOENT", error.Message),
        UnauthorizedAccessException => new("EACCES", error.Message),
        Win32Exception win32 when win32.NativeErrorCode is 2 or 3 => new("ENOENT", win32.Message),
        Win32Exception win32 when win32.NativeErrorCode is 5 or 13 => new("EACCES", win32.Message),
        _ => new("E_START", error.Message),
    };
}
