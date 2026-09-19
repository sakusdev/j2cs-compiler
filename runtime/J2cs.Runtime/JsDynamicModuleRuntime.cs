namespace J2cs.Runtime;

/// <summary>
/// The dynamic-import/TLA lane consumes an already-linked module evaluator instead of
/// reimplementing ESM graph traversal, live bindings, evaluate-once, or cycle handling.
/// The ESM linker lane can satisfy this interface once merged.
/// </summary>
public interface IJsDynamicModuleHost
{
    ValueTask<string> ResolveAsync(string specifier, string? referrerCanonicalKey);

    /// <summary>
    /// Evaluate the canonical Module Record and return its namespace value. Implementations
    /// own Module Record caching, evaluate-once, dependency ordering, cycles, live bindings,
    /// and namespace identity. The returned task represents asynchronous module evaluation,
    /// including top-level await and rejection.
    /// </summary>
    Task<JsValue> EvaluateAsync(string canonicalKey);
}

/// <summary>
/// Module-specific asynchronous boundary for import(). It intentionally does not claim
/// general ECMAScript Promise semantics; the Promise lane can adapt this task when merged.
/// </summary>
public sealed class JsDynamicImportPromise
{
    private readonly Task<JsValue> task;

    internal JsDynamicImportPromise(Task<JsValue> task)
        => this.task = task ?? throw new ArgumentNullException(nameof(task));

    public Task<JsValue> AsTask() => task;
    public bool IsCompleted => task.IsCompleted;
}

/// <summary>
/// Runtime boundary owned by dynamic import/top-level await. Resolution and asynchronous
/// rejection are explicit here; ESM graph/cache semantics are delegated to the linked
/// module evaluator so this lane remains independently mergeable without duplicating #33.
/// </summary>
public sealed class JsDynamicModuleRuntime
{
    private readonly IJsDynamicModuleHost host;

    public JsDynamicModuleRuntime(IJsDynamicModuleHost host)
        => this.host = host ?? throw new ArgumentNullException(nameof(host));

    /// <summary>
    /// Always returns the asynchronous import boundary. Resolution/evaluation failures are
    /// captured by the returned task rather than escaping synchronously from this call.
    /// </summary>
    public JsDynamicImportPromise DynamicImport(string specifier, string? referrerCanonicalKey = null)
        => new(DynamicImportCoreAsync(specifier, referrerCanonicalKey));

    /// <summary>
    /// Canonical async-module evaluation hook for the reviewed top-level-await rule.
    /// This awaits the host's ESM evaluator rather than mapping TLA to C# entry-point await.
    /// </summary>
    public async Task<JsValue> EvaluateWithTopLevelAwait(string canonicalKey)
    {
        if (string.IsNullOrWhiteSpace(canonicalKey))
            throw new ArgumentException("A canonical module key is required.", nameof(canonicalKey));

        return await host.EvaluateAsync(canonicalKey).ConfigureAwait(false);
    }

    private async Task<JsValue> DynamicImportCoreAsync(string specifier, string? referrerCanonicalKey)
    {
        if (string.IsNullOrWhiteSpace(specifier))
            throw new ArgumentException("Dynamic import specifier must be non-empty.", nameof(specifier));

        var canonicalKey = await host.ResolveAsync(specifier, referrerCanonicalKey).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(canonicalKey))
            throw new InvalidOperationException("The dynamic-module host returned an empty canonical key.");

        return await EvaluateWithTopLevelAwait(canonicalKey).ConfigureAwait(false);
    }
}
