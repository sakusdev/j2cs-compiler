using System.Net;
using System.Net.Sockets;

namespace J2cs.Runtime.NodeCompat;

public readonly record struct NodeNetAddress(string Address, int Port, int Family);

public sealed class NodeTcpServer : IAsyncDisposable
{
    private readonly CancellationTokenSource lifetime = new();
    private TcpListener? listener;
    private volatile bool listening;
    private volatile bool closed;
    private Task listenCompletion = Task.CompletedTask;

    public bool Listening => listening;
    public Task ListenCompletion => listenCompletion;

    public NodeNetAddress? Address
    {
        get
        {
            if (!listening || listener?.LocalEndpoint is not IPEndPoint endpoint)
                return null;
            return new NodeNetAddress(endpoint.Address.ToString(), endpoint.Port, FamilyOf(endpoint.Address));
        }
    }

    public NodeTcpServer Listen(
        int port,
        string host = "127.0.0.1",
        Action<NodeTcpServer>? onListening = null)
    {
        if (port is < 0 or > 65535)
            throw new NodeNetworkException("ERR_SOCKET_BAD_PORT", "Port must be between 0 and 65535");
        if (closed)
            throw new NodeNetworkException("ERR_SERVER_NOT_RUNNING", "Server has been closed");
        if (listener is not null)
            throw new NodeNetworkException("ERR_SERVER_ALREADY_LISTEN", "Server is already listening or binding");
        if (!IPAddress.TryParse(host, out var address))
            throw new NodeNetworkException("ERR_INVALID_ARG_VALUE", "Transport foundation requires a literal bind address");

        listener = new TcpListener(address, port);
        listenCompletion = Task.Run(async () =>
        {
            await Task.Yield();
            try
            {
                listener.Start();
                listening = true;
                onListening?.Invoke(this);
            }
            catch (SocketException error)
            {
                throw NodeNetworkException.FromSocket(error, "listen");
            }
        }, lifetime.Token);
        return this;
    }

    public async Task<NodeTcpSocket> AcceptAsync(CancellationToken cancellationToken = default)
    {
        await listenCompletion.ConfigureAwait(false);
        if (!listening || listener is null)
            throw new NodeNetworkException("ERR_SERVER_NOT_RUNNING", "Server is not listening");
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, cancellationToken);
        try
        {
            var client = await listener.AcceptTcpClientAsync(linked.Token).ConfigureAwait(false);
            return new NodeTcpSocket(client);
        }
        catch (SocketException error)
        {
            throw NodeNetworkException.FromSocket(error, "accept");
        }
    }

    public NodeTcpServer Close()
    {
        if (closed)
            return this;
        closed = true;
        listening = false;
        lifetime.Cancel();
        listener?.Stop();
        return this;
    }

    public ValueTask DisposeAsync()
    {
        Close();
        lifetime.Dispose();
        return ValueTask.CompletedTask;
    }

    private static int FamilyOf(IPAddress address) => address.AddressFamily switch
    {
        AddressFamily.InterNetwork => 4,
        AddressFamily.InterNetworkV6 => 6,
        _ => 0
    };
}

public sealed class NodeTcpSocket : IAsyncDisposable
{
    private readonly TcpClient client;
    private readonly CancellationTokenSource lifetime = new();
    private volatile bool connecting;
    private volatile bool destroyed;
    private Task connectCompletion = Task.CompletedTask;

    public NodeTcpSocket() : this(new TcpClient())
    {
    }

    internal NodeTcpSocket(TcpClient client)
        => this.client = client ?? throw new ArgumentNullException(nameof(client));

    public bool Connecting => connecting;
    public bool Destroyed => destroyed;
    public bool Connected => !destroyed && client.Connected;
    public Task ConnectCompletion => connectCompletion;

    public NodeTcpSocket Connect(
        string host,
        int port,
        Action<NodeTcpSocket>? onConnect = null)
    {
        if (destroyed)
            throw new NodeNetworkException("ERR_SOCKET_CLOSED", "Socket has been destroyed");
        if (connecting || client.Connected)
            throw new NodeNetworkException("ERR_SOCKET_ALREADY_BOUND", "Socket is already connecting or connected");
        if (string.IsNullOrEmpty(host))
            throw new NodeNetworkException("ERR_INVALID_ARG_VALUE", "host must be non-empty");
        if (port is < 1 or > 65535)
            throw new NodeNetworkException("ERR_SOCKET_BAD_PORT", "Port must be between 1 and 65535");

        connecting = true;
        connectCompletion = Task.Run(async () =>
        {
            await Task.Yield();
            try
            {
                await client.ConnectAsync(host, port, lifetime.Token).ConfigureAwait(false);
                onConnect?.Invoke(this);
            }
            catch (SocketException error)
            {
                throw NodeNetworkException.FromSocket(error, "connect");
            }
            finally
            {
                connecting = false;
            }
        }, lifetime.Token);
        return this;
    }

    public NodeTcpSocket Destroy()
    {
        if (destroyed)
            return this;
        destroyed = true;
        connecting = false;
        lifetime.Cancel();
        client.Dispose();
        return this;
    }

    internal Stream TransportStream
        => !destroyed && client.Connected
            ? client.GetStream()
            : throw new NodeNetworkException("ERR_SOCKET_CLOSED", "Socket is not connected");

    public ValueTask DisposeAsync()
    {
        Destroy();
        lifetime.Dispose();
        return ValueTask.CompletedTask;
    }
}
