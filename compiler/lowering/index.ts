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
        return call('JsReference.Assign', [{ kind: 'ref', repr: 'value', name: variable(e.binding) }, expression(e.value)]);
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
          default: return fail('E_LOWERING', `Unimplemented binary lowering ${op}.`, e.span);
        }
      }
      case 'unary': {
        const op = select({ kind: 'unary', operator: e.op }, facts, e.span), operand = expression(e.operand);
        if (op === 'unary.number') return box({ kind: 'unary', repr: 'number', op: '-', value: unbox(operand, 'number') });
        if (op === 'unary.boolean') return box({ kind: 'unary', repr: 'boolean', op: '!', value: unbox(operand, 'boolean') });
        if (op === 'helper.not') return box({ kind: 'unary', repr: 'boolean', op: '!', value: call('JsValue.IsTruthy', [operand], 'boolean') });
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
        select({ kind: 'call.function' }, facts, e.span);
        return call(`F${e.target}`, e.args.map(expression));
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
      case 'return':
        if (s.value.kind === 'literal' && s.value.value === undefined) {
          select({ kind: 'return.undefined' }, programFacts().prove('return.representation', 'value', 'Observable tagged return convention'), s.span);
        } else contracts.add('core.return-value');
        return { kind: 'return', value: expression(s.value) };
    }
  }
  const functions = program.functions.map(fn => {
    select({ kind: 'function' }, declarationFacts(fn), fn.span);
    return { name: `F${fn.instanceId}`, params: fn.params.map(variable), body: fn.body.map(statement) };
  });
  return { ir: { functions, body: program.body.map(statement) }, trace, structuralContracts: [...contracts].sort() };
}
