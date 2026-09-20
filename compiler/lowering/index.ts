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
const ref = (b: Binding): CE => ({ kind: 'ref', repr: 'value', name: variable(b) });
const undef = (): CE => ({ kind: 'member', repr: 'value', name: 'JsUndefined.Value' });
const stringLiteral = (value: string): CE => ({ kind: 'literal', repr: 'string', value });
const numberLiteral = (value: number): CE => ({ kind: 'literal', repr: 'number', value });
export function lower(program: SemanticProgram, index: RuleIndex): LoweredProgram {
  const trace: Trace[] = [], contracts = new Set<string>();
  interface Context { insideFunction: boolean; insideLoop: boolean }
  const rootContext: Context = { insideFunction: false, insideLoop: false };
  function completionFacts(): ReturnType<typeof programFacts> {
    return programFacts().prove('completion.representation', 'JsCompletionSignal',
      'All admitted abrupt completions use the explicit JsCompletionSignal carrier');
  }
  function throwFacts(): ReturnType<typeof programFacts> {
    return programFacts()
      .prove('control.context', 'synchronous ECMAScript control flow', 'Async/generator functions are rejected by this lane')
      .prove('control.sync', true, 'Only synchronous ECMAScript control flow reaches this lowering')
      .prove('throw.valueArbitrary', true, 'Thrown values remain tagged JsValue values without coercion')
      .prove('throw.expressionMayAbrupt', true, 'Throw operand is evaluated exactly once before wrapping')
      .prove('throw.wrapper', 'JsException', 'Throw completion uses the identity-preserving JsException wrapper');
  }
  function containsFinally(s: SS): boolean {
    switch (s.kind) {
      case 'try': return !!s.finallyBlock || containsFinally(s.body)
        || !!s.catchClause && containsFinally(s.catchClause.body);
      case 'block': return s.body.some(containsFinally);
      case 'if': return containsFinally(s.then) || !!s.otherwise && containsFinally(s.otherwise);
      case 'while': case 'doWhile': case 'for': return containsFinally(s.body);
      default: return false;
    }
  }
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
          if (e.throwTypes.length) {
            select({ kind: 'call.function.throw' }, programFacts()
              .prove('callee.kind', 'ordinary synchronous ECMAScript function', 'Resolved ordinary function specialization')
              .prove('callee.mayThrow', true, 'Function summary contains a Throw completion'), e.span);
          }
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
  function statement(s: SS, context: Context = rootContext): CS {
    switch (s.kind) {
      case 'variable': contracts.add('core.lexical-initialization'); return { kind: 'variable', name: variable(s.binding), initializer: expression(s.initializer) };
      case 'expression': return { kind: 'expression', expression: expression(s.expression) };
      case 'block': return { kind: 'block', body: s.body.map(x => statement(x, context)) };
      case 'if': return { kind: 'if', condition: condition(s.condition), then: statement(s.then, context),
        otherwise: s.otherwise && statement(s.otherwise, context) };
      case 'while': contracts.add('core.loop.while'); return { kind: 'while', condition: condition(s.condition),
        body: statement(s.body, { ...context, insideLoop: true }) };
      case 'doWhile': contracts.add('core.loop.do-while'); return { kind: 'doWhile',
        body: statement(s.body, { ...context, insideLoop: true }), condition: condition(s.condition) };
      case 'for': {
        contracts.add('core.loop.for');
        const loop: CS = { kind: 'for', condition: s.condition && condition(s.condition), update: s.update && expression(s.update),
          body: statement(s.body, { ...context, insideLoop: true }) };
        if (!s.initializer) return loop;
        const init = s.initializer.kind === 'variables'
          ? s.initializer.declarations.map(x => statement(x, context))
          : [{ kind: 'expression' as const, expression: expression(s.initializer.expression) }];
        return { kind: 'block', body: [...init, loop] };
      }
      case 'break':
        select({ kind: 'completion' }, completionFacts(), s.span);
        return { kind: 'throw', value: call('JsCompletion.Break', []) };
      case 'continue':
        select({ kind: 'completion' }, completionFacts(), s.span);
        return { kind: 'throw', value: call('JsCompletion.Continue', []) };
      case 'return':
        select({ kind: 'completion' }, completionFacts(), s.span);
        if (s.value.kind === 'literal' && s.value.value === undefined) {
          select({ kind: 'return.undefined' }, programFacts().prove('return.representation', 'value', 'Observable tagged return convention'), s.span);
        } else contracts.add('core.return-value');
        return { kind: 'throw', value: call('JsCompletion.Return', [expression(s.value)]) };
      case 'throw':
        select({ kind: 'completion' }, completionFacts(), s.span);
        select({ kind: 'throw.value' }, throwFacts(), s.span);
        select({ kind: 'throw.expression' }, throwFacts(), s.span);
        return { kind: 'throw', value: call('JsException.Wrap', [expression(s.value)]) };
      case 'try': {
        if (!s.catchClause && !s.finallyBlock) return statement(s.body, context);
        const facts = programFacts()
          .prove('control.sync', true, 'Only synchronous try statements are admitted')
          .prove('try.hasCatch', !!s.catchClause, 'Normalized try statement shape')
          .prove('try.hasFinally', !!s.finallyBlock, 'Normalized try statement shape')
          .prove('try.bodyMayAbrupt', !!s.catchClause || s.pendingAbruptKinds.length > 0,
            'Completion analysis records all abrupt exits from the protected body')
          .prove('throw.wrapper', 'JsException', 'Throw completion uses the identity-preserving JsException wrapper');
        if (s.catchClause) {
          if (s.catchClause.binding) {
            const catchFacts = new Map(facts)
              .set('catch.parameterKind', { value: 'BindingIdentifier', evidence: 'Parser admits only identifier catch bindings' })
              .set('catch.parameterPresent', { value: true, evidence: 'Normalized catch clause has a lexical binding' })
              .set('catch.lexicalScopeObservable', { value: true, evidence: 'Binder allocates a fresh catch lexical scope' });
            select({ kind: 'try.catch.binding' }, catchFacts, s.span);
            select({ kind: 'try.catch.scope' }, catchFacts, s.span);
          } else {
            select({ kind: 'try.catch.omitted' }, new Map(facts)
              .set('catch.binding', { value: 'omitted', evidence: 'Normalized catch clause omits its binding' }), s.span);
          }
          select({ kind: 'try.catch.abrupt' }, facts, s.span);
        }
        if (s.finallyBlock) {
          const finalFacts = new Map(facts)
            .set('finally.normalOnly', { value: s.finallyCanCompleteNormally && s.finallyAbruptKinds.length === 0,
              evidence: 'Completion analysis of the finally block' })
            .set('finally.mayAbrupt', { value: s.finallyAbruptKinds.length > 0,
              evidence: 'Completion analysis of the finally block' })
            .set('control.insideFunction', { value: context.insideFunction, evidence: 'Lowering context' })
            .set('control.insideIteration', { value: context.insideLoop, evidence: 'Lowering context' })
            .set('try.loopControlMayCross', { value: s.pendingAbruptKinds.some(k => k === 'break' || k === 'continue'),
              evidence: 'Pending completion kinds crossing finally' })
            .set('try.nestedFinally', { value: containsFinally(s.body)
              || !!s.catchClause && containsFinally(s.catchClause.body), evidence: 'Nested semantic try/finally scan' });
          select({ kind: 'try.finally' }, finalFacts, s.span);
          if (s.catchClause) select({ kind: 'try.catch-finally' }, finalFacts, s.span);
          if (s.pendingAbruptKinds.includes('return')) select({ kind: 'try.finally.return' }, finalFacts, s.span);
          if (s.pendingAbruptKinds.some(k => k === 'break' || k === 'continue')) select({ kind: 'try.finally.loop' }, finalFacts, s.span);
          if (finalFacts.get('try.nestedFinally')?.value === true) select({ kind: 'try.finally.nested' }, finalFacts, s.span);
        }
        return { kind: 'try', body: statement(s.body, context),
          ...(s.catchClause ? { catchClause: { ...(s.catchClause.binding ? { binding: variable(s.catchClause.binding) } : {}),
            body: statement(s.catchClause.body, context) } } : {}),
          ...(s.finallyBlock ? { finallyBlock: statement(s.finallyBlock, context) } : {}) };
      }
    }
  }
  const functions = program.functions.map(fn => {
    select({ kind: 'function' }, declarationFacts(fn), fn.span);
    const context: Context = { insideFunction: true, insideLoop: false };
    return { name: `F${fn.instanceId}`, params: fn.params.map(variable), body: fn.body.map(x => statement(x, context)) };
  });
  return { ir: { functions, body: program.body.map(x => statement(x, rootContext)) }, trace, structuralContracts: [...contracts].sort() };
}
