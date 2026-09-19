namespace J2cs.Runtime.ElectronCompat;

public sealed class BrowserWindowOptions
{
    public int Width { get; init; } = 800;
    public int Height { get; init; } = 600;
    public int X { get; init; }
    public int Y { get; init; }
    public bool Show { get; init; } = true;
}

public readonly record struct WindowBounds(int X, int Y, int Width, int Height);

public sealed class BrowserWindowClosingEventArgs : EventArgs
{
    public bool IsDefaultPrevented { get; private set; }
    public void PreventDefault() => IsDefaultPrevented = true;
}

public interface IBrowserWindowHostFactory
{
    IBrowserWindowHost Create(BrowserWindowOptions options);
}

public interface IBrowserWindowHost : IDisposable
{
    IWebContentsHost? WebContents { get; }
    WindowBounds GetBounds();
    void SetBounds(WindowBounds bounds);
    void Show();
    void Hide();
    void Focus();
    void Blur();
    bool TryClose();
    void Destroy();
}

/// <summary>
/// Identity-bearing BrowserWindow wrapper. Native window lifetime and renderer
/// lifetime stay distinct: hiding never destroys, close is cancelable, and destroy
/// deliberately bypasses close/unload prevention.
/// </summary>
public sealed class BrowserWindow
{
    private static readonly object RegistryGate = new();
    private static readonly List<BrowserWindow> Windows = new();
    private static BrowserWindow? focusedWindow;

    private readonly IBrowserWindowHost host;
    private bool destroyed;
    private bool visible;
    private bool focused;

    private BrowserWindow(IBrowserWindowHost host, BrowserWindowOptions options)
    {
        this.host = host;
        visible = options.Show;
        WebContents = new WebContents(this, host.WebContents);
    }

    public WebContents WebContents { get; }

    public event EventHandler<BrowserWindowClosingEventArgs>? Closing;
    public event EventHandler? Closed;
    public event EventHandler? Shown;
    public event EventHandler? Hidden;
    public event EventHandler? Focused;
    public event EventHandler? Blurred;

    public static BrowserWindow Create(BrowserWindowOptions? options = null)
    {
        if (!App.IsReady)
            throw new ElectronCompatibilityException("BrowserWindow cannot be constructed before app readiness.");

        options ??= new BrowserWindowOptions();
        ValidateSize(options.Width, options.Height);
        var native = ElectronRuntime.Current.Windows.Create(options)
            ?? throw new ElectronCompatibilityException("Native window backend returned no window host.");
        var window = new BrowserWindow(native, options);
        lock (RegistryGate) Windows.Add(window);
        return window;
    }

    public static IReadOnlyList<BrowserWindow> GetAllWindows()
    {
        lock (RegistryGate) return Windows.Where(window => !window.destroyed).ToArray();
    }

    public static BrowserWindow? GetFocusedWindow()
    {
        lock (RegistryGate)
            return focusedWindow is { destroyed: false } ? focusedWindow : null;
    }

    public bool IsDestroyed() => destroyed;
    public bool IsVisible() => !destroyed && visible;
    public bool IsFocused() => !destroyed && focused;

    public WindowBounds GetBounds()
    {
        EnsureAlive();
        return host.GetBounds();
    }

    public void SetBounds(WindowBounds bounds)
    {
        EnsureAlive();
        ValidateSize(bounds.Width, bounds.Height);
        host.SetBounds(bounds);
    }

    public void SetSize(int width, int height)
    {
        EnsureAlive();
        ValidateSize(width, height);
        var current = host.GetBounds();
        host.SetBounds(new WindowBounds(current.X, current.Y, width, height));
    }

    public void Show()
    {
        EnsureAlive();
        host.Show();
        visible = true;
        Shown?.Invoke(this, EventArgs.Empty);

        host.Focus();
        SetFocused(true);
    }

    public void Hide()
    {
        EnsureAlive();
        host.Hide();
        visible = false;
        if (focused) SetFocused(false);
        Hidden?.Invoke(this, EventArgs.Empty);
    }

    public void Focus()
    {
        EnsureAlive();
        host.Focus();
        SetFocused(true);
    }

    public void Blur()
    {
        EnsureAlive();
        host.Blur();
        SetFocused(false);
    }

    public Task LoadUrlAsync(string url, CancellationToken cancellationToken = default)
        => WebContents.LoadUrlAsync(url, cancellationToken);

    public Task LoadFileAsync(string filePath, CancellationToken cancellationToken = default)
        => WebContents.LoadFileAsync(filePath, cancellationToken);

    public void Close() => CloseCore();

    public void Destroy()
    {
        if (destroyed) return;
        host.Destroy();
        CompleteDestroyed();
    }

    internal static bool CloseAllForQuit()
    {
        BrowserWindow[] snapshot;
        lock (RegistryGate) snapshot = Windows.Where(window => !window.destroyed).ToArray();
        foreach (var window in snapshot)
            if (!window.CloseCore()) return false;
        return true;
    }

    internal static void DestroyAllForExit()
    {
        BrowserWindow[] snapshot;
        lock (RegistryGate) snapshot = Windows.Where(window => !window.destroyed).ToArray();
        foreach (var window in snapshot) window.Destroy();
    }

    internal void EnsureAlive()
    {
        if (destroyed) throw new ElectronCompatibilityException("BrowserWindow is destroyed.");
    }

    private bool CloseCore()
    {
        if (destroyed) return true;

        var closing = new BrowserWindowClosingEventArgs();
        Closing?.Invoke(this, closing);
        if (closing.IsDefaultPrevented) return false;
        if (!WebContents.CanUnload()) return false;
        if (!host.TryClose()) return false;

        CompleteDestroyed();
        return true;
    }

    private void CompleteDestroyed()
    {
        if (destroyed) return;
        destroyed = true;
        visible = false;
        WebContents.MarkDestroyed();

        lock (RegistryGate)
        {
            Windows.Remove(this);
            if (ReferenceEquals(focusedWindow, this)) focusedWindow = null;
        }
        focused = false;
        host.Dispose();
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private void SetFocused(bool value)
    {
        if (focused == value)
        {
            if (value)
            {
                lock (RegistryGate) focusedWindow = this;
            }
            return;
        }

        focused = value;
        lock (RegistryGate)
        {
            if (value) focusedWindow = this;
            else if (ReferenceEquals(focusedWindow, this)) focusedWindow = null;
        }

        if (value) Focused?.Invoke(this, EventArgs.Empty);
        else Blurred?.Invoke(this, EventArgs.Empty);
    }

    private static void ValidateSize(int width, int height)
    {
        if (width <= 0 || height <= 0)
            throw new ArgumentOutOfRangeException(nameof(width), "Window width and height must be positive.");
    }
}
