import { fail, type Span } from '../diagnostics/index.js';
import { isPrimitiveSet, type TypeSet } from './facts.js';

export type ExpressionUse = 'value' | 'statement';

export function requirePrimitiveAwait(types: TypeSet, span: Span): void {
  if (!isPrimitiveSet(types))
    fail('E_ASYNC_THENABLE_DEPENDENCY',
      'await is currently enabled only for proven primitive/non-thenable values; Promise/thenable adoption belongs to the unmerged Promise core.', span);
}

export function requireDiscardedAsyncResult(use: ExpressionUse, span: Span): void {
  if (use !== 'statement')
    fail('E_ASYNC_PROMISE_DEPENDENCY',
      'The returned Promise from an async function is not yet representable on this branch; only a directly discarded async call is safe.', span);
}
