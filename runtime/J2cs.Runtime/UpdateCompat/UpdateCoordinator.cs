namespace J2cs.Runtime.UpdateCompat;

public enum UpdateHostPlatform { Windows, MacOS, Linux }
public enum WindowsPackageKind { Msix, Squirrel }
public enum UpdateMechanism { None, Msix, Squirrel, SquirrelMac }
public enum UpdateState
{
    Idle,
    FeedConfigured,
    Checking,
    Available,
    Downloaded,
    InstallRequested,
    Failed,
    RollbackRequested
}
public enum UpdateHostActionKind
{
    CheckForUpdates,
    PersistDownloadedUpdate,
    QuitAndInstall,
    Rollback
}

public sealed record UpdateHostAction(
    UpdateHostActionKind Kind,
    UpdateMechanism Mechanism,
    string Channel,
    Uri? FeedUri,
    string? Version);

public sealed record UpdateTraceEvent(int Sequence, string Name, string? Detail);

/// <summary>
/// Models updater ordering and platform preconditions without pretending to perform
/// network, signing, process restart, installer, or rollback work. The host must
/// execute returned actions and report resulting state transitions explicitly.
/// </summary>
public sealed class UpdateCoordinator
{
    private readonly List<UpdateTraceEvent> trace = new();
    private int sequence;

    public UpdateHostPlatform Platform { get; }
    public WindowsPackageKind? WindowsPackaging { get; }
    public bool SignedApplication { get; }
    public string Channel { get; }
    public UpdateState State { get; private set; } = UpdateState.Idle;
    public Uri? FeedUri { get; private set; }
    public string? CandidateVersion { get; private set; }
    public string? DownloadedVersion { get; private set; }
    public string? RollbackVersion { get; private set; }
    public IReadOnlyList<UpdateTraceEvent> Trace => trace;

    public UpdateCoordinator(
        UpdateHostPlatform platform,
        WindowsPackageKind? windowsPackaging,
        bool signedApplication,
        string channel)
    {
        if (string.IsNullOrWhiteSpace(channel)) throw new ArgumentException("Update channel must be non-empty.", nameof(channel));
        if (platform != UpdateHostPlatform.Windows && windowsPackaging is not null)
            throw new ArgumentException("Windows packaging is only valid for the Windows updater.", nameof(windowsPackaging));
        Platform = platform;
        WindowsPackaging = windowsPackaging;
        SignedApplication = signedApplication;
        Channel = channel;
    }

    public UpdateMechanism Mechanism => Platform switch
    {
        UpdateHostPlatform.Windows => WindowsPackaging switch
        {
            WindowsPackageKind.Msix => UpdateMechanism.Msix,
            WindowsPackageKind.Squirrel => UpdateMechanism.Squirrel,
            null => UpdateMechanism.None,
            _ => throw new InvalidOperationException("Unknown Windows packaging kind.")
        },
        UpdateHostPlatform.MacOS => UpdateMechanism.SquirrelMac,
        UpdateHostPlatform.Linux => UpdateMechanism.None,
        _ => throw new InvalidOperationException("Unknown update host platform.")
    };

    public void SetFeedUrl(Uri feedUri)
    {
        EnsureHostPreconditions();
        ArgumentNullException.ThrowIfNull(feedUri);
        if (!feedUri.IsAbsoluteUri) throw new ArgumentException("Updater feed URI must be absolute.", nameof(feedUri));
        if (State is not (UpdateState.Idle or UpdateState.FeedConfigured))
            throw new InvalidOperationException($"Cannot configure updater feed while state is {State}.");
        FeedUri = feedUri;
        State = UpdateState.FeedConfigured;
        Append("set-feed-url", feedUri.AbsoluteUri);
    }

    public UpdateHostAction BeginCheck()
    {
        EnsureHostPreconditions();
        if (FeedUri is null) throw new InvalidOperationException("Updater feed must be configured before checking.");
        if (State != UpdateState.FeedConfigured)
            throw new InvalidOperationException($"Cannot check for updates while state is {State}.");
        State = UpdateState.Checking;
        Append("check-for-updates", null);
        return new UpdateHostAction(UpdateHostActionKind.CheckForUpdates, Mechanism, Channel, FeedUri, null);
    }

    public void MarkUpdateAvailable(string version)
    {
        if (State != UpdateState.Checking)
            throw new InvalidOperationException($"Cannot report an available update while state is {State}.");
        CandidateVersion = NormalizeVersion(version);
        State = UpdateState.Available;
        Append("update-available", CandidateVersion);
    }

    public void MarkUpdateDownloaded(string version)
    {
        if (State != UpdateState.Available)
            throw new InvalidOperationException($"Cannot report a downloaded update while state is {State}.");
        var normalized = NormalizeVersion(version);
        if (!StringComparer.Ordinal.Equals(CandidateVersion, normalized))
            throw new InvalidOperationException("Downloaded version must match the previously reported candidate version.");
        DownloadedVersion = normalized;
        State = UpdateState.Downloaded;
        Append("update-downloaded", normalized);
    }

    public UpdateHostAction PersistDownloadedForNextLaunch()
    {
        EnsureHostPreconditions();
        if (State != UpdateState.Downloaded || DownloadedVersion is null)
            throw new InvalidOperationException("Only a downloaded update can be persisted for a later launch.");
        Append("persist-downloaded-update", DownloadedVersion);
        return new UpdateHostAction(
            UpdateHostActionKind.PersistDownloadedUpdate,
            Mechanism,
            Channel,
            FeedUri,
            DownloadedVersion);
    }

    public UpdateHostAction RequestQuitAndInstall()
    {
        EnsureHostPreconditions();
        if (State != UpdateState.Downloaded || DownloadedVersion is null)
            throw new InvalidOperationException("quit-and-install requires a downloaded update.");
        State = UpdateState.InstallRequested;
        Append("quit-and-install", DownloadedVersion);
        return new UpdateHostAction(
            UpdateHostActionKind.QuitAndInstall,
            Mechanism,
            Channel,
            FeedUri,
            DownloadedVersion);
    }

    public void RecordRollbackPoint(string version)
    {
        RollbackVersion = NormalizeVersion(version);
        Append("rollback-point", RollbackVersion);
    }

    public UpdateHostAction RequestRollback(string version)
    {
        EnsureHostPreconditions();
        var normalized = NormalizeVersion(version);
        if (RollbackVersion is null || !StringComparer.Ordinal.Equals(RollbackVersion, normalized))
            throw new InvalidOperationException("Rollback is allowed only to the explicitly retained rollback point.");
        State = UpdateState.RollbackRequested;
        Append("rollback", normalized);
        return new UpdateHostAction(UpdateHostActionKind.Rollback, Mechanism, Channel, FeedUri, normalized);
    }

    public void MarkFailure(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) throw new ArgumentException("Failure code must be non-empty.", nameof(code));
        State = UpdateState.Failed;
        Append("error", code);
    }

    private void EnsureHostPreconditions()
    {
        if (Platform == UpdateHostPlatform.Linux)
            throw new PlatformNotSupportedException("Electron built-in autoUpdater has no Linux implementation; a separate host updater is required.");
        if (Platform == UpdateHostPlatform.MacOS && !SignedApplication)
            throw new InvalidOperationException("macOS automatic updates require a signed application.");
        if (Platform == UpdateHostPlatform.Windows && WindowsPackaging is null)
            throw new InvalidOperationException("Windows updater mechanism must be selected from package type (MSIX or Squirrel).");
    }

    private static string NormalizeVersion(string version)
    {
        if (string.IsNullOrWhiteSpace(version)) throw new ArgumentException("Version must be non-empty.", nameof(version));
        return version.Trim();
    }

    private void Append(string name, string? detail)
        => trace.Add(new UpdateTraceEvent(++sequence, name, detail));
}
