import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { run } from './harness.js';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function project(runtimeProject: string): string {
  return [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    '    <OutputType>Exe</OutputType>',
    '    <TargetFramework>net8.0</TargetFramework>',
    '    <ImplicitUsings>enable</ImplicitUsings>',
    '    <Nullable>enable</Nullable>',
    '    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>',
    '    <AssemblyName>ElectronDesktopFixture</AssemblyName>',
    '  </PropertyGroup>',
    '  <ItemGroup>',
    '    <ProjectReference Include="' + xml(runtimeProject) + '" />',
    '  </ItemGroup>',
    '</Project>',
    '',
  ].join('\n');
}

test('Electron desktop host contract matches deterministic Node reference semantics', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'j2cs-electron-desktop-'));
  const nodeDir = path.join(root, 'node');
  const csharpDir = path.join(root, 'csharp');
  await mkdir(nodeDir);
  await mkdir(csharpDir);

  const nodeSource = [
    "const a={id:'a',label:'A'}, b={id:'b',label:'B'};",
    'const menu=[a,b];',
    "console.log('menu:'+menu.map(x=>x.id).join(','));",
    "console.log('menuIdentity:'+(menu.find(x=>x.id==='a')===a));",
    "let tray={destroyed:false,tooltip:'',menu:null}; tray.tooltip='tip'; tray.menu=menu;",
    "console.log('tray:'+tray.destroyed+'|'+tray.tooltip+'|'+(tray.menu===menu));",
    "tray.destroyed=true; console.log('trayDestroyed:'+tray.destroyed);",
    "console.log('trayUseAfterDestroy:error');",
    "const notification={showCount:0,closed:false}; notification.showCount++; notification.showCount++; notification.closed=true;",
    "console.log('notification:'+notification.showCount+'|'+notification.closed);",
    "const clip={clipboard:'normal',selection:'selection'};",
    "console.log('clipboard:'+clip.clipboard+'|'+clip.selection);",
    "let registered=true; console.log('shortcut:true|false|'+registered+'|false');",
    "console.log('scheme:'+'My-App'.toLowerCase());",
    "console.log('schemeInvalid:error');",
    "console.log('defaultProtocol:true');",
    "console.log('deepLink:my-app://hello');",
    "console.log('theme:dark|true');",
    "console.log('power:PreventDisplaySleep|PreventAppSuspension|None');",
    "console.log('screen:2');",
    "console.log('dialog:1|true');",
    "console.log('shell:https://example.com/');",
    "console.log('powerMonitor:true|42|Idle');",
    "console.log('selection:unsupported');",
    "console.log('missing:unsupported');",
    '',
  ].join('\n');

  const csharpSource = `using System.Globalization;
using J2cs.Runtime.ElectronCompat;

static string B(bool value) => value ? "true" : "false";
static void Line(string value) => Console.Write(value + "\\n");

var host = new FakeHost();
var runtime = new DesktopRuntime(host);

var menu = runtime.Menus.Create();
var a = new DesktopMenuItem("a", "A");
var b = new DesktopMenuItem("b", "B");
menu.Append(a);
menu.Append(b);
Line("menu:" + string.Join(",", menu.Items.Select(item => item.Id)));
Line("menuIdentity:" + B(ReferenceEquals(menu.GetMenuItemById("a"), a)));

var tray = runtime.CreateTray("icon.png");
tray.SetToolTip("tip");
tray.SetContextMenu(menu);
Line("tray:" + B(tray.IsDestroyed) + "|" + tray.ToolTip + "|" + B(ReferenceEquals(tray.ContextMenu, menu)));
tray.Destroy();
Line("trayDestroyed:" + B(tray.IsDestroyed));
try { tray.SetToolTip("after"); Line("trayUseAfterDestroy:unexpected"); }
catch (InvalidOperationException) { Line("trayUseAfterDestroy:error"); }

var notification = runtime.CreateNotification("Title", "Body");
notification.Show();
notification.Show();
notification.Close();
Line("notification:" + notification.ShowCount.ToString(CultureInfo.InvariantCulture) + "|" + B(notification.Closed));

runtime.Clipboard.WriteText("normal");
runtime.Clipboard.WriteText("selection", DesktopClipboardType.Selection);
Line("clipboard:" + runtime.Clipboard.ReadText() + "|" + runtime.Clipboard.ReadText(DesktopClipboardType.Selection));

var ok = runtime.GlobalShortcut.Register("Control+X", () => { });
var taken = runtime.GlobalShortcut.Register("Taken", () => { });
var before = runtime.GlobalShortcut.IsRegistered("Control+X");
runtime.GlobalShortcut.Unregister("Control+X");
var after = runtime.GlobalShortcut.IsRegistered("Control+X");
Line("shortcut:" + B(ok) + "|" + B(taken) + "|" + B(before) + "|" + B(after));

Line("scheme:" + DesktopProtocol.ValidateSchemeName("My-App"));
try { DesktopProtocol.ValidateSchemeName("1bad"); Line("schemeInvalid:unexpected"); }
catch (ArgumentException) { Line("schemeInvalid:error"); }
Line("defaultProtocol:" + B(runtime.Protocol.RequestDefaultProtocolClient("My-App")));
string deepLink = "";
runtime.Protocol.DeepLinkReceived += value => deepLink = value;
runtime.Protocol.EnableDeepLinkRouting();
host.EmitDeepLink("my-app://hello");
Line("deepLink:" + deepLink);

var assignedTheme = runtime.NativeTheme.SetThemeSource("dark");
Line("theme:" + assignedTheme + "|" + B(runtime.NativeTheme.ShouldUseDarkColors));

var first = runtime.PowerSaveBlocker.Start("prevent-app-suspension");
var second = runtime.PowerSaveBlocker.Start("prevent-display-sleep");
var p1 = runtime.PowerSaveBlocker.EffectivePolicy;
runtime.PowerSaveBlocker.Stop(second);
var p2 = runtime.PowerSaveBlocker.EffectivePolicy;
runtime.PowerSaveBlocker.Stop(first);
var p3 = runtime.PowerSaveBlocker.EffectivePolicy;
Line("power:" + p1 + "|" + p2 + "|" + p3);

var display = runtime.Screen.GetPrimaryDisplay();
Line("screen:" + display.ScaleFactor.ToString(CultureInfo.InvariantCulture));

var dialog = await runtime.Dialog.ShowMessageBoxAsync(
    new DesktopMessageBoxOptions(new[] { "No", "Yes" }, "Continue?"));
Line("dialog:" + dialog.Response.ToString(CultureInfo.InvariantCulture) + "|" + B(dialog.CheckboxChecked));

await runtime.Shell.OpenExternalAsync(new Uri("https://example.com/"));
Line("shell:" + host.LastExternal);

Line("powerMonitor:" + B(runtime.PowerMonitor.IsOnBatteryPower()) + "|"
    + runtime.PowerMonitor.GetSystemIdleTime().ToString(CultureInfo.InvariantCulture) + "|"
    + runtime.PowerMonitor.GetSystemIdleState(10));

try {
    new DesktopRuntime(new NoSelectionHost()).Clipboard.WriteText("x", DesktopClipboardType.Selection);
    Line("selection:unexpected");
}
catch (PlatformNotSupportedException) { Line("selection:unsupported"); }

try {
    new DesktopRuntime(new MissingHost()).Menus.Create();
    Line("missing:unexpected");
}
catch (PlatformNotSupportedException) { Line("missing:unsupported"); }

sealed class FakeHost : DesktopPlatformAdapterBase
{
    private string _clipboard = "";
    private string _selection = "";
    private string _themeSource = "system";
    private Action<string>? _deepLink;
    private long _nextMenu = 10;

    public override bool IsAppReady => true;
    public override bool SupportsSelectionClipboard => true;
    public override bool IsNotificationSupported => true;
    public string LastExternal { get; private set; } = "";

    public override long CreateMenu() => ++_nextMenu;
    public override void UpdateMenu(long menuId, IReadOnlyList<DesktopMenuItem> items) { }
    public override long CreateTray(string image, string? guid) => 100;
    public override void SetTrayToolTip(long trayId, string text) { }
    public override void SetTrayContextMenu(long trayId, long? menuId) { }
    public override void DestroyTray(long trayId) { }

    public override void ShowNotification(long notificationId, string title, string body) { }
    public override void CloseNotification(long notificationId) { }

    public override string ReadClipboardText(DesktopClipboardType type)
        => type == DesktopClipboardType.Selection ? _selection : _clipboard;
    public override void WriteClipboardText(string text, DesktopClipboardType type)
    {
        if (type == DesktopClipboardType.Selection) _selection = text;
        else _clipboard = text;
    }

    public override Task<DesktopMessageBoxResult> ShowMessageBoxAsync(
        DesktopMessageBoxOptions options,
        CancellationToken cancellationToken)
        => Task.FromResult(new DesktopMessageBoxResult(1, true));

    public override Task OpenExternalAsync(Uri uri, CancellationToken cancellationToken)
    {
        LastExternal = uri.ToString();
        return Task.CompletedTask;
    }

    public override bool RegisterGlobalShortcut(string accelerator, Action callback)
        => accelerator != "Taken";
    public override void UnregisterGlobalShortcut(string accelerator) { }

    public override bool RequestDefaultProtocolClient(string canonicalScheme)
        => canonicalScheme == "my-app";
    public override void SetDeepLinkHandler(Action<string> handler) => _deepLink = handler;
    public void EmitDeepLink(string value) => _deepLink?.Invoke(value);

    public override DesktopDisplay GetPrimaryDisplay()
        => new(1, new DesktopRect(0, 0, 1920, 1080), new DesktopRect(0, 0, 1920, 1040), 2.0, 0, true);

    public override string ThemeSource
    {
        get => _themeSource;
        set => _themeSource = value;
    }
    public override bool ShouldUseDarkColors => _themeSource == "dark";

    public override void SetPowerPolicy(DesktopPowerPolicy policy) { }
    public override bool IsOnBatteryPower() => true;
    public override int GetSystemIdleTimeSeconds() => 42;
    public override DesktopIdleState GetSystemIdleState(int idleThresholdSeconds) => DesktopIdleState.Idle;
}

sealed class NoSelectionHost : DesktopPlatformAdapterBase { }
sealed class MissingHost : DesktopPlatformAdapterBase { }
`;

  try {
    await writeFile(path.join(nodeDir, 'oracle.cjs'), nodeSource);
    await writeFile(
      path.join(csharpDir, 'Fixture.csproj'),
      project(path.join(ROOT, 'runtime/J2cs.Runtime/J2cs.Runtime.csproj')),
    );
    await writeFile(path.join(csharpDir, 'Program.cs'), csharpSource);

    const dotnet = process.env.DOTNET ?? 'dotnet';
    const build = await run(dotnet, ['build', 'Fixture.csproj', '--nologo', '-v', 'quiet'], csharpDir, 60_000);
    assert.equal(build.exit, 0, 'desktop fixture dotnet build failed:\n' + build.stdout + '\n' + build.stderr);

    const node = await run(process.execPath, ['oracle.cjs'], nodeDir);
    const csharp = await run(
      dotnet,
      [path.join(csharpDir, 'bin/Debug/net8.0/ElectronDesktopFixture.dll')],
      csharpDir,
    );
    assert.deepEqual(csharp, node, 'Electron desktop host contract differs from Node reference model');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
