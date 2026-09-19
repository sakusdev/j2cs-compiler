import { fail, type Span } from '../diagnostics/index.js';
import { Facts, PRIMITIVES, isPrimitiveSet, type JsType, type TypeSet } from '../analysis/facts.js';
import type { RuleIndex } from '../rules/index.js';
import type { Trace } from '../lowering/index.js';
import { parseGeneratorProgram, type GExpr, type GFunction, type GProgram, type GStmt } from './parser.js';
import { fact, proveGeneratorRule, type GeneratorTrace } from './rules.js';

type StaticType = JsType | 'Generator' | 'IteratorResult' | 'Any';
type GenPhase = 'suspended-start' | 'suspended-yield' | 'completed';

interface GeneratorDefinition {
  id: number;
  source: GFunction;
  yieldCount: number;
}
interface GeneratorObject {
  definition: GeneratorDefinition;
  phase: GenPhase;
  delivered: number;
}
interface Slot {
  cname: string;
  mutable: boolean;
  initialized: boolean;
  type: StaticType;
  generator?: GeneratorObject;
  resultValueType?: StaticType;
}
interface Value {
  code: string;
  type: StaticType;
  generator?: GeneratorObject;
  resultValueType?: StaticType;
}
type AnyTrace = GeneratorTrace | Trace;

interface CompileContext {
  env: Map<string, Slot>;
  machine: boolean;
  lines?: string[];
}

interface CaseBlock {
  id: number;
  lines: string[];
}

const generatorFacts = {
  call: () => ({ 'callee.syncGenerator': fact(true, 'Direct binding resolves to a reviewed synchronous generator declaration') }),
  body: () => ({ 'context.syncGenerator': fact(true, 'Expression is inside the normalized synchronous generator body') }),
  receiver: (phase: GenPhase, member: 'next' | 'return') => ({
    'receiver.syncGenerator': fact(true, 'Flow metadata preserves a canonical JsGenerator identity'),
    'generator.state': fact(phase, 'Straight-line generator use proves the pre-call generator state'),
    ['member.' + member + '.pristine']: fact(true, 'Generator method properties cannot be mutated or escaped in this bounded profile'),
  }),
  delegation: (resumeKind?: 'return') => ({
    'context.syncGenerator': fact(true, 'yield* occurs inside a normalized synchronous generator body'),
    'delegation.active': fact(true, 'Generated state machine owns the active canonical delegated generator'),
    ...(resumeKind ? { 'outer.resumeKind': fact(resumeKind, 'Generated Return path forwards return completion to the active delegate') } : {}),
  }),
};

function quote(value: string): string {
  let result = '"';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    result += c < 32 || c > 126 ? '\\u' + c.toString(16).padStart(4, '0')
      : c === 34 ? '\\"' : c === 92 ? '\\\\' : value[i];
  }
  return result + '"';
}
function number(value: number): string {
  if (Number.isNaN(value)) return 'double.NaN';
  if (!Number.isFinite(value)) return value < 0 ? 'double.NegativeInfinity' : 'double.PositiveInfinity';
  if (Object.is(value, -0)) return '-0.0d';
  return String(value) + 'd';
}
function literal(value: number | string | boolean | null | undefined): Value {
  if (value === undefined) return { code: 'JsUndefined.Value', type: 'Undefined' };
  if (value === null) return { code: 'JsNull.Value', type: 'Null' };
  if (typeof value === 'number') return { code: 'JsValue.FromNumber(' + number(value) + ')', type: 'Number' };
  if (typeof value === 'string') return { code: 'JsValue.FromString(' + quote(value) + ')', type: 'String' };
  return { code: 'JsValue.FromBoolean(' + String(value) + ')', type: 'Boolean' };
}
function coreTypes(type: StaticType): TypeSet {
  if (type === 'Generator' || type === 'IteratorResult') return ['Object'];
  if (type === 'Any') return [...PRIMITIVES, 'Object', 'Array'];
  return [type];
}
function referenceLike(type: StaticType): boolean {
  return type === 'Object' || type === 'Array' || type === 'Generator' || type === 'IteratorResult' || type === 'Any';
}

export interface GeneratorCompileResult {
  source: string;
  ir: { kind: 'generator-profile'; generatorCount: number };
  trace: AnyTrace[];
  structuralContracts: string[];
}

export function tryCompileGeneratorProgram(
  source: string,
  index: RuleIndex,
  file = 'input.js',
): GeneratorCompileResult | undefined {
  const program = parseGeneratorProgram(source, file);
  if (!program) return undefined;
  return compileGeneratorProgram(program, index);
}

function compileGeneratorProgram(program: GProgram, index: RuleIndex): GeneratorCompileResult {
  const trace: AnyTrace[] = [];
  const contracts = new Set<string>([
    'generator.sync.state-machine-v1',
    'generator.iterator-result.identity-v1',
    'generator.closed-straight-line-profile-v1',
  ]);
  let nextBinding = 0;

  const definitions = new Map<string, GeneratorDefinition>();
  for (const source of program.functions) {
    if (definitions.has(source.name))
      fail('E_DUPLICATE_BINDING', 'Duplicate generator declaration ' + source.name + '.', source.span);
    definitions.set(source.name, { id: definitions.size, source, yieldCount: -1 });
  }

  function containsYield(e: GExpr): boolean {
    switch (e.kind) {
      case 'yield': return true;
      case 'object': return e.properties.some(p => containsYield(p.value));
      case 'array': return e.elements.some(x => !!x && containsYield(x));
      case 'binary': return containsYield(e.left) || containsYield(e.right);
      case 'assign': return containsYield(e.value);
      case 'member': return containsYield(e.object);
      case 'call': return containsYield(e.callee) || e.args.some(containsYield);
      default: return false;
    }
  }
  function topYield(s: GStmt): GExpr & { kind: 'yield' } | undefined {
    const e = s.kind === 'variable' ? s.initializer : s.kind === 'expression' ? s.expression : s.kind === 'return' ? s.value : undefined;
    if (!e) return undefined;
    if (e.kind === 'yield') return e;
    if (containsYield(e))
      fail('E_GENERATOR_YIELD_CONTEXT', 'yield/yield* must be the complete initializer, expression statement, or return value in this lane.', e.span);
    return undefined;
  }
  function delegatedGenerator(e: GExpr): GeneratorDefinition | undefined {
    if (e.kind !== 'call' || e.callee.kind !== 'identifier') return undefined;
    return definitions.get(e.callee.name);
  }
  const counting = new Set<number>();
  function countYields(def: GeneratorDefinition): number {
    if (def.yieldCount >= 0) return def.yieldCount;
    if (counting.has(def.id))
      fail('E_GENERATOR_DELEGATION_CYCLE', 'Recursive yield* delegation requires a general completion stack and is fail-closed.', def.source.span);
    counting.add(def.id);
    let count = 0;
    for (const s of def.source.body) {
      const y = topYield(s);
      if (y) {
        if (!y.delegate) count += 1;
        else if (y.value.kind === 'array') count += y.value.elements.length;
        else {
          const inner = delegatedGenerator(y.value);
          if (!inner)
            fail('E_GENERATOR_DELEGATE_UNPROVEN', 'yield* is currently proven only for array literals or direct known sync generators.', y.span);
          count += countYields(inner);
        }
      }
      if (s.kind === 'return') break;
    }
    counting.delete(def.id);
    def.yieldCount = count;
    return count;
  }
  for (const def of definitions.values()) countYields(def);

  function coreRule(selector: { kind: string; operator?: string }, left: StaticType, right: StaticType, span: Span): string {
    const l = coreTypes(left), r = coreTypes(right);
    const facts = new Facts()
      .type('left', l, 'Generator-lane flow type for left operand')
      .type('right', r, 'Generator-lane flow type for right operand')
      .prove('operands.complete', true, 'Every admitted generator-lane value has an explicit JsValue representation')
      .prove('operands.domain', isPrimitiveSet(l) && isPrimitiveSet(r) ? 'primitive' : 'ecmascript-value',
        'Complete generator-lane operand type sets');
    const selection = index.select(selector, facts);
    const chosen = selection.selected;
    if (!chosen || chosen.loaded.rule.strategy === 'unsupported')
      fail('E_NO_SAFE_RULE', 'No proven canonical j2cs rule for generator-lane operator ' + (selector.operator ?? selector.kind) + '.', span, {
        ambiguous: selection.ambiguous,
        candidates: selection.candidates.map(c => ({ id: c.loaded.rule.id, verdict: c.proof.verdict })),
      });
    trace.push({
      ruleId: chosen.loaded.rule.id,
      strategy: chosen.loaded.rule.strategy,
      lowering: chosen.adapter.lowering,
      span,
      sha256: chosen.loaded.sha256,
      requirements: chosen.proof,
      rejected: selection.candidates.filter(c => c !== chosen).map(c => ({ id: c.loaded.rule.id, verdict: c.proof.verdict })),
      ambiguous: selection.ambiguous,
    });
    return chosen.adapter.lowering;
  }

  function predeclareVariables(body: GStmt[], env: Map<string, Slot>, parameterNames: Set<string>, span: Span): void {
    for (const s of body) {
      if (s.kind !== 'variable') continue;
      if (env.has(s.name) || parameterNames.has(s.name) || definitions.has(s.name))
        fail('E_DUPLICATE_BINDING', 'Duplicate/conflicting binding ' + s.name + '.', s.span);
      env.set(s.name, {
        cname: 'b' + nextBinding++,
        mutable: s.mode === 'let',
        initialized: false,
        type: 'Undefined',
      });
    }
    if (env.has('console'))
      fail('E_INTRINSIC_SHADOWED', 'A lexical console binding shadows the generator profile host intrinsic.', span);
  }

  function valueExpression(e: GExpr, context: CompileContext): Value {
    switch (e.kind) {
      case 'literal': return literal(e.value);
      case 'identifier': {
        const slot = context.env.get(e.name);
        if (slot) {
          if (!slot.initialized) fail('E_TDZ', 'Binding ' + e.name + ' is accessed before initialization.', e.span);
          return {
            code: slot.cname,
            type: slot.type,
            ...(slot.generator ? { generator: slot.generator } : {}),
            ...(slot.resultValueType ? { resultValueType: slot.resultValueType } : {}),
          };
        }
        if (e.name === 'undefined') return literal(undefined);
        if (definitions.has(e.name))
          fail('E_FUNCTION_VALUE', 'Generator function values cannot escape; invoke the known declaration directly.', e.span);
        fail(context.machine ? 'E_GENERATOR_CAPTURE_DEPENDENCY' : 'E_UNRESOLVED_BINDING',
          context.machine
            ? 'Generator capture of outer binding ' + e.name + ' waits for the functions/closures lane.'
            : 'Unresolved identifier ' + e.name + '.', e.span);
      }
      case 'object': {
        let code = 'JsObject.Create()';
        for (const p of e.properties) {
          const value = valueExpression(p.value, context);
          code = 'JsObject.DefineDataProperty(' + code + ', ' + quote(p.key) + ', ' + value.code + ')';
        }
        return { code, type: 'Object' };
      }
      case 'array': {
        let code = 'JsArray.Create(' + number(e.elements.length) + ')';
        e.elements.forEach((element, i) => {
          if (!element) return;
          const value = valueExpression(element, context);
          code = 'JsArray.DefineElement(' + code + ', ' + number(i) + ', ' + value.code + ')';
        });
        return { code, type: 'Array' };
      }
      case 'assign': {
        const slot = context.env.get(e.name);
        if (!slot) fail('E_UNRESOLVED_BINDING', 'Unresolved assignment target ' + e.name + '.', e.span);
        if (!slot.initialized) fail('E_TDZ', 'Assignment target ' + e.name + ' is in its temporal dead zone.', e.span);
        if (!slot.mutable) fail('E_IMMUTABLE_WRITE', 'Assignment to const binding ' + e.name + '.', e.span);
        const rhs = valueExpression(e.value, context);
        slot.type = rhs.type;
        slot.generator = rhs.generator;
        slot.resultValueType = rhs.resultValueType;
        return { ...rhs, code: 'JsReference.Assign(ref ' + slot.cname + ', ' + rhs.code + ')' };
      }
      case 'binary': {
        const left = valueExpression(e.left, context);
        const right = valueExpression(e.right, context);
        const lowering = coreRule({ kind: 'binary', operator: e.op }, left.type, right.type, e.span);
        if (e.op === '+') {
          if (lowering === 'binary.number')
            return { code: 'JsValue.FromNumber((' + left.code + ').Number + (' + right.code + ').Number)', type: 'Number' };
          if (lowering === 'binary.string')
            return { code: 'JsValue.FromString(string.Concat((' + left.code + ').String, (' + right.code + ').String))', type: 'String' };
          if (lowering === 'helper.add')
            return { code: 'JsOperators.Add(' + left.code + ', ' + right.code + ')',
              type: left.type === 'String' || right.type === 'String' ? 'String' : left.type === 'Any' || right.type === 'Any' ? 'Any' : 'Number' };
          fail('E_LOWERING', 'Unexpected addition lowering in generator lane: ' + lowering, e.span);
        }
        let eq: string;
        if (lowering === 'equality.number') eq = '(' + left.code + ').Number == (' + right.code + ').Number';
        else if (lowering === 'equality.string') eq = 'string.Equals((' + left.code + ').String, (' + right.code + ').String, StringComparison.Ordinal)';
        else if (lowering === 'equality.boolean') eq = '(' + left.code + ').Boolean == (' + right.code + ').Boolean';
        else if (lowering === 'helper.strictEquals') eq = 'JsOperators.StrictEquals(' + left.code + ', ' + right.code + ')';
        else if (lowering === 'helper.strictNotEquals') eq = '!JsOperators.StrictEquals(' + left.code + ', ' + right.code + ')';
        else fail('E_LOWERING', 'Unexpected strict-equality lowering in generator lane: ' + lowering, e.span);
        if (e.op === '!==' && lowering !== 'helper.strictNotEquals') eq = '!(' + eq + ')';
        return { code: 'JsValue.FromBoolean(' + eq + ')', type: 'Boolean' };
      }
      case 'member': {
        const receiver = valueExpression(e.object, context);
        if (receiver.type !== 'IteratorResult')
          fail('E_GENERATOR_MEMBER', 'Only IteratorResult.value/done property reads are admitted by the isolated generator lane.', e.span);
        if (e.property === 'done')
          return { code: 'JsValue.FromBoolean(JsGenerator.ResultDone(' + receiver.code + '))', type: 'Boolean' };
        if (e.property === 'value')
          return { code: 'JsGenerator.ResultValue(' + receiver.code + ')', type: receiver.resultValueType ?? 'Any' };
        fail('E_GENERATOR_MEMBER', 'IteratorResult property ' + e.property + ' is not admitted.', e.span);
      }
      case 'call': {
        if (e.callee.kind === 'identifier') {
          if (e.callee.name === 'console') fail('E_INDIRECT_CALL', 'console is not directly callable.', e.span);
          const def = definitions.get(e.callee.name);
          if (!def) fail('E_INDIRECT_CALL', 'Only direct known generator declarations are callable in this lane.', e.span);
          if (context.machine)
            fail('E_GENERATOR_NESTED_CALL', 'Generator objects created inside generator bodies are admitted only as direct yield* delegates.', e.span);
          if (e.args.length !== def.source.params.length)
            fail('E_ARITY', 'Generator calls currently require exact arity.', e.span);
          const args = e.args.map(a => valueExpression(a, context));
          if (args.some(a => referenceLike(a.type)))
            fail('E_GENERATOR_ARGUMENT_BOUNDARY', 'Generator arguments are currently restricted to proven primitive values.', e.span);
          proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.call-lazy', generatorFacts.call(), e.span);
          return {
            code: 'G' + def.id + '(' + args.map(a => a.code).join(', ') + ')',
            type: 'Generator',
            generator: { definition: def, phase: 'suspended-start', delivered: 0 },
          };
        }
        if (e.callee.kind !== 'member')
          fail('E_INDIRECT_CALL', 'Indirect calls are not admitted by the generator lane.', e.span);
        if (e.callee.object.kind === 'identifier' && e.callee.object.name === 'console') {
          if (context.env.has('console')) fail('E_INTRINSIC_SHADOWED', 'console is shadowed by a lexical binding.', e.span);
          if (e.callee.property !== 'log') fail('E_INDIRECT_CALL', 'Only console.log is admitted.', e.span);
          const args = e.args.map(a => valueExpression(a, context));
          if (args.some(a => referenceLike(a.type)))
            fail('E_CONSOLE_OBJECT', 'Generator lane console.log requires proven primitive values.', e.span);
          if (args.length > 1 && args[0]?.type === 'String')
            fail('E_CONSOLE_FORMAT', 'Multi-argument console.log with a String first argument is fail-closed for Node format semantics.', e.span);
          contracts.add('host.node.console-log.primitive-v1');
          return { code: 'JsConsole.Log(' + args.map(a => a.code).join(', ') + ')', type: 'Undefined' };
        }
        if (e.callee.property === 'throw')
          fail('E_GENERATOR_EXCEPTIONS_DEPENDENCY', 'Generator.throw requires the exception/completion lane and remains fail-closed.', e.span);
        if (e.callee.property !== 'next' && e.callee.property !== 'return')
          fail('E_GENERATOR_MEMBER_CALL', 'Only generator.next and generator.return are admitted.', e.span);
        if (context.machine)
          fail('E_GENERATOR_NESTED_CALL', 'Explicit generator method calls inside generator bodies are deferred; use yield* for delegation.', e.span);
        if (e.callee.object.kind !== 'identifier')
          fail('E_GENERATOR_STATE_PROOF', 'Generator method receiver must be a tracked lexical generator binding.', e.span);
        const slot = context.env.get(e.callee.object.name);
        if (!slot?.initialized || !slot.generator)
          fail('E_GENERATOR_STATE_PROOF', 'Receiver is not a statically tracked canonical generator object.', e.span);
        if (e.args.length > 1) fail('E_ARITY', 'Generator next/return accept at most one argument in this lane.', e.span);
        const arg = e.args[0] ? valueExpression(e.args[0], context) : literal(undefined);
        const generator = slot.generator;
        if (e.callee.property === 'next') {
          const rule = generator.phase === 'suspended-start' ? 'generator.next.initial-argument-ignored'
            : generator.phase === 'suspended-yield' ? 'generator.next.resume-value' : 'generator.completed.next';
          proveGeneratorRule(index, trace as GeneratorTrace[], rule, generatorFacts.receiver(generator.phase, 'next'), e.span);
          let resultValueType: StaticType = 'Any';
          if (generator.phase === 'completed') resultValueType = 'Undefined';
          if (generator.phase === 'suspended-start') {
            if (generator.definition.yieldCount > 0) {
              generator.phase = 'suspended-yield';
              generator.delivered = 1;
            } else generator.phase = 'completed';
          } else if (generator.phase === 'suspended-yield') {
            if (generator.delivered < generator.definition.yieldCount) generator.delivered += 1;
            else {
              generator.phase = 'completed';
              resultValueType = 'Any';
            }
          }
          return {
            code: 'JsGenerator.Next(' + slot.cname + ', ' + arg.code + ')',
            type: 'IteratorResult',
            resultValueType,
          };
        }
        const rule = generator.phase === 'suspended-start' ? 'generator.return.before-start'
          : generator.phase === 'suspended-yield' ? 'generator.return.suspended' : 'generator.completed.return';
        proveGeneratorRule(index, trace as GeneratorTrace[], rule, generatorFacts.receiver(generator.phase, 'return'), e.span);
        generator.phase = 'completed';
        return {
          code: 'JsGenerator.Return(' + slot.cname + ', ' + arg.code + ')',
          type: 'IteratorResult',
          resultValueType: arg.type,
        };
      }
      case 'yield':
        fail('E_GENERATOR_YIELD_CONTEXT', 'yield is lowered only at a generator suspension boundary.', e.span);
    }
  }

  const compiledMachines: string[] = [];
  for (const def of definitions.values()) {
    const env = new Map<string, Slot>();
    const paramNames = new Set<string>();
    for (const name of def.source.params) {
      if (paramNames.has(name) || definitions.has(name))
        fail('E_DUPLICATE_BINDING', 'Duplicate/conflicting generator parameter ' + name + '.', def.source.span);
      paramNames.add(name);
      env.set(name, { cname: 'b' + nextBinding++, mutable: true, initialized: true, type: 'Any' });
    }
    predeclareVariables(def.source.body, env, paramNames, def.source.span);

    const cases: CaseBlock[] = [{ id: 0, lines: [] }];
    let current = cases[0]!;
    let nextState = 1;
    let terminated = false;
    let delegateIndex = 0;
    const delegateFields: Array<{ value: string; active: string; first: string }> = [];

    const freshCase = (): CaseBlock => {
      const c = { id: nextState++, lines: [] };
      cases.push(c);
      current = c;
      return c;
    };
    const endWithYield = (value: Value, resume?: Slot): void => {
      proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.yield.value', generatorFacts.body(), def.source.span);
      const resumeCase = nextState;
      current.lines.push('state = ' + resumeCase + ';');
      current.lines.push('return JsGeneratorStep.Yield(' + value.code + ');');
      freshCase();
      if (resume) {
        current.lines.push(resume.cname + ' = sent;');
        resume.initialized = true;
        resume.type = 'Any';
        resume.generator = undefined;
        resume.resultValueType = undefined;
      }
    };
    const completionTarget = (s: GStmt): { mode: 'ignore' | 'slot' | 'return'; slot?: Slot } => {
      if (s.kind === 'variable') {
        const slot = env.get(s.name)!;
        return { mode: 'slot', slot };
      }
      if (s.kind === 'return') return { mode: 'return' };
      return { mode: 'ignore' };
    };
    const finishYieldStarValue = (target: ReturnType<typeof completionTarget>, code: string): void => {
      if (target.mode === 'return') {
        proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.return.statement-value', generatorFacts.body(), def.source.span);
        current.lines.push('state = -1;');
        current.lines.push('return JsGeneratorStep.Complete(' + code + ');');
        terminated = true;
      } else {
        if (target.mode === 'slot' && target.slot) {
          current.lines.push(target.slot.cname + ' = ' + code + ';');
          target.slot.initialized = true;
          target.slot.type = 'Any';
        }
      }
    };

    for (const s of def.source.body) {
      if (terminated) break;
      const y = topYield(s);
      if (!y) {
        if (s.kind === 'empty') continue;
        if (s.kind === 'variable') {
          const slot = env.get(s.name)!;
          const init = s.initializer ? valueExpression(s.initializer, { env, machine: true }) : literal(undefined);
          current.lines.push(slot.cname + ' = ' + init.code + ';');
          slot.initialized = true;
          slot.type = init.type;
          slot.generator = init.generator;
          slot.resultValueType = init.resultValueType;
          continue;
        }
        if (s.kind === 'expression') {
          const value = valueExpression(s.expression, { env, machine: true });
          current.lines.push('_ = ' + value.code + ';');
          continue;
        }
        if (s.kind === 'return') {
          const value = valueExpression(s.value, { env, machine: true });
          proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.return.statement-value', generatorFacts.body(), s.span);
          current.lines.push('state = -1;');
          current.lines.push('return JsGeneratorStep.Complete(' + value.code + ');');
          terminated = true;
          continue;
        }
        continue;
      }

      const target = completionTarget(s);
      if (!y.delegate) {
        const yielded = valueExpression(y.value, { env, machine: true });
        if (target.mode === 'slot' && target.slot) {
          // The lexical declaration is initialized by the resume value, not by the yielded value.
          endWithYield(yielded, target.slot);
        } else {
          endWithYield(yielded);
          if (target.mode === 'return') {
            proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.return.statement-value', generatorFacts.body(), s.span);
            current.lines.push('state = -1;');
            current.lines.push('return JsGeneratorStep.Complete(sent);');
            terminated = true;
          }
        }
        continue;
      }

      proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.yield-star.delegate-next', generatorFacts.body(), y.span);
      proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.yield-star.completion-value', generatorFacts.delegation(), y.span);
      if (y.value.kind === 'array') {
        for (const element of y.value.elements) {
          const yielded = element ? valueExpression(element, { env, machine: true }) : literal(undefined);
          const resumeCase = nextState;
          current.lines.push('state = ' + resumeCase + ';');
          current.lines.push('return JsGeneratorStep.Yield(' + yielded.code + ');');
          freshCase();
        }
        finishYieldStarValue(target, 'JsUndefined.Value');
        continue;
      }

      const inner = delegatedGenerator(y.value);
      if (!inner || y.value.kind !== 'call')
        fail('E_GENERATOR_DELEGATE_UNPROVEN', 'yield* delegate is not a direct known generator.', y.span);
      if (y.value.args.length !== inner.source.params.length)
        fail('E_ARITY', 'Delegated generator call currently requires exact arity.', y.span);
      const args = y.value.args.map(a => valueExpression(a, { env, machine: true }));
      if (args.some(a => referenceLike(a.type)))
        fail('E_GENERATOR_ARGUMENT_BOUNDARY', 'Delegated generator arguments are restricted to proven primitives.', y.span);

      proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.yield-star.resume-forward', generatorFacts.delegation(), y.span);
      proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.yield-star.return-forward', generatorFacts.delegation('return'), y.span);

      const di = delegateIndex++;
      const fields = { value: '__delegate' + di, active: '__delegateActive' + di, first: '__delegateFirst' + di };
      delegateFields.push(fields);
      current.lines.push(fields.value + ' = Program.G' + inner.id + '(' + args.map(a => a.code).join(', ') + ');');
      current.lines.push(fields.active + ' = true;');
      current.lines.push(fields.first + ' = true;');
      const delegateState = nextState;
      current.lines.push('state = ' + delegateState + ';');
      current.lines.push('goto case ' + delegateState + ';');
      const delegateCase = freshCase();
      const resultName = '__result' + di;
      const valueName = '__value' + di;
      delegateCase.lines.push('var ' + resultName + ' = JsGenerator.Next(' + fields.value + ', ' + fields.first + ' ? JsUndefined.Value : sent);');
      delegateCase.lines.push(fields.first + ' = false;');
      delegateCase.lines.push('if (!JsGenerator.ResultDone(' + resultName + '))');
      delegateCase.lines.push('{');
      delegateCase.lines.push('    state = ' + delegateState + ';');
      delegateCase.lines.push('    return JsGeneratorStep.Yield(JsGenerator.ResultValue(' + resultName + '));');
      delegateCase.lines.push('}');
      delegateCase.lines.push('var ' + valueName + ' = JsGenerator.ResultValue(' + resultName + ');');
      delegateCase.lines.push(fields.active + ' = false;');
      if (target.mode === 'return') {
        proveGeneratorRule(index, trace as GeneratorTrace[], 'generator.return.statement-value', generatorFacts.body(), s.span);
        delegateCase.lines.push('state = -1;');
        delegateCase.lines.push('return JsGeneratorStep.Complete(' + valueName + ');');
        terminated = true;
      } else {
        const continuation = nextState;
        if (target.mode === 'slot' && target.slot) {
          delegateCase.lines.push(target.slot.cname + ' = ' + valueName + ';');
          target.slot.initialized = true;
          target.slot.type = 'Any';
        }
        delegateCase.lines.push('state = ' + continuation + ';');
        delegateCase.lines.push('goto case ' + continuation + ';');
        freshCase();
      }
    }

    if (!terminated) {
      current.lines.push('state = -1;');
      current.lines.push('return JsGeneratorStep.Complete(JsUndefined.Value);');
      contracts.add('generator.fallthrough.undefined-v1');
    }

    const slots = [...env.values()];
    const paramSlots = def.source.params.map(name => env.get(name)!);
    const machine: string[] = [];
    machine.push('    private sealed class G' + def.id + 'Machine : IJsGeneratorMachine');
    machine.push('    {');
    machine.push('        private int state;');
    for (const slot of slots) machine.push('        private JsValue ' + slot.cname + ' = JsUndefined.Value;');
    for (const d of delegateFields) {
      machine.push('        private JsValue ' + d.value + ' = JsUndefined.Value;');
      machine.push('        private bool ' + d.active + ';');
      machine.push('        private bool ' + d.first + ';');
    }
    machine.push('');
    machine.push('        internal G' + def.id + 'Machine(' + paramSlots.map(s => 'JsValue p_' + s.cname).join(', ') + ')');
    machine.push('        {');
    for (const slot of paramSlots) machine.push('            ' + slot.cname + ' = p_' + slot.cname + ';');
    machine.push('        }');
    machine.push('');
    machine.push('        public JsGeneratorStep Next(JsValue sent)');
    machine.push('        {');
    machine.push('            while (true)');
    machine.push('            {');
    machine.push('                switch (state)');
    machine.push('                {');
    for (const c of cases) {
      machine.push('                    case ' + c.id + ':');
      for (const line of c.lines) machine.push('                        ' + line);
    }
    machine.push('                    default:');
    machine.push('                        return JsGeneratorStep.Complete(JsUndefined.Value);');
    machine.push('                }');
    machine.push('            }');
    machine.push('        }');
    machine.push('');
    machine.push('        public JsGeneratorStep Return(JsValue value)');
    machine.push('        {');
    for (const d of delegateFields) {
      machine.push('            if (' + d.active + ')');
      machine.push('            {');
      machine.push('                var result = JsGenerator.Return(' + d.value + ', value);');
      machine.push('                ' + d.active + ' = false;');
      machine.push('                state = -1;');
      machine.push('                if (!JsGenerator.ResultDone(result))');
      machine.push('                    throw new InvalidOperationException("Reviewed generator profile forbids finally-yield during delegated return");');
      machine.push('                return JsGeneratorStep.Complete(JsGenerator.ResultValue(result));');
      machine.push('            }');
    }
    machine.push('            state = -1;');
    machine.push('            return JsGeneratorStep.Complete(value);');
    machine.push('        }');
    machine.push('    }');
    machine.push('');
    machine.push('    private static JsValue G' + def.id + '(' + paramSlots.map(s => 'JsValue p_' + s.cname).join(', ') + ')');
    machine.push('        => JsGenerator.Create(new G' + def.id + 'Machine(' + paramSlots.map(s => 'p_' + s.cname).join(', ') + '));');
    compiledMachines.push(machine.join('\n'));
  }

  const topEnv = new Map<string, Slot>();
  const noParams = new Set<string>();
  predeclareVariables(program.body, topEnv, noParams, program.functions[0]?.span ?? { file: program.file, start: 0, end: 0, line: 1, column: 1 });
  for (const name of definitions.keys()) {
    if (topEnv.has(name)) fail('E_DUPLICATE_BINDING', 'Generator declaration conflicts with lexical binding ' + name + '.', definitions.get(name)!.source.span);
  }

  const main: string[] = [];
  for (const s of program.body) {
    if (s.kind === 'empty') continue;
    if (s.kind === 'variable') {
      const slot = topEnv.get(s.name)!;
      const init = s.initializer ? valueExpression(s.initializer, { env: topEnv, machine: false }) : literal(undefined);
      main.push('JsValue ' + slot.cname + ' = ' + init.code + ';');
      slot.initialized = true;
      slot.type = init.type;
      slot.generator = init.generator;
      slot.resultValueType = init.resultValueType;
      continue;
    }
    if (s.kind === 'expression') {
      const value = valueExpression(s.expression, { env: topEnv, machine: false });
      main.push('_ = ' + value.code + ';');
      continue;
    }
    if (s.kind === 'return')
      fail('E_RETURN_CONTEXT', 'return outside a generator is invalid.', s.span);
  }

  const lines: string[] = [
    '// Generated by j2cs-compiler generator lane. Canonical rule proofs are in compilation.json.',
    'using J2cs.Runtime;',
    '',
    'internal static class Program',
    '{',
    '    private static void Main()',
    '    {',
    ...main.map(line => '        ' + line),
    '    }',
  ];
  for (const machine of compiledMachines) {
    lines.push('');
    lines.push(machine);
  }
  lines.push('}', '');

  return {
    source: lines.join('\n'),
    ir: { kind: 'generator-profile', generatorCount: definitions.size },
    trace,
    structuralContracts: [...contracts].sort(),
  };
}
