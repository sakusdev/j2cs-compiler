import { Facts } from './facts.js';

export type PromiseMethod = 'resolve' | 'reject' | 'then' | 'catch' | 'finally';

export interface PromiseProofInput {
  intrinsicConstructor?: boolean;
  constructorPristine?: boolean;
  pristineMethods?: readonly PromiseMethod[];
  executorCallable?: boolean;
  receiverRepresentation?: 'JsPromise';
  intrinsicSpecies?: boolean;
}

/**
 * Produce only evidence that a preceding analysis pass actually proved.
 * Omitted fields stay absent/unknown so Promise lowering remains fail-closed.
 */
export function promiseFacts(input: PromiseProofInput): Facts {
  const facts = new Facts();
  if (input.intrinsicConstructor)
    facts.prove('promise.constructor', 'intrinsic', 'binding resolution proved the intrinsic Promise constructor');
  if (input.constructorPristine)
    facts.prove('promise.constructor.integrity', 'pristine', 'closed-profile effect analysis proved Promise constructor integrity');
  for (const method of input.pristineMethods ?? [])
    facts.prove(`promise.method.${method}.integrity`, 'pristine', `effect analysis proved Promise.${method} is pristine`);
  if (input.executorCallable)
    facts.prove('promise.executor', 'callable', 'call-target analysis proved the Promise executor callable');
  if (input.receiverRepresentation === 'JsPromise')
    facts.prove('promise.receiver.representation', 'JsPromise', 'flow analysis proved the canonical intrinsic Promise representation');
  if (input.intrinsicSpecies)
    facts.prove('promise.species', 'intrinsic', 'closed-profile analysis proved intrinsic Promise species');
  return facts;
}
