namespace J2cs.Runtime;

/// <summary>
/// Lexical environment keyed by compiler-stable binding ids. Cells are shared through the
/// parent chain so closures observe later writes instead of value snapshots.
/// </summary>
public sealed class JsEnvironment
{
    private sealed class Cell
    {
        internal JsValue Value;
        internal Cell(JsValue value) => Value = value;
    }

    private readonly JsEnvironment? parent;
    private readonly Dictionary<int, Cell> cells = new();

    private JsEnvironment(JsEnvironment? parent) => this.parent = parent;

    public static JsEnvironment CreateRoot() => new(null);
    internal static JsEnvironment CreateChild(JsEnvironment parent)
        => new(parent ?? throw new ArgumentNullException(nameof(parent)));

    public JsValue Declare(int bindingId, JsValue value)
    {
        cells[bindingId] = new Cell(value);
        return value;
    }

    public JsValue Read(int bindingId) => Find(bindingId).Value;
    public static JsValue Read(JsEnvironment environment, int bindingId)
        => (environment ?? throw new ArgumentNullException(nameof(environment))).Read(bindingId);

    public JsValue Assign(int bindingId, JsValue value)
    {
        Find(bindingId).Value = value;
        return value;
    }

    private Cell Find(int bindingId)
    {
        for (JsEnvironment? current = this; current is not null; current = current.parent)
            if (current.cells.TryGetValue(bindingId, out var cell)) return cell;
        throw new InvalidOperationException($"Compiler lexical binding proof violated for #{bindingId}");
    }
}
