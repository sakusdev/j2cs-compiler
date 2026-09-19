namespace J2cs.Runtime.ElectronCompat;

/// <summary>
/// Raised when translated Electron behavior needs a host capability that was not
/// explicitly configured. Missing host integration fails closed rather than
/// falling back to an unrelated .NET API.
/// </summary>
public sealed class ElectronCompatibilityException : InvalidOperationException
{
    public ElectronCompatibilityException(string message) : base(message) { }
    public ElectronCompatibilityException(string message, Exception innerException) : base(message, innerException) { }
}

public interface IElectronApplicationHost
{
    bool IsReady { get; }
    Task WhenReadyAsync(CancellationToken cancellationToken = default);
    void Quit();
    void Exit(int exitCode);
}

public interface IElectronHost
{
    IElectronApplicationHost Application { get; }
    IBrowserWindowHostFactory Windows { get; }
}

/// <summary>
/// Process-wide Electron host boundary. The compiler must prove the Electron main
/// profile before emitted code may reference this service.
/// </summary>
public static class ElectronRuntime
{
    private static IElectronHost? current;

    public static IElectronHost Current
        => Volatile.Read(ref current)
            ?? throw new ElectronCompatibilityException(
                "Electron host is not configured. Electron lowering must remain fail-closed.");

    public static void Configure(IElectronHost host)
    {
        ArgumentNullException.ThrowIfNull(host);
        if (Interlocked.CompareExchange(ref current, host, null) is not null)
            throw new ElectronCompatibilityException("Electron host is already configured for this process.");
    }
}
