namespace J2cs.Runtime;

/// <summary>
/// A specialized process.env object. Generic Object/Proxy/enumeration integration remains
/// outside this lane; proven own string property get/set/delete operations use this object.
/// </summary>
public sealed class NodeEnvironment : JsObject
{
    internal NodeEnvironment() { }

    protected override bool TryGetOwn(string key, out JsValue value)
    {
        var current = Environment.GetEnvironmentVariable(key);
        if (current is null)
        {
            value = JsUndefined.Value;
            return false;
        }

        value = JsValue.FromString(current);
        return true;
    }

    protected override void SetOwn(string key, JsValue value)
    {
        if (value.Kind != JsKind.String)
            throw new NotSupportedException("process.env non-string assignment requires the JS ToString bridge.");

        Environment.SetEnvironmentVariable(key, value.String);
    }

    public override bool HasOwnProperty(string key) => Environment.GetEnvironmentVariable(key) is not null;

    public static bool Delete(JsValue receiver, string key)
    {
        if (RequireReference(receiver) is not NodeEnvironment)
            throw new InvalidOperationException("Compiler process.env proof violated.");

        Environment.SetEnvironmentVariable(key, null);
        return true;
    }
}

public static class NodeProcess
{
    private static readonly NodeEnvironment EnvironmentObject = new();
    private static readonly JsValue EnvironmentValue = JsValue.FromReference(EnvironmentObject);
    private static readonly JsValue ArgumentsValue = CreateArguments(Environment.GetCommandLineArgs());

    /// <summary>Shared identity-bearing argv array for this generated host process.</summary>
    public static JsValue Argv => ArgumentsValue;

    /// <summary>Shared specialized process.env object.</summary>
    public static JsValue Env => EnvironmentValue;

    public static string CurrentDirectory => Directory.GetCurrentDirectory();
    public static string Platform => NodePlatform.Platform;
    public static string Arch => NodePlatform.Arch;

    public static string Cwd() => CurrentDirectory;

    public static void Chdir(string directory)
    {
        ArgumentNullException.ThrowIfNull(directory);
        Directory.SetCurrentDirectory(directory);
    }

    private static JsValue CreateArguments(IReadOnlyList<string> values)
    {
        var result = JsArray.Create(values.Count);
        for (var i = 0; i < values.Count; i++)
            JsArray.DefineElement(result, i, JsValue.FromString(values[i]));
        return result;
    }
}
