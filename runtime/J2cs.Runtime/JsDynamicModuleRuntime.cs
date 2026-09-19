using System.Collections.Concurrent;

namespace J2cs.Runtime;

/// <summary>
/// Observable states for the isolated dynamic-import/top-level-await module runtime.
/// This is deliberately not a substitute for the ESM binding/linker subsystem.
/// </summary>
public enum JsDynamicModuleState
{
    Loaded,
    Evaluating,
    EvaluatingAsync,
    Evaluated,
    Errored
}

/// <summary>
/// Stable identity token for one canonical Module Record. Export/live-binding access is
/// intentionally owned by the ESM linker workstream and is not approximated here.
/// </summary>
public sealed class JsDynamicModuleNamespace
{
    internal JsDynamicModuleNamespace(string canonicalKey) => CanonicalKey = canonicalKey;
    public string CanonicalKey { get; }
}

public sealed class JsDynamicModuleContext
{
    internal JsDynamicModuleContext(string canonicalKey, JsDynamicModuleNamespace moduleNamespace)
        => (CanonicalKey, Namespace) = (canonicalKey, moduleNamespace);

    public string CanonicalKey { get; }
    public JsDynamicModuleNamespace Namespace { get; }
}

/// <summary>
/// Host-provided linked module definition. Dependency specifiers remain host-resolved;
/// their source order is preserved. A non-TLA evaluator must complete synchronously.
/// </summary>
public sealed class JsDynamicModuleDefinition
{
    private readonly IReadOnlyList<string> dependencies;

    public JsDynamicModuleDefinition(
        string canonicalKey,
        IEnumerable<string> dependencies,
        bool hasTopLevelAwait,
        Func<JsDynamicModuleContext, Task> evaluator)
    {
        if (string.IsNullOrWhiteSpace(canonicalKey))
            throw new ArgumentException("A canonical module key is required.", nameof(canonicalKey));
        ArgumentNullException.ThrowIfNull(dependencies);
        ArgumentNullException.ThrowIfNull(evaluator);
        var requested = dependencies.ToArray();
        if (requested.Any(string.IsNullOrWhiteSpace))
            throw new ArgumentException("Dependency specifiers must be non-empty.", nameof(dependencies));

        CanonicalKey = canonicalKey;
        this.dependencies = Array.AsReadOnly(requested);
        HasTopLevelAwait = hasTopLevelAwait;
        Evaluator = evaluator;
    }

    public string CanonicalKey { get; }
    public IReadOnlyList<string> Dependencies => dependencies;
    public bool HasTopLevelAwait { get; }
    internal Func<JsDynamicModuleContext, Task> Evaluator { get; }
}

/// <summary>
/// Explicit host contract for Node-style resolution/loading. Resolution failures and
/// loader failures cross the DynamicImport boundary as rejected asynchronous work.
/// </summary>
public interface IJsDynamicModuleHost
{
    ValueTask<string> ResolveAsync(string specifier, string? referrerCanonicalKey);
    ValueTask<JsDynamicModuleDefinition> LoadAsync(string canonicalKey);
}

/// <summary>
/// Module-specific promise boundary. It intentionally does not claim general ECMAScript
/// Promise semantics; the Promise workstream can adapt this task when its runtime lands.
/// </summary>
public sealed class JsDynamicImportPromise
{
    private readonly Task<JsDynamicModuleNamespace> task;

    internal JsDynamicImportPromise(Task<JsDynamicModuleNamespace> task)
        => this.task = task ?? throw new ArgumentNullException(nameof(task));

    public Task<JsDynamicModuleNamespace> AsTask() => task;
    public bool IsCompleted => task.IsCompleted;
}

internal sealed class JsDynamicModuleRecord
{
    internal JsDynamicModuleRecord(JsDynamicModuleDefinition definition)
    {
        Definition = definition;
        Namespace = new JsDynamicModuleNamespace(definition.CanonicalKey);
    }

    internal object Gate { get; } = new();
    internal JsDynamicModuleDefinition Definition { get; }
    internal JsDynamicModuleNamespace Namespace { get; }
    internal JsDynamicModuleState State { get; set; } = JsDynamicModuleState.Loaded;
    internal Exception? Error { get; set; }
}

/// <summary>
/// Runtime fallback for the reviewed dynamic-import/TLA rules. It provides:
/// canonical-key load caching, evaluate-once, stable namespace identity, dependency-first
/// source ordering, cycle termination, TLA dependency waiting, and rejection propagation.
///
/// Root graph evaluation is serialized in this isolated fallback. That keeps cycle and
/// evaluate-once behavior deterministic without silently depending on the unmerged
/// Promise/ESM scheduler lanes. Parser/lowering integration remains fail-closed until
/// those lanes provide the missing language contracts.
/// </summary>
public sealed class JsDynamicModuleRuntime
{
    private readonly IJsDynamicModuleHost host;
    private readonly ConcurrentDictionary<string, Lazy<Task<JsDynamicModuleRecord>>> records =
        new(StringComparer.Ordinal);
    private readonly SemaphoreSlim evaluationGate = new(1, 1);

    public JsDynamicModuleRuntime(IJsDynamicModuleHost host)
        => this.host = host ?? throw new ArgumentNullException(nameof(host));

    public JsDynamicImportPromise DynamicImport(string specifier, string? referrerCanonicalKey = null)
        => new(DynamicImportCoreAsync(specifier, referrerCanonicalKey));

    public async Task<JsDynamicModuleNamespace> Evaluate(string canonicalKey)
    {
        await evaluationGate.WaitAsync().ConfigureAwait(false);
        try
        {
            var record = await GetOrLoadAsync(canonicalKey).ConfigureAwait(false);
            await EvaluateRecordAsync(record, new HashSet<string>(StringComparer.Ordinal)).ConfigureAwait(false);
            return record.Namespace;
        }
        finally
        {
            evaluationGate.Release();
        }
    }

    public Task<JsDynamicModuleNamespace> EvaluateWithTopLevelAwait(string canonicalKey) => Evaluate(canonicalKey);

    private async Task<JsDynamicModuleNamespace> DynamicImportCoreAsync(string specifier, string? referrerCanonicalKey)
    {
        if (string.IsNullOrWhiteSpace(specifier))
            throw new ArgumentException("Dynamic import specifier must be non-empty.", nameof(specifier));

        var canonicalKey = await host.ResolveAsync(specifier, referrerCanonicalKey).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(canonicalKey))
            throw new InvalidOperationException("The module host returned an empty canonical key.");

        return await Evaluate(canonicalKey).ConfigureAwait(false);
    }

    private Task<JsDynamicModuleRecord> GetOrLoadAsync(string canonicalKey)
    {
        if (string.IsNullOrWhiteSpace(canonicalKey))
            return Task.FromException<JsDynamicModuleRecord>(
                new ArgumentException("A canonical module key is required.", nameof(canonicalKey)));

        return records.GetOrAdd(canonicalKey, static (key, state) =>
            new Lazy<Task<JsDynamicModuleRecord>>(
                () => state.LoadRecordAsync(key),
                LazyThreadSafetyMode.ExecutionAndPublication), this).Value;
    }

    private async Task<JsDynamicModuleRecord> LoadRecordAsync(string canonicalKey)
    {
        var definition = await host.LoadAsync(canonicalKey).ConfigureAwait(false);
        if (definition is null)
            throw new InvalidOperationException($"The module host returned no definition for '{canonicalKey}'.");
        if (!StringComparer.Ordinal.Equals(definition.CanonicalKey, canonicalKey))
            throw new InvalidOperationException(
                $"The module host returned canonical key '{definition.CanonicalKey}' for requested key '{canonicalKey}'.");

        return new JsDynamicModuleRecord(definition);
    }

    private async Task EvaluateRecordAsync(JsDynamicModuleRecord record, HashSet<string> ancestry)
    {
        var key = record.Definition.CanonicalKey;
        if (!ancestry.Add(key))
            return;

        try
        {
            lock (record.Gate)
            {
                if (record.State == JsDynamicModuleState.Evaluated)
                    return;
                if (record.State == JsDynamicModuleState.Errored)
                    throw record.Error ?? new InvalidOperationException($"Module '{key}' previously failed evaluation.");
                record.State = JsDynamicModuleState.Evaluating;
            }

            foreach (var requested in record.Definition.Dependencies)
            {
                var dependencyKey = await host.ResolveAsync(requested, key).ConfigureAwait(false);
                if (string.IsNullOrWhiteSpace(dependencyKey))
                    throw new InvalidOperationException($"The module host returned an empty dependency key for '{requested}'.");
                var dependency = await GetOrLoadAsync(dependencyKey).ConfigureAwait(false);

                // A back-edge belongs to the current strongly-connected traversal. Do not
                // recursively await it; the Module Record will execute exactly once when
                // its first traversal unwinds.
                if (ancestry.Contains(dependency.Definition.CanonicalKey))
                    continue;

                await EvaluateRecordAsync(dependency, ancestry).ConfigureAwait(false);
            }

            if (record.Definition.HasTopLevelAwait)
            {
                lock (record.Gate)
                    record.State = JsDynamicModuleState.EvaluatingAsync;
            }

            var bodyTask = record.Definition.Evaluator(new JsDynamicModuleContext(key, record.Namespace))
                ?? throw new InvalidOperationException($"Module '{key}' returned a null evaluation task.");

            if (!record.Definition.HasTopLevelAwait && !bodyTask.IsCompleted)
                throw new InvalidOperationException(
                    $"Module '{key}' suspended asynchronously without a proven top-level-await contract.");

            await bodyTask.ConfigureAwait(false);
            lock (record.Gate)
            {
                record.Error = null;
                record.State = JsDynamicModuleState.Evaluated;
            }
        }
        catch (Exception error)
        {
            lock (record.Gate)
            {
                record.Error = error;
                record.State = JsDynamicModuleState.Errored;
            }
            throw;
        }
        finally
        {
            ancestry.Remove(key);
        }
    }
}
