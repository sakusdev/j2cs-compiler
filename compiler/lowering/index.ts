import { fail, type Span } from '../diagnostics/index.js';
import { exactly } from '../analysis/facts.js';
import type { Binding } from '../analysis/bindings.js';
import type { SemanticExpr as SE, SemanticProgram, SemanticStatement as SS } from '../ir/semantic.js';
import { box, unbox, type CsExpr as CE, type CsProgram, type CsStatement as CS } from '../ir/csharp.js';
import { RuleIndex, type Candidate, type Selector } from '../rules/index.js';
import { declarationFacts, expressionFacts, programFacts } from '../rules/facts.js';
import type { FactModel } from '../analysis/facts.js';
export interface Trace {
  ruleId: string; strategy: string; lowering: string; span: Span; sha256: string;
  requirements: Candidate['proof']; rejected: { id: string; verdict: string }[]; ambiguous: string[];
}
export interface LoweredProgram { ir: CsProgram; trace: Trace[]; structuralContracts: string[] }
const variable = (b: Binding): string => `b${b.id}`;
const call = (target: string, args: CE[], repr: CE['repr'] = 'value'): CE => ({ kind: 'call', target, args, repr });
const read = (b: Binding): CE => ({ kind: 'read', repr: 'value', name: variable(b) });
const readName = (name: string): CE => ({ kind: 'read', repr: 'value', name });
const ref = (b: Binding): CE => ({ kind: 'ref', repr: 'value', name: variable(b) });
const undef = (): CE => ({ kind: 'member', repr: 'value', name: 'JsUndefined.Value' });
const stringLiteral = (value: string): CE => ({ kind: 'literal', repr: 'string', value });
const numberLiteral = (value: number): CE => ({ kind: 'literal', repr: 'number', value });
export function lower(program: SemanticProgram, index: RuleIndex): LoweredProgram {
  const trace: Trace[] = [], contracts = new Set<string>();
  function select(selector: Selector, facts: FactModel, span: Span): string {
    const result = index.select(selector, facts), chosen = result.selected;
    if (!chosen || chosen.loaded.rule.strategy === 'unsupported') {
      fail('E_NO_SAFE_RULE', `No proven implemented rule for ${selector.kind}${selector.operator ? ` ${selector.operator}` : ''}.`, span, {
        ambiguous: result.ambiguous,
        candidates: result.candidates.map(c => ({ id: c.loaded.rule.id, strategy: c.loaded.rule.strategy, proof: c.proof })),
      });
    }
    trace.push({ ruleId: chosen.loaded.rule.id, strategy: chosen.loaded.rule.strategy, lowering: chosen.adapter.lowering,
      span, sha256: chosen.loaded.sha256, requirements: chosen.proof, ambiguous: result.ambiguous,
      rejected: result.candidates.filter(c => c !== chosen).map(c => ({ id: c.loaded.rule.id, verdict: c.proof.verdict })) });
    return chosen.adapter.lowering;
  }
  function expression(e: SE): CE {
    const facts = expressionFacts(e);
    switch (e.kind) {
      case 'literal':
        if (e.value === undefined) { contracts.add('core.undefined-initialization'); return undef(); }
        if (e.value === null) {
          select({ kind: 'literal.null' }, facts, e.span); return { kind: 'member', repr: 'value', name: 'JsNull.Value' };
        }
        if (typeof e.value === 'number') {
          select({ kind: 'literal.number' }, facts, e.span); return box({ kind: 'literal', repr: 'number', value: e.value });
        }
        contracts.add(`core.literal.${typeof e.value}`);
        return typeof e.value === 'string' ? box({ kind: 'literal', repr: 'string', value: e.value }) : box({ kind: 'literal', repr: 'boolean', value: e.value });
      case 'object': {
        contracts.add('core.object-literal.ordinary-data-v1');
        let result = call('JsObject.Create', []);
        for (const property of e.properties)
          result = call('JsObject.DefineDataProperty', [result, stringLiteral(property.key), expression(property.value)]);
        return result;
      }
      case 'array': {
        contracts.add('core.array-literal.holes-v1');
        let result = call('JsArray.Create', [numberLiteral(e.elements.length)]);
        e.elements.forEach((element, i) => {
          if (element) result = call('JsArray.DefineElement', [result, numberLiteral(i), expression(element)]);
        });
        return result;
      }
      case 'thisValue':
        contracts.add('core.constructor-this-v1');
        return readName(e.slot);
      case 'newTarget': {
        const op = select({ kind: 'meta.newTarget' }, facts, e.span);
        if (op !== 'meta.newTarget') fail('E_LOWERING', 'new.target adapter has no implementation.', e.span);
        contracts.add('core.new-target-context-v1');
        return e.constructorTemplateId === undefined
          ? undef()
          : call('JsConstructor.Identity', [numberLiteral(e.constructorTemplateId)]);
      }
      case 'construct': {
        const op = select({ kind: 'construct.function' }, facts, e.span);
        if (op !== 'construct.function') fail('E_LOWERING', 'Constructor adapter has no implementation.', e.span);
        if (e.mayReturnObject) {
          const override = select({ kind: 'construct.returnOverride' }, facts, e.span);
          if (override !== 'construct.returnOverride') fail('E_LOWERING', 'Constructor return-override adapter has no implementation.', e.span);
        }
        contracts.add('core.constructor-direct-known-v1');
        return call(`K${e.target}`, e.args.map(expression));
      }
      case 'read':
        if (e.binding.kind !== 'intrinsic') { contracts.add('core.lexical-read'); return { kind: 'read', repr: 'value', name: variable(e.binding) }; }
        switch (select({ kind: 'intrinsic', intrinsic: e.binding.name }, facts, e.span)) {
          case 'intrinsic.undefined': return undef();
          case 'intrinsic.nan': return box({ kind: 'member', repr: 'number', name: 'double.NaN' });
          case 'intrinsic.infinity': return box({ kind: 'member', repr: 'number', name: 'double.PositiveInfinity' });
          default: return fail('E_LOWERING', 'Intrinsic adapter has no implementation.', e.span);
        }
      case 'assign': {
        const op = select({ kind: 'assign' }, facts, e.span);
        if (op !== 'helper.assign') fail('E_LOWERING', 'Assignment adapter has no implementation.', e.span);
        return call('JsReference.Assign', [ref(e.binding), expression(e.value)]);
      }
      case 'compound': {
        const op = select({ kind: 'compound', operator: e.op }, facts, e.span);
        const target = {
          'helper.addAssign': 'JsReference.AddAssign',
          'helper.subtractAssignNumber': 'JsReference.SubtractAssignNumber',
          'helper.multiplyAssignNumber': 'JsReference.MultiplyAssignNumber',
          'helper.divideAssignNumber': 'JsReference.DivideAssignNumber',
          'helper.remainderAssignNumber': 'JsReference.RemainderAssignNumber',
        }[op];
        if (!target) return fail('E_LOWERING', `Unimplemented compound lowering ${op}.`, e.span);
        // C# evaluates arguments left-to-right: capture GetValue before evaluating RHS.
        return call(target, [ref(e.binding), read(e.binding), expression(e.value)]);
      }
      case 'update': {
        const selectorOp = `${e.prefix ? 'prefix' : 'postfix'}${e.op}`;
        const op = select({ kind: 'update', operator: selectorOp }, facts, e.span);
        const target = {
          'helper.prefixIncrementNumber': 'JsReference.PrefixIncrementNumber',
          'helper.postfixIncrementNumber': 'JsReference.PostfixIncrementNumber',
          'helper.prefixDecrementNumber': 'JsReference.PrefixDecrementNumber',
          'helper.postfixDecrementNumber': 'JsReference.PostfixDecrementNumber',
        }[op];
        if (!target) return fail('E_LOWERING', `Unimplemented update lowering ${op}.`, e.span);
        return call(target, [ref(e.binding), read(e.binding)]);
      }
      case 'propertyAssign':
        contracts.add('core.ordinary-own-property-write-v1');
        return call('JsObject.SetProperty', [expression(e.object), stringLiteral(e.property), expression(e.value)]);
      case 'member':
        if (e.property === 'length' && exactly(e.object.types, 'Array')) {
          const op = select({ kind: 'array.length' }, facts, e.span);
          if (op !== 'array.length') fail('E_LOWERING', 'Array length adapter has no implementation.', e.span);
          return box(call('JsArray.Length', [expression(e.object)], 'number'));
        }
        contracts.add('core.ordinary-own-property-read-v1');
        return call('JsObject.GetProperty', [expression(e.object), stringLiteral(e.property)]);
      case 'binary': {
        const op = select({ kind: 'binary', operator: e.op }, facts, e.span);
        const left = expression(e.left), right = expression(e.right);
        switch (op) {
          case 'binary.number': return box({ kind: 'binary', repr: ['+', '-', '*', '/', '%'].includes(e.op) ? 'number' : 'boolean', op: e.op,
            left: unbox(left, 'number'), right: unbox(right, 'number') });
          case 'binary.string': return box(call('string.Concat', [unbox(left, 'string'), unbox(right, 'string')], 'string'));
          case 'equality.number': case 'equality.boolean': case 'equality.string': {
            const type = op === 'equality.number' ? 'number' : op === 'equality.boolean' ? 'boolean' : 'string';
            return box({ kind: 'binary', repr: 'boolean', op: '==', left: unbox(left, type), right: unbox(right, type) });
          }
          case 'helper.add': return call('JsOperators.Add', [left, right]);
          case 'helper.strictEquals': return box(call('JsOperators.StrictEquals', [left, right], 'boolean'));
          case 'helper.strictNotEquals': return box({ kind: 'unary', repr: 'boolean', op: '!', value: call('JsOperators.StrictEquals', [left, right], 'boolean') });
          case 'helper.looseEquals': return box(call('JsOperators.LooseEquals', [left, right], 'boolean'));
          case 'helper.looseNotEquals': return box({ kind: 'unary', repr: 'boolean', op: '!', value: call('JsOperators.LooseEquals', [left, right], 'boolean') });
          case 'helper.lessThan': return box(call('JsOperators.LessThan', [left, right], 'boolean'));
          case 'helper.lessThanOrEqual': return box(call('JsOperators.LessThanOrEqual', [left, right], 'boolean'));
          case 'helper.greaterThan': return box(call('JsOperators.GreaterThan', [left, right], 'boolean'));
          case 'helper.greaterThanOrEqual': return box(call('JsOperators.GreaterThanOrEqual', [left, right], 'boolean'));
          default: return fail('E_LOWERING', `Unimplemented binary lowering ${op}.`, e.span);
        }
      }
      case 'unary': {
        const op = select({ kind: 'unary', operator: e.op }, facts, e.span), operand = expression(e.operand);
        if (op === 'unary.number') return box({ kind: 'unary', repr: 'number', op: '-', value: unbox(operand, 'number') });
        if (op === 'unary.boolean') return box({ kind: 'unary', repr: 'boolean', op: '!', value: unbox(operand, 'boolean') });
        if (op === 'helper.not') return box({ kind: 'unary', repr: 'boolean', op: '!', value: call('JsValue.IsTruthy', [operand], 'boolean') });
        if (op === 'helper.toNumber') return box(call('JsCoercion.ToNumberPrimitive', [operand], 'number'));
        return fail('E_LOWERING', `Unimplemented unary lowering ${op}.`, e.span);
      }
      case 'call':
        if (e.target === 'console') {
          contracts.add('host.node.console-log.primitive-v1');
          return call('JsConsole.Log', e.args.map(expression));
        }
        if (e.target === 'array.push') {
          const op = select({ kind: 'array.push' }, facts, e.span);
          if (op !== 'array.push') fail('E_LOWERING', 'Array push adapter has no implementation.', e.span);
          return call('JsArray.Push', [expression(e.receiver), ...e.args.map(expression)]);
        }
        if (e.target === 'object.hasOwn') {
          const op = select({ kind: 'object.hasOwn' }, facts, e.span);
          if (op !== 'object.hasOwn') fail('E_LOWERING', 'Object.hasOwn adapter has no implementation.', e.span);
          return box(call('JsObject.HasOwn', [expression(e.receiver), stringLiteral(e.property)], 'boolean'));
        }
        if (typeof e.target === 'number') {
          select({ kind: 'call.function' }, facts, e.span);
          return call(`F${e.target}`, e.args.map(expression));
        }
        const op = select({ kind: 'call.intrinsic', intrinsic: e.target }, facts, e.span);
        const args = e.args.map(expression);
        switch (op) {
          case 'intrinsic.isFinite.number': return box(call('double.IsFinite', [unbox(args[0]!, 'number')], 'boolean'));
          case 'helper.isFinite.primitive': return box(call('JsGlobals.IsFinitePrimitive', [args[0]!], 'boolean'));
          case 'intrinsic.isNaN.number': return box(call('double.IsNaN', [unbox(args[0]!, 'number')], 'boolean'));
          case 'helper.isNaN.primitive': return box(call('JsGlobals.IsNaNPrimitive', [args[0]!], 'boolean'));
          case 'helper.parseFloat.string': return box(call('JsNumber.ParseFloatPrimitive', [unbox(args[0]!, 'string')], 'number'));
          case 'helper.parseFloat.primitive': return box(call('JsGlobals.ParseFloatPrimitive', [args[0]!], 'number'));
          case 'helper.parseInt.stringDefault':
            return box(call('JsNumber.ParseIntPrimitive', [unbox(args[0]!, 'string'), { kind: 'literal', repr: 'number', value: 0 }], 'number'));
          case 'helper.parseInt.stringKnownRadix':
            return box(call('JsNumber.ParseIntPrimitive', [unbox(args[0]!, 'string'),
              call('JsCoercion.ToInt32Primitive', [args[1]!], 'number')], 'number'));
          case 'helper.parseInt.primitive': {
            const radix = args[1] ?? box({ kind: 'literal', repr: 'number', value: 0 });
            return box(call('JsGlobals.ParseIntPrimitive', [args[0]!, radix], 'number'));
          }
          default: return fail('E_LOWERING', `Unimplemented intrinsic lowering ${op}.`, e.span);
        }
    }
  }
  function condition(e: SE): CE {
    if (exactly(e.types, 'Boolean')) { contracts.add('core.boolean-condition'); return unbox(expression(e), 'boolean'); }
    const facts = expressionFacts(e).type('operand', e.types, 'Condition flow type analysis');
    select({ kind: 'condition' }, facts, e.span);
    return call('JsValue.IsTruthy', [expression(e)], 'boolean');
  }
  function statement(s: SS): CS {
    switch (s.kind) {
      case 'variable': contracts.add('core.lexical-initialization'); return { kind: 'variable', name: variable(s.binding), initializer: expression(s.initializer) };
      case 'expression': return { kind: 'expression', expression: expression(s.expression) };
      case 'block': return { kind: 'block', body: s.body.map(statement) };
      case 'if': return { kind: 'if', condition: condition(s.condition), then: statement(s.then), otherwise: s.otherwise && statement(s.otherwise) };
      case 'while': contracts.add('core.loop.while'); return { kind: 'while', condition: condition(s.condition), body: statement(s.body) };
      case 'doWhile': contracts.add('core.loop.do-while'); return { kind: 'doWhile', body: statement(s.body), condition: condition(s.condition) };
      case 'for': {
        contracts.add('core.loop.for');
        const loop: CS = { kind: 'for', condition: s.condition && condition(s.condition), update: s.update && expression(s.update), body: statement(s.body) };
        if (!s.initializer) return loop;
        const init = s.initializer.kind === 'variables'
          ? s.initializer.declarations.map(statement)
          : [{ kind: 'expression' as const, expression: expression(s.initializer.expression) }];
        return { kind: 'block', body: [...init, loop] };
      }
      case 'break': contracts.add('core.loop.break'); return { kind: 'break' };
      case 'continue': contracts.add('core.loop.continue'); return { kind: 'continue' };
      case 'return':
        if (s.value.kind === 'literal' && s.value.value === undefined) {
          select({ kind: 'return.undefined' }, programFacts().prove('return.representation', 'value', 'Observable tagged return convention'), s.span);
        } else contracts.add('core.return-value');
        return { kind: 'return', value: expression(s.value) };
    }
  }
  const functions = program.functions.flatMap(fn => {
    const hasInvocationMeta = fn.usedWithNew || fn.observes.includes('this') || fn.observes.includes('new.target');
    if (hasInvocationMeta) contracts.add('core.function-invocation-context-specialization-v1');
    else select({ kind: 'function' }, declarationFacts(fn), fn.span);
    const bodyFunction = {
      name: `F${fn.instanceId}`,
      params: [...(fn.thisSlot ? [fn.thisSlot] : []), ...fn.params.map(variable)],
      body: fn.body.map(statement),
    };
    if (fn.mode !== 'construct') return [bodyFunction];
    const receiver = fn.thisSlot!;
    const result = `r${fn.instanceId}`;
    const wrapper = {
      name: `K${fn.instanceId}`,
      params: fn.params.map(variable),
      body: [
        { kind: 'variable' as const, name: receiver,
          initializer: call('JsConstructor.CreateReceiver', [numberLiteral(fn.constructorTemplateId!)]) },
        { kind: 'variable' as const, name: result,
          initializer: call(`F${fn.instanceId}`, [readName(receiver), ...fn.params.map(p => readName(variable(p)))]) },
        { kind: 'return' as const, value: call('JsConstructor.SelectResult', [readName(receiver), readName(result)]) },
      ],
    };
    return [bodyFunction, wrapper];
  });
  return { ir: { functions, body: program.body.map(statement) }, trace, structuralContracts: [...contracts].sort() };
}
