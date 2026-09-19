namespace J2cs.Runtime;

public static class NodeOs
{
    public static string Platform() => NodePlatform.Platform;
    public static string Arch() => NodePlatform.Arch;
    public static string Eol => NodePlatform.Platform == "win32" ? "\r\n" : "\n";
}
