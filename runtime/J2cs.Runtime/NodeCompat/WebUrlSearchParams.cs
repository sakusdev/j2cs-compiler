using System.Text;

namespace J2cs.Runtime.NodeCompat;

public readonly record struct WebUrlSearchParam(string Name, string Value);

public sealed class WebUrlSearchParams
{
    private readonly List<WebUrlSearchParam> items = new();

    public int Size => items.Count;

    public IReadOnlyList<WebUrlSearchParam> Pairs => items;

    public void Append(string name, string value) =>
        items.Add(new WebUrlSearchParam(ToUsvString(name), ToUsvString(value)));

    public void Set(string name, string value)
    {
        string normalizedName = ToUsvString(name);
        string normalizedValue = ToUsvString(value);
        int first = items.FindIndex(item => item.Name == normalizedName);
        if (first < 0)
        {
            items.Add(new WebUrlSearchParam(normalizedName, normalizedValue));
            return;
        }

        items[first] = new WebUrlSearchParam(normalizedName, normalizedValue);
        for (int i = items.Count - 1; i > first; i--)
            if (items[i].Name == normalizedName) items.RemoveAt(i);
    }

    public void Delete(string name)
    {
        string normalizedName = ToUsvString(name);
        items.RemoveAll(item => item.Name == normalizedName);
    }

    public string? Get(string name)
    {
        string normalizedName = ToUsvString(name);
        foreach (var item in items)
            if (item.Name == normalizedName) return item.Value;
        return null;
    }

    public IReadOnlyList<string> GetAll(string name)
    {
        string normalizedName = ToUsvString(name);
        return items.Where(item => item.Name == normalizedName).Select(item => item.Value).ToArray();
    }

    public string Serialize() => Serialize(items);

    public override string ToString() => Serialize();

    public static string Serialize(IEnumerable<WebUrlSearchParam> parameters) =>
        string.Join("&", parameters.Select(parameter =>
            EncodeFormComponent(ToUsvString(parameter.Name)) + "=" + EncodeFormComponent(ToUsvString(parameter.Value))));

    private static string EncodeFormComponent(string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        var builder = new StringBuilder(bytes.Length);
        foreach (byte b in bytes)
        {
            if (b == 0x20)
            {
                builder.Append('+');
            }
            else if ((b is >= (byte)'A' and <= (byte)'Z') ||
                     (b is >= (byte)'a' and <= (byte)'z') ||
                     (b is >= (byte)'0' and <= (byte)'9') ||
                     b is (byte)'*' or (byte)'-' or (byte)'.' or (byte)'_')
            {
                builder.Append((char)b);
            }
            else
            {
                builder.Append('%');
                builder.Append(b.ToString("X2", System.Globalization.CultureInfo.InvariantCulture));
            }
        }
        return builder.ToString();
    }

    private static string ToUsvString(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var builder = new StringBuilder(value.Length);
        for (int i = 0; i < value.Length; i++)
        {
            char current = value[i];
            if (char.IsHighSurrogate(current))
            {
                if (i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
                {
                    builder.Append(current);
                    builder.Append(value[++i]);
                }
                else
                {
                    builder.Append('\uFFFD');
                }
            }
            else if (char.IsLowSurrogate(current))
            {
                builder.Append('\uFFFD');
            }
            else
            {
                builder.Append(current);
            }
        }
        return builder.ToString();
    }
}
