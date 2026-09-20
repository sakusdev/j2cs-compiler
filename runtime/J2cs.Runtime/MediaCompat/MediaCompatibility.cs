namespace J2cs.Runtime.MediaCompat;

public enum MediaDeviceKind
{
    AudioInput,
    VideoInput,
    AudioOutput,
}

public enum MediaTrackKind
{
    Audio,
    Video,
}

public enum MediaTrackReadyState
{
    Live,
    Ended,
}

public enum MediaPermissionKind
{
    Camera,
    Microphone,
    DisplayCapture,
}

public sealed record MediaNumericConstraint(
    double? Exact = null,
    double? Ideal = null,
    double? Min = null,
    double? Max = null);

public sealed record MediaStringConstraint(string? Exact = null, string? Ideal = null);

public sealed record MediaTrackConstraints(
    MediaStringConstraint? DeviceId = null,
    MediaNumericConstraint? Width = null,
    MediaNumericConstraint? Height = null,
    MediaNumericConstraint? FrameRate = null,
    MediaNumericConstraint? SampleRate = null,
    MediaNumericConstraint? ChannelCount = null);

public sealed record MediaCaptureRequest(MediaTrackConstraints? Audio, MediaTrackConstraints? Video);

public sealed record DisplayCaptureRequest(MediaTrackConstraints Video, MediaTrackConstraints? Audio = null);

public sealed record MediaDeviceDescriptor(
    string DeviceId,
    MediaDeviceKind Kind,
    string Label,
    string GroupId);

public sealed record MediaDeviceInfo(
    string DeviceId,
    MediaDeviceKind Kind,
    string Label,
    string GroupId);

public sealed record MediaTrackSettings(
    string DeviceId,
    int? Width = null,
    int? Height = null,
    double? FrameRate = null,
    int? SampleRate = null,
    int? ChannelCount = null);

public sealed record NativeMediaTrackDescriptor(
    string Id,
    MediaTrackKind Kind,
    string Label,
    MediaTrackSettings Settings);

public sealed record NativeMediaStreamDescriptor(
    string Id,
    IReadOnlyList<NativeMediaTrackDescriptor> Tracks);

public sealed record MediaCodecCapability(
    string MimeType,
    int ClockRate,
    int Channels = 0,
    string? SdpFmtpLine = null,
    bool HardwareAccelerated = false);

public sealed class MediaEngineCapabilities
{
    private readonly MediaCodecCapability[] _audioCodecs;
    private readonly MediaCodecCapability[] _videoCodecs;

    public MediaEngineCapabilities(
        IEnumerable<MediaCodecCapability> audioCodecs,
        IEnumerable<MediaCodecCapability> videoCodecs,
        bool screenCaptureAvailable)
    {
        _audioCodecs = audioCodecs.ToArray();
        _videoCodecs = videoCodecs.ToArray();
        ScreenCaptureAvailable = screenCaptureAvailable;
    }

    public IReadOnlyList<MediaCodecCapability> AudioCodecs => _audioCodecs;
    public IReadOnlyList<MediaCodecCapability> VideoCodecs => _videoCodecs;
    public bool ScreenCaptureAvailable { get; }

    public bool SupportsMimeType(string mimeType) =>
        _audioCodecs.Concat(_videoCodecs).Any(codec =>
            string.Equals(codec.MimeType, mimeType, StringComparison.OrdinalIgnoreCase));

    public bool SupportsOpus => _audioCodecs.Any(codec =>
        string.Equals(codec.MimeType, "audio/opus", StringComparison.OrdinalIgnoreCase) &&
        codec.ClockRate == 48_000);
}

public enum MediaBackendError
{
    PermissionDenied,
    DeviceNotFound,
    ConstraintUnsatisfied,
    NotReadable,
    Unsupported,
    InvalidState,
    Aborted,
}

public sealed class MediaBackendException : Exception
{
    public MediaBackendException(MediaBackendError code, string message, string? constraint = null)
        : base(message)
    {
        Code = code;
        Constraint = constraint;
    }

    public MediaBackendError Code { get; }
    public string? Constraint { get; }
}

public sealed class MediaApiException : Exception
{
    public MediaApiException(string name, string message, string? constraint = null, Exception? innerException = null)
        : base(message, innerException)
    {
        Name = name;
        Constraint = constraint;
    }

    public string Name { get; }
    public string? Constraint { get; }
}

public interface IMediaPermissionPolicy
{
    ValueTask<bool> HasPermissionAsync(MediaPermissionKind kind, CancellationToken cancellationToken = default);
    ValueTask<bool> RequestPermissionAsync(MediaPermissionKind kind, CancellationToken cancellationToken = default);
}

public interface IMediaCaptureBackend
{
    MediaEngineCapabilities Capabilities { get; }
    Task<IReadOnlyList<MediaDeviceDescriptor>> EnumerateDevicesAsync(CancellationToken cancellationToken = default);
    Task<NativeMediaStreamDescriptor> GetUserMediaAsync(MediaCaptureRequest request, CancellationToken cancellationToken = default);
    Task<NativeMediaStreamDescriptor> GetDisplayMediaAsync(DisplayCaptureRequest request, CancellationToken cancellationToken = default);
    IRtcPeerConnectionBackend CreatePeerConnection(RtcConfiguration configuration);
}

public sealed class MediaStreamTrack
{
    internal MediaStreamTrack(NativeMediaTrackDescriptor descriptor)
    {
        if (string.IsNullOrEmpty(descriptor.Id)) throw new MediaApiException("InvalidStateError", "Native media track id must be non-empty.");
        Id = descriptor.Id;
        Kind = descriptor.Kind;
        Label = descriptor.Label;
        Settings = descriptor.Settings;
    }

    public string Id { get; }
    public MediaTrackKind Kind { get; }
    public string Label { get; }
    public MediaTrackSettings Settings { get; }
    public bool Enabled { get; set; } = true;
    public bool Muted { get; internal set; }
    public MediaTrackReadyState ReadyState { get; private set; } = MediaTrackReadyState.Live;

    public void Stop()
    {
        ReadyState = MediaTrackReadyState.Ended;
    }
}

public sealed class MediaStream
{
    private readonly MediaStreamTrack[] _tracks;

    internal MediaStream(NativeMediaStreamDescriptor descriptor)
    {
        if (string.IsNullOrEmpty(descriptor.Id)) throw new MediaApiException("InvalidStateError", "Native media stream id must be non-empty.");
        Id = descriptor.Id;
        _tracks = descriptor.Tracks.Select(track => new MediaStreamTrack(track)).ToArray();
        if (_tracks.Select(track => track.Id).Distinct(StringComparer.Ordinal).Count() != _tracks.Length)
            throw new MediaApiException("InvalidStateError", "Native media stream contains duplicate track ids.");
    }

    public string Id { get; }
    public bool Active => _tracks.Any(track => track.ReadyState == MediaTrackReadyState.Live);

    public IReadOnlyList<MediaStreamTrack> GetTracks() => _tracks.ToArray();
    public IReadOnlyList<MediaStreamTrack> GetAudioTracks() => _tracks.Where(track => track.Kind == MediaTrackKind.Audio).ToArray();
    public IReadOnlyList<MediaStreamTrack> GetVideoTracks() => _tracks.Where(track => track.Kind == MediaTrackKind.Video).ToArray();

    public MediaStreamTrack? GetTrackById(string id) =>
        _tracks.FirstOrDefault(track => string.Equals(track.Id, id, StringComparison.Ordinal));
}

public sealed class MediaDevices
{
    private readonly IMediaCaptureBackend _backend;
    private readonly IMediaPermissionPolicy _permissions;

    internal MediaDevices(IMediaCaptureBackend backend, IMediaPermissionPolicy permissions)
    {
        _backend = backend;
        _permissions = permissions;
    }

    public async Task<IReadOnlyList<MediaDeviceInfo>> EnumerateDevicesAsync(CancellationToken cancellationToken = default)
    {
        var camera = await _permissions.HasPermissionAsync(MediaPermissionKind.Camera, cancellationToken).ConfigureAwait(false);
        var microphone = await _permissions.HasPermissionAsync(MediaPermissionKind.Microphone, cancellationToken).ConfigureAwait(false);
        IReadOnlyList<MediaDeviceDescriptor> devices;
        try
        {
            devices = await _backend.EnumerateDevicesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (MediaBackendException error)
        {
            throw Translate(error);
        }

        return devices.Select(device =>
        {
            var reveal = device.Kind switch
            {
                MediaDeviceKind.AudioInput => microphone,
                MediaDeviceKind.VideoInput => camera,
                MediaDeviceKind.AudioOutput => microphone || camera,
                _ => false,
            };
            return new MediaDeviceInfo(device.DeviceId, device.Kind, reveal ? device.Label : string.Empty, reveal ? device.GroupId : string.Empty);
        }).ToArray();
    }

    public async Task<MediaStream> GetUserMediaAsync(MediaCaptureRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Audio is null && request.Video is null)
            throw new MediaApiException("TypeError", "At least one of audio or video must be requested.");

        if (request.Audio is not null && !await _permissions.RequestPermissionAsync(MediaPermissionKind.Microphone, cancellationToken).ConfigureAwait(false))
            throw new MediaApiException("NotAllowedError", "Microphone capture permission was denied.");
        if (request.Video is not null && !await _permissions.RequestPermissionAsync(MediaPermissionKind.Camera, cancellationToken).ConfigureAwait(false))
            throw new MediaApiException("NotAllowedError", "Camera capture permission was denied.");

        try
        {
            return Materialize(await _backend.GetUserMediaAsync(request, cancellationToken).ConfigureAwait(false));
        }
        catch (MediaBackendException error)
        {
            throw Translate(error);
        }
    }

    public async Task<MediaStream> GetDisplayMediaAsync(DisplayCaptureRequest request, CancellationToken cancellationToken = default)
    {
        if (!_backend.Capabilities.ScreenCaptureAvailable)
            throw new MediaApiException("NotSupportedError", "Display capture is unavailable in the active media backend.");
        if (!await _permissions.RequestPermissionAsync(MediaPermissionKind.DisplayCapture, cancellationToken).ConfigureAwait(false))
            throw new MediaApiException("NotAllowedError", "Display capture permission was denied.");

        try
        {
            return Materialize(await _backend.GetDisplayMediaAsync(request, cancellationToken).ConfigureAwait(false));
        }
        catch (MediaBackendException error)
        {
            throw Translate(error);
        }
    }

    private static MediaStream Materialize(NativeMediaStreamDescriptor descriptor) => new(descriptor);

    internal static MediaApiException Translate(MediaBackendException error) => error.Code switch
    {
        MediaBackendError.PermissionDenied => new MediaApiException("NotAllowedError", error.Message, error.Constraint, error),
        MediaBackendError.DeviceNotFound => new MediaApiException("NotFoundError", error.Message, error.Constraint, error),
        MediaBackendError.ConstraintUnsatisfied => new MediaApiException("OverconstrainedError", error.Message, error.Constraint, error),
        MediaBackendError.NotReadable => new MediaApiException("NotReadableError", error.Message, error.Constraint, error),
        MediaBackendError.Unsupported => new MediaApiException("NotSupportedError", error.Message, error.Constraint, error),
        MediaBackendError.InvalidState => new MediaApiException("InvalidStateError", error.Message, error.Constraint, error),
        _ => new MediaApiException("AbortError", error.Message, error.Constraint, error),
    };
}

public sealed record RtcIceServer(IReadOnlyList<string> Urls, string? Username = null, string? Credential = null);

public sealed record RtcConfiguration(IReadOnlyList<RtcIceServer> IceServers);

public enum RtcSessionDescriptionType
{
    Offer,
    Pranswer,
    Answer,
    Rollback,
}

public sealed record RtcSessionDescription(RtcSessionDescriptionType Type, string Sdp);

public sealed record RtcIceCandidate(
    string Candidate,
    string? SdpMid = null,
    int? SdpMLineIndex = null,
    string? UsernameFragment = null);

public enum RtcSignalingState
{
    Stable,
    HaveLocalOffer,
    HaveRemoteOffer,
    HaveLocalPranswer,
    HaveRemotePranswer,
    Closed,
}

public enum RtcIceGatheringState
{
    New,
    Gathering,
    Complete,
}

public enum RtcIceConnectionState
{
    New,
    Checking,
    Connected,
    Completed,
    Failed,
    Disconnected,
    Closed,
}

public enum RtcPeerConnectionState
{
    New,
    Connecting,
    Connected,
    Disconnected,
    Failed,
    Closed,
}

public sealed record RtcPeerConnectionSnapshot(
    RtcSignalingState SignalingState,
    RtcIceGatheringState IceGatheringState,
    RtcIceConnectionState IceConnectionState,
    RtcPeerConnectionState ConnectionState);

public sealed record RtcStatsEntry(
    string Id,
    string Type,
    double TimestampMilliseconds,
    long? BytesSent = null,
    long? BytesReceived = null,
    long? PacketsSent = null,
    long? PacketsReceived = null,
    double? JitterSeconds = null,
    double? RoundTripTimeSeconds = null,
    string? CodecMimeType = null);

public sealed class RtcStatsReport
{
    private readonly RtcStatsEntry[] _entries;
    private readonly Dictionary<string, RtcStatsEntry> _byId;

    public RtcStatsReport(IEnumerable<RtcStatsEntry> entries)
    {
        _entries = entries.ToArray();
        _byId = new Dictionary<string, RtcStatsEntry>(StringComparer.Ordinal);
        foreach (var entry in _entries)
        {
            if (!_byId.TryAdd(entry.Id, entry))
                throw new MediaApiException("InvalidStateError", $"Duplicate RTC stats id: {entry.Id}");
        }
    }

    public IReadOnlyList<RtcStatsEntry> Entries => _entries;
    public RtcStatsEntry? Get(string id) => _byId.GetValueOrDefault(id);
}

public interface IRtcPeerConnectionBackend
{
    RtcPeerConnectionSnapshot Snapshot { get; }
    Task<RtcSessionDescription> CreateOfferAsync(CancellationToken cancellationToken = default);
    Task<RtcSessionDescription> CreateAnswerAsync(CancellationToken cancellationToken = default);
    Task SetLocalDescriptionAsync(RtcSessionDescription description, CancellationToken cancellationToken = default);
    Task SetRemoteDescriptionAsync(RtcSessionDescription description, CancellationToken cancellationToken = default);
    Task AddIceCandidateAsync(RtcIceCandidate? candidate, CancellationToken cancellationToken = default);
    Task<RtcStatsReport> GetStatsAsync(CancellationToken cancellationToken = default);
    void Close();
}

public sealed class RtcPeerConnection
{
    private readonly IRtcPeerConnectionBackend _backend;
    private bool _closed;

    internal RtcPeerConnection(IRtcPeerConnectionBackend backend)
    {
        _backend = backend;
    }

    public RtcPeerConnectionSnapshot Snapshot
    {
        get
        {
            var snapshot = _backend.Snapshot;
            return !_closed ? snapshot : snapshot with
            {
                SignalingState = RtcSignalingState.Closed,
                IceConnectionState = RtcIceConnectionState.Closed,
                ConnectionState = RtcPeerConnectionState.Closed,
            };
        }
    }

    public async Task<RtcSessionDescription> CreateOfferAsync(CancellationToken cancellationToken = default)
    {
        EnsureOpen();
        return await Execute(() => _backend.CreateOfferAsync(cancellationToken)).ConfigureAwait(false);
    }

    public async Task<RtcSessionDescription> CreateAnswerAsync(CancellationToken cancellationToken = default)
    {
        EnsureOpen();
        return await Execute(() => _backend.CreateAnswerAsync(cancellationToken)).ConfigureAwait(false);
    }

    public async Task SetLocalDescriptionAsync(RtcSessionDescription description, CancellationToken cancellationToken = default)
    {
        EnsureOpen();
        await Execute(() => _backend.SetLocalDescriptionAsync(description, cancellationToken)).ConfigureAwait(false);
    }

    public async Task SetRemoteDescriptionAsync(RtcSessionDescription description, CancellationToken cancellationToken = default)
    {
        EnsureOpen();
        await Execute(() => _backend.SetRemoteDescriptionAsync(description, cancellationToken)).ConfigureAwait(false);
    }

    public async Task AddIceCandidateAsync(RtcIceCandidate? candidate, CancellationToken cancellationToken = default)
    {
        EnsureOpen();
        await Execute(() => _backend.AddIceCandidateAsync(candidate, cancellationToken)).ConfigureAwait(false);
    }

    public async Task<RtcStatsReport> GetStatsAsync(CancellationToken cancellationToken = default) =>
        await Execute(() => _backend.GetStatsAsync(cancellationToken)).ConfigureAwait(false);

    public void Close()
    {
        if (_closed) return;
        _closed = true;
        _backend.Close();
    }

    private void EnsureOpen()
    {
        if (_closed || _backend.Snapshot.SignalingState == RtcSignalingState.Closed)
            throw new MediaApiException("InvalidStateError", "RTCPeerConnection is closed.");
    }

    private static async Task<T> Execute<T>(Func<Task<T>> operation)
    {
        try
        {
            return await operation().ConfigureAwait(false);
        }
        catch (MediaBackendException error)
        {
            throw MediaDevices.Translate(error);
        }
    }

    private static async Task Execute(Func<Task> operation)
    {
        try
        {
            await operation().ConfigureAwait(false);
        }
        catch (MediaBackendException error)
        {
            throw MediaDevices.Translate(error);
        }
    }
}

public sealed class MediaRuntime
{
    private readonly IMediaCaptureBackend _backend;

    public MediaRuntime(IMediaCaptureBackend backend, IMediaPermissionPolicy permissions)
    {
        _backend = backend;
        Devices = new MediaDevices(backend, permissions);
    }

    public MediaDevices Devices { get; }
    public MediaEngineCapabilities Capabilities => _backend.Capabilities;

    public RtcPeerConnection CreatePeerConnection(RtcConfiguration configuration) =>
        new(_backend.CreatePeerConnection(configuration));
}
