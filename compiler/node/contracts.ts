import { fail } from '../diagnostics/index.js';
import type { LoadedRule, RuleDatabase, Strategy } from '../rules/loader.js';

export const PINNED_J2CS_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

interface ContractSpec {
  ruleId: string;
  category: string;
  strategy: Strategy;
  targetKind: string;
  targetMarker: string;
  requirements: Readonly<Record<string, string | boolean>>;
  runtimeContract: string;
}

export interface NodeHostRuleProof {
  ruleId: string;
  file: string;
  sha256: string;
  ruleDbCommit: string;
  runtimeContract: string;
  requirements: Readonly<Record<string, string | boolean>>;
}

const HOST_TIMER_REQUIREMENTS = Object.freeze({
  host_profile: 'Node.js',
  global_builtin_not_overridden: true,
});

const specs: readonly ContractSpec[] = [
  {
    ruleId: 'node.timers.set-timeout',
    category: 'timers',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'NodeEventLoop.SetTimeout',
    requirements: HOST_TIMER_REQUIREMENTS,
    runtimeContract: 'NodeCompat.NodeEventLoop.SetTimeout',
  },
  {
    ruleId: 'node.timers.clear-timeout',
    category: 'timers',
    strategy: 'helper',
    targetKind: 'helper',
    targetMarker: 'NodeTimers.ClearTimeout',
    requirements: HOST_TIMER_REQUIREMENTS,
    runtimeContract: 'NodeCompat.NodeEventLoop.ClearTimeout',
  },
  {
    ruleId: 'node.timers.set-interval',
    category: 'timers',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'NodeEventLoop.SetInterval',
    requirements: HOST_TIMER_REQUIREMENTS,
    runtimeContract: 'NodeCompat.NodeEventLoop.SetInterval',
  },
  {
    ruleId: 'node.timers.clear-interval',
    category: 'timers',
    strategy: 'helper',
    targetKind: 'helper',
    targetMarker: 'NodeTimers.ClearInterval',
    requirements: HOST_TIMER_REQUIREMENTS,
    runtimeContract: 'NodeCompat.NodeEventLoop.ClearInterval',
  },
  {
    ruleId: 'node.timers.set-immediate',
    category: 'timers',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'NodeEventLoop.SetImmediate',
    requirements: HOST_TIMER_REQUIREMENTS,
    runtimeContract: 'NodeCompat.NodeEventLoop.SetImmediate',
  },
  {
    ruleId: 'eventloop.immediate-fifo',
    category: 'event_loop',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'NodeEventLoop.EnqueueImmediateFifo',
    requirements: Object.freeze({
      host_profile: 'Node.js',
      global_builtin_not_overridden: true,
      same_queue_turn: true,
    }),
    runtimeContract: 'NodeCompat.NodeEventLoop.RunCheckPhase',
  },
  {
    ruleId: 'node.child-process.spawn-sync',
    category: 'node_process_workers',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'node_child_process_spawn_sync',
    requirements: Object.freeze({ binding: 'node:child_process.spawnSync' }),
    runtimeContract: 'NodeCompat.NodeChildProcess.SpawnSync',
  },
  {
    ruleId: 'node.child-process.spawn-stdio-pipe',
    category: 'node_process_workers',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'node_child_process_spawn_stdio_pipe',
    requirements: Object.freeze({
      binding: 'node:child_process.spawn',
      stdio: 'default pipes',
    }),
    runtimeContract: 'NodeCompat.NodeChildProcess.StartPiped',
  },
  {
    ruleId: 'node.child-process.spawn-env-cwd',
    category: 'node_process_workers',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'node_child_process_spawn_env_cwd',
    requirements: Object.freeze({ binding: 'node:child_process.spawn' }),
    runtimeContract: 'NodeCompat.NodeSpawnOptions',
  },
  {
    ruleId: 'node.worker-threads.post-message',
    category: 'node_process_workers',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'node_worker_threads_post_message',
    requirements: Object.freeze({
      receiver: 'node:worker_threads.Worker',
      builtin_method: 'postMessage',
    }),
    runtimeContract: 'NodeCompat.NodeWorkerMessageQueue.PostMessage',
  },
  {
    ruleId: 'node.worker-threads.exit-event',
    category: 'node_process_workers',
    strategy: 'runtime',
    targetKind: 'runtime',
    targetMarker: 'node_worker_threads_exit_event',
    requirements: Object.freeze({
      receiver: 'Worker',
      event: 'exit',
    }),
    runtimeContract: 'NodeCompat.NodeWorkerMessageQueue.Complete',
  },
];

function targetContains(rule: LoadedRule, marker: string): boolean {
  const target = rule.rule.target;
  return target.helper === marker
    || target.template === marker
    || target.helper?.includes(marker) === true
    || target.template?.includes(marker) === true;
}

function assertContract(loaded: LoadedRule, spec: ContractSpec): void {
  const rule = loaded.rule;
  if (rule.category !== spec.category || rule.strategy !== spec.strategy || rule.target.kind !== spec.targetKind) {
    fail('E_RULE_CONTRACT', `Canonical rule ${spec.ruleId} changed category/strategy/target kind; review the Node host contract.`);
  }
  if (!targetContains(loaded, spec.targetMarker)) {
    fail('E_RULE_CONTRACT', `Canonical rule ${spec.ruleId} changed target helper/template; review the Node host contract.`);
  }
  const actual = rule.source.requirements ?? {};
  for (const [key, value] of Object.entries(spec.requirements)) {
    if (actual[key] !== value) {
      fail('E_RULE_CONTRACT', `Canonical rule ${spec.ruleId} changed requirement ${key}; review the Node host contract.`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(loaded.sha256)) {
    fail('E_RULE_CONTRACT', `Canonical rule ${spec.ruleId} has an invalid content fingerprint.`);
  }
}

/**
 * Connect the independently testable Node host compatibility layer to the pinned
 * canonical j2cs rules without claiming parser/module support that is not merged.
 *
 * These are proofs of runtime contracts, not executable compiler adapters. Direct
 * require/import/timer syntax remains fail-closed until the module/callable lanes
 * can prove binding identity and callback semantics.
 */
export function proveNodeHostContracts(database: RuleDatabase): readonly NodeHostRuleProof[] {
  return specs.map(spec => {
    const loaded = database.byId.get(spec.ruleId);
    if (!loaded) fail('E_RULE_MISSING', `Canonical Node host rule is absent: ${spec.ruleId}`);
    assertContract(loaded, spec);
    return Object.freeze({
      ruleId: spec.ruleId,
      file: loaded.file,
      sha256: loaded.sha256,
      ruleDbCommit: PINNED_J2CS_COMMIT,
      runtimeContract: spec.runtimeContract,
      requirements: spec.requirements,
    });
  });
}
