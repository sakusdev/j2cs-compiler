namespace J2cs.Runtime.NativeCompat;

public enum NativeModuleRoute
{
    KnownAdapter,
    PInvokeWrapper,
    SidecarBridge,
    Unsupported
}

public enum NativeModuleLifetime
{
    Process,
    Module,
    Handle
}

public enum NativeErrorModel
{
    NapiStatus,
    Errno,
    ReturnCode,
    ExceptionFree
}

public sealed class NativeAbiContract
{
    public string Family { get; }
    public int Major { get; }
    public NativeModuleLifetime Lifetime { get; }
    public NativeErrorModel Errors { get; }

    public NativeAbiContract(string family, int major, NativeModuleLifetime lifetime, NativeErrorModel errors)
    {
        if (string.IsNullOrEmpty(family)) throw new ArgumentException("ABI family must be non-empty.", nameof(family));
        if (major < 0) throw new ArgumentOutOfRangeException(nameof(major));
        Family = family;
        Major = major;
        Lifetime = lifetime;
        Errors = errors;
    }

    internal bool ExactlyMatches(NativeAbiContract other)
        => Family == other.Family
           && Major == other.Major
           && Lifetime == other.Lifetime
           && Errors == other.Errors;
}

public sealed class NativeModuleDescriptor
{
    public string Request { get; }
    public string ResolvedPath { get; }
    public string Rid { get; }
    public NativeAbiContract Abi { get; }

    public NativeModuleDescriptor(string request, string resolvedPath, string rid, NativeAbiContract abi)
    {
        if (string.IsNullOrEmpty(request)) throw new ArgumentException("Request must be non-empty.", nameof(request));
        if (string.IsNullOrEmpty(resolvedPath)) throw new ArgumentException("Resolved path must be non-empty.", nameof(resolvedPath));
        if (string.IsNullOrEmpty(rid)) throw new ArgumentException("RID must be non-empty.", nameof(rid));
        Request = request;
        ResolvedPath = resolvedPath;
        Rid = rid;
        Abi = abi ?? throw new ArgumentNullException(nameof(abi));
    }
}

public sealed class NativeBackendCandidate
{
    public NativeModuleRoute Route { get; }
    public string Id { get; }
    public IReadOnlyList<string> SupportedRids { get; }
    public NativeAbiContract Abi { get; }

    public NativeBackendCandidate(
        NativeModuleRoute route,
        string id,
        IEnumerable<string> supportedRids,
        NativeAbiContract abi)
    {
        if (route == NativeModuleRoute.Unsupported)
            throw new ArgumentException("Unsupported is a result, not a backend candidate.", nameof(route));
        if (string.IsNullOrEmpty(id))
            throw new ArgumentException("Backend id must be non-empty.", nameof(id));
        var rids = supportedRids?.ToArray() ?? throw new ArgumentNullException(nameof(supportedRids));
        if (rids.Length == 0 || rids.Any(string.IsNullOrEmpty))
            throw new ArgumentException("At least one non-empty RID is required.", nameof(supportedRids));
        Route = route;
        Id = id;
        SupportedRids = Array.AsReadOnly(rids);
        Abi = abi ?? throw new ArgumentNullException(nameof(abi));
    }
}

public sealed class NativeModulePlan
{
    public NativeModuleDescriptor Descriptor { get; }
    public NativeModuleRoute Route { get; }
    public string? BackendId { get; }
    public string? DiagnosticCode { get; }

    internal NativeModulePlan(
        NativeModuleDescriptor descriptor,
        NativeModuleRoute route,
        string? backendId,
        string? diagnosticCode)
        => (Descriptor, Route, BackendId, DiagnosticCode) = (descriptor, route, backendId, diagnosticCode);
}
