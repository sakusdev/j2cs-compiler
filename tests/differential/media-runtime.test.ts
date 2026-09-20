import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

const nodeSource = `
const permissions = new Set();
const devices = [
  {deviceId:'mic-1',kind:'audioinput',label:'Desk Mic',groupId:'g1'},
  {deviceId:'cam-1',kind:'videoinput',label:'Front Camera',groupId:'g2'},
  {deviceId:'spk-1',kind:'audiooutput',label:'Speakers',groupId:'g1'},
];
function enumerate() {
  const camera = permissions.has('camera'), microphone = permissions.has('microphone');
  return devices.map(d => {
    const reveal = d.kind === 'audioinput' ? microphone : d.kind === 'videoinput' ? camera : microphone || camera;
    return {...d,label:reveal?d.label:'',groupId:reveal?d.groupId:''};
  });
}
console.log(enumerate().map(d=>d.deviceId+':'+d.label+':'+d.groupId).join('|'));
permissions.add('camera'); permissions.add('microphone');
console.log(enumerate().map(d=>d.deviceId+':'+d.label+':'+d.groupId).join('|'));
const audio = {id:'a1',kind:'audio',readyState:'live'};
const video = {id:'v1',kind:'video',readyState:'live'};
const stream = {id:'s1',tracks:[audio,video]};
console.log(stream.id, stream.tracks.length, stream.tracks[0] === audio, stream.tracks.find(t=>t.id==='v1') === video);
audio.readyState='ended';
console.log(audio.readyState, stream.tracks.some(t=>t.readyState==='live'));
console.log('audio/opus',48000,true,'video/VP8',true);
try { throw Object.assign(new Error('width rejected'), {name:'OverconstrainedError',constraint:'width'}); }
catch (e) { console.log(e.name,e.constraint); }
console.log('NotAllowedError',0);
const pc = {closed:false,state:'new'};
console.log('offer','connected',42,'audio/opus');
pc.closed=true;
console.log('closed','closed');
try { if (pc.closed) throw Object.assign(new Error('closed'), {name:'InvalidStateError'}); }
catch (e) { console.log(e.name); }
`;

const csharpSource = `using J2cs.Runtime.MediaCompat;

public sealed class PermissionPolicy : IMediaPermissionPolicy
{
    private readonly HashSet<MediaPermissionKind> _granted = new();
    public void Grant(MediaPermissionKind kind) => _granted.Add(kind);
    public ValueTask<bool> HasPermissionAsync(MediaPermissionKind kind, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(_granted.Contains(kind));
    public ValueTask<bool> RequestPermissionAsync(MediaPermissionKind kind, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(_granted.Contains(kind));
}

public sealed class FakePeerBackend : IRtcPeerConnectionBackend
{
    private bool _closed;
    public RtcPeerConnectionSnapshot Snapshot => _closed
        ? new(RtcSignalingState.Closed, RtcIceGatheringState.Complete, RtcIceConnectionState.Closed, RtcPeerConnectionState.Closed)
        : new(RtcSignalingState.Stable, RtcIceGatheringState.Complete, RtcIceConnectionState.Connected, RtcPeerConnectionState.Connected);
    public Task<RtcSessionDescription> CreateOfferAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(new RtcSessionDescription(RtcSessionDescriptionType.Offer, "offer"));
    public Task<RtcSessionDescription> CreateAnswerAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(new RtcSessionDescription(RtcSessionDescriptionType.Answer, "answer"));
    public Task SetLocalDescriptionAsync(RtcSessionDescription description, CancellationToken cancellationToken = default) => Task.CompletedTask;
    public Task SetRemoteDescriptionAsync(RtcSessionDescription description, CancellationToken cancellationToken = default) => Task.CompletedTask;
    public Task AddIceCandidateAsync(RtcIceCandidate? candidate, CancellationToken cancellationToken = default) => Task.CompletedTask;
    public Task<RtcStatsReport> GetStatsAsync(CancellationToken cancellationToken = default) => Task.FromResult(new RtcStatsReport(new[]
    {
        new RtcStatsEntry("out-1", "outbound-rtp", 1000, BytesSent: 42, CodecMimeType: "audio/opus")
    }));
    public void Close() => _closed = true;
}

public sealed class FakeMediaBackend : IMediaCaptureBackend
{
    public int DisplayCalls { get; private set; }
    public MediaEngineCapabilities Capabilities { get; } = new(
        new[] { new MediaCodecCapability("audio/opus", 48_000, Channels: 2) },
        new[] { new MediaCodecCapability("video/VP8", 90_000) },
        screenCaptureAvailable: true);

    public Task<IReadOnlyList<MediaDeviceDescriptor>> EnumerateDevicesAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<MediaDeviceDescriptor>>(new[]
        {
            new MediaDeviceDescriptor("mic-1", MediaDeviceKind.AudioInput, "Desk Mic", "g1"),
            new MediaDeviceDescriptor("cam-1", MediaDeviceKind.VideoInput, "Front Camera", "g2"),
            new MediaDeviceDescriptor("spk-1", MediaDeviceKind.AudioOutput, "Speakers", "g1"),
        });

    public Task<NativeMediaStreamDescriptor> GetUserMediaAsync(MediaCaptureRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Video?.Width?.Exact == 9999)
            throw new MediaBackendException(MediaBackendError.ConstraintUnsatisfied, "width rejected", "width");
        return Task.FromResult(new NativeMediaStreamDescriptor("s1", new[]
        {
            new NativeMediaTrackDescriptor("a1", MediaTrackKind.Audio, "Desk Mic", new MediaTrackSettings("mic-1", SampleRate: 48_000, ChannelCount: 2)),
            new NativeMediaTrackDescriptor("v1", MediaTrackKind.Video, "Front Camera", new MediaTrackSettings("cam-1", Width: 1280, Height: 720, FrameRate: 30)),
        }));
    }

    public Task<NativeMediaStreamDescriptor> GetDisplayMediaAsync(DisplayCaptureRequest request, CancellationToken cancellationToken = default)
    {
        DisplayCalls++;
        return Task.FromResult(new NativeMediaStreamDescriptor("screen", new[]
        {
            new NativeMediaTrackDescriptor("screen-1", MediaTrackKind.Video, "Screen 1", new MediaTrackSettings("screen", Width: 1920, Height: 1080, FrameRate: 60)),
        }));
    }

    public IRtcPeerConnectionBackend CreatePeerConnection(RtcConfiguration configuration) => new FakePeerBackend();
}

public static class Program
{
    private static string B(bool value) => value ? "true" : "false";
    private static string Devices(IReadOnlyList<MediaDeviceInfo> devices) => string.Join("|", devices.Select(d => $"{d.DeviceId}:{d.Label}:{d.GroupId}"));

    public static async Task Main()
    {
        var permissions = new PermissionPolicy();
        var backend = new FakeMediaBackend();
        var runtime = new MediaRuntime(backend, permissions);
        Console.WriteLine(Devices(await runtime.Devices.EnumerateDevicesAsync()));
        permissions.Grant(MediaPermissionKind.Camera);
        permissions.Grant(MediaPermissionKind.Microphone);
        Console.WriteLine(Devices(await runtime.Devices.EnumerateDevicesAsync()));

        var stream = await runtime.Devices.GetUserMediaAsync(new MediaCaptureRequest(new MediaTrackConstraints(), new MediaTrackConstraints()));
        var all = stream.GetTracks();
        var audio = stream.GetAudioTracks()[0];
        var video = stream.GetTrackById("v1");
        Console.WriteLine($"{stream.Id} {all.Count} {B(ReferenceEquals(all[0], audio))} {B(ReferenceEquals(all[1], video))}");
        audio.Stop();
        Console.WriteLine($"{audio.ReadyState.ToString().ToLowerInvariant()} {B(stream.Active)}");
        Console.WriteLine($"{runtime.Capabilities.AudioCodecs[0].MimeType} {runtime.Capabilities.AudioCodecs[0].ClockRate} {B(runtime.Capabilities.SupportsOpus)} {runtime.Capabilities.VideoCodecs[0].MimeType} {B(runtime.Capabilities.SupportsMimeType("video/vp8"))}");

        try
        {
            await runtime.Devices.GetUserMediaAsync(new MediaCaptureRequest(null, new MediaTrackConstraints(Width: new MediaNumericConstraint(Exact: 9999))));
        }
        catch (MediaApiException error)
        {
            Console.WriteLine($"{error.Name} {error.Constraint}");
        }

        try
        {
            await runtime.Devices.GetDisplayMediaAsync(new DisplayCaptureRequest(new MediaTrackConstraints()));
        }
        catch (MediaApiException error)
        {
            Console.WriteLine($"{error.Name} {backend.DisplayCalls}");
        }

        var pc = runtime.CreatePeerConnection(new RtcConfiguration(new[] { new RtcIceServer(new[] { "stun:stun.example.test" }) }));
        var offer = await pc.CreateOfferAsync();
        var stats = await pc.GetStatsAsync();
        Console.WriteLine($"{offer.Sdp} {pc.Snapshot.ConnectionState.ToString().ToLowerInvariant()} {stats.Get("out-1")?.BytesSent} {stats.Get("out-1")?.CodecMimeType}");
        pc.Close();
        Console.WriteLine($"{pc.Snapshot.SignalingState.ToString().ToLowerInvariant()} {pc.Snapshot.ConnectionState.ToString().ToLowerInvariant()}");
        try
        {
            await pc.CreateOfferAsync();
        }
        catch (MediaApiException error)
        {
            Console.WriteLine(error.Name);
        }
    }
}
`;

function xmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

test('Node vs C# media host contract: permissions, tracks, codecs, constraints and peer lifecycle', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-media-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  try {
    await writeFile(path.join(dir, 'oracle.cjs'), nodeSource);
    await writeFile(path.join(dir, 'Program.cs'), csharpSource);
    const runtimeProject = path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj');
    await writeFile(path.join(dir, 'Probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${xmlAttribute(runtimeProject)}" />
  </ItemGroup>
</Project>\n`);

    const build = await run(dotnet, ['build', 'Probe.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`);
    const node = await run(process.execPath, ['oracle.cjs'], dir);
    const csharp = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/Probe.dll')], dir);
    assert.equal(node.exit, 0, node.stderr);
    const normalize = (value: typeof node) => ({
      ...value,
      stdout: value.stdout.replace(/\r\n/g, '\n'),
      stderr: value.stderr.replace(/\r\n/g, '\n'),
    });
    assert.deepEqual(normalize(csharp), normalize(node), 'Media runtime trace differs from Node oracle');
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`media-runtime: ${String(error)}\nReproduction artifacts: ${dir}`, { cause: error });
  }
});
