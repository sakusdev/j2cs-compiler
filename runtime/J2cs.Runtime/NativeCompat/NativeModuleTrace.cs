namespace J2cs.Runtime.NativeCompat;

public static class NativeModuleTrace
{
    public static string Format(NativeModulePlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);
        var descriptor = plan.Descriptor;
        return string.Join(
            "|",
            RouteText(plan.Route),
            plan.BackendId ?? "-",
            Escape(descriptor.Request),
            Escape(descriptor.ResolvedPath),
            Escape(descriptor.Rid),
            Escape(descriptor.Abi.Family) + "@"
                + descriptor.Abi.Major.ToString(System.Globalization.CultureInfo.InvariantCulture),
            LifetimeText(descriptor.Abi.Lifetime),
            ErrorText(descriptor.Abi.Errors),
            plan.DiagnosticCode ?? "-");
    }

    private static string RouteText(NativeModuleRoute route) => route switch
    {
        NativeModuleRoute.KnownAdapter => "known-adapter",
        NativeModuleRoute.PInvokeWrapper => "pinvoke-wrapper",
        NativeModuleRoute.SidecarBridge => "sidecar-bridge",
        NativeModuleRoute.Unsupported => "unsupported",
        _ => throw new InvalidOperationException("Unknown native module route")
    };

    private static string LifetimeText(NativeModuleLifetime lifetime) => lifetime switch
    {
        NativeModuleLifetime.Process => "process",
        NativeModuleLifetime.Module => "module",
        NativeModuleLifetime.Handle => "handle",
        _ => throw new InvalidOperationException("Unknown native module lifetime")
    };

    private static string ErrorText(NativeErrorModel errors) => errors switch
    {
        NativeErrorModel.NapiStatus => "napi-status",
        NativeErrorModel.Errno => "errno",
        NativeErrorModel.ReturnCode => "return-code",
        NativeErrorModel.ExceptionFree => "exception-free",
        _ => throw new InvalidOperationException("Unknown native error model")
    };

    private static string Escape(string value)
        => value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("|", "\\|", StringComparison.Ordinal)
            .Replace("\r", "\\r", StringComparison.Ordinal)
            .Replace("\n", "\\n", StringComparison.Ordinal);
}
