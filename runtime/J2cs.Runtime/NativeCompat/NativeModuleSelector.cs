namespace J2cs.Runtime.NativeCompat;

public static class NativeModuleSelector
{
    public static NativeModulePlan Plan(
        NativeModuleDescriptor descriptor,
        params NativeBackendCandidate[] candidates)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(candidates);

        foreach (var route in new[]
        {
            NativeModuleRoute.KnownAdapter,
            NativeModuleRoute.PInvokeWrapper,
            NativeModuleRoute.SidecarBridge
        })
        {
            var eligible = candidates
                .Where(candidate => candidate.Route == route
                    && candidate.SupportedRids.Contains(descriptor.Rid, StringComparer.Ordinal)
                    && descriptor.Abi.ExactlyMatches(candidate.Abi))
                .ToArray();

            if (eligible.Length > 1)
                return new NativeModulePlan(
                    descriptor,
                    NativeModuleRoute.Unsupported,
                    null,
                    "E_NATIVE_MODULE_AMBIGUOUS");

            if (eligible.Length == 1)
                return new NativeModulePlan(descriptor, route, eligible[0].Id, null);
        }

        return new NativeModulePlan(
            descriptor,
            NativeModuleRoute.Unsupported,
            null,
            "E_NATIVE_MODULE_UNSUPPORTED");
    }
}
