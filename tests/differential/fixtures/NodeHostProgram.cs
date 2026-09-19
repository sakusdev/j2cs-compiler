using J2cs.Runtime;
using J2cs.Runtime.NodeCompat;

var loop = new NodeEventLoop();
NodeTimeoutHandle? timer = null;
timer = loop.SetTimeout((handle, values) =>
{
    Console.WriteLine("timer:" + values[0].String + ":" + (ReferenceEquals(handle, timer) ? "true" : "false"));
}, 1, JsValue.FromString("arg"));
Console.Write("timer-ref:" + (timer.HasRef() ? "true" : "false") + ",");
timer.Unref();
Console.WriteLine(timer.HasRef() ? "true" : "false");
timer.Ref();

var cancelled = loop.SetTimeout((_, _) => Console.WriteLine("bad-timeout"), 1);
loop.ClearTimeout(cancelled);
loop.AdvanceBy(1);

var intervalCount = 0;
NodeTimeoutHandle? interval = null;
interval = loop.SetInterval((handle, _) =>
{
    intervalCount++;
    if (intervalCount == 2)
    {
        loop.ClearInterval(handle);
        Console.WriteLine("interval:" + intervalCount + ":" + (ReferenceEquals(handle, interval) ? "true" : "false"));
    }
}, 1);
loop.AdvanceBy(1);
loop.AdvanceBy(1);

var immediateValues = new List<string>();
loop.SetImmediate((_, _) => immediateValues.Add("a"));
loop.SetImmediate((_, _) => immediateValues.Add("b"));
loop.RunCheckPhase();
Console.WriteLine("immediate:" + string.Join(",", immediateValues));

var options = new NodeSpawnOptions
{
    WorkingDirectory = Environment.CurrentDirectory,
    Environment = new Dictionary<string, string> { ["J2CS_TEST"] = "v" },
};
var child = NodeChildProcess.SpawnSync(
    args[0],
    new[] { "-e", "process.stdout.write((process.env.J2CS_TEST || '') + '@' + process.cwd())" },
    options);
if (child.Error is not null)
{
    Console.Error.WriteLine(child.Error.Code + ":" + child.Error.Message);
    Environment.ExitCode = 1;
    return;
}
Console.WriteLine("child:" + child.Status + ":" + child.Stdout);

var worker = new NodeWorkerMessageQueue();
worker.PostMessage(JsValue.FromNumber(1));
worker.PostMessage(JsValue.FromString("x"));
worker.Complete(0);
var workerValues = new List<string>();
worker.Drain(
    value => workerValues.Add(value.Kind == JsKind.Number
        ? "number:" + value.Number.ToString(System.Globalization.CultureInfo.InvariantCulture)
        : "string:" + value.String),
    exitCode => workerValues.Add("exit:" + exitCode));
Console.WriteLine("worker:" + string.Join(",", workerValues));
