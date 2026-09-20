using System.Text;

namespace J2cs.Runtime.ElectronCompat;

public sealed class SessionContractException : Exception
{
    public SessionContractException(string name, string message) : base(message) => Name = name;
    public string Name { get; }
}

public sealed record ElectronSessionOptions(bool CacheEnabled = true);

public interface IElectronSessionHost
{
    string StoragePathFor(ElectronSession session);
    void FlushStorageData(ElectronSession session);
    void FlushCookieStore(ElectronSession session);
}

public sealed class ElectronSessionRegistry
{
    private readonly Dictionary<string, ElectronSession> sessions = new(StringComparer.Ordinal);
    private readonly IElectronSessionHost host;
    private readonly ISecureCredentialBackend credentialBackend;

    public ElectronSessionRegistry(IElectronSessionHost host, ISecureCredentialBackend credentialBackend)
    {
        this.host = host ?? throw new ArgumentNullException(nameof(host));
        this.credentialBackend = credentialBackend ?? throw new ArgumentNullException(nameof(credentialBackend));
    }

    public ElectronSession FromPartition(string partition, ElectronSessionOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(partition);
        if (sessions.TryGetValue(partition, out ElectronSession? existing)) return existing;
        bool persistent = partition.Length == 0 || partition.StartsWith("persist:", StringComparison.Ordinal);
        var created = new ElectronSession(partition, persistent, options ?? new ElectronSessionOptions(), host, credentialBackend);
        sessions.Add(partition, created);
        return created;
    }

    public ElectronSession RestoreForRestart(SessionProfileSnapshot snapshot)
    {
        SessionProfileSnapshot migrated = SessionProfileMigrator.Migrate(snapshot);
        if (!migrated.Persistent) throw new SessionContractException("InvalidStateError", "An in-memory Session cannot be restored as persistent state.");
        ElectronSession session = FromPartition(migrated.Partition);
        if (!session.IsPersistent) throw new SessionContractException("DataError", "Persistent snapshot partition does not designate a persistent Session.");
        session.Cookies.Import(migrated.Cookies);
        session.Credentials.ImportProtected(migrated.Credentials);
        return session;
    }
}

public sealed class ElectronSession
{
    private readonly IElectronSessionHost host;

    internal ElectronSession(string partition, bool persistent, ElectronSessionOptions options, IElectronSessionHost host, ISecureCredentialBackend credentialBackend)
    {
        Partition = partition; IsPersistent = persistent; Options = options; this.host = host;
        Cookies = new SessionCookieStore(this, host);
        Credentials = new SecureCredentialStore(credentialBackend);
    }

    public string Partition { get; }
    public bool IsPersistent { get; }
    public ElectronSessionOptions Options { get; }
    public SessionCookieStore Cookies { get; }
    public SecureCredentialStore Credentials { get; }

    public string? StoragePath
    {
        get
        {
            if (!IsPersistent) return null;
            string path = host.StoragePathFor(this);
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path))
                throw new SessionContractException("DataError", "Persistent Session host returned a non-absolute storage path.");
            return path;
        }
    }

    public void FlushStorageData() => host.FlushStorageData(this);

    public SessionProfileSnapshot CaptureForRestart(string profileNamespace)
    {
        if (!IsPersistent) throw new SessionContractException("InvalidStateError", "In-memory Sessions do not have persistent restart state.");
        if (string.IsNullOrWhiteSpace(profileNamespace)) throw new ArgumentException("A profile namespace is required.", nameof(profileNamespace));
        FlushStorageData();
        Cookies.FlushStore();
        return new SessionProfileSnapshot(
            SessionProfileMigrator.CurrentVersion,
            Partition,
            true,
            profileNamespace,
            Cookies.Export(),
            Credentials.ExportProtected());
    }
}

public sealed record SessionCookie(string Name, string Value, string Domain, string Path, bool Secure = false, bool HttpOnly = false);

public sealed class SessionCookieStore
{
    private readonly Dictionary<CookieKey, SessionCookie> cookies = new();
    private readonly ElectronSession owner;
    private readonly IElectronSessionHost host;

    internal SessionCookieStore(ElectronSession owner, IElectronSessionHost host)
    {
        this.owner = owner; this.host = host;
    }

    public void Set(SessionCookie cookie)
    {
        ArgumentNullException.ThrowIfNull(cookie);
        if (string.IsNullOrEmpty(cookie.Name)) throw new SessionContractException("TypeError", "Cookie name must not be empty.");
        cookies[new CookieKey(cookie.Name, cookie.Domain, cookie.Path)] = cookie;
    }

    public bool Remove(string name, string domain, string path) => cookies.Remove(new CookieKey(name, domain, path));

    public IReadOnlyList<SessionCookie> Get(string? name = null) => cookies.Values
        .Where(cookie => name is null || string.Equals(cookie.Name, name, StringComparison.Ordinal))
        .OrderBy(cookie => cookie.Domain, StringComparer.Ordinal)
        .ThenBy(cookie => cookie.Path, StringComparer.Ordinal)
        .ThenBy(cookie => cookie.Name, StringComparer.Ordinal)
        .ToArray();

    public void FlushStore() => host.FlushCookieStore(owner);
    internal IReadOnlyList<SessionCookie> Export() => Get();

    internal void Import(IEnumerable<SessionCookie> restored)
    {
        cookies.Clear();
        foreach (SessionCookie cookie in restored) Set(cookie);
    }

    private readonly record struct CookieKey(string Name, string Domain, string Path);
}

public interface ISecureCredentialBackend
{
    bool IsAvailable { get; }
    byte[] Protect(ReadOnlySpan<byte> clearBytes);
    byte[] Unprotect(ReadOnlySpan<byte> protectedBytes);
}

public sealed record CredentialEnvelope(string Key, byte[] ProtectedBytes);

public sealed class SecureCredentialStore
{
    private readonly ISecureCredentialBackend backend;
    private readonly Dictionary<string, byte[]> protectedValues = new(StringComparer.Ordinal);

    public SecureCredentialStore(ISecureCredentialBackend backend) => this.backend = backend ?? throw new ArgumentNullException(nameof(backend));

    public void Set(string key, string value)
    {
        ArgumentNullException.ThrowIfNull(key); ArgumentNullException.ThrowIfNull(value);
        RequireBackend();
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        try { protectedValues[key] = backend.Protect(bytes); }
        finally { Array.Clear(bytes, 0, bytes.Length); }
    }

    public string? Get(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        if (!protectedValues.TryGetValue(key, out byte[]? protectedBytes)) return null;
        RequireBackend();
        byte[] bytes = backend.Unprotect(protectedBytes);
        try { return Encoding.UTF8.GetString(bytes); }
        finally { Array.Clear(bytes, 0, bytes.Length); }
    }

    public bool Remove(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        return protectedValues.Remove(key);
    }

    public IReadOnlyList<CredentialEnvelope> ExportProtected() => protectedValues
        .OrderBy(pair => pair.Key, StringComparer.Ordinal)
        .Select(pair => new CredentialEnvelope(pair.Key, pair.Value.ToArray()))
        .ToArray();

    internal void ImportProtected(IEnumerable<CredentialEnvelope> restored)
    {
        protectedValues.Clear();
        foreach (CredentialEnvelope envelope in restored) protectedValues.Add(envelope.Key, envelope.ProtectedBytes.ToArray());
    }

    private void RequireBackend()
    {
        if (!backend.IsAvailable)
            throw new SessionContractException("NotSupportedError", "Secure credential storage requires an explicit host protection backend; clear-text fallback is forbidden.");
    }
}

public sealed record SessionProfileSnapshot(
    int SchemaVersion,
    string Partition,
    bool Persistent,
    string ProfileNamespace,
    IReadOnlyList<SessionCookie> Cookies,
    IReadOnlyList<CredentialEnvelope> Credentials);

public static class SessionProfileMigrator
{
    public const int CurrentVersion = 2;

    public static SessionProfileSnapshot Migrate(SessionProfileSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.SchemaVersion <= 0 || snapshot.SchemaVersion > CurrentVersion)
            throw new SessionContractException("VersionError", "Unsupported Electron Session profile schema version.");
        if (snapshot.SchemaVersion == CurrentVersion)
        {
            if (string.IsNullOrWhiteSpace(snapshot.ProfileNamespace))
                throw new SessionContractException("DataError", "Current Session profile snapshots require a profile namespace.");
            return snapshot;
        }
        string profileNamespace = string.IsNullOrWhiteSpace(snapshot.ProfileNamespace) ? "default" : snapshot.ProfileNamespace;
        return new SessionProfileSnapshot(CurrentVersion, snapshot.Partition, snapshot.Persistent, profileNamespace, snapshot.Cookies, snapshot.Credentials);
    }
}
