using System.Net;
using System.Net.Sockets;

namespace J2cs.Runtime.NodeCompat;

public sealed class NodeNetworkException : Exception
{
    public string Code { get; }

    public NodeNetworkException(string code, string message, Exception? innerException = null)
        : base(message, innerException) => Code = code;

    internal static NodeNetworkException FromSocket(SocketException error, string operation)
    {
        var code = error.SocketErrorCode switch
        {
            SocketError.HostNotFound or SocketError.NoData => "ENOTFOUND",
            SocketError.TryAgain => "EAI_AGAIN",
            SocketError.ConnectionRefused => "ECONNREFUSED",
            SocketError.ConnectionReset => "ECONNRESET",
            SocketError.TimedOut => "ETIMEDOUT",
            SocketError.AddressAlreadyInUse => "EADDRINUSE",
            SocketError.AddressNotAvailable => "EADDRNOTAVAIL",
            _ => "EUNKNOWN"
        };
        return new NodeNetworkException(code, `${operation}: ${error.Message}`, error);
    }
}

public readonly record struct NodeDnsAddress(string Address, int Family);

public static class NodeDns
{
    public static async Task<NodeDnsAddress> LookupAsync(
        string hostname,
        int family = 0,
        CancellationToken cancellationToken = default)
    {
        var addresses = await LookupAllAsync(hostname, family, cancellationToken).ConfigureAwait(false);
        if (addresses.Count == 0)
            throw new NodeNetworkException("ENOTFOUND", `getaddrinfo ENOTFOUND ${hostname}`);
        return addresses[0];
    }

    public static async Task<IReadOnlyList<NodeDnsAddress>> LookupAllAsync(
        string hostname,
        int family = 0,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(hostname))
            throw new NodeNetworkException("ERR_INVALID_ARG_VALUE", "hostname must be a non-empty string");
        if (family is not 0 and not 4 and not 6)
            throw new NodeNetworkException("ERR_INVALID_ARG_VALUE", "family must be 0, 4, or 6");

        if (IPAddress.TryParse(hostname, out var literal))
        {
            var literalFamily = FamilyOf(literal);
            if (family != 0 && family != literalFamily)
                throw new NodeNetworkException("ENOTFOUND", `getaddrinfo ENOTFOUND ${hostname}`);
            return new[] { new NodeDnsAddress(literal.ToString(), literalFamily) };
        }

        IPAddress[] addresses;
        try
        {
            addresses = await Dns.GetHostAddressesAsync(hostname).WaitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (SocketException error)
        {
            throw NodeNetworkException.FromSocket(error, "getaddrinfo");
        }

        var result = addresses
            .Select(address => new NodeDnsAddress(address.ToString(), FamilyOf(address)))
            .Where(address => family == 0 || address.Family == family)
            .ToArray();

        if (result.Length == 0)
            throw new NodeNetworkException("ENOTFOUND", `getaddrinfo ENOTFOUND ${hostname}`);
        return result;
    }

    private static int FamilyOf(IPAddress address) => address.AddressFamily switch
    {
        AddressFamily.InterNetwork => 4,
        AddressFamily.InterNetworkV6 => 6,
        _ => throw new NodeNetworkException("EAFNOSUPPORT", `Unsupported address family ${address.AddressFamily}`)
    };
}
