import { Facts, type FactModel } from '../analysis/facts.js';

export const NODE_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export type NodePathFlavor = 'host' | 'posix' | 'win32';
export type NodeRuleStrategy = 'helper' | 'runtime';

type Scalar = string | number | boolean;
interface Guard {
  readonly key: string;
  readonly equals?: Scalar;
  readonly oneOf?: readonly Scalar[];
  readonly subsetOf?: readonly string[];
}

export interface NodeRuleAdapter {
  readonly operation: string;
  readonly ruleId: string;
  readonly rulePath: string;
  readonly sha256: string;
  readonly strategy: NodeRuleStrategy;
  readonly target: string;
  readonly guards: readonly Guard[];
}

const processGuards: readonly Guard[] = [
  { key: 'host.profile', equals: 'node' },
  { key: 'binding.origin', equals: 'node.process.global' },
  { key: 'binding.shadowed', equals: false },
];

const pathGuards: readonly Guard[] = [
  { key: 'host.profile', equals: 'node' },
  { key: 'binding.origin', equals: 'node:path' },
  { key: 'binding.shadowed', equals: false },
  { key: 'path.flavor', oneOf: ['host', 'posix', 'win32'] },
];

const osGuards: readonly Guard[] = [
  { key: 'host.profile', equals: 'node' },
  { key: 'binding.origin', equals: 'node:os' },
  { key: 'binding.shadowed', equals: false },
];

export const NODE_RULE_ADAPTERS: readonly NodeRuleAdapter[] = [
  {
    operation: 'process.argv', ruleId: 'node.process.argv', rulePath: 'rules/node_core/process-argv.json',
    sha256: '82c8919493bcf9a0b35353ae2b6739ac1e6990a1a6e798700e8b21f519a5942b',
    strategy: 'helper', target: 'NodeProcess.Argv', guards: processGuards,
  },
  {
    operation: 'process.env', ruleId: 'node.process.env', rulePath: 'rules/node_core/process-env.json',
    sha256: '135257c7d81f1001d8f8c520382dad5898703dc690dcded1805d3f939d26ffcd',
    strategy: 'runtime', target: 'NodeProcess.Env', guards: processGuards,
  },
  {
    operation: 'process.cwd', ruleId: 'node.process.cwd', rulePath: 'rules/node_core/process-cwd.json',
    sha256: 'ddf3277dc4ac3ea75fe3df1259fbf8e106d3962a957116a340467a733d311605',
    strategy: 'helper', target: 'NodeProcess.Cwd()', guards: processGuards,
  },
  {
    operation: 'process.chdir', ruleId: 'node.process.chdir', rulePath: 'rules/node_core/process-chdir.json',
    sha256: '43eba34a8fa2700fc7dca05171fe94c9dabf879f1e5988df38632fd2cc23314b',
    strategy: 'helper', target: 'NodeProcess.Chdir', guards: [
      ...processGuards,
      { key: 'argument.types', subsetOf: ['String'] },
      { key: 'execution.context', equals: 'main' },
    ],
  },
  {
    operation: 'process.platform', ruleId: 'node.process.platform', rulePath: 'rules/node_core/process-platform.json',
    sha256: 'd3cf30b1da4433c98ffd3a80411f49938cdd2539b5838d4971f8b8353c759ec4',
    strategy: 'helper', target: 'NodeProcess.Platform', guards: processGuards,
  },
  {
    operation: 'process.arch', ruleId: 'node.process.arch', rulePath: 'rules/node_core/process-arch.json',
    sha256: '8b3111dba5aa656e05aa84e7b408579c64f8d78e71ae440a692998516de5fc93',
    strategy: 'helper', target: 'NodeProcess.Arch', guards: processGuards,
  },
  {
    operation: 'path.normalize', ruleId: 'node.path.normalize', rulePath: 'rules/node_core/path-normalize.json',
    sha256: 'e5a463a43813c7a62f06e02c38d5d4ba4308ec9400ce3145c85e4077e02e81ab',
    strategy: 'helper', target: 'NodePath.Normalize', guards: [...pathGuards, { key: 'argument.types', subsetOf: ['String'] }],
  },
  {
    operation: 'path.join', ruleId: 'node.path.join', rulePath: 'rules/node_core/path-join.json',
    sha256: 'ef43c9a5fc1373dded2ef069d0f0560af1e3fc19df2c4955b60d34de479fd6ad',
    strategy: 'helper', target: 'NodePath.Join', guards: [...pathGuards, { key: 'arguments.allString', equals: true }],
  },
  {
    operation: 'path.isAbsolute', ruleId: 'node.path.isabsolute', rulePath: 'rules/node_core/path-isabsolute.json',
    sha256: '16f9d2c54c5c2600101dea6eb8840611089ed14f3f6efce7119bfb3b874c0459',
    strategy: 'helper', target: 'NodePath.IsAbsolute', guards: [...pathGuards, { key: 'argument.types', subsetOf: ['String'] }],
  },
  {
    operation: 'path.sep', ruleId: 'node.path.sep', rulePath: 'rules/node_core/path-sep.json',
    sha256: 'f1ba3643b3237545b01ff23ac4c1ac6074da8c9bfaab43e8396ac9b91e888193',
    strategy: 'helper', target: 'NodePath.Separator', guards: pathGuards,
  },
  {
    operation: 'path.delimiter', ruleId: 'node.path.delimiter', rulePath: 'rules/node_core/path-delimiter.json',
    sha256: '45f50656492f36190e44cac721de8f91315b0e86c7218a5213b7c5056534ef55',
    strategy: 'helper', target: 'NodePath.Delimiter', guards: pathGuards,
  },
  {
    operation: 'os.platform', ruleId: 'node.os.platform', rulePath: 'rules/node_core/os-platform.json',
    sha256: '9dc101c12f63d32a2de99d423c8aea44b9c1a8030a61fbc00a9caa71cbe168ba',
    strategy: 'helper', target: 'NodeOs.Platform()', guards: osGuards,
  },
  {
    operation: 'os.arch', ruleId: 'node.os.arch', rulePath: 'rules/node_core/os-arch.json',
    sha256: '25a669fe9f4f7045f5da9997c143a7d7252ec5a8b181cb569fd342d633474b94',
    strategy: 'helper', target: 'NodeOs.Arch()', guards: osGuards,
  },
  {
    operation: 'os.EOL', ruleId: 'node.os.eol', rulePath: 'rules/node_core/os-eol.json',
    sha256: 'ca83c187e0ee480b3a9d60448104914b512ce185cea7e8c70c2a90b223858ded',
    strategy: 'helper', target: 'NodeOs.Eol', guards: osGuards,
  },
];

export type NodeProofVerdict = 'proven' | 'false' | 'unknown';
export interface NodeProof {
  readonly verdict: NodeProofVerdict;
  readonly evidence: readonly string[];
  readonly failures: readonly string[];
}

function evaluateGuard(guard: Guard, facts: FactModel): NodeProof {
  const fact = facts.get(guard.key);
  if (!fact) return { verdict: 'unknown', evidence: [], failures: [`missing ${guard.key}`] };

  if (guard.equals !== undefined) {
    const ok = fact.value === guard.equals;
    return ok
      ? { verdict: 'proven', evidence: [`${guard.key}: ${fact.evidence}`], failures: [] }
      : { verdict: 'false', evidence: [], failures: [`${guard.key} did not equal ${String(guard.equals)}`] };
  }

  if (guard.oneOf) {
    const ok = typeof fact.value !== 'object' && guard.oneOf.includes(fact.value as Scalar);
    return ok
      ? { verdict: 'proven', evidence: [`${guard.key}: ${fact.evidence}`], failures: [] }
      : { verdict: 'false', evidence: [], failures: [`${guard.key} was outside the reviewed set`] };
  }

  if (guard.subsetOf) {
    if (!Array.isArray(fact.value)) return { verdict: 'false', evidence: [], failures: [`${guard.key} was not a type set`] };
    const ok = fact.value.every(value => typeof value === 'string' && guard.subsetOf!.includes(value));
    return ok
      ? { verdict: 'proven', evidence: [`${guard.key}: ${fact.evidence}`], failures: [] }
      : { verdict: 'false', evidence: [], failures: [`${guard.key} included an unreviewed value`] };
  }

  return { verdict: 'unknown', evidence: [], failures: [`guard for ${guard.key} had no predicate`] };
}

export function proveNodeAdapter(adapter: NodeRuleAdapter, facts: FactModel): NodeProof {
  const results = adapter.guards.map(guard => evaluateGuard(guard, facts));
  const evidence = results.flatMap(result => result.evidence);
  const failures = results.flatMap(result => result.failures);
  if (results.some(result => result.verdict === 'false')) return { verdict: 'false', evidence, failures };
  if (results.some(result => result.verdict === 'unknown')) return { verdict: 'unknown', evidence, failures };
  return { verdict: 'proven', evidence, failures: [] };
}

export function selectNodeAdapter(operation: string, facts: FactModel) {
  const adapter = NODE_RULE_ADAPTERS.find(candidate => candidate.operation === operation);
  if (!adapter) return { status: 'unsupported' as const, operation, reason: 'No reviewed Node adapter.' };
  const proof = proveNodeAdapter(adapter, facts);
  if (proof.verdict !== 'proven') return { status: 'blocked' as const, operation, adapter, proof };
  return { status: 'selected' as const, operation, adapter, proof };
}

function baseNodeFacts(): Facts {
  return new Facts()
    .prove('host.profile', 'node', 'Compilation target is the reviewed Node host profile.')
    .prove('host.platform', 'runtime', 'Platform is observed by NodePlatform at runtime.')
    .prove('host.arch', 'runtime', 'Architecture is observed by NodePlatform at runtime.')
    .prove('process.cwdSource', 'NodeProcess.runtime', 'cwd is read and mutated through NodeProcess.');
}

export function nodeProcessFacts(): Facts {
  return baseNodeFacts()
    .prove('binding.origin', 'node.process.global', 'Binding resolver proved the Node process global.')
    .prove('binding.shadowed', false, 'No lexical binding shadows process.');
}

export function nodePathFacts(flavor: NodePathFlavor): Facts {
  return baseNodeFacts()
    .prove('binding.origin', 'node:path', 'Module resolver proved the node:path builtin.')
    .prove('binding.shadowed', false, 'The imported builtin binding is intact.')
    .prove('path.flavor', flavor, 'Member resolution proved default, posix, or win32 path flavor.');
}

export function nodeOsFacts(): Facts {
  return baseNodeFacts()
    .prove('binding.origin', 'node:os', 'Module resolver proved the node:os builtin.')
    .prove('binding.shadowed', false, 'The imported builtin binding is intact.');
}
