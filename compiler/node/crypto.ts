export const NODE_CRYPTO_RULE_DB_COMMIT = '35ca8d859f9352e90ee2497f4ac8f6edb9c19ed1';

export interface NodeCryptoRuleProof {
  id: string;
  path: string;
  sha256: string;
}

export const NODE_CRYPTO_RULE_PROOFS = [
  { id: 'node.crypto.create-hash', path: 'rules/node_http_crypto/crypto-create-hash.json', sha256: '61916a47c669259f351de7cb835deaa0d757f80b58b41a5825a234fee4e06fcd' },
  { id: 'node.crypto.hash.update', path: 'rules/node_http_crypto/crypto-hash-update.json', sha256: '2da75babb96852a20eeb6278f648cd56610593f2131dd55470e94903a0a2582a' },
  { id: 'node.crypto.hash.digest', path: 'rules/node_http_crypto/crypto-hash-digest.json', sha256: '8d9d38b8671ab6431e03cd8e551eda1454fb3ad5017a838b622c6182cb834d83' },
  { id: 'node.crypto.create-hmac', path: 'rules/node_http_crypto/crypto-create-hmac.json', sha256: '6ba1ab539f3adcb5f6310f3ba35e9c63ed8843231532d342a87679c085550afe' },
  { id: 'node.crypto.hmac.update', path: 'rules/node_http_crypto/crypto-hmac-update.json', sha256: '292364a6a64a241f8f8c1d42be6668bbb545e106f20cde7b479509a058fea4d7' },
  { id: 'node.crypto.hmac.digest', path: 'rules/node_http_crypto/crypto-hmac-digest.json', sha256: '4b62145c05ad2b296f70d855fe0b0b20f6a47f8c855b904b23af9cec99cf1619' },
  { id: 'node.crypto.random-bytes-sync', path: 'rules/node_http_crypto/crypto-random-bytes-sync.json', sha256: '7d9902052fabf59c6c2d9cc51c5c5c96c5b4172f5577a76e9acf5f155c9f163e' },
  { id: 'node.crypto.random-int-sync', path: 'rules/node_http_crypto/crypto-random-int-sync.json', sha256: 'a9c2123f834a7780c41abac857d8e6c0fac183e4cb06235d56b4f67c5b3972db' },
  { id: 'node.crypto.random-uuid', path: 'rules/node_http_crypto/crypto-random-uuid.json', sha256: 'f3a70fb92dd581e5eb36d3f697c91a4216b7d51bc132ba5c0cfe4ec175ac3506' },
  { id: 'node.crypto.timing-safe-equal', path: 'rules/node_http_crypto/crypto-timing-safe-equal.json', sha256: '1e28adeb429990b9fc1db1f905a1143896918633047703157190d1eab165eba4' },
  { id: 'node.crypto.create-secret-key', path: 'rules/node_http_crypto/crypto-create-secret-key.json', sha256: 'ac323e24534294022be0f53a5bb5141a27503d53c243f26678da871a20792e04' },
  { id: 'node.crypto.secret-key-export', path: 'rules/node_http_crypto/crypto-secret-key-export.json', sha256: 'ae06a059ae46f023abbaca0fa0046b0a0c443c557fa1c47a2b6034f18e742e5d' },
  { id: 'web.subtle-crypto.digest', path: 'rules/web_crypto/07-subtle-crypto-digest.json', sha256: '581a5cb2c7556495353ded3d1afab9e9685e6c39aa0e4ef538aad785648f636c' },
  { id: 'web.subtle-crypto.digest.sha-256', path: 'rules/web_crypto/09-subtle-crypto-digest-sha-256.json', sha256: 'e7108e48b002bc316495d869cc23ba757f030e4506258ba98ba2e1e5a165195e' },
  { id: 'web.subtle-crypto.digest.sha-384', path: 'rules/web_crypto/10-subtle-crypto-digest-sha-384.json', sha256: 'f1eded2ce4236bdf5394f3f516e949cc9762ca8e9524e3133c00a2be33ecfa78' },
  { id: 'web.subtle-crypto.digest.sha-512', path: 'rules/web_crypto/11-subtle-crypto-digest-sha-512.json', sha256: '5ed99d9ca3340d1d36e2f7a8b0ad691c3b3de27034db9f12dad34b29ee3cd465' },
] as const satisfies readonly NodeCryptoRuleProof[];

export interface NodeCryptoFacts {
  nodeCryptoBuiltin: boolean;
  builtinNotShadowed: boolean;
  bufferCompat: boolean;
  webCryptoIntrinsic: boolean;
  bufferSourceCompat: boolean;
  promiseJobs: boolean;
}

export type NodeCryptoRequest =
  | { kind: 'hash-utf8'; algorithm: string; digestEncoding: 'hex' | 'base64' }
  | { kind: 'hmac-utf8'; algorithm: string; digestEncoding: 'hex' | 'base64' }
  | { kind: 'random-int' }
  | { kind: 'random-uuid' }
  | { kind: 'random-bytes' }
  | { kind: 'timing-safe-equal' }
  | { kind: 'secret-key' }
  | { kind: 'webcrypto-digest'; algorithm: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' };

export interface NodeCryptoRuntimePlan {
  status: 'runtime';
  helpers: readonly string[];
  ruleIds: readonly string[];
  proof: readonly string[];
}

export interface NodeCryptoUnsupportedPlan {
  status: 'unsupported';
  code: string;
  message: string;
  ruleIds: readonly string[];
}

export type NodeCryptoPlan = NodeCryptoRuntimePlan | NodeCryptoUnsupportedPlan;

const supportedDigests = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512']);

function normalizeDigest(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '');
}

function unsupported(code: string, message: string, ruleIds: readonly string[]): NodeCryptoUnsupportedPlan {
  return { status: 'unsupported', code, message, ruleIds };
}

function requireNodeBuiltin(facts: NodeCryptoFacts, ruleIds: readonly string[]): NodeCryptoUnsupportedPlan | undefined {
  if (!facts.nodeCryptoBuiltin)
    return unsupported('E_NODE_CRYPTO_MODULE_PROOF', 'node:crypto builtin identity is not proven', ruleIds);
  if (!facts.builtinNotShadowed)
    return unsupported('E_NODE_CRYPTO_INTRINSIC_MUTATION', 'node:crypto builtin integrity is not proven', ruleIds);
  return undefined;
}

function runtime(helpers: readonly string[], ruleIds: readonly string[], proof: readonly string[]): NodeCryptoRuntimePlan {
  return { status: 'runtime', helpers, ruleIds, proof };
}

export function planNodeCrypto(request: NodeCryptoRequest, facts: NodeCryptoFacts): NodeCryptoPlan {
  if (request.kind === 'webcrypto-digest') {
    const specific = request.algorithm === 'SHA-256' ? 'web.subtle-crypto.digest.sha-256'
      : request.algorithm === 'SHA-384' ? 'web.subtle-crypto.digest.sha-384'
      : request.algorithm === 'SHA-512' ? 'web.subtle-crypto.digest.sha-512'
      : 'web.subtle-crypto.digest';
    const rules = ['web.subtle-crypto.digest', specific] as const;
    if (!facts.webCryptoIntrinsic || !facts.builtinNotShadowed)
      return unsupported('E_WEB_CRYPTO_PROOF', 'intrinsic WebCrypto identity/integrity is not proven', rules);
    if (!facts.bufferSourceCompat)
      return unsupported('E_WEB_CRYPTO_BINARY_DEPENDENCY', 'BufferSource snapshot semantics are not available', rules);
    if (!facts.promiseJobs)
      return unsupported('E_WEB_CRYPTO_ASYNC_DEPENDENCY', 'Promise job/settlement semantics are not available', rules);
    return runtime(['NodeCrypto.WebCryptoDigestCore', 'JsWebCrypto.Digest'], rules,
      ['intrinsic_web_crypto_api=true', 'builtin_not_overridden=true', 'BufferSource snapshot proven', 'Promise jobs proven']);
  }

  const ruleIds: readonly string[] = request.kind === 'hash-utf8'
    ? ['node.crypto.create-hash', 'node.crypto.hash.update', 'node.crypto.hash.digest']
    : request.kind === 'hmac-utf8'
      ? ['node.crypto.create-hmac', 'node.crypto.hmac.update', 'node.crypto.hmac.digest']
      : request.kind === 'random-int'
        ? ['node.crypto.random-int-sync']
        : request.kind === 'random-uuid'
          ? ['node.crypto.random-uuid']
          : request.kind === 'random-bytes'
            ? ['node.crypto.random-bytes-sync']
            : request.kind === 'timing-safe-equal'
              ? ['node.crypto.timing-safe-equal']
              : ['node.crypto.create-secret-key', 'node.crypto.secret-key-export'];

  const missingBuiltin = requireNodeBuiltin(facts, ruleIds);
  if (missingBuiltin) return missingBuiltin;

  if ((request.kind === 'hash-utf8' || request.kind === 'hmac-utf8') &&
      !supportedDigests.has(normalizeDigest(request.algorithm))) {
    return unsupported('E_NODE_CRYPTO_ALGORITHM',
      'algorithm is outside the bounded .NET digest host contract', ruleIds);
  }

  if (request.kind === 'hash-utf8') {
    return runtime(['NodeCrypto.CreateHash', 'NodeCrypto.HashUpdate', 'NodeCrypto.HashDigest'], ruleIds,
      ['module_binding=node:crypto builtin', 'builtin_not_shadowed=true', 'UTF-8 string input', `digest=${request.digestEncoding}`]);
  }
  if (request.kind === 'hmac-utf8') {
    return runtime(['NodeCrypto.CreateHmac', 'NodeCrypto.HmacUpdate', 'NodeCrypto.HmacDigest'], ruleIds,
      ['module_binding=node:crypto builtin', 'builtin_not_shadowed=true', 'UTF-8 string key/input', `digest=${request.digestEncoding}`]);
  }
  if (request.kind === 'random-int') {
    return runtime(['NodeCrypto.RandomInt'], ruleIds,
      ['module_binding=node:crypto builtin', 'builtin_not_shadowed=true', 'safe-integer endpoints', 'range<2^48']);
  }
  if (request.kind === 'random-uuid') {
    return runtime(['NodeCrypto.RandomUuid'], ruleIds,
      ['module_binding=node:crypto builtin', 'builtin_not_shadowed=true', 'canonical RFC4122 v4 format']);
  }

  if (!facts.bufferCompat) {
    return unsupported('E_NODE_CRYPTO_BUFFER_DEPENDENCY',
      'this Node crypto surface observes Buffer identity/view semantics owned by the Buffer lane', ruleIds);
  }

  if (request.kind === 'random-bytes') {
    return runtime(['NodeCrypto.RandomBytes'], ruleIds,
      ['module_binding=node:crypto builtin', 'builtin_not_shadowed=true', 'Buffer bridge proven']);
  }
  if (request.kind === 'timing-safe-equal') {
    return runtime(['NodeCrypto.TimingSafeEqual'], ruleIds,
      ['module_binding=node:crypto builtin', 'builtin_not_shadowed=true', 'Buffer bridge proven', 'equal byte length or throw']);
  }
  return runtime(['NodeCrypto.CreateSecretKey', 'NodeCrypto.ExportSecretKey'], ruleIds,
    ['module_binding=node:crypto builtin', 'builtin_not_shadowed=true', 'Buffer bridge proven', 'key material copied']);
}
