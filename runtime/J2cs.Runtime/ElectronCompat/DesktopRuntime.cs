namespace J2cs.Runtime.ElectronCompat;

public sealed class DesktopRuntime
{
    private readonly IDesktopPlatformAdapter _platform;

    public DesktopRuntime(IDesktopPlatformAdapter platform)
    {
        ArgumentNullException.ThrowIfNull(platform);
        _platform = platform;
        Clipboard = new DesktopClipboard(platform);
        Dialog = new DesktopDialog(platform);
        Shell = new DesktopShell(platform);
        GlobalShortcut = new DesktopGlobalShortcut(platform);
        Protocol = new DesktopProtocol(platform);
        Screen = new DesktopScreen(platform);
        NativeTheme = new DesktopNativeTheme(platform);
        PowerSaveBlocker = new DesktopPowerSaveBlocker(platform);
        PowerMonitor = new DesktopPowerMonitor(platform);
        Menus = new DesktopMenuService(platform);
    }

    public DesktopClipboard Clipboard { get; }
    public DesktopDialog Dialog { get; }
    public DesktopShell Shell { get; }
    public DesktopGlobalShortcut GlobalShortcut { get; }
    public DesktopProtocol Protocol { get; }
    public DesktopScreen Screen { get; }
    public DesktopNativeTheme NativeTheme { get; }
    public DesktopPowerSaveBlocker PowerSaveBlocker { get; }
    public DesktopPowerMonitor PowerMonitor { get; }
    public DesktopMenuService Menus { get; }

    public DesktopTray CreateTray(string image, string? guid = null)
    {
        EnsureReady(_platform, "Tray");
        if (string.IsNullOrWhiteSpace(image)) throw new ArgumentException("Tray image must be non-empty.", nameof(image));
        return new DesktopTray(_platform, _platform.CreateTray(image, guid), image);
    }

    public DesktopNotification CreateNotification(string title, string body = "")
        => new(_platform, title, body);

    internal static void EnsureReady(IDesktopPlatformAdapter platform, string feature)
    {
        if (!platform.IsAppReady) {
            throw new InvalidOperationException(feature + " requires the Electron app-ready lifecycle state.");
        }
    }
}

public sealed class DesktopMenuItem
{
    public DesktopMenuItem(string? id, string label)
    {
        if (label is null) throw new ArgumentNullException(nameof(label));
        Id = id;
        Label = label;
    }

    public string? Id { get; }
    public string Label { get; }
}

public sealed class DesktopMenu
{
    private readonly IDesktopPlatformAdapter _platform;
    private readonly List<DesktopMenuItem> _items = [];

    internal DesktopMenu(IDesktopPlatformAdapter platform, long hostId)
    {
        _platform = platform;
        HostId = hostId;
    }

    internal long HostId { get; }
    public IReadOnlyList<DesktopMenuItem> Items => _items.AsReadOnly();

    public void Append(DesktopMenuItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        _items.Add(item);
        _platform.UpdateMenu(HostId, Items);
    }

    public void Insert(int position, DesktopMenuItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (position < 0 || position > _items.Count) throw new ArgumentOutOfRangeException(nameof(position));
        _items.Insert(position, item);
        _platform.UpdateMenu(HostId, Items);
    }

    public DesktopMenuItem? GetMenuItemById(string id)
    {
        if (id is null) throw new ArgumentNullException(nameof(id));
        return _items.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.Ordinal));
    }

    public void Popup() => _platform.PopupMenu(HostId);
}

public sealed class DesktopMenuService
{
    private readonly IDesktopPlatformAdapter _platform;
    private DesktopMenu? _applicationMenu;

    internal DesktopMenuService(IDesktopPlatformAdapter platform) => _platform = platform;

    public DesktopMenu Create() => new(_platform, _platform.CreateMenu());

    public void SetApplicationMenu(DesktopMenu? menu)
    {
        _platform.SetApplicationMenu(menu?.HostId);
        _applicationMenu = menu;
    }

    public DesktopMenu? GetApplicationMenu() => _applicationMenu;
}

public sealed class DesktopTray
{
    private readonly IDesktopPlatformAdapter _platform;
    private bool _destroyed;

    internal DesktopTray(IDesktopPlatformAdapter platform, long hostId, string image)
    {
        _platform = platform;
        HostId = hostId;
        Image = image;
    }

    internal long HostId { get; }
    public string Image { get; private set; }
    public string ToolTip { get; private set; } = "";
    public DesktopMenu? ContextMenu { get; private set; }
    public bool IsDestroyed => _destroyed;

    public void SetImage(string image)
    {
        EnsureLive();
        if (string.IsNullOrWhiteSpace(image)) throw new ArgumentException("Tray image must be non-empty.", nameof(image));
        _platform.SetTrayImage(HostId, image);
        Image = image;
    }

    public void SetToolTip(string text)
    {
        EnsureLive();
        if (text is null) throw new ArgumentNullException(nameof(text));
        _platform.SetTrayToolTip(HostId, text);
        ToolTip = text;
    }

    public DesktopRect GetBounds()
    {
        EnsureLive();
        return _platform.GetTrayBounds(HostId);
    }

    public void SetContextMenu(DesktopMenu? menu)
    {
        EnsureLive();
        _platform.SetTrayContextMenu(HostId, menu?.HostId);
        ContextMenu = menu;
    }

    public void Destroy()
    {
        if (_destroyed) return;
        _platform.DestroyTray(HostId);
        _destroyed = true;
        ContextMenu = null;
    }

    private void EnsureLive()
    {
        if (_destroyed) throw new InvalidOperationException("Tray host resource has been destroyed.");
    }
}

public sealed class DesktopNotification
{
    private static long _nextIdentity;
    private readonly IDesktopPlatformAdapter _platform;

    internal DesktopNotification(IDesktopPlatformAdapter platform, string title, string body)
    {
        if (title is null) throw new ArgumentNullException(nameof(title));
        if (body is null) throw new ArgumentNullException(nameof(body));
        _platform = platform;
        Identity = Interlocked.Increment(ref _nextIdentity);
        Title = title;
        Body = body;
    }

    public long Identity { get; }
    public string Title { get; }
    public string Body { get; }
    public int ShowCount { get; private set; }
    public bool Closed { get; private set; }

    public void Show()
    {
        if (!_platform.IsNotificationSupported) {
            throw new PlatformNotSupportedException("Desktop notifications are not supported by this host.");
        }
        _platform.ShowNotification(Identity, Title, Body);
        ShowCount++;
        Closed = false;
    }

    public void Close()
    {
        _platform.CloseNotification(Identity);
        Closed = true;
    }
}

public sealed class DesktopClipboard
{
    private readonly IDesktopPlatformAdapter _platform;

    internal DesktopClipboard(IDesktopPlatformAdapter platform) => _platform = platform;

    public string ReadText(DesktopClipboardType type = DesktopClipboardType.Clipboard)
    {
        ValidateType(type);
        return _platform.ReadClipboardText(type);
    }

    public void WriteText(string text, DesktopClipboardType type = DesktopClipboardType.Clipboard)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));
        ValidateType(type);
        _platform.WriteClipboardText(text, type);
    }

    public string ReadHtml(DesktopClipboardType type = DesktopClipboardType.Clipboard)
    {
        ValidateType(type);
        return _platform.ReadClipboardHtml(type);
    }

    public void WriteHtml(string html, DesktopClipboardType type = DesktopClipboardType.Clipboard)
    {
        if (html is null) throw new ArgumentNullException(nameof(html));
        ValidateType(type);
        _platform.WriteClipboardHtml(html, type);
    }

    public IReadOnlyList<string> AvailableFormats(DesktopClipboardType type = DesktopClipboardType.Clipboard)
    {
        ValidateType(type);
        return _platform.GetClipboardFormats(type);
    }

    public void Clear(DesktopClipboardType type = DesktopClipboardType.Clipboard)
    {
        ValidateType(type);
        _platform.ClearClipboard(type);
    }

    private void ValidateType(DesktopClipboardType type)
    {
        if (type == DesktopClipboardType.Selection && !_platform.SupportsSelectionClipboard) {
            throw new PlatformNotSupportedException(
                "Electron selection clipboard is distinct and cannot be silently aliased on this host.");
        }
    }
}
