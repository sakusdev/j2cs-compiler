import { readFile } from 'node:fs/promises';
import { fail } from '../diagnostics/index.js';
import type { LoadedRule, RuleDatabase } from './loader.js';

export type NetworkAvailability = 'executable-helper' | 'transport-foundation' | 'deferred';
export interface NetworkContract { ruleId:string; sha256:string; module:string; runtime:string; availability:NetworkAvailability; receiver?:string; blockedBy?:string[] }
export interface NetworkFacts { hostProfile?:string; moduleBinding?:string; moduleIntegrity?:string; memberIntegrity?:string; receiver?:string }
export type NetworkVerdict = 'proven' | 'disproven' | 'unknown';
export interface NetworkCheck { requirement:string; expected:unknown; actual?:unknown; verdict:NetworkVerdict; evidence:string }
export interface NetworkProof { ruleId:string; verdict:NetworkVerdict; checks:NetworkCheck[]; compilerEnableable:boolean }

export class NetworkContractRegistry {
  readonly byRuleId = new Map<string, NetworkContract>();
  constructor(readonly ruleDbCommit:string, readonly contracts:readonly NetworkContract[], database:RuleDatabase) {
    for (const c of contracts) {
      if (this.byRuleId.has(c.ruleId)) fail('E_NODE_NETWORK_CONTRACT', `Duplicate contract ${c.ruleId}.`);
      const rule = database.byId.get(c.ruleId);
      if (!rule) fail('E_RULE_MISSING', `Canonical Node network rule is absent: ${c.ruleId}`);
      if (rule.sha256 !== c.sha256) fail('E_RULE_CONTRACT', `Canonical Node network rule changed: ${c.ruleId}.`);
      this.byRuleId.set(c.ruleId, c);
    }
  }
  require(ruleId:string):NetworkContract { return this.byRuleId.get(ruleId) ?? fail('E_NODE_NETWORK_CONTRACT', `No reviewed contract for ${ruleId}.`); }
}

export async function loadNetworkContracts(database:RuleDatabase, file:string, expectedCommit?:string):Promise<NetworkContractRegistry> {
  const data = JSON.parse(await readFile(file, 'utf8')) as {version?:unknown;ruleDbCommit?:unknown;contracts?:unknown};
  if (data.version !== 1 || typeof data.ruleDbCommit !== 'string' || !Array.isArray(data.contracts)) fail('E_NODE_NETWORK_CONTRACT', 'Invalid network contract registry.');
  if (expectedCommit !== undefined && data.ruleDbCommit !== expectedCommit) fail('E_RULE_CONTRACT', 'Network registry pin differs from compiler rule-db pin.');
  const contracts = data.contracts.map((x:unknown) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return fail('E_NODE_NETWORK_CONTRACT', 'Invalid network contract entry.');
    const c=x as Record<string,unknown>;
    if (typeof c.ruleId !== 'string' || typeof c.sha256 !== 'string' || typeof c.module !== 'string' || typeof c.runtime !== 'string'
      || !['executable-helper','transport-foundation','deferred'].includes(String(c.availability))) return fail('E_NODE_NETWORK_CONTRACT', 'Invalid network contract fields.');
    if (c.receiver !== undefined && typeof c.receiver !== 'string') return fail('E_NODE_NETWORK_CONTRACT', 'Invalid receiver contract.');
    if (c.blockedBy !== undefined && (!Array.isArray(c.blockedBy) || !c.blockedBy.every(v=>typeof v==='string'))) return fail('E_NODE_NETWORK_CONTRACT', 'Invalid dependency list.');
    return c as unknown as NetworkContract;
  });
  return new NetworkContractRegistry(data.ruleDbCommit, contracts, database);
}

function eq(requirement:string, expected:unknown, actual:unknown, evidence:string):NetworkCheck {
  return {requirement,expected,actual,verdict:actual===undefined?'unknown':actual===expected?'proven':'disproven',evidence};
}
function requirement(key:string, expected:unknown, facts:NetworkFacts):NetworkCheck {
  if (key==='module_binding') return eq(key,expected,facts.moduleBinding,'Resolved builtin module identity.');
  if (key==='builtin_not_shadowed') return eq(key,true,facts.moduleIntegrity===undefined?undefined:facts.moduleIntegrity==='pristine','Module integrity.');
  if (key==='builtin_node_member_not_overridden' || key==='builtin_method_not_overridden' || key==='builtin_property_or_method_not_overridden')
    return eq(key,true,facts.memberIntegrity===undefined?undefined:facts.memberIntegrity==='pristine','Builtin member integrity.');
  if (key==='receiver_inferred_as') return eq(key,expected,facts.receiver,'Receiver host contract.');
  return {requirement:key,expected,verdict:'unknown',evidence:`Unrecognized requirement ${key}.`};
}
export function proveNetworkContract(contract:NetworkContract, loaded:LoadedRule, facts:NetworkFacts):NetworkProof {
  if (loaded.rule.id!==contract.ruleId || loaded.sha256!==contract.sha256) fail('E_RULE_CONTRACT', `Rule/contract mismatch for ${contract.ruleId}.`);
  const checks=Object.entries(loaded.rule.source.requirements??{}).map(([k,v])=>requirement(k,v,facts));
  checks.push(eq('backend.hostProfile','Node.js',facts.hostProfile,'Host-profile guard.'));
  checks.push(eq('backend.moduleBinding',`${contract.module} builtin`,facts.moduleBinding,'Exact builtin module guard.'));
  if (contract.receiver!==undefined) checks.push(eq('backend.receiver',contract.receiver,facts.receiver,'Exact receiver guard.'));
  const verdict:NetworkVerdict=checks.some(c=>c.verdict==='disproven')?'disproven':checks.some(c=>c.verdict==='unknown')?'unknown':'proven';
  return {ruleId:contract.ruleId,verdict,checks,compilerEnableable:verdict==='proven'&&contract.availability==='executable-helper'&&(contract.blockedBy?.length??0)===0};
}
