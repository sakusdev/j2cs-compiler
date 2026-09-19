using System.Text;

namespace J2cs.Runtime;

public enum NodePathFlavor
{
    Host,
    Posix,
    Win32
}

public static class NodePath
{
    public static string Separator(NodePathFlavor flavor)
        => EffectiveFlavor(flavor) == NodePathFlavor.Win32 ? "\\" : "/";

    public static string Delimiter(NodePathFlavor flavor)
        => EffectiveFlavor(flavor) == NodePathFlavor.Win32 ? ";" : ":";

    public static bool IsAbsolute(string value, NodePathFlavor flavor)
    {
        ArgumentNullException.ThrowIfNull(value);
        return EffectiveFlavor(flavor) == NodePathFlavor.Win32 ? IsAbsoluteWin32(value) : value.StartsWith("/", StringComparison.Ordinal);
    }

    public static string Normalize(string value, NodePathFlavor flavor)
    {
        ArgumentNullException.ThrowIfNull(value);
        return EffectiveFlavor(flavor) == NodePathFlavor.Win32 ? NormalizeWin32(value) : NormalizePosix(value);
    }

    public static string Join(IReadOnlyList<string> segments, NodePathFlavor flavor)
    {
        ArgumentNullException.ThrowIfNull(segments);
        var separator = Separator(flavor);
        var joined = new StringBuilder();
        foreach (var segment in segments)
        {
            ArgumentNullException.ThrowIfNull(segment);
            if (segment.Length == 0) continue;
            if (joined.Length != 0) joined.Append(separator);
            joined.Append(segment);
        }
        return joined.Length == 0 ? "." : Normalize(joined.ToString(), flavor);
    }

    public static string Join(NodePathFlavor flavor, params string[] segments) => Join(segments, flavor);

    private static NodePathFlavor EffectiveFlavor(NodePathFlavor flavor)
        => flavor == NodePathFlavor.Host
            ? (NodePlatform.Platform == "win32" ? NodePathFlavor.Win32 : NodePathFlavor.Posix)
            : flavor;

    private static string NormalizePosix(string value)
    {
        if (value.Length == 0) return ".";

        var absolute = value[0] == '/';
        var trailingSeparator = value[^1] == '/';
        var tail = NormalizeSegments(value, 0, static ch => ch == '/', !absolute, '/');

        if (tail.Length == 0)
        {
            if (absolute) return "/";
            return trailingSeparator ? "./" : ".";
        }

        if (trailingSeparator) tail += "/";
        return absolute ? "/" + tail : tail;
    }

    private static string NormalizeWin32(string value)
    {
        if (value.Length == 0) return ".";

        var length = value.Length;
        var rootEnd = 0;
        var absolute = false;
        var unc = false;
        var device = string.Empty;

        if (IsWinSeparator(value[0]))
        {
            absolute = true;
            rootEnd = 1;

            if (length > 1 && IsWinSeparator(value[1]))
            {
                var index = 2;
                while (index < length && IsWinSeparator(value[index])) index++;
                var serverStart = index;
                while (index < length && !IsWinSeparator(value[index])) index++;
                var server = value[serverStart..index];

                while (index < length && IsWinSeparator(value[index])) index++;
                var shareStart = index;
                while (index < length && !IsWinSeparator(value[index])) index++;
                var share = value[shareStart..index];

                if (server.Length != 0 && share.Length != 0)
                {
                    device = "\\\\" + server + "\\" + share;
                    rootEnd = index;
                    while (rootEnd < length && IsWinSeparator(value[rootEnd])) rootEnd++;
                    unc = true;
                }
            }
        }
        else if (length >= 2 && IsDriveLetter(value[0]) && value[1] == ':')
        {
            device = value[..2];
            rootEnd = 2;
            if (rootEnd < length && IsWinSeparator(value[rootEnd]))
            {
                absolute = true;
                while (rootEnd < length && IsWinSeparator(value[rootEnd])) rootEnd++;
            }
        }

        var trailingSeparator = IsWinSeparator(value[^1]);
        var tail = NormalizeSegments(value, rootEnd, IsWinSeparator, !absolute, '\\');

        string result;
        if (unc) result = device + "\\";
        else if (device.Length != 0) result = device + (absolute ? "\\" : string.Empty);
        else if (absolute) result = "\\";
        else result = string.Empty;

        if (tail.Length != 0) result += tail;
        else if (result.Length == 0) result = ".";
        else if (device.Length != 0 && !absolute && result == device) result += ".";

        if (trailingSeparator && tail.Length != 0 && !result.EndsWith("\\", StringComparison.Ordinal))
            result += "\\";

        return result;
    }

    private static bool IsAbsoluteWin32(string value)
    {
        if (value.Length == 0) return false;
        if (IsWinSeparator(value[0])) return true;
        return value.Length > 2 && IsDriveLetter(value[0]) && value[1] == ':' && IsWinSeparator(value[2]);
    }

    private static bool IsDriveLetter(char value)
        => value is >= 'A' and <= 'Z' or >= 'a' and <= 'z';

    private static bool IsWinSeparator(char value) => value is '\\' or '/';

    private static string NormalizeSegments(
        string value,
        int start,
        Func<char, bool> isSeparator,
        bool allowAboveRoot,
        char separator)
    {
        var segments = new List<string>();
        var segmentStart = start;

        for (var index = start; index <= value.Length; index++)
        {
            if (index != value.Length && !isSeparator(value[index])) continue;

            if (index > segmentStart)
            {
                var segment = value[segmentStart..index];
                if (segment == "..")
                {
                    if (segments.Count != 0 && segments[^1] != "..") segments.RemoveAt(segments.Count - 1);
                    else if (allowAboveRoot) segments.Add("..");
                }
                else if (segment != ".")
                {
                    segments.Add(segment);
                }
            }

            segmentStart = index + 1;
        }

        return string.Join(separator.ToString(), segments);
    }
}
