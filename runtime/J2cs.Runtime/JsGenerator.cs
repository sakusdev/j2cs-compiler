namespace J2cs.Runtime;

public interface IJsGeneratorMachine
{
    JsGeneratorStep Next(JsValue sent);
    JsGeneratorStep Return(JsValue value);
}

public readonly struct JsGeneratorStep
{
    public JsValue Value { get; }
    public bool Done { get; }

    private JsGeneratorStep(JsValue value, bool done) => (Value, Done) = (value, done);

    public static JsGeneratorStep Yield(JsValue value) => new(value, false);
    public static JsGeneratorStep Complete(JsValue value) => new(value, true);
}

internal sealed class JsIteratorResult : JsObject
{
    internal JsIteratorResult(JsValue value, bool done) => (Value, Done) = (value, done);
    internal JsValue Value { get; }
    internal bool Done { get; }
}

/// <summary>
/// Canonical synchronous generator boundary. The generated machine owns suspension points;
/// this type owns ECMAScript-visible suspended-start/suspended-yield/completed transitions,
/// lazy first execution, next(value), return(value), result identity and reentrancy checks.
/// </summary>
public sealed class JsGenerator : JsObject
{
    private enum GeneratorState { SuspendedStart, SuspendedYield, Executing, Completed }

    private readonly IJsGeneratorMachine machine;
    private GeneratorState state = GeneratorState.SuspendedStart;

    private JsGenerator(IJsGeneratorMachine machine)
        => this.machine = machine ?? throw new ArgumentNullException(nameof(machine));

    public static JsValue Create(IJsGeneratorMachine machine) => JsValue.FromReference(new JsGenerator(machine));

    private static JsGenerator RequireGenerator(JsValue value)
        => RequireReference(value) as JsGenerator
            ?? throw new InvalidOperationException("Compiler sync-generator proof violated");

    private static JsIteratorResult RequireResult(JsValue value)
        => RequireReference(value) as JsIteratorResult
            ?? throw new InvalidOperationException("Compiler IteratorResult proof violated");

    private static JsValue Result(JsValue value, bool done)
        => JsValue.FromReference(new JsIteratorResult(value, done));

    public static JsValue Next(JsValue receiver, JsValue value)
    {
        var generator = RequireGenerator(receiver);
        if (generator.state == GeneratorState.Completed) return Result(JsUndefined.Value, true);
        if (generator.state == GeneratorState.Executing)
            throw new InvalidOperationException("Generator is already running");

        var first = generator.state == GeneratorState.SuspendedStart;
        generator.state = GeneratorState.Executing;
        try
        {
            // ECMAScript ignores the argument of the first next() that starts a generator.
            var step = generator.machine.Next(first ? JsUndefined.Value : value);
            generator.state = step.Done ? GeneratorState.Completed : GeneratorState.SuspendedYield;
            return Result(step.Value, step.Done);
        }
        catch
        {
            generator.state = GeneratorState.Completed;
            throw;
        }
    }

    public static JsValue Return(JsValue receiver, JsValue value)
    {
        var generator = RequireGenerator(receiver);
        if (generator.state == GeneratorState.Completed) return Result(value, true);
        if (generator.state == GeneratorState.Executing)
            throw new InvalidOperationException("Generator is already running");

        // A return before the first next() completes without entering the body or a finally.
        if (generator.state == GeneratorState.SuspendedStart)
        {
            generator.state = GeneratorState.Completed;
            return Result(value, true);
        }

        generator.state = GeneratorState.Executing;
        try
        {
            var step = generator.machine.Return(value);
            generator.state = step.Done ? GeneratorState.Completed : GeneratorState.SuspendedYield;
            return Result(step.Value, step.Done);
        }
        catch
        {
            generator.state = GeneratorState.Completed;
            throw;
        }
    }

    public static JsValue ResultValue(JsValue result) => RequireResult(result).Value;
    public static bool ResultDone(JsValue result) => RequireResult(result).Done;
}
