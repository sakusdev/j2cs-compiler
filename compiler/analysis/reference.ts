import type { Expr } from '../parser/ast.js';
import { Facts } from './facts.js';

export type CallReferenceKind = 'property' | 'value';

export interface CallReferencePlan {
  kind: CallReferenceKind;
  thisArgument: 'base' | 'undefined';
  evaluateCalleeOnce: true;
  argumentOrder: 'left-to-right';
  property?: string;
}

/**
 * Normalize the ECMAScript Reference-vs-value distinction without evaluating source text.
 * A MemberExpression call preserves its base as the eventual thisArgument; every other
 * callee is a value call whose ordinary thisArgument is undefined.
 */
export function planCallReference(callee: Expr): CallReferencePlan {
  if (callee.kind === 'member') {
    return {
      kind: 'property',
      thisArgument: 'base',
      evaluateCalleeOnce: true,
      argumentOrder: 'left-to-right',
      property: callee.property,
    };
  }
  return {
    kind: 'value',
    thisArgument: 'undefined',
    evaluateCalleeOnce: true,
    argumentOrder: 'left-to-right',
  };
}

export interface ReferenceCallEvidence {
  propertyResolvesToKnownJsFunction?: boolean;
  getterEffectsAccountedFor?: boolean;
  methodNotProxy?: boolean;
  sideEffectfulCalleeOrArguments?: boolean;
}

function proveOptional(facts: Facts, key: string, value: boolean | undefined, evidence: string): void {
  if (value !== undefined) facts.prove(key, value, evidence);
}

/**
 * Evidence is deliberately explicit. Omitted evidence stays unknown and therefore cannot
 * prove a canonical rule through the reference-call proof bridge.
 */
export function referenceCallFacts(plan: CallReferencePlan, evidence: ReferenceCallEvidence = {}): Facts {
  const facts = new Facts()
    .prove('call.reference.kind', plan.kind, 'Normalized AST callee form')
    .prove('call.reference.thisSource', plan.thisArgument, 'ECMAScript Reference call classification')
    .prove('call.callee.evaluateOnce', true, 'Reference plan evaluates the callee/reference once before arguments')
    .prove('call.arguments.leftToRight', true, 'Normalized call plan preserves source argument order');

  proveOptional(facts, 'call.property.knownJsFunction', evidence.propertyResolvesToKnownJsFunction,
    'Callable identity/property resolution evidence supplied by semantic analysis');
  proveOptional(facts, 'call.lookup.effectsAccountedFor', evidence.getterEffectsAccountedFor,
    'Property lookup effects are represented at the reference boundary');
  proveOptional(facts, 'call.method.notProxy', evidence.methodNotProxy,
    'Proxy exclusion is explicit proof, never inferred from syntax alone');
  proveOptional(facts, 'call.sideEffectful', evidence.sideEffectfulCalleeOrArguments,
    'Semantic analysis classified callee/reference or arguments as effectful');
  return facts;
}

export function methodExtractionFacts(propertyValueIsJsFunction?: boolean, ordinaryCallAfterExtraction?: boolean): Facts {
  const facts = new Facts();
  proveOptional(facts, 'call.extraction.propertyValueJsFunction', propertyValueIsJsFunction,
    'Flow analysis proves the extracted property value is a JavaScript function');
  proveOptional(facts, 'call.extraction.ordinaryCall', ordinaryCallAfterExtraction,
    'The later invocation is an ordinary value call, not a retained property Reference');
  return facts;
}

export type OrdinaryThisMode = 'strict' | 'sloppy';

export function ordinaryThisFacts(mode: OrdinaryThisMode, hostGlobalThisKnown?: boolean): Facts {
  const facts = new Facts()
    .prove('function.this.strict', mode === 'strict', 'Function strictness is an explicit semantic fact')
    .prove('function.this.sloppy', mode === 'sloppy', 'Function strictness is an explicit semantic fact');
  proveOptional(facts, 'host.globalThis.known', hostGlobalThisKnown,
    'Host profile provides an explicit global this value');
  return facts;
}
