namespace J2cs.Runtime.WebCompat;

public sealed class StorageContractException : Exception
{
    public StorageContractException(string name, string message) : base(message) => Name = name;
    public string Name { get; }
}

public enum WebStorageKind { Local, Session }
public enum StorageMutationKind { Set, Remove, Clear }

public sealed record BrowserStoragePartition
{
    public BrowserStoragePartition(string storageKey, string origin)
    {
        if (string.IsNullOrWhiteSpace(storageKey)) throw new ArgumentException("A non-empty storage key is required.", nameof(storageKey));
        if (string.IsNullOrWhiteSpace(origin)) throw new ArgumentException("A non-empty origin is required.", nameof(origin));
        StorageKey = storageKey; Origin = origin;
    }
    public string StorageKey { get; }
    public string Origin { get; }
}

public sealed record StorageMutation(long Sequence, StorageMutationKind Kind, string? Key, string? OldValue, string? NewValue);
public sealed record StorageEntrySnapshot(string Key, string Value);
public sealed record StorageAreaSnapshot(string StorageKey, string Origin, WebStorageKind Kind, string? PageSession, IReadOnlyList<StorageEntrySnapshot> Entries);
public sealed record StorageProfileSnapshot(int SchemaVersion, string ProfileId, IReadOnlyList<StorageAreaSnapshot> LocalStorage);

public interface IStorageQuotaPolicy { bool CanSet(StorageArea area, string key, string value); }

public sealed class UnlimitedStorageQuotaPolicy : IStorageQuotaPolicy
{
    public static UnlimitedStorageQuotaPolicy Instance { get; } = new();
    private UnlimitedStorageQuotaPolicy() { }
    public bool CanSet(StorageArea area, string key, string value) => true;
}

public sealed class CodeUnitStorageQuotaPolicy : IStorageQuotaPolicy
{
    public CodeUnitStorageQuotaPolicy(long maximumCodeUnits)
    {
        if (maximumCodeUnits < 0) throw new ArgumentOutOfRangeException(nameof(maximumCodeUnits));
        MaximumCodeUnits = maximumCodeUnits;
    }
    public long MaximumCodeUnits { get; }
    public bool CanSet(StorageArea area, string key, string value) => area.EstimateCodeUnitsAfterSet(key, value) <= MaximumCodeUnits;
}

public sealed class StorageArea
{
    private readonly Dictionary<string, string> values = new(StringComparer.Ordinal);
    private readonly List<string> order = new();
    private readonly List<StorageMutation> mutations = new();
    private long sequence;

    internal StorageArea(BrowserStoragePartition partition, WebStorageKind kind, string? pageSession, IStorageQuotaPolicy quotaPolicy, IEnumerable<StorageEntrySnapshot>? restored = null)
    {
        Partition = partition; Kind = kind; PageSession = pageSession; QuotaPolicy = quotaPolicy;
        if (restored is null) return;
        foreach (StorageEntrySnapshot entry in restored)
        {
            if (values.ContainsKey(entry.Key)) throw new StorageContractException("DataError", "Persistent storage snapshot contains a duplicate key.");
            values.Add(entry.Key, entry.Value); order.Add(entry.Key);
        }
    }

    public BrowserStoragePartition Partition { get; }
    public WebStorageKind Kind { get; }
    public string? PageSession { get; }
    public IStorageQuotaPolicy QuotaPolicy { get; }
    public int Length => values.Count;
    public IReadOnlyList<StorageMutation> PendingMutations => mutations;

    public string? Key(int index) => index >= 0 && index < order.Count ? order[index] : null;

    public string? GetItem(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        return values.TryGetValue(key, out string? value) ? value : null;
    }

    public void SetItem(string key, string value)
    {
        ArgumentNullException.ThrowIfNull(key); ArgumentNullException.ThrowIfNull(value);
        values.TryGetValue(key, out string? oldValue);
        if (oldValue is not null && string.Equals(oldValue, value, StringComparison.Ordinal)) return;
        if (!QuotaPolicy.CanSet(this, key, value)) throw new StorageContractException("QuotaExceededError", "The storage quota policy rejected this atomic update.");
        if (!values.ContainsKey(key)) order.Add(key);
        values[key] = value;
        mutations.Add(new StorageMutation(++sequence, StorageMutationKind.Set, key, oldValue, value));
    }

    public void RemoveItem(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        if (!values.Remove(key, out string? oldValue)) return;
        order.Remove(key);
        mutations.Add(new StorageMutation(++sequence, StorageMutationKind.Remove, key, oldValue, null));
    }

    public void Clear()
    {
        if (values.Count == 0) return;
        values.Clear(); order.Clear();
        mutations.Add(new StorageMutation(++sequence, StorageMutationKind.Clear, null, null, null));
    }

    public IReadOnlyList<StorageMutation> DrainMutations()
    {
        StorageMutation[] result = mutations.ToArray(); mutations.Clear(); return result;
    }

    public long EstimateCodeUnitsAfterSet(string key, string value)
    {
        ArgumentNullException.ThrowIfNull(key); ArgumentNullException.ThrowIfNull(value);
        long total = 0;
        foreach ((string existingKey, string existingValue) in values)
        {
            if (string.Equals(existingKey, key, StringComparison.Ordinal)) continue;
            total = checked(total + existingKey.Length + existingValue.Length);
        }
        return checked(total + key.Length + value.Length);
    }

    internal StorageAreaSnapshot Snapshot() => new(
        Partition.StorageKey, Partition.Origin, Kind, PageSession,
        order.Select(key => new StorageEntrySnapshot(key, values[key])).ToArray());
}

public sealed class WebStorageRegistry
{
    private readonly Dictionary<LocalAreaKey, StorageArea> local = new();
    private readonly Dictionary<SessionAreaKey, StorageArea> session = new();
    private readonly IStorageQuotaPolicy quotaPolicy;

    public WebStorageRegistry(IStorageQuotaPolicy? quotaPolicy = null) => this.quotaPolicy = quotaPolicy ?? UnlimitedStorageQuotaPolicy.Instance;

    public StorageArea GetLocalStorage(BrowserStoragePartition partition)
    {
        ArgumentNullException.ThrowIfNull(partition);
        var key = new LocalAreaKey(partition.StorageKey, partition.Origin);
        if (!local.TryGetValue(key, out StorageArea? area))
        {
            area = new StorageArea(partition, WebStorageKind.Local, null, quotaPolicy); local.Add(key, area);
        }
        return area;
    }

    public StorageArea GetSessionStorage(BrowserStoragePartition partition, string pageSession)
    {
        ArgumentNullException.ThrowIfNull(partition);
        if (string.IsNullOrEmpty(pageSession)) throw new ArgumentException("A page-session identity is required.", nameof(pageSession));
        var key = new SessionAreaKey(partition.StorageKey, partition.Origin, pageSession);
        if (!session.TryGetValue(key, out StorageArea? area))
        {
            area = new StorageArea(partition, WebStorageKind.Session, pageSession, quotaPolicy); session.Add(key, area);
        }
        return area;
    }

    public StorageProfileSnapshot CapturePersistentProfile(string profileId)
    {
        if (string.IsNullOrWhiteSpace(profileId)) throw new ArgumentException("A profile identity is required.", nameof(profileId));
        StorageAreaSnapshot[] areas = local.Values.Select(area => area.Snapshot())
            .OrderBy(area => area.StorageKey, StringComparer.Ordinal).ThenBy(area => area.Origin, StringComparer.Ordinal).ToArray();
        return new StorageProfileSnapshot(StorageProfileMigrator.CurrentVersion, profileId, areas);
    }

    public void RestorePersistentProfile(StorageProfileSnapshot snapshot)
    {
        StorageProfileSnapshot migrated = StorageProfileMigrator.Migrate(snapshot);
        local.Clear(); session.Clear();
        foreach (StorageAreaSnapshot area in migrated.LocalStorage)
        {
            if (area.Kind != WebStorageKind.Local || area.PageSession is not null) throw new StorageContractException("DataError", "Persistent profile snapshots may contain localStorage only.");
            var partition = new BrowserStoragePartition(area.StorageKey, area.Origin);
            var key = new LocalAreaKey(area.StorageKey, area.Origin);
            if (!local.TryAdd(key, new StorageArea(partition, WebStorageKind.Local, null, quotaPolicy, area.Entries)))
                throw new StorageContractException("DataError", "Persistent profile snapshot contains a duplicate storage area.");
        }
    }

    private readonly record struct LocalAreaKey(string StorageKey, string Origin);
    private readonly record struct SessionAreaKey(string StorageKey, string Origin, string PageSession);
}

public static class StorageProfileMigrator
{
    public const int CurrentVersion = 2;
    public static StorageProfileSnapshot Migrate(StorageProfileSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.SchemaVersion <= 0 || snapshot.SchemaVersion > CurrentVersion) throw new StorageContractException("VersionError", "Unsupported storage profile schema version.");
        if (snapshot.SchemaVersion == CurrentVersion)
        {
            if (string.IsNullOrWhiteSpace(snapshot.ProfileId)) throw new StorageContractException("DataError", "Current storage profile snapshots require a profile identity.");
            return snapshot;
        }
        string profileId = string.IsNullOrWhiteSpace(snapshot.ProfileId) ? "default" : snapshot.ProfileId;
        return new StorageProfileSnapshot(CurrentVersion, profileId, snapshot.LocalStorage);
    }
}

public sealed record IndexedDbOpenDescriptor(BrowserStoragePartition Partition, string DatabaseName, long? RequestedVersion, bool EventDrivenRequest, bool StructuredCloneRequired);

public static class IndexedDbBoundary
{
    public static IndexedDbOpenDescriptor Open(BrowserStoragePartition partition, string databaseName, long? version = null)
    {
        ArgumentNullException.ThrowIfNull(partition); ArgumentNullException.ThrowIfNull(databaseName);
        if (version is <= 0) throw new StorageContractException("TypeError", "IndexedDB version must be a positive integer.");
        return new IndexedDbOpenDescriptor(partition, databaseName, version, true, true);
    }
}

public sealed record CacheStorageDescriptor(BrowserStoragePartition Partition, string CacheName, bool HostPersistenceRequired);

public sealed class CacheStorageBoundary
{
    public CacheStorageBoundary(BrowserStoragePartition partition, bool secureContext)
    {
        Partition = partition ?? throw new ArgumentNullException(nameof(partition)); SecureContext = secureContext;
    }
    public BrowserStoragePartition Partition { get; }
    public bool SecureContext { get; }
    public CacheStorageDescriptor Open(string cacheName)
    {
        ArgumentNullException.ThrowIfNull(cacheName);
        if (!SecureContext) throw new StorageContractException("SecurityError", "CacheStorage requires a proven secure context.");
        return new CacheStorageDescriptor(Partition, cacheName, true);
    }
}
