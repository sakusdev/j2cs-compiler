using J2cs.Runtime.NativeCompat;

static NativeAbiContract Abi(
    string family = "napi",
    int major = 8,
    NativeModuleLifetime lifetime = NativeModuleLifetime.Module,
    NativeErrorModel errors = NativeErrorModel.NapiStatus)
    => new(family, major, lifetime, errors);

static NativeModuleDescriptor Descriptor(string request)
    => new(request, "/modules/" + request + ".node", "linux-x64", Abi());

static NativeBackendCandidate Candidate(
    NativeModuleRoute route,
    string id,
    NativeAbiContract? abi = null,
    params string[] rids)
    => new(route, id, rids.Length == 0 ? new[] { "linux-x64" } : rids, abi ?? Abi());

static void Print(NativeModuleDescriptor descriptor, params NativeBackendCandidate[] candidates)
    => Console.WriteLine(NativeModuleTrace.Format(NativeModuleSelector.Plan(descriptor, candidates)));

Print(
    Descriptor("known"),
    Candidate(NativeModuleRoute.SidecarBridge, "side"),
    Candidate(NativeModuleRoute.PInvokeWrapper, "wrap"),
    Candidate(NativeModuleRoute.KnownAdapter, "known-adapter"));

Print(
    Descriptor("wrapper"),
    Candidate(NativeModuleRoute.KnownAdapter, "wrong-rid", null, "win-x64"),
    Candidate(NativeModuleRoute.PInvokeWrapper, "pinvoke"));

Print(
    Descriptor("sidecar"),
    Candidate(NativeModuleRoute.PInvokeWrapper, "wrong-abi", Abi("napi", 7)),
    Candidate(NativeModuleRoute.SidecarBridge, "bridge"));

Print(
    Descriptor("ambiguous"),
    Candidate(NativeModuleRoute.SidecarBridge, "a"),
    Candidate(NativeModuleRoute.SidecarBridge, "b"));

Print(
    Descriptor("missing"),
    Candidate(NativeModuleRoute.KnownAdapter, "windows-only", null, "win-x64"));
