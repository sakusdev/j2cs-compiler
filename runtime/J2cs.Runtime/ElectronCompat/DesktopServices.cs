namespace J2cs.Runtime.ElectronCompat;

public sealed class DesktopDialog
{
    private readonly IDesktopPlatformAdapter _platform;

    internal DesktopDialog(IDesktopPlatformAdapter platform) => _platform = platform;

    public Task<DesktopMessageBoxResult> ShowMessageBoxAsync(
        DesktopMessageBoxOptions options,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return _platform.ShowMessageBoxAsync(options, cancellationToken);
    }

    public Task<DesktopOpenDialogResult> ShowOpenDialogAsync(
        DesktopOpenDialogOptions options,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return _platform.ShowOpenDialogAsync(options, cancellationToken);
    }

    public Task<DesktopSaveDialogResult> ShowSaveDialogAsync(
        DesktopSaveDialogOptions options,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return _platform.ShowSaveDialogAsync(options, cancellationToken);
    }
}

public sealed class DesktopShell
{
    private readonly IDesktopPlatformAdapter _platform;

    internal DesktopShell(IDesktopPlatformAdapter platform) => _platform = platform;

    public Task OpenExternalAsync(Uri uri, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!uri.IsAbsoluteUri) throw new ArgumentException("External URL must be absolute.", nameof(uri));
        return _platform.OpenExternalAsync(uri, cancellationToken);
    }

    public Task<string> OpenPathAsync(string path, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Path must be non-empty.", nameof(path));
        return _platform.OpenPathAsync(path, cancellationToken);
    }

    public Task TrashItemAsync(string path, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Path must be non-empty.", nameof(path));
        return _platform.TrashItemAsync(path, cancellationToken);
    }

    public void ShowItemInFolder(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Path must be non-empty.", nameof(path));
        _platform.ShowItemInFolder(path);
    }

    public void Beep() => _platform.Beep();
}

public sealed class DesktopGlobalShortcut
{
    private readonly IDesktopPlatformAdapter _platform;
    private readonly Dictionary<string, Action> _registrations = new(StringComparer.Ordinal);

    internal DesktopGlobalShortcut(IDesktopPlatformAdapter platform) => _platform = platform;

    public bool Register(string accelerator, Action callback)
    {
        DesktopRuntime.EnsureReady(_platform, "globalShortcut");
        if (string.IsNullOrWhiteSpace(accelerator)) throw new ArgumentException("Accelerator must be non-empty.", nameof(accelerator));
        ArgumentNullException.ThrowIfNull(callback);
        if (_registrations.ContainsKey(accelerator)) return false;
        if (!_platform.RegisterGlobalShortcut(accelerator, callback)) return false;
        _registrations.Add(accelerator, callback);
        return true;
    }

    public bool IsRegistered(string accelerator)
    {
        if (accelerator is null) throw new ArgumentNullException(nameof(accelerator));
        return _registrations.ContainsKey(accelerator);
    }

    public void Unregister(string accelerator)
    {
        if (accelerator is null) throw new ArgumentNullException(nameof(accelerator));
        if (!_registrations.Remove(accelerator)) return;
        _platform.UnregisterGlobalShortcut(accelerator);
    }

    public void UnregisterAll()
    {
        _platform.UnregisterAllGlobalShortcuts();
        _registrations.Clear();
    }

    public void SetSuspended(bool suspended) => _platform.SetGlobalShortcutsSuspended(suspended);
}

public sealed class DesktopProtocol
{
    private readonly IDesktopPlatformAdapter _platform;
    private event Action<string>? _deepLinkReceived;

    internal DesktopProtocol(IDesktopPlatformAdapter platform)
    {
        _platform = platform;
        _platform.SetDeepLinkHandler(DispatchDeepLink);
    }

    public event Action<string> DeepLinkReceived
    {
        add => _deepLinkReceived += value;
        remove => _deepLinkReceived -= value;
    }

    public static string ValidateSchemeName(string scheme)
    {
        if (string.IsNullOrEmpty(scheme) || !IsAsciiLetter(scheme[0])) {
            throw new ArgumentException("Scheme must start with an ASCII letter.", nameof(scheme));
        }
        for (var index = 1; index < scheme.Length; index++) {
            var c = scheme[index];
            if (!IsAsciiLetter(c) && !char.IsAsciiDigit(c) && c != '+' && c != '.' && c != '-') {
                throw new ArgumentException("Scheme contains an invalid character.", nameof(scheme));
            }
        }
        return scheme.ToLowerInvariant();
    }

    public bool RequestDefaultProtocolClient(string scheme)
        => _platform.RequestDefaultProtocolClient(ValidateSchemeName(scheme));

    private void DispatchDeepLink(string url)
    {
        if (url is null) throw new ArgumentNullException(nameof(url));
        _deepLinkReceived?.Invoke(url);
    }

    private static bool IsAsciiLetter(char c)
        => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

public sealed class DesktopScreen
{
    private readonly IDesktopPlatformAdapter _platform;

    internal DesktopScreen(IDesktopPlatformAdapter platform) => _platform = platform;

    public DesktopDisplay GetPrimaryDisplay()
    {
        DesktopRuntime.EnsureReady(_platform, "screen");
        return _platform.GetPrimaryDisplay();
    }

    public IReadOnlyList<DesktopDisplay> GetAllDisplays()
    {
        DesktopRuntime.EnsureReady(_platform, "screen");
        return _platform.GetAllDisplays();
    }

    public DesktopDisplay GetDisplayNearestPoint(DesktopPoint point)
    {
        DesktopRuntime.EnsureReady(_platform, "screen");
        return _platform.GetDisplayNearestPoint(point);
    }

    public DesktopDisplay GetDisplayMatching(DesktopRect rectangle)
    {
        DesktopRuntime.EnsureReady(_platform, "screen");
        return _platform.GetDisplayMatching(rectangle);
    }

    public DesktopPoint GetCursorScreenPoint()
    {
        DesktopRuntime.EnsureReady(_platform, "screen");
        return _platform.GetCursorScreenPoint();
    }
}

public sealed class DesktopNativeTheme
{
    private readonly IDesktopPlatformAdapter _platform;

    internal DesktopNativeTheme(IDesktopPlatformAdapter platform) => _platform = platform;

    public string ThemeSource => _platform.ThemeSource;
    public bool ShouldUseDarkColors => _platform.ShouldUseDarkColors;

    public string SetThemeSource(string source)
    {
        if (source is not ("system" or "light" or "dark")) {
            throw new ArgumentOutOfRangeException(nameof(source), source, "themeSource must be system, light, or dark.");
        }
        _platform.ThemeSource = source;
        return source;
    }
}
