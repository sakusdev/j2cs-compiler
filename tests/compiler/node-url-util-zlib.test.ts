import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../../compiler/index.js';
import { Facts } from '../../compiler/analysis/facts.js';
import { loadRules } from '../../compiler/rules/loader.js';
import {
  NODE_URL_UTIL_ZLIB_RULE_DB_COMMIT,
  loadNodeUrlUtilZlibProofIndex,
} from '../../compiler/node/url-util-zlib.js';

const database = await loadRules(path.join(ROOT, 'rule-db'));
const index = await loadNodeUrlUtilZlibProofIndex(database, path.join(ROOT, 'compiler/node/adapters.json'));

test('NODE_URL_UTIL_ZLIB_MISC adapters pin the reviewed canonical rules and helpers', () => {
  assert.equal(index.ruleDbCommit, NODE_URL_UTIL_ZLIB_RULE_DB_COMMIT);
  assert.deepEqual(index.ruleIds(), [
    'node.url.fileurltopath',
    'node.util.format',
    'node.zlib.gzip.sync',
    'web.urlsearchparams.to-string',
  ]);
  assert.equal(index.adapter('node.url.fileurltopath').lowering, 'NodeUrl.FileUrlToPath');
  assert.equal(index.adapter('node.util.format').lowering, 'NodeUtil.Format');
  assert.equal(index.adapter('node.zlib.gzip.sync').lowering, 'NodeZlib.SyncGzipSync');
  assert.equal(index.adapter('web.urlsearchparams.to-string').lowering, 'WebUrlSearchParams.Serialize');
});

test('fileURLToPath proof requires intrinsic module identity, compatible input and preserved platform option', () => {
  const facts = new Facts()
    .prove('node.moduleBinding', 'node:url builtin', 'module resolver')
    .prove('node.bindingIntegrity', 'pristine', 'binding analysis')
    .prove('node.url.inputCompatible', true, 'URL/string representation analysis')
    .prove('node.url.optionsPreserved', true, 'options lowering')
    .prove('node.url.input', 'string', 'bounded runtime profile')
    .prove('node.url.platformMode', 'explicit', 'explicit platform mode');
  assert.equal(index.prove('node.url.fileurltopath', facts).verdict, 'proven');

  const shadowed = new Facts(facts).prove('node.bindingIntegrity', 'shadowed', 'lexical binding');
  assert.equal(index.prove('node.url.fileurltopath', shadowed).verdict, 'disproven');

  const missingOptions = new Facts()
    .prove('node.moduleBinding', 'node:url builtin', 'module resolver')
    .prove('node.bindingIntegrity', 'pristine', 'binding analysis')
    .prove('node.url.inputCompatible', true, 'URL/string representation analysis')
    .prove('node.url.input', 'string', 'bounded runtime profile')
    .prove('node.url.platformMode', 'explicit', 'explicit platform mode');
  assert.equal(index.prove('node.url.fileurltopath', missingOptions).verdict, 'unknown');
});

test('util.format proof stays primitive-only until the Node inspect object contract is available', () => {
  const facts = new Facts()
    .prove('node.moduleBinding', 'node:util builtin', 'module resolver')
    .prove('node.bindingIntegrity', 'pristine', 'binding analysis')
    .prove('node.valueDomain', 'primitive', 'value-flow analysis');
  const proof = index.prove('node.util.format', facts);
  assert.equal(proof.verdict, 'proven');
  assert.equal(proof.lowering, 'NodeUtil.Format');

  facts.prove('node.valueDomain', 'object-or-primitive', 'value-flow join');
  assert.equal(index.prove('node.util.format', facts).verdict, 'disproven');
});

test('gzipSync proof requires the sibling Buffer bridge and default options', () => {
  const base = new Facts()
    .prove('node.zlib.bindingIntegrity', 'pristine', 'module/member integrity')
    .prove('node.zlib.input', 'bytes-or-utf8-string', 'input representation')
    .prove('node.zlib.options', 'defaults', 'options analysis');

  assert.equal(index.prove('node.zlib.gzip.sync', base).verdict, 'unknown');

  base.prove('node.bufferBridge', 'proven', 'NODE_EVENTS_STREAMS_BUFFER integration proof');
  assert.equal(index.prove('node.zlib.gzip.sync', base).verdict, 'proven');

  base.prove('node.zlib.options', 'custom', 'observable zlib options');
  assert.equal(index.prove('node.zlib.gzip.sync', base).verdict, 'disproven');
});

test('URLSearchParams serializer proof requires intrinsic receiver and pristine member', () => {
  const facts = new Facts()
    .prove('web.urlSearchParams.receiver', 'intrinsic', 'receiver analysis')
    .prove('web.urlSearchParams.memberIntegrity', 'pristine', 'prototype/member integrity')
    .prove('web.urlSearchParams.profile', 'string-list-v1', 'runtime representation');
  assert.equal(index.prove('web.urlsearchparams.to-string', facts).verdict, 'proven');

  facts.prove('web.urlSearchParams.memberIntegrity', 'overridden', 'observable replacement');
  assert.equal(index.prove('web.urlsearchparams.to-string', facts).verdict, 'disproven');
});

test('unreviewed nearby rules fail closed', () => {
  assert.throws(
    () => index.prove('node.util.inspect', new Facts()),
    /No reviewed NODE_URL_UTIL_ZLIB_MISC adapter/,
  );
});
