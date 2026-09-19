# Node process/path/os compatibility lane

This directory is the compiler-side proof boundary for the reviewed `node_core`
rules owned by workstream `NODE_PROCESS_PATH_OS`.

The parser/module graph on the current main branch cannot yet prove CommonJS or ESM
builtin bindings. Therefore this lane does **not** recognize source text such as
`require("path")` or `import path from "node:path"` by spelling. Callers must
supply binding-origin facts produced by a future reviewed module resolver. Missing,
shadowed, or contradictory facts remain fail-closed.

`index.ts` pins the complete SHA-256 of each consumed upstream rule at the pinned
j2cs commit and maps its requirements onto the shared fact/proof model. The runtime
helpers live under `runtime/J2cs.Runtime/NodeCompat/`.

Implemented reviewed contracts:

- `process.argv`, `process.env`, `process.cwd()`, `process.chdir()`,
  `process.platform`, and `process.arch`;
- `path.normalize()`, `path.join()`, `path.isAbsolute()`, `path.sep`, and
  `path.delimiter` for explicit host/POSIX/win32 lexical flavors;
- `os.platform()`, `os.arch()`, and `os.EOL`.

The runtime deliberately does not claim unimplemented generic process.env
enumeration/Proxy behavior, drive-specific win32 cwd resolution, or other Node APIs.
Those remain unsupported until their owning object/module semantics are available.
