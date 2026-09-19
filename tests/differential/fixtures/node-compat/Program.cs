using J2cs.Runtime;
using J2cs.Runtime.NodeCompat;

static string Bool(bool value) => value ? "true" : "false";

var emitter = NodeEvents.Create();
var log = new List<string>();
NodeEventListener? c = null;
var a = new NodeEventListener(args =>
{
    log.Add("a" + ((int)args[0].Number).ToString());
    emitter.On("x", c!);
});
var b = new NodeEventListener(args => log.Add("b" + ((int)args[0].Number).ToString()));
c = new NodeEventListener(args => log.Add("c" + ((int)args[0].Number).ToString()));
emitter.On("x", a);
emitter.Once("x", b);
emitter.Emit("x", JsValue.FromNumber(1));
emitter.Emit("x", JsValue.FromNumber(2));
Console.WriteLine(string.Join(",", log));
Console.WriteLine(Bool(emitter.Emit("none")));
try { emitter.Emit("error", JsValue.FromString("boom")); }
catch (NodeUnhandledErrorException error) { Console.WriteLine(error.Code); }

var buffer = NodeBuffer.From("68656c6c6f", "hex");
var view = buffer.Slice(1, 4);
view[0] = 0x61;
Console.WriteLine($"{buffer.ToString("utf8")} {view.ToString("hex")} {NodeBuffer.ByteLength("é", "utf8")} {NodeBuffer.Alloc(3, 65).ToString("utf8")}");
var copy = NodeBuffer.From(buffer);
copy[0] = 0x7a;
Console.WriteLine($"{buffer[0]} {copy[0]}");
Console.WriteLine(NodeBuffer.From(new double[] { 257, -1, 3.9 }).ToString("hex"));
Console.WriteLine(NodeBuffer.ByteLength("é", "not-an-encoding"));
var backing = new byte[] { 1, 2, 3 };
var shared = NodeBuffer.FromArrayBuffer(backing);
shared[0] = 9;
Console.WriteLine(backing[0]);

var scheduler = new NodeManualScheduler();
var readable = NodeStreams.CreateReadable(scheduler, highWaterMark: 1);
readable.On("end", new NodeEventListener(_ => Console.WriteLine("end")));
Console.WriteLine(Bool(NodeStreams.Push(readable, NodeStreamChunk.FromBuffer(NodeBuffer.From(new byte[] { 1 })))));
var read = NodeStreams.Read(readable);
Console.WriteLine(read!.Value.Buffer.ToString("hex"));
NodeStreams.PushEof(readable);
NodeStreams.Read(readable);

var writable = NodeStreams.CreateWritable(scheduler, highWaterMark: 1);
writable.On("drain", new NodeEventListener(_ =>
{
    Console.WriteLine("drain");
    NodeStreams.End(writable);
}));
writable.On("finish", new NodeEventListener(_ => Console.WriteLine("finish")));
Console.WriteLine(Bool(NodeStreams.Write(writable, NodeStreamChunk.FromBuffer(NodeBuffer.From(new byte[] { 2 })))));

var duplex = NodeStreams.CreateDuplex(
    scheduler,
    readableHighWaterMark: 1,
    writableHighWaterMark: 7,
    allowHalfOpen: false);
Console.WriteLine($"{duplex.ReadableHighWaterMark} {duplex.WritableHighWaterMark} {Bool(duplex.AllowHalfOpen)}");
Console.WriteLine(Bool(duplex.Push(NodeStreamChunk.FromBuffer(NodeBuffer.From(new byte[] { 3 })))));
Console.WriteLine(duplex.Read()!.Value.Buffer.ToString("hex"));

scheduler.Drain();
