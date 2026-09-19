namespace J2cs.Runtime.ElectronCompat;

public enum DesktopClipboardType
{
    Clipboard,
    Selection,
}

public readonly record struct DesktopPoint(int X, int Y);

public readonly record struct DesktopRect(int X, int Y, int Width, int Height)
{
    public int Right => X + Width;
    public int Bottom => Y + Height;
}

public sealed record DesktopDisplay(
    long Id,
    DesktopRect Bounds,
    DesktopRect WorkArea,
    double ScaleFactor,
    int Rotation,
    bool Internal);

public sealed record DesktopMessageBoxOptions(
    IReadOnlyList<string> Buttons,
    string Message,
    int DefaultId = 0,
    int CancelId = 0,
    string? CheckboxLabel = null,
    bool CheckboxChecked = false);

public sealed record DesktopMessageBoxResult(int Response, bool CheckboxChecked);

public sealed record DesktopOpenDialogOptions(
    string? Title = null,
    string? DefaultPath = null,
    bool MultiSelections = false,
    bool OpenDirectory = false);

public sealed record DesktopOpenDialogResult(bool Canceled, IReadOnlyList<string> FilePaths);

public sealed record DesktopSaveDialogOptions(string? Title = null, string? DefaultPath = null);

public sealed record DesktopSaveDialogResult(bool Canceled, string? FilePath);

public enum DesktopIdleState
{
    Active,
    Idle,
    Locked,
    Unknown,
}

public enum DesktopPowerPolicy
{
    None,
    PreventAppSuspension,
    PreventDisplaySleep,
}

/// <summary>
/// Explicit desktop host boundary. The runtime never substitutes arbitrary .NET APIs
/// for Electron behavior: a platform integration must implement the capability.
/// </summary>
public interface IDesktopPlatformAdapter
{
    bool IsAppReady { get; }
    bool SupportsSelectionClipboard { get; }
    bool IsNotificationSupported { get; }

    long CreateTray(string image, string? guid);
    void SetTrayImage(long trayId, string image);
    void SetTrayToolTip(long trayId, string text);
    DesktopRect GetTrayBounds(long trayId);
    void SetTrayContextMenu(long trayId, long? menuId);
    void DestroyTray(long trayId);

    long CreateMenu();
    void UpdateMenu(long menuId, IReadOnlyList<DesktopMenuItem> items);
    void PopupMenu(long menuId);
    void SetApplicationMenu(long? menuId);

    void ShowNotification(long notificationId, string title, string body);
    void CloseNotification(long notificationId);

    string ReadClipboardText(DesktopClipboardType type);
    void WriteClipboardText(string text, DesktopClipboardType type);
    string ReadClipboardHtml(DesktopClipboardType type);
    void WriteClipboardHtml(string html, DesktopClipboardType type);
    IReadOnlyList<string> GetClipboardFormats(DesktopClipboardType type);
    void ClearClipboard(DesktopClipboardType type);

    Task<DesktopMessageBoxResult> ShowMessageBoxAsync(
        DesktopMessageBoxOptions options,
        CancellationToken cancellationToken);
    Task<DesktopOpenDialogResult> ShowOpenDialogAsync(
        DesktopOpenDialogOptions options,
        CancellationToken cancellationToken);
    Task<DesktopSaveDialogResult> ShowSaveDialogAsync(
        DesktopSaveDialogOptions options,
        CancellationToken cancellationToken);

    Task OpenExternalAsync(Uri uri, CancellationToken cancellationToken);
    Task<string> OpenPathAsync(string path, CancellationToken cancellationToken);
    Task TrashItemAsync(string path, CancellationToken cancellationToken);
    void ShowItemInFolder(string path);
    void Beep();

    bool RegisterGlobalShortcut(string accelerator, Action callback);
    void UnregisterGlobalShortcut(string accelerator);
    void UnregisterAllGlobalShortcuts();
    void SetGlobalShortcutsSuspended(bool suspended);

    bool RequestDefaultProtocolClient(string canonicalScheme);
    void SetDeepLinkHandler(Action<string> handler);

    DesktopDisplay GetPrimaryDisplay();
    IReadOnlyList<DesktopDisplay> GetAllDisplays();
    DesktopDisplay GetDisplayNearestPoint(DesktopPoint point);
    DesktopDisplay GetDisplayMatching(DesktopRect rectangle);
    DesktopPoint GetCursorScreenPoint();

    string ThemeSource { get; set; }
    bool ShouldUseDarkColors { get; }

    void SetPowerPolicy(DesktopPowerPolicy policy);
    bool IsOnBatteryPower();
    int GetSystemIdleTimeSeconds();
    DesktopIdleState GetSystemIdleState(int idleThresholdSeconds);
}

/// <summary>
/// Fail-closed adapter base. Unimplemented host capabilities throw instead of
/// silently approximating Electron behavior.
/// </summary>
public abstract class DesktopPlatformAdapterBase : IDesktopPlatformAdapter
{
    public virtual bool IsAppReady => false;
    public virtual bool SupportsSelectionClipboard => false;
    public virtual bool IsNotificationSupported => false;

    protected static PlatformNotSupportedException Missing(string capability)
        => new("Electron desktop host capability is unavailable: " + capability);

    public virtual long CreateTray(string image, string? guid) => throw Missing("tray.create");
    public virtual void SetTrayImage(long trayId, string image) => throw Missing("tray.setImage");
    public virtual void SetTrayToolTip(long trayId, string text) => throw Missing("tray.setToolTip");
    public virtual DesktopRect GetTrayBounds(long trayId) => throw Missing("tray.getBounds");
    public virtual void SetTrayContextMenu(long trayId, long? menuId) => throw Missing("tray.setContextMenu");
    public virtual void DestroyTray(long trayId) => throw Missing("tray.destroy");

    public virtual long CreateMenu() => throw Missing("menu.create");
    public virtual void UpdateMenu(long menuId, IReadOnlyList<DesktopMenuItem> items) => throw Missing("menu.update");
    public virtual void PopupMenu(long menuId) => throw Missing("menu.popup");
    public virtual void SetApplicationMenu(long? menuId) => throw Missing("menu.setApplicationMenu");

    public virtual void ShowNotification(long notificationId, string title, string body) => throw Missing("notification.show");
    public virtual void CloseNotification(long notificationId) => throw Missing("notification.close");

    public virtual string ReadClipboardText(DesktopClipboardType type) => throw Missing("clipboard.readText");
    public virtual void WriteClipboardText(string text, DesktopClipboardType type) => throw Missing("clipboard.writeText");
    public virtual string ReadClipboardHtml(DesktopClipboardType type) => throw Missing("clipboard.readHTML");
    public virtual void WriteClipboardHtml(string html, DesktopClipboardType type) => throw Missing("clipboard.writeHTML");
    public virtual IReadOnlyList<string> GetClipboardFormats(DesktopClipboardType type) => throw Missing("clipboard.availableFormats");
    public virtual void ClearClipboard(DesktopClipboardType type) => throw Missing("clipboard.clear");

    public virtual Task<DesktopMessageBoxResult> ShowMessageBoxAsync(
        DesktopMessageBoxOptions options,
        CancellationToken cancellationToken) => throw Missing("dialog.showMessageBox");

    public virtual Task<DesktopOpenDialogResult> ShowOpenDialogAsync(
        DesktopOpenDialogOptions options,
        CancellationToken cancellationToken) => throw Missing("dialog.showOpenDialog");

    public virtual Task<DesktopSaveDialogResult> ShowSaveDialogAsync(
        DesktopSaveDialogOptions options,
        CancellationToken cancellationToken) => throw Missing("dialog.showSaveDialog");

    public virtual Task OpenExternalAsync(Uri uri, CancellationToken cancellationToken) => throw Missing("shell.openExternal");
    public virtual Task<string> OpenPathAsync(string path, CancellationToken cancellationToken) => throw Missing("shell.openPath");
    public virtual Task TrashItemAsync(string path, CancellationToken cancellationToken) => throw Missing("shell.trashItem");
    public virtual void ShowItemInFolder(string path) => throw Missing("shell.showItemInFolder");
    public virtual void Beep() => throw Missing("shell.beep");

    public virtual bool RegisterGlobalShortcut(string accelerator, Action callback) => throw Missing("globalShortcut.register");
    public virtual void UnregisterGlobalShortcut(string accelerator) => throw Missing("globalShortcut.unregister");
    public virtual void UnregisterAllGlobalShortcuts() => throw Missing("globalShortcut.unregisterAll");
    public virtual void SetGlobalShortcutsSuspended(bool suspended) => throw Missing("globalShortcut.setSuspended");

    public virtual bool RequestDefaultProtocolClient(string canonicalScheme) => throw Missing("app.setAsDefaultProtocolClient");
    public virtual void SetDeepLinkHandler(Action<string> handler) => throw Missing("deep-link handler");

    public virtual DesktopDisplay GetPrimaryDisplay() => throw Missing("screen.getPrimaryDisplay");
    public virtual IReadOnlyList<DesktopDisplay> GetAllDisplays() => throw Missing("screen.getAllDisplays");
    public virtual DesktopDisplay GetDisplayNearestPoint(DesktopPoint point) => throw Missing("screen.getDisplayNearestPoint");
    public virtual DesktopDisplay GetDisplayMatching(DesktopRect rectangle) => throw Missing("screen.getDisplayMatching");
    public virtual DesktopPoint GetCursorScreenPoint() => throw Missing("screen.getCursorScreenPoint");

    public virtual string ThemeSource
    {
        get => throw Missing("nativeTheme.themeSource");
        set => throw Missing("nativeTheme.themeSource");
    }

    public virtual bool ShouldUseDarkColors => throw Missing("nativeTheme.shouldUseDarkColors");

    public virtual void SetPowerPolicy(DesktopPowerPolicy policy) => throw Missing("powerSaveBlocker");
    public virtual bool IsOnBatteryPower() => throw Missing("powerMonitor.isOnBatteryPower");
    public virtual int GetSystemIdleTimeSeconds() => throw Missing("powerMonitor.getSystemIdleTime");
    public virtual DesktopIdleState GetSystemIdleState(int idleThresholdSeconds) => throw Missing("powerMonitor.getSystemIdleState");
}
