import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compile, createCompiler, ROOT } from '../../compiler/index.js';
import { CompileError } from '../../compiler/diagnostics/index.js';
import {
  loadNetworkContracts,
  proveNetworkContract,
  type NetworkFacts,
} from '../../compiler/rules/node-network-contracts.js';

const index = await createCompiler();
const adapterRegistry = JSON.parse(
  await readFile(path.join(ROOT, 'compiler/rules/adapters.json'), 'utf8'),
) as { ruleDbCommit: string };
const registry = await loadNetworkContracts(
  index.database,
  path.join(ROOT, 'compiler/rules/node-network-contracts.json'),
  adapterRegistry.ruleDbCommit,
);

function prove(ruleId: string, facts: NetworkFacts) {
  const contract = registry.require(ruleId);
  const loaded = index.database.byId.get(ruleId);
  assert.ok(loaded, `missing canonical rule ${ruleId}`);
  return proveNetworkContract(contract, loaded, facts);
}

test('Node network contract registry is pinned to reviewed canonical j2cs rules', () => {
  assert.equal(registry.ruleDbCommit, adapterRegistry.ruleDbCommit);
  assert.equal(registry.contracts.length, 12);
  for (const contract of registry.contracts) {
    const loaded = index.database.byId.get(contract.ruleId);
    assert.ok(loaded, contract.ruleId);
    assert.equal(loaded.sha256, contract.sha256, contract.ruleId);
  }
});

test('HTTP header helpers require exact host/module/receiver proofs', () => {
  const facts: NetworkFacts = {
    hostProfile: 'Node.js',
    moduleBinding: 'node:http builtin',
    moduleIntegrity: 'pristine',
    memberIntegrity: 'pristine',
    receiver: 'node:http ClientRequest',
  };
  const proof = prove('node.http.client-request.set-header', facts);
  assert.equal(proof.verdict, 'proven');
  assert.equal(proof.compilerEnableable, true);

  const unknownReceiver = prove('node.http.client-request.set-header', { ...facts, receiver: undefined });
  assert.equal(unknownReceiver.verdict, 'unknown');
  assert.equal(unknownReceiver.compilerEnableable, false);

  const wrongHost = prove('node.http.client-request.set-header', { ...facts, hostProfile: 'Electron' });
  assert.equal(wrongHost.verdict, 'disproven');
  assert.equal(wrongHost.compilerEnableable, false);
});

test('transport foundations and sibling-dependent rules stay fail-closed', () => {
  const netFacts: NetworkFacts = {
    hostProfile: 'Node.js',
    moduleBinding: 'node:net builtin',
    memberIntegrity: 'pristine',
  };

  const createServer = prove('node.net.create-server', netFacts);
  assert.equal(createServer.verdict, 'proven');
  assert.equal(createServer.compilerEnableable, false);
  assert.equal(registry.require('node.net.create-server').availability, 'transport-foundation');

  const write = prove('node.net.socket.write', netFacts);
  assert.equal(write.verdict, 'proven');
  assert.equal(write.compilerEnableable, false);
  assert.deepEqual(registry.require('node.net.socket.write').blockedBy, ['NODE_EVENTS_STREAMS_BUFFER']);

  const httpRequest = prove('node.http.request', {
    hostProfile: 'Node.js',
    moduleBinding: 'node:http builtin',
    moduleIntegrity: 'pristine',
  });
  assert.equal(httpRequest.verdict, 'proven');
  assert.equal(httpRequest.compilerEnableable, false);
  assert.equal(registry.require('node.http.request').availability, 'deferred');
});

test('unsupported CommonJS module syntax remains a compiler diagnostic until module wiring lands', () => {
  assert.throws(
    () => compile("const net = require('node:net');", index, 'network.cjs'),
    (error: unknown) => {
      assert.ok(error instanceof CompileError);
      assert.equal(error.diagnostic.code, 'E_UNRESOLVED_BINDING');
      return true;
    },
  );
});
