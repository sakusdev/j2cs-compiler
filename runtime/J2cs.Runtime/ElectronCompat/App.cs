namespace J2cs.Runtime.ElectronCompat;

public sealed class AppQuitEventArgs : EventArgs
{
    public bool IsDefaultPrevented { get; private set; }
    public void PreventDefault() => IsDefaultPrevented = true;
}

/// <summary>
/// Electron app lifecycle compatibility surface. Readiness and quit operations are
/// backed by the same configured host state; graceful quit remains cancelable.
/// </summary>
public static class App
{
    public static event EventHandler<AppQuitEventArgs>? BeforeQuit;
    public static event EventHandler? WillQuit;

    public static bool IsReady => ElectronRuntime.Current.Application.IsReady;

    public static Task WhenReadyAsync(CancellationToken cancellationToken = default)
        => ElectronRuntime.Current.Application.WhenReadyAsync(cancellationToken);

    public static void Quit()
    {
        var before = new AppQuitEventArgs();
        BeforeQuit?.Invoke(null, before);
        if (before.IsDefaultPrevented) return;

        if (!BrowserWindow.CloseAllForQuit()) return;

        WillQuit?.Invoke(null, EventArgs.Empty);
        ElectronRuntime.Current.Application.Quit();
    }

    /// <summary>
    /// Immediate process-exit boundary. Unlike Quit, this deliberately bypasses
    /// cancelable window/unload hooks, matching the semantic distinction in Electron.
    /// </summary>
    public static void Exit(int exitCode = 0)
    {
        BrowserWindow.DestroyAllForExit();
        ElectronRuntime.Current.Application.Exit(exitCode);
    }
}
