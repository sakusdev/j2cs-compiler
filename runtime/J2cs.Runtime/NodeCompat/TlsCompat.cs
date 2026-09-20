using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;

namespace J2cs.Runtime.NodeCompat;

public sealed class NodeTlsClient : IAsyncDisposable
{
    private readonly TcpClient client = new();
    private readonly CancellationTokenSource lifetime = new();
    private SslStream? tls;
    private volatile bool connecting;
    private volatile bool secure;
    private volatile bool destroyed;
    private Task connectCompletion = Task.CompletedTask;

    public bool Connecting => connecting;
    public bool Secure => secure;
    public bool Destroyed => destroyed;
    public Task ConnectCompletion => connectCompletion;

    public NodeTlsClient Connect(
        string host,
        int port,
        bool rejectUnauthorized = true,
        Action<NodeTlsClient>? onSecureConnect = null)
    {
        if (destroyed)
            throw new NodeNetworkException("ERR_SOCKET_CLOSED", "TLS socket has been destroyed");
        if (connecting || secure || client.Connected)
            throw new NodeNetworkException("ERR_SOCKET_ALREADY_BOUND", "TLS socket is already connecting or connected");
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
                tls = rejectUnauthorized
                    ? new SslStream(client.GetStream(), leaveInnerStreamOpen: false)
                    : new SslStream(
                        client.GetStream(),
                        leaveInnerStreamOpen: false,
                        static (_, _, _, _) => true);

                var options = new SslClientAuthenticationOptions
                {
                    TargetHost = host
                };
                await tls.AuthenticateAsClientAsync(options, lifetime.Token).ConfigureAwait(false);
                secure = true;
                connecting = false;
                onSecureConnect?.Invoke(this);
            }
            catch (SocketException error)
            {
                throw NodeNetworkException.FromSocket(error, "tls.connect");
            }
            catch (AuthenticationException error)
            {
                throw new NodeNetworkException("ERR_TLS_HANDSHAKE", error.Message, error);
            }
            finally
            {
                connecting = false;
            }
        }, lifetime.Token);
        return this;
    }

    public NodeTlsClient Destroy()
    {
        if (destroyed)
            return this;
        destroyed = true;
        secure = false;
        connecting = false;
        lifetime.Cancel();
        tls?.Dispose();
        client.Dispose();
        return this;
    }

    public ValueTask DisposeAsync()
    {
        Destroy();
        lifetime.Dispose();
        return ValueTask.CompletedTask;
    }
}
