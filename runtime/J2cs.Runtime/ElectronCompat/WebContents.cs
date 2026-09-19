using J2cs.Runtime;

namespace J2cs.Runtime.ElectronCompat;

public enum NavigationKind
{
    Url,
    File
}

public sealed record NavigationRequest(NavigationKind Kind, string Target);

public sealed record NavigationResult(
    bool Success,
    string? CommittedUrl = null,
    string? ErrorCode = null,
    string? ErrorDescription = null)
{
    public static NavigationResult Completed(string committedUrl) => new(true, committedUrl);
    public static NavigationResult Failed(string errorCode, string errorDescription)
        => new(false, null, errorCode, errorDescription);
}

public interface IWebContentsHost
{
    bool CanUnload();
    Task<NavigationResult> NavigateAsync(
        NavigationRequest request,
        CancellationToken cancellationToken = default);
    void Stop();
}

public class NavigationEventArgs : EventArgs
{
    public NavigationEventArgs(string target) => Target = target;
    public string Target { get; }
}

public sealed class NavigationFailedEventArgs : NavigationEventArgs
{
    public NavigationFailedEventArgs(string target, string errorCode, string errorDescription)
        : base(target)
        => (ErrorCode, ErrorDescription) = (errorCode, errorDescription);

    public string ErrorCode { get; }
    public string ErrorDescription { get; }
}

public sealed class NavigationException : InvalidOperationException
{
    public NavigationException(string errorCode, string message) : base(message)
        => ErrorCode = errorCode;

    public NavigationException(string errorCode, string message, Exception innerException)
        : base(message, innerException)
        => ErrorCode = errorCode;

    public string ErrorCode { get; }
}

/// <summary>
/// WebContents navigation contract. A native BrowserWindow may exist without a
/// renderer backend; renderer-dependent operations then reject explicitly instead
/// of pretending that ordinary .NET networking/UI is Chromium navigation.
/// </summary>
public sealed class WebContents
{
    private readonly BrowserWindow owner;
    private readonly IWebContentsHost? host;
    private string currentUrl = string.Empty;
    private bool destroyed;

    internal WebContents(BrowserWindow owner, IWebContentsHost? host)
        => (this.owner, this.host) = (owner, host);

    public event EventHandler<NavigationEventArgs>? DidStartLoading;
    public event EventHandler<NavigationEventArgs>? DidFinishLoad;
    public event EventHandler<NavigationFailedEventArgs>? DidFailLoad;
    public event EventHandler<NavigationEventArgs>? DidStopLoading;

    public bool IsLoading { get; private set; }
    public bool IsDestroyed => destroyed || owner.IsDestroyed();

    public string GetUrl()
    {
        EnsureAlive();
        return currentUrl;
    }

    public Task LoadUrlAsync(string url, CancellationToken cancellationToken = default)
    {
        EnsureAlive();
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || string.IsNullOrWhiteSpace(uri.Scheme))
            return Task.FromException(new NavigationException("ERR_INVALID_URL", "loadURL requires a protocol-qualified URL."));
        return NavigateAsync(new NavigationRequest(NavigationKind.Url, url), cancellationToken);
    }

    public Task LoadFileAsync(string filePath, CancellationToken cancellationToken = default)
    {
        EnsureAlive();
        if (string.IsNullOrWhiteSpace(filePath))
            return Task.FromException(new NavigationException("ERR_INVALID_FILE", "loadFile requires a non-empty file path."));
        return NavigateAsync(new NavigationRequest(NavigationKind.File, filePath), cancellationToken);
    }

    public void Stop()
    {
        EnsureAlive();
        RequireRenderer().Stop();
    }

    /// <summary>
    /// Canonical j2cs marks arbitrary executeJavaScript as unsupported for AOT.
    /// Keep the runtime boundary explicit so accidental wiring rejects rather than
    /// executing source strings or invoking a hidden JavaScript engine.
    /// </summary>
    public Task<JsValue> ExecuteJavaScriptAsync(string code, bool userGesture = false)
    {
        EnsureAlive();
        _ = code;
        _ = userGesture;
        return Task.FromException<JsValue>(
            new ElectronCompatibilityException(
                "webContents.executeJavaScript is unsupported by the Chromium/V8-free AOT contract."));
    }

    internal bool CanUnload()
    {
        if (destroyed) return true;
        return host?.CanUnload() ?? true;
    }

    internal void MarkDestroyed()
    {
        destroyed = true;
        IsLoading = false;
    }

    private async Task NavigateAsync(NavigationRequest request, CancellationToken cancellationToken)
    {
        EnsureAlive();
        var renderer = RequireRenderer();

        IsLoading = true;
        DidStartLoading?.Invoke(this, new NavigationEventArgs(request.Target));
        try
        {
            NavigationResult result;
            try
            {
                result = await renderer.NavigateAsync(request, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error)
            {
                var failed = new NavigationFailedEventArgs(request.Target, "ERR_FAILED", error.Message);
                DidFailLoad?.Invoke(this, failed);
                throw new NavigationException("ERR_FAILED", error.Message, error);
            }

            if (!result.Success)
            {
                var code = result.ErrorCode ?? "ERR_FAILED";
                var description = result.ErrorDescription ?? "Navigation failed.";
                DidFailLoad?.Invoke(this, new NavigationFailedEventArgs(request.Target, code, description));
                throw new NavigationException(code, description);
            }

            currentUrl = result.CommittedUrl ?? request.Target;
            DidFinishLoad?.Invoke(this, new NavigationEventArgs(currentUrl));
        }
        finally
        {
            IsLoading = false;
            DidStopLoading?.Invoke(this, new NavigationEventArgs(request.Target));
        }
    }

    private IWebContentsHost RequireRenderer()
        => host ?? throw new ElectronCompatibilityException(
            "Renderer/navigation backend is unavailable; WebContents operation remains fail-closed.");

    private void EnsureAlive()
    {
        if (IsDestroyed) throw new ElectronCompatibilityException("WebContents is destroyed.");
    }
}
