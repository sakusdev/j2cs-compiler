import { fail, type Span } from '../diagnostics/index.js';
import type { Trace } from '../lowering/index.js';
import type { RuleDatabase } from '../rules/loader.js';
import type { RequirementsProof, Proof, Predicate } from '../rules/requirements.js';
import type { ClassExpr, ParsedClass, ParsedClassProgram, ParsedStaticMethod } from '../parser/classes.js';

const CLASS_RULES = {
  staticMethod: { id: 'classes.static.method_direct', sha256: 'bfbf41f7c27e28e6c4a4a9d1cff0f272ac34a0d972335180311c21c21c0e9f29', lowering: 'class.static.method.direct' },
  staticInit: { id: 'classes.static.initialization_order', sha256: '6eca4988bdd2031025f146a2d3d0588f30f6b1a7c2e172878cb136a15329cb81', lowering: 'JsClass.Initialize' },
  staticInheritance: { id: 'classes.static.field_inheritance', sha256: 'f27473aefbc1467b55305a558e960db176b20a61e26c12b48057795270f78409', lowering: 'JsClass.GetStatic/SetStatic' },
  extendsStatic: { id: 'classes.extends.static_base', sha256: '36ee16ec999b23c7b61f9d1f83288c62b2cd4fe40cd6870131f25812d52cdb93', lowering: 'class.extends.closed-world' },
  baseField: { id: 'classes.field.public_base_initializer_order', sha256: 'a82ff7b1b18c38ff3116b0a25655dcab4107c9b2f96e97e8875130f5a1c0498e', lowering: 'deferred.instance-field.base' },
  derivedField: { id: 'classes.field.public_derived_initializer_order', sha256: 'f46fa0ff6cd0dce2e50d78d0eb3789e8ef7841b8950538c1de6fb41c5383ad94', lowering: 'deferred.instance-field.derived' },
  derivedCtor: { id: 'classes.constructor.derived_super_first', sha256: '5d401df285fffc94c2a2069ac3d14dfa3ca06a99ce604804f9ad704c96280057', lowering: 'deferred.constructor.super' },
  superInstance: { id: 'classes.super.instance_property', sha256: '740af4191bc5783a57f3d7a6a92f062a2c64f712cb61f54d5d33b04841afe2ae', lowering: 'deferred.JsSuper' },
  superStatic: { id: 'classes.super.static_property', sha256: '6cafcd79674f7d3008cade5f44b22936ba2699c7b60ed5e135183522b603c93e', lowering: 'deferred.JsSuper.GetStatic' },
} as const;

type ClassRuleKey = keyof typeof CLASS_RULES;
export interface DeferredClassEdge { span: Span; feature: string; canonicalRules: string[]; dependency: string }
export interface StaticFieldResolution { owner: ParsedClass; inherited: boolean }
export interface ClassPlan {
  program: ParsedClassProgram;
  byName: Map<string, ParsedClass>;
  traces: Trace[];
  deferred: DeferredClassEdge[];
  resolveField(className: string, property: string, span: Span): StaticFieldResolution;
  resolveMethod(className: string, method: string, span: Span): { owner: ParsedClass; method: ParsedStaticMethod };
}

function checkedRule(database: RuleDatabase, key: ClassRuleKey) {
  const contract = CLASS_RULES[key], loaded = database.byId.get(contract.id);
  if (!loaded) fail('E_RULE_MISSING', `Reviewed class rule is absent: ${contract.id}`);
  if (loaded.sha256 !== contract.sha256)
    fail('E_RULE_CONTRACT', `Class rule ${contract.id} changed; review its class adapter before enabling it.`);
  return { loaded, contract };
}

function proofFor(database: RuleDatabase, key: ClassRuleKey, evidence: Record<string, string>, span: Span): Trace {
  const { loaded, contract } = checkedRule(database, key);
  const requirements = loaded.rule.source.requirements ?? {};
  const checks: Proof[] = [];
  for (const [name, value] of Object.entries(requirements)) {
    const why = evidence[name];
    if (!why || !['string', 'number', 'boolean'].includes(typeof value))
      fail('E_CLASS_PROOF_UNKNOWN', `No reviewed proof producer for ${contract.id} requirement '${name}'.`, span);
    const predicate: Predicate = { fact: `class.${name}`, equals: value as string | number | boolean };
    checks.push({ verdict: 'proven', predicate, evidence: [why] });
  }
  const requirementsProof: RequirementsProof = {
    verdict: 'proven', checks,
    constraints: checks.map(c => JSON.stringify(c.predicate)).sort(),
  };
  return {
    ruleId: loaded.rule.id, strategy: loaded.rule.strategy, lowering: contract.lowering, span,
    sha256: loaded.sha256, requirements: requirementsProof, rejected: [], ambiguous: [],
  };
}

function walkExpr(e: ClassExpr, visit: (e: ClassExpr) => void): void {
  visit(e);
  if (e.kind === 'staticCall' || e.kind === 'consoleLog') e.args.forEach(a => walkExpr(a, visit));
}

export function analyzeClassProgram(program: ParsedClassProgram, database: RuleDatabase): ClassPlan {
  const byName = new Map<string, ParsedClass>(), traces: Trace[] = [], deferred: DeferredClassEdge[] = [];
  const traceKeys = new Set<string>();
  const addTrace = (key: ClassRuleKey, evidence: Record<string, string>, span: Span, uniqueness: string) => {
    const k = `${key}:${uniqueness}`;
    if (!traceKeys.has(k)) { traces.push(proofFor(database, key, evidence, span)); traceKeys.add(k); }
  };

  for (const item of program.items) {
    if (item.kind !== 'class') continue;
    if (byName.has(item.bindingName)) fail('E_DUPLICATE_BINDING', `Duplicate class binding '${item.bindingName}'.`, item.span);
    if (item.dynamicBase) fail('E_CLASS_DYNAMIC_BASE', 'Dynamic class heritage remains fail-closed.', item.span);
    if (item.baseName && !byName.has(item.baseName))
      fail('E_CLASS_BASE_TDZ', `Base class '${item.baseName}' is not an already-evaluated translated class.`, item.span);
    byName.set(item.bindingName, item);

    const staticFields = item.elements.filter(e => e.kind === 'staticField');
    const staticMethods = item.elements.filter((e): e is ParsedStaticMethod => e.kind === 'staticMethod');
    const seen = new Set<string>();
    for (const element of [...staticFields, ...staticMethods]) {
      if (seen.has(element.name))
        fail('E_CLASS_REDEFINITION', `Repeated static element '${element.name}' is deferred until property redefinition semantics are modeled.`, element.span);
      seen.add(element.name);
    }
    if (staticFields.length) addTrace('staticInit', {
      static_initializers_or_blocks_present: 'At least one parsed static field initializer executes at this exact class-evaluation point.',
    }, item.span, item.bindingName);

    for (const method of staticMethods) {
      if (method.usesThis || method.usesSuper) {
        checkedRule(database, 'staticMethod');
        if (method.usesSuper) checkedRule(database, 'superStatic');
        deferred.push({ span: method.span, feature: `static method ${item.bindingName}.${method.name} with dynamic this/super`,
          canonicalRules: [CLASS_RULES.staticMethod.id, CLASS_RULES.superStatic.id],
          dependency: 'constructor-object receiver/super descriptor semantics are not independently proven' });
      } else addTrace('staticMethod', {
        static_method_does_not_use_this_as_constructor_object: 'Normalized method scan proves no ThisKeyword.',
        no_static_super_dynamic_access: 'Normalized method scan proves no SuperKeyword.',
        class_value_not_reflected: 'Class-lane grammar only permits statically resolved field/method operations and console output.',
        method_not_replaced: 'Analyzer rejects writes that target declared static methods.',
      }, method.span, `${item.bindingName}.${method.name}`);
    }

    for (const element of item.elements) {
      if (element.kind === 'instanceField') {
        checkedRule(database, item.baseName ? 'derivedField' : 'baseField');
        deferred.push({ span: element.span, feature: `instance field ${item.bindingName}.${element.name}`,
          canonicalRules: [item.baseName ? CLASS_RULES.derivedField.id : CLASS_RULES.baseField.id],
          dependency: item.baseName ? 'LANGUAGE_CONSTRUCTORS_NEW_TARGET/#20 must establish this after super()' : 'LANGUAGE_CONSTRUCTORS_NEW_TARGET/#20 must establish construction' });
      } else if (element.kind === 'instanceMethod') {
        if (element.usesSuper) checkedRule(database, 'superInstance');
        deferred.push({ span: element.span, feature: `instance method ${item.bindingName}.${element.name}`,
          canonicalRules: element.usesSuper ? [CLASS_RULES.superInstance.id] : [],
          dependency: 'LANGUAGE_THIS_METHOD_CALLS/#19 and LANGUAGE_CONSTRUCTORS_NEW_TARGET/#20 are unmerged' });
      } else if (element.kind === 'constructor') {
        if (element.derived) checkedRule(database, 'derivedCtor');
        deferred.push({ span: element.span, feature: `constructor for ${item.bindingName}`,
          canonicalRules: element.derived ? [CLASS_RULES.derivedCtor.id] : [],
          dependency: 'LANGUAGE_CONSTRUCTORS_NEW_TARGET/#20 is unmerged; constructor entry stays fail-closed' });
      }
    }
  }

  function classByName(name: string, span: Span): ParsedClass {
    return byName.get(name) ?? fail('E_CLASS_UNRESOLVED', `Unresolved class binding '${name}'.`, span);
  }
  function resolveField(className: string, property: string, span: Span): StaticFieldResolution {
    let current = classByName(className, span), inherited = false;
    for (;;) {
      const own = current.elements.find(e => e.kind === 'staticField' && e.name === property);
      if (own) {
        if (inherited) addTrace('staticInheritance', {
          static_field_access_through_subclass_possible: `Static access ${className}.${property} resolves through constructor-object base linkage to ${current.bindingName}.`,
        }, span, `${className}.${property}`);
        return { owner: current, inherited };
      }
      if (!current.baseName) break;
      current = classByName(current.baseName, span); inherited = true;
    }
    return fail('E_CLASS_STATIC_PROPERTY', `Static property '${className}.${property}' is not a proven translated static data field.`, span);
  }
  function resolveMethod(className: string, methodName: string, span: Span) {
    const cls = classByName(className, span);
    const own = cls.elements.find((e): e is ParsedStaticMethod => e.kind === 'staticMethod' && e.name === methodName);
    if (own) return { owner: cls, method: own };
    for (let current = cls.baseName ? classByName(cls.baseName, span) : undefined; current;
      current = current.baseName ? classByName(current.baseName, span) : undefined) {
      if (current.elements.some(e => e.kind === 'staticMethod' && e.name === methodName))
        fail('E_CLASS_STATIC_METHOD_RECEIVER', 'Inherited static method calls need dynamic constructor-object this semantics and remain fail-closed.', span);
    }
    return fail('E_CLASS_STATIC_METHOD', `Static method '${className}.${methodName}' is not defined.`, span);
  }

  const inspect = (available: ReadonlySet<string>, owner?: ParsedClass) => (e: ClassExpr): void => {
    if (e.kind === 'staticRead' || e.kind === 'staticCall') {
      if (!available.has(e.className)) fail('E_CLASS_TDZ', `Class '${e.className}' is not evaluated yet.`, e.span);
      if (owner?.expression && e.className === owner.bindingName) fail('E_CLASS_EXPRESSION_TDZ', 'Class-expression initializer cannot read its outer const binding.', e.span);
    }
    if (e.kind === 'staticRead') resolveField(e.className, e.property, e.span);
    if (e.kind === 'staticCall') {
      if (e.args.length) fail('E_CLASS_ARITY_DEPENDENCY', 'Static class calls with arguments are owned by the arguments/default/rest lane.', e.span);
      resolveMethod(e.className, e.method, e.span);
    }
  };
  const evaluated = new Set<string>();
  for (const item of program.items) {
    if (item.kind === 'class') {
      const available = new Set(evaluated); available.add(item.bindingName);
      for (const element of item.elements) {
        if (element.kind === 'staticField') walkExpr(element.initializer, inspect(available, item));
        if (element.kind === 'staticMethod' && element.result) walkExpr(element.result, inspect(available));
      }
      evaluated.add(item.bindingName);
    } else if (item.kind === 'console') item.args.forEach(e => walkExpr(e, inspect(evaluated)));
    else if (item.kind === 'staticCall') walkExpr(item.call, inspect(evaluated));
    else {
      if (!evaluated.has(item.className)) fail('E_CLASS_TDZ', `Class '${item.className}' is not evaluated yet.`, item.span);
      const cls = classByName(item.className, item.span);
      if (cls.elements.some(e => e.kind === 'staticMethod' && e.name === item.property))
        fail('E_CLASS_METHOD_REPLACEMENT', 'Replacing a translated static method would invalidate the direct-method proof.', item.span);
      resolveField(item.className, item.property, item.span);
      walkExpr(item.value, inspect(evaluated));
    }
  }
  return { program, byName, traces, deferred, resolveField, resolveMethod };
}
