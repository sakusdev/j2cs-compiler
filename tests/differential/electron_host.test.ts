import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

test('Node vs C#: Electron app/window/navigation host contract ordering', { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2cs-electron-diff-'));
  const dotnet = process.env.DOTNET ?? 'dotnet';
  const runtimeProject = path.resolve('runtime/J2cs.Runtime/J2cs.Runtime.csproj');

  const csharp = String.raw`using J2cs.Runtime.ElectronCompat;

static string B(bool value) => value ? "true" : "false";

var application = new FakeApplication();
ElectronRuntime.Configure(new FakeHost(application));

Console.WriteLine("ready:" + B(App.IsReady));
application.MarkReady();
await App.WhenReadyAsync();
Console.WriteLine("ready:" + B(App.IsReady));

var window = BrowserWindow.Create(new BrowserWindowOptions { Width = 640, Height = 480, Show = false });
window.Shown += (_, _) => Console.WriteLine("window:shown");
window.Hidden += (_, _) => Console.WriteLine("window:hidden");
window.Focused += (_, _) => Console.WriteLine("window:focused");
window.Closed += (_, _) => Console.WriteLine("window:closed");

Console.WriteLine("visible:" + B(window.IsVisible()));
window.Show();
Console.WriteLine("visible:" + B(window.IsVisible()));
window.Hide();
Console.WriteLine("visible:" + B(window.IsVisible()));

window.SetSize(900, 700);
var bounds = window.GetBounds();
Console.WriteLine("bounds:" + bounds.Width + "x" + bounds.Height);

var contents = window.WebContents;
contents.DidStartLoading += (_, e) => Console.WriteLine("nav:start:" + e.Target);
contents.DidFinishLoad += (_, e) => Console.WriteLine("nav:finish:" + e.Target);
contents.DidFailLoad += (_, e) => Console.WriteLine("nav:fail:" + e.ErrorCode);
contents.DidStopLoading += (_, e) => Console.WriteLine("nav:stop:" + e.Target);

await contents.LoadUrlAsync("https://example.test/");
Console.WriteLine("url:" + contents.GetUrl());

try
{
    await contents.LoadUrlAsync("bad-scheme://x");
}
catch (NavigationException error)
{
    Console.WriteLine("nav:error:" + error.ErrorCode);
}

try
{
    await contents.ExecuteJavaScriptAsync("1 + 2");
}
catch (ElectronCompatibilityException)
{
    Console.WriteLine("execute:unsupported");
}

var cancelNextClose = true;
window.Closing += (_, e) =>
{
    Console.WriteLine("window:closing");
    if (cancelNextClose)
    {
        cancelNextClose = false;
        e.PreventDefault();
        Console.WriteLine("window:prevented");
    }
};
window.Close();
Console.WriteLine("destroyed:" + B(window.IsDestroyed()));
window.Close();
Console.WriteLine("destroyed:" + B(window.IsDestroyed()));

App.BeforeQuit += (_, _) => Console.WriteLine("app:before-quit");
App.WillQuit += (_, _) => Console.WriteLine("app:will-quit");
App.Quit();

sealed class FakeHost : IElectronHost
{
    public FakeHost(FakeApplication application)
    {
        Application = application;
        Windows = new FakeWindowFactory();
    }

    public IElectronApplicationHost Application { get; }
    public IBrowserWindowHostFactory Windows { get; }
}

sealed class FakeApplication : IElectronApplicationHost
{
    private readonly TaskCompletionSource<bool> ready =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public bool IsReady { get; private set; }

    public void MarkReady()
    {
        IsReady = true;
        ready.TrySetResult(true);
    }

    public Task WhenReadyAsync(CancellationToken cancellationToken = default)
        => IsReady ? Task.CompletedTask : ready.Task.WaitAsync(cancellationToken);

    public void Quit() => Console.WriteLine("host:quit");
    public void Exit(int exitCode) => Console.WriteLine("host:exit:" + exitCode);
}

sealed class FakeWindowFactory : IBrowserWindowHostFactory
{
    public IBrowserWindowHost Create(BrowserWindowOptions options) => new FakeWindow(options);
}

sealed class FakeWindow : IBrowserWindowHost
{
    private WindowBounds bounds;

    public FakeWindow(BrowserWindowOptions options)
    {
        bounds = new WindowBounds(options.X, options.Y, options.Width, options.Height);
        WebContents = new FakeWebContents();
    }

    public IWebContentsHost? WebContents { get; }
    public WindowBounds GetBounds() => bounds;

    public void SetBounds(WindowBounds value)
    {
        bounds = value;
        Console.WriteLine("host:bounds:" + value.Width + "x" + value.Height);
    }

    public void Show() => Console.WriteLine("host:show");
    public void Hide() => Console.WriteLine("host:hide");
    public void Focus() => Console.WriteLine("host:focus");
    public void Blur() => Console.WriteLine("host:blur");

    public bool TryClose()
    {
        Console.WriteLine("host:close");
        return true;
    }

    public void Destroy() => Console.WriteLine("host:destroy");
    public void Dispose() { }
}

sealed class FakeWebContents : IWebContentsHost
{
    public bool CanUnload() => true;

    public async Task<NavigationResult> NavigateAsync(
        NavigationRequest request,
        CancellationToken cancellationToken = default)
    {
        Console.WriteLine("host:navigate:" + request.Target);
        await Task.Yield();
        cancellationToken.ThrowIfCancellationRequested();
        if (request.Target.StartsWith("bad-scheme:", StringComparison.Ordinal))
            return NavigationResult.Failed("ERR_TEST", "synthetic failure");
        return NavigationResult.Completed(request.Target);
    }

    public void Stop() => Console.WriteLine("host:stop");
}
`;

  const node = String.raw`const B = value => value ? 'true' : 'false';
let ready = false;
console.log('ready:' + B(ready));
ready = true;
await Promise.resolve();
console.log('ready:' + B(ready));

let visible = false;
let destroyed = false;
console.log('visible:' + B(visible));
console.log('host:show');
visible = true;
console.log('window:shown');
console.log('host:focus');
console.log('window:focused');
console.log('visible:' + B(visible));
console.log('host:hide');
visible = false;
console.log('window:hidden');
console.log('visible:' + B(visible));

console.log('host:bounds:900x700');
console.log('bounds:900x700');

async function navigate(target) {
  console.log('nav:start:' + target);
  console.log('host:navigate:' + target);
  await Promise.resolve();
  if (target.startsWith('bad-scheme:')) {
    console.log('nav:fail:ERR_TEST');
    console.log('nav:stop:' + target);
    throw Object.assign(new Error('synthetic failure'), { code: 'ERR_TEST' });
  }
  console.log('nav:finish:' + target);
  console.log('nav:stop:' + target);
  return target;
}

let currentUrl = await navigate('https://example.test/');
console.log('url:' + currentUrl);
try { await navigate('bad-scheme://x'); }
catch (error) { console.log('nav:error:' + error.code); }

try { throw new Error('unsupported'); }
catch { console.log('execute:unsupported'); }

let cancelNextClose = true;
function close() {
  console.log('window:closing');
  if (cancelNextClose) {
    cancelNextClose = false;
    console.log('window:prevented');
    return;
  }
  console.log('host:close');
  destroyed = true;
  console.log('window:closed');
}
close();
console.log('destroyed:' + B(destroyed));
close();
console.log('destroyed:' + B(destroyed));

console.log('app:before-quit');
console.log('app:will-quit');
console.log('host:quit');
`;

  try {
    await writeFile(path.join(dir, 'HostProbe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${xml(runtimeProject)}" />
  </ItemGroup>
</Project>
`);
    await writeFile(path.join(dir, 'Program.cs'), csharp);
    await writeFile(path.join(dir, 'oracle.mjs'), node);

    const build = await run(dotnet, ['build', 'HostProbe.csproj', '--nologo', '-v', 'quiet'], dir, 60_000);
    assert.equal(build.exit, 0, 'Electron host probe failed to build:\n' + build.stdout + '\n' + build.stderr);

    const nodeRun = await run(process.execPath, ['oracle.mjs'], dir);
    const csharpRun = await run(dotnet, [path.join(dir, 'bin/Debug/net8.0/HostProbe.dll')], dir);
    const normalize = (value: string) => value.replaceAll('\r\n', '\n');

    assert.equal(csharpRun.exit, nodeRun.exit);
    assert.equal(normalize(csharpRun.stderr), normalize(nodeRun.stderr));
    assert.equal(normalize(csharpRun.stdout), normalize(nodeRun.stdout),
      'Electron host lifecycle/navigation observations differ from Node oracle');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
