namespace J2cs.Runtime;

public enum JsPromiseState { Pending, Fulfilled, Rejected }

public delegate void JsPromiseExecutor(Action<JsValue> resolve, Action<JsValue> reject);
public delegate JsValue JsPromiseHandler(JsValue value);
public delegate JsValue JsPromiseFinallyHandler();
public delegate void JsThenableExecutor(Action<JsValue> resolve, Action<JsValue> reject);

internal interface IJsThenable
{
    void Then(Action<JsValue> resolve, Action<JsValue> reject);
}

/// <summary>
/// Intrinsic Promise runtime for the compiler's closed/pristine Promise profile.
/// Reactions are scheduled on an explicit JsJobQueue; CLR Task/ContinueWith are not
/// used as semantic substitutes.
///
/// Arbitrary object then-property lookup is intentionally not claimed here. The
/// compiler may construct a bounded thenable with CreateThenable only after proving
/// the dynamic lookup/accessor boundary is not observable.
/// </summary>
public sealed class JsPromise : JsObject, IJsThenable
{
    private sealed record Reaction(JsPromise Derived, JsPromiseHandler? OnFulfilled, JsPromiseHandler? OnRejected);

    private sealed class JsPromiseSelfResolutionTypeError : JsObject { }

    private sealed class JsThenableObject : JsObject, IJsThenable
    {
        private readonly JsThenableExecutor executor;
        public JsThenableObject(JsThenableExecutor executor)
            => this.executor = executor ?? throw new ArgumentNullException(nameof(executor));
        public void Then(Action<JsValue> resolve, Action<JsValue> reject) => executor(resolve, reject);
    }

    private readonly JsJobQueue queue;
    private readonly List<Reaction> reactions = [];
    private JsPromiseState state;
    private JsValue result;

    private JsPromise(JsJobQueue queue)
        => this.queue = queue ?? throw new ArgumentNullException(nameof(queue));

    public static JsJobQueue DefaultQueue { get; } = new();

    public JsPromiseState State => state;
    public JsValue Result => state == JsPromiseState.Pending
        ? throw new InvalidOperationException("Pending Promise has no result.")
        : result;

    public JsValue AsValue() => JsValue.FromReference(this);

    public static JsPromise Create(JsPromiseExecutor executor) => Create(DefaultQueue, executor);

    public static JsPromise Create(JsJobQueue queue, JsPromiseExecutor executor)
    {
        ArgumentNullException.ThrowIfNull(executor);
        var promise = new JsPromise(queue);
        var (resolve, reject) = CreateResolvingFunctions(promise);
        try
        {
            executor(resolve, reject);
        }
        catch (JsThrownValueException thrown)
        {
            reject(thrown.Value);
        }
        return promise;
    }

    public static JsPromise Resolve(JsValue value) => Resolve(DefaultQueue, value);

    public static JsPromise Resolve(JsJobQueue queue, JsValue value)
    {
        if (value.Kind == JsKind.Object && JsObject.RequireReference(value) is JsPromise existing)
            return existing;

        var promise = new JsPromise(queue);
        var (resolve, _) = CreateResolvingFunctions(promise);
        resolve(value);
        return promise;
    }

    public static JsPromise Reject(JsValue reason) => Reject(DefaultQueue, reason);

    public static JsPromise Reject(JsJobQueue queue, JsValue reason)
    {
        var promise = new JsPromise(queue);
        RejectUnchecked(promise, reason);
        return promise;
    }

    public static JsValue CreateThenable(JsThenableExecutor executor)
        => JsValue.FromReference(new JsThenableObject(executor));

    public static JsPromise Then(JsPromise promise, JsPromiseHandler? onFulfilled = null, JsPromiseHandler? onRejected = null)
        => promise.Then(onFulfilled, onRejected);

    public JsPromise Then(JsPromiseHandler? onFulfilled = null, JsPromiseHandler? onRejected = null)
    {
        var derived = new JsPromise(queue);
        var reaction = new Reaction(derived, onFulfilled, onRejected);
        if (state == JsPromiseState.Pending)
            reactions.Add(reaction);
        else
            EnqueueReaction(reaction, state, result);
        return derived;
    }

    public static JsPromise Catch(JsPromise promise, JsPromiseHandler? onRejected)
        => promise.Catch(onRejected);

    public JsPromise Catch(JsPromiseHandler? onRejected) => Then(null, onRejected);

    public static JsPromise Finally(JsPromise promise, JsPromiseFinallyHandler? onFinally)
        => promise.Finally(onFinally);

    public JsPromise Finally(JsPromiseFinallyHandler? onFinally)
    {
        if (onFinally is null) return Then();

        return Then(
            value => ContinueFinally(onFinally, value, rejected: false),
            reason => ContinueFinally(onFinally, reason, rejected: true));
    }

    public static void DrainJobs() => DefaultQueue.Drain();

    void IJsThenable.Then(Action<JsValue> resolve, Action<JsValue> reject)
    {
        Then(
            value => { resolve(value); return JsUndefined.Value; },
            reason => { reject(reason); return JsUndefined.Value; });
    }

    private JsValue ContinueFinally(JsPromiseFinallyHandler onFinally, JsValue original, bool rejected)
    {
        var cleanup = Resolve(queue, onFinally());
        var continuation = cleanup.Then(_ =>
        {
            if (rejected) throw new JsThrownValueException(original);
            return original;
        });
        return continuation.AsValue();
    }

    private static (Action<JsValue> Resolve, Action<JsValue> Reject) CreateResolvingFunctions(JsPromise promise)
    {
        var alreadyResolved = false;
        void Resolve(JsValue value)
        {
            if (alreadyResolved) return;
            alreadyResolved = true;
            ResolveUnchecked(promise, value);
        }
        void Reject(JsValue reason)
        {
            if (alreadyResolved) return;
            alreadyResolved = true;
            RejectUnchecked(promise, reason);
        }
        return (Resolve, Reject);
    }

    private static void ResolveUnchecked(JsPromise promise, JsValue value)
    {
        if (promise.state != JsPromiseState.Pending) return;

        if (value.Kind != JsKind.Object)
        {
            FulfillUnchecked(promise, value);
            return;
        }

        var reference = JsObject.RequireReference(value);
        if (ReferenceEquals(reference, promise))
        {
            RejectUnchecked(promise, JsValue.FromReference(new JsPromiseSelfResolutionTypeError()));
            return;
        }

        if (reference is not IJsThenable thenable)
        {
            FulfillUnchecked(promise, value);
            return;
        }

        // PromiseResolveThenableJob: invoking then is never inline with resolve().
        promise.queue.Enqueue(() =>
        {
            var (resolve, reject) = CreateResolvingFunctions(promise);
            try
            {
                thenable.Then(resolve, reject);
            }
            catch (JsThrownValueException thrown)
            {
                reject(thrown.Value);
            }
        });
    }

    private static void FulfillUnchecked(JsPromise promise, JsValue value)
    {
        if (promise.state != JsPromiseState.Pending) return;
        promise.state = JsPromiseState.Fulfilled;
        promise.result = value;
        promise.TriggerReactions();
    }

    private static void RejectUnchecked(JsPromise promise, JsValue reason)
    {
        if (promise.state != JsPromiseState.Pending) return;
        promise.state = JsPromiseState.Rejected;
        promise.result = reason;
        promise.TriggerReactions();
    }

    private void TriggerReactions()
    {
        if (state == JsPromiseState.Pending) return;
        var pending = reactions.ToArray();
        reactions.Clear();
        foreach (var reaction in pending)
            EnqueueReaction(reaction, state, result);
    }

    private void EnqueueReaction(Reaction reaction, JsPromiseState settledState, JsValue settledValue)
    {
        queue.Enqueue(() =>
        {
            var handler = settledState == JsPromiseState.Fulfilled ? reaction.OnFulfilled : reaction.OnRejected;
            if (handler is null)
            {
                if (settledState == JsPromiseState.Fulfilled)
                    ResolveUnchecked(reaction.Derived, settledValue);
                else
                    RejectUnchecked(reaction.Derived, settledValue);
                return;
            }

            try
            {
                ResolveUnchecked(reaction.Derived, handler(settledValue));
            }
            catch (JsThrownValueException thrown)
            {
                RejectUnchecked(reaction.Derived, thrown.Value);
            }
        });
    }
}
