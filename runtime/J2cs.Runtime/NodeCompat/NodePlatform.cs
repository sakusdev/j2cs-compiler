using System.Runtime.InteropServices;

namespace J2cs.Runtime;

internal static class NodePlatform
{
    public static string Platform { get; } = DetectPlatform();
    public static string Arch { get; } = DetectArchitecture();

    private static string DetectPlatform()
    {
        if (OperatingSystem.IsWindows()) return "win32";
        if (OperatingSystem.IsLinux()) return OperatingSystem.IsAndroid() ? "android" : "linux";
        if (OperatingSystem.IsMacOS()) return "darwin";
        if (OperatingSystem.IsFreeBSD()) return "freebsd";
        throw new PlatformNotSupportedException("The current OS has no reviewed Node process.platform mapping.");
    }

    private static string DetectArchitecture()
        => RuntimeInformation.ProcessArchitecture.ToString() switch
        {
            "X64" => "x64",
            "X86" => "ia32",
            "Arm" => "arm",
            "Arm64" => "arm64",
            "S390x" => "s390x",
            "Ppc64le" => "ppc64",
            "LoongArch64" => "loong64",
            var architecture => throw new PlatformNotSupportedException(
                $"The current architecture '{architecture}' has no reviewed Node process.arch mapping.")
        };
}
